// agentshot-mcp: the small program an agent starts to talk to AgentShot when it speaks MCP over stdin and stdout
// (the Claude app, Codex) instead of over HTTP. It stays running for as long as the agent's chat is open, so it is
// kept tiny: it reads one JSON-RPC message per line and passes each to AgentShot's own MCP server on this computer
// (src/main/mcp.ts), which does the work.
//
//   agentshot-mcp <state file> [--app <AgentShot>] [--from <agent's name>]
//
// The state file is the one AgentShot keeps (the switch, the port, the token), read afresh for every message, so a
// new token or port needs no new setup. While AgentShot is closed, the questions an agent asks just to get ready
// (initialize, ping, the list of tools as AgentShot last gave it) are answered here, so opening a chat doesn't open
// the editor; the first real request opens it, in the background, and waits for it.
use serde_json::{json, Value};
use std::io::{self, BufRead, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const PROTOCOL: &str = "2025-06-18";
const SWITCH_ON: &str = "Editing from other agents is switched off in AgentShot. Ask the user to open AgentShot's Settings → Keys and switch on \"Edit from Claude Code or Codex\".";
const NOT_OPEN: &str = "AgentShot isn't open. Ask the user to open it, then try again.";

struct State {
    enabled: bool,
    port: u16,
    token: String,
}

fn read_state(file: &Path) -> Option<State> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()?;
    Some(State {
        enabled: v["enabled"].as_bool().unwrap_or(false),
        port: v["port"].as_u64().and_then(|p| u16::try_from(p).ok()).unwrap_or(0),
        token: v["token"].as_str().unwrap_or("").to_string(),
    })
}

enum Sent {
    /// AgentShot answered: its status and what it said.
    Answer(u16, String),
    /// Nothing is listening there (AgentShot is closed, or the switch is off).
    Closed,
}

/// Removes HTTP chunking ("<hex size>\r\n<bytes>\r\n" … "0\r\n\r\n").
fn unchunk(mut body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    while let Some(end) = body.windows(2).position(|w| w == b"\r\n") {
        let size = std::str::from_utf8(&body[..end]).ok().and_then(|s| usize::from_str_radix(s.split(';').next().unwrap_or("").trim(), 16).ok());
        let Some(size) = size else { break };
        let start = end + 2;
        if size == 0 || start + size > body.len() {
            break;
        }
        out.extend_from_slice(&body[start..start + size]);
        body = &body[(start + size + 2).min(body.len())..];
    }
    out
}

/// Splits a whole HTTP reply into its status and its body.
fn parse_reply(raw: &[u8]) -> Option<(u16, String)> {
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = String::from_utf8_lossy(&raw[..split]).to_lowercase();
    let status: u16 = head.split_whitespace().nth(1)?.parse().ok()?;
    let body = &raw[split + 4..];
    let chunked = head.lines().any(|l| l.starts_with("transfer-encoding:") && l.contains("chunked"));
    let body = if chunked { unchunk(body) } else { body.to_vec() };
    Some((status, String::from_utf8_lossy(&body).trim().to_string()))
}

/// One message to AgentShot and its answer. A tool call may run for a long time (a render), so reading never times out.
fn send(state: &State, from: &str, message: &str) -> io::Result<Sent> {
    let addr = SocketAddr::from(([127, 0, 0, 1], state.port));
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_secs(2)) {
        Ok(s) => s,
        Err(_) => return Ok(Sent::Closed),
    };
    let request = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nUser-Agent: agentshot-mcp\r\nX-AgentShot-From: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        state.port, state.token, from, message.len()
    );
    stream.write_all(request.as_bytes())?;
    stream.write_all(message.as_bytes())?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw)?;
    match parse_reply(&raw) {
        Some((status, body)) => Ok(Sent::Answer(status, body)),
        None => Err(io::Error::new(io::ErrorKind::InvalidData, "AgentShot's answer could not be read")),
    }
}

fn error(id: &Value, message: &str) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32000, "message": message } }).to_string()
}
fn result(id: &Value, result: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string()
}

/// What can be answered without AgentShot: getting ready, the tools as it last listed them, and the editor page the
/// chat shows (kept beside the tools as outside-resources.json; none before AgentShot ever gave one).
fn answer_closed(msg: &Value, tools_file: &Path) -> Option<String> {
    let id = &msg["id"];
    match msg["method"].as_str()? {
        "initialize" => Some(result(id, json!({
            "protocolVersion": msg["params"]["protocolVersion"].as_str().unwrap_or(PROTOCOL),
            "capabilities": { "tools": {}, "resources": {} },
            "serverInfo": { "name": "agentshot", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "AgentShot is a video editor on this computer. These tools edit the project the user has open in it; start with project_state.",
        }))),
        "ping" => Some(result(id, json!({}))),
        "tools/list" => {
            let tools: Value = serde_json::from_str(&std::fs::read_to_string(tools_file).ok()?).ok()?;
            tools.is_array().then(|| result(id, json!({ "tools": tools })))
        }
        "resources/list" | "resources/read" => {
            let kept: Value = std::fs::read_to_string(tools_file.with_file_name("outside-resources.json")).ok()
                .and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
            if msg["method"] == "resources/list" {
                let listed = if kept["resources"].is_array() { kept["resources"].clone() } else { json!([]) };
                return Some(result(id, json!({ "resources": listed })));
            }
            let page = &kept["read"][msg["params"]["uri"].as_str()?];
            page.is_object().then(|| result(id, page.clone()))
        }
        _ => None,
    }
}

/// Opens AgentShot without bringing it to the front.
fn open_app(app: &Path) {
    let mut cmd = if cfg!(target_os = "macos") && app.extension().is_some_and(|e| e == "app") {
        let mut c = Command::new("/usr/bin/open");
        c.arg("-g").arg("-a").arg(app);
        c
    } else {
        Command::new(app)
    };
    let _ = cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn();
}

struct Launcher {
    state_file: PathBuf,
    tools_file: PathBuf,
    app: Option<PathBuf>,
    from: String,
    opened: bool,
    /// How long to wait for AgentShot to start listening once opened.
    wait: Duration,
}

impl Launcher {
    fn try_send(&self, line: &str) -> io::Result<Sent> {
        match read_state(&self.state_file) {
            Some(s) if s.enabled && s.port != 0 && !s.token.is_empty() => send(&s, &self.from, line),
            _ => Ok(Sent::Closed),
        }
    }

    /// The line to write back for one message, if it is owed an answer.
    fn handle(&mut self, line: &str) -> Option<String> {
        let msg: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => return Some(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "Not JSON." } }).to_string()),
        };
        let id = msg.get("id").cloned().filter(|i| !i.is_null());
        let mut sent = self.try_send(line);
        if matches!(sent, Ok(Sent::Closed)) {
            // a note to the server, or a reply to it: nothing to say back
            let id = id.as_ref()?;
            if msg.get("method").is_none() {
                return None;
            }
            if let Some(answer) = answer_closed(&msg, &self.tools_file) {
                return Some(answer);
            }
            // a real request: open AgentShot (once), then wait for it to listen
            if let (Some(app), false) = (&self.app, self.opened) {
                open_app(app);
                self.opened = true;
                let until = Instant::now() + self.wait;
                while Instant::now() < until && matches!(sent, Ok(Sent::Closed)) {
                    std::thread::sleep(Duration::from_millis(250));
                    sent = self.try_send(line);
                }
            }
            if matches!(sent, Ok(Sent::Closed)) {
                let off = read_state(&self.state_file).map_or(true, |s| !s.enabled);
                return Some(error(id, if off { SWITCH_ON } else { NOT_OPEN }));
            }
        }
        match sent {
            Ok(Sent::Answer(200, body)) if !body.is_empty() => Some(body),
            // taken note of (202), or an empty answer: nothing to pass on
            Ok(Sent::Answer(status, _)) if (200..300).contains(&status) => None,
            Ok(Sent::Answer(_, body)) => {
                let said = serde_json::from_str::<Value>(&body).ok().and_then(|v| v["error"]["message"].as_str().map(str::to_string));
                id.map(|id| error(&id, &said.unwrap_or_else(|| "AgentShot refused the request.".to_string())))
            }
            Ok(Sent::Closed) => None,
            Err(e) => id.map(|id| error(&id, &format!("AgentShot stopped answering ({e})."))),
        }
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(state_file) = args.next().map(PathBuf::from) else {
        eprintln!("usage: agentshot-mcp <state file> [--app <AgentShot>] [--from <agent's name>]");
        std::process::exit(2);
    };
    let (mut app, mut from, mut wait) = (None, String::from("Another agent"), 40);
    while let Some(flag) = args.next() {
        match (flag.as_str(), args.next()) {
            ("--app", Some(v)) => app = Some(PathBuf::from(v)),
            ("--from", Some(v)) => from = v.chars().filter(|c| c.is_ascii_alphanumeric() || *c == ' ').take(40).collect(),
            ("--wait", Some(v)) => wait = v.parse().unwrap_or(wait),
            _ => {}
        }
    }
    let tools_file = state_file.with_file_name("outside-tools.json");
    let mut launcher = Launcher { state_file, tools_file, app, from, opened: false, wait: Duration::from_secs(wait) };
    let stdin = io::stdin();
    let mut out = io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(answer) = launcher.handle(line) {
            // one message per line: an answer never carries a raw newline
            if writeln!(out, "{}", answer.replace('\n', " ")).and_then(|_| out.flush()).is_err() {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_plain_reply_and_a_chunked_one() {
        assert_eq!(parse_reply(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"a\":1}"), Some((200, "{\"a\":1}".to_string())));
        let chunked = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\n{\"a\"\r\n3\r\n:1}\r\n0\r\n\r\n";
        assert_eq!(parse_reply(chunked), Some((200, "{\"a\":1}".to_string())));
        assert_eq!(parse_reply(b"HTTP/1.1 202 Accepted\r\n\r\n"), Some((202, String::new())));
        assert_eq!(parse_reply(b"not http"), None);
    }

    #[test]
    fn a_cut_off_chunk_gives_what_arrived_whole() {
        assert_eq!(unchunk(b"3\r\nabc\r\n5\r\nde"), b"abc".to_vec());
        assert_eq!(unchunk(b"zz\r\nabc\r\n"), Vec::<u8>::new());
    }

    #[test]
    fn gets_an_agent_ready_while_agentshot_is_closed() {
        let none = Path::new("/nonexistent/outside-tools.json");
        let init: Value = serde_json::from_str(&answer_closed(&json!({ "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26" } }), none).unwrap()).unwrap();
        assert_eq!(init["id"], 1);
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(init["result"]["serverInfo"]["name"], "agentshot");
        assert!(answer_closed(&json!({ "id": 2, "method": "ping" }), none).unwrap().contains("\"result\":{}"));
        // no list kept yet, and anything that does work: AgentShot has to answer those itself
        assert!(answer_closed(&json!({ "id": 3, "method": "tools/list" }), none).is_none());
        assert!(answer_closed(&json!({ "id": 4, "method": "tools/call", "params": { "name": "project_state" } }), none).is_none());
        assert_eq!(init["result"]["capabilities"]["resources"], json!({}));
        // no page kept yet: none to list, and nothing opened to say so
        let listed: Value = serde_json::from_str(&answer_closed(&json!({ "id": 5, "method": "resources/list" }), none).unwrap()).unwrap();
        assert_eq!(listed["result"]["resources"], json!([]));
        assert!(answer_closed(&json!({ "id": 6, "method": "resources/read", "params": { "uri": "ui://agentshot/editor.html" } }), none).is_none());
    }

    #[test]
    fn shows_the_editor_page_agentshot_last_gave() {
        let dir = std::env::temp_dir().join(format!("agentshot-mcp-page-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let tools = dir.join("outside-tools.json");
        let page = json!({ "contents": [{ "uri": "ui://agentshot/editor.html", "mimeType": "text/html;profile=mcp-app", "text": "<!doctype html>" }] });
        std::fs::write(dir.join("outside-resources.json"), json!({ "resources": [{ "uri": "ui://agentshot/editor.html" }], "read": { "ui://agentshot/editor.html": page } }).to_string()).unwrap();
        let listed: Value = serde_json::from_str(&answer_closed(&json!({ "id": 1, "method": "resources/list" }), &tools).unwrap()).unwrap();
        assert_eq!(listed["result"]["resources"][0]["uri"], "ui://agentshot/editor.html");
        let read: Value = serde_json::from_str(&answer_closed(&json!({ "id": 2, "method": "resources/read", "params": { "uri": "ui://agentshot/editor.html" } }), &tools).unwrap()).unwrap();
        assert_eq!(read["result"], page);
        // a page it doesn't have is AgentShot's to answer
        assert!(answer_closed(&json!({ "id": 3, "method": "resources/read", "params": { "uri": "ui://agentshot/other.html" } }), &tools).is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn lists_the_tools_agentshot_last_gave() {
        let dir = std::env::temp_dir().join(format!("agentshot-mcp-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("outside-tools.json");
        std::fs::write(&file, r#"[{"name":"project_state","description":"The project.","inputSchema":{"type":"object"}}]"#).unwrap();
        let listed: Value = serde_json::from_str(&answer_closed(&json!({ "id": "a", "method": "tools/list" }), &file).unwrap()).unwrap();
        assert_eq!(listed["result"]["tools"][0]["name"], "project_state");
        std::fs::write(&file, "{}").unwrap();
        assert!(answer_closed(&json!({ "id": "a", "method": "tools/list" }), &file).is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn says_what_to_do_when_the_switch_is_off_or_agentshot_is_closed() {
        let dir = std::env::temp_dir().join(format!("agentshot-mcp-state-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let state = dir.join("outside.json");
        let mut l = Launcher { state_file: state.clone(), tools_file: dir.join("outside-tools.json"), app: None, from: "Test".into(), opened: false, wait: Duration::from_secs(0) };
        let call = r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"project_state"}}"#;
        // never switched on (no file), then switched off
        assert!(l.handle(call).unwrap().contains("switched off"));
        std::fs::write(&state, r#"{"enabled":false,"port":1}"#).unwrap();
        assert!(l.handle(call).unwrap().contains("switched off"));
        // on, but nothing listening on its port
        std::fs::write(&state, r#"{"enabled":true,"port":1,"token":"t"}"#).unwrap();
        let said: Value = serde_json::from_str(&l.handle(call).unwrap()).unwrap();
        assert_eq!(said["id"], 7);
        assert_eq!(said["error"]["message"], NOT_OPEN);
        // notes are owed no answer, and what isn't JSON gets a parse error
        assert!(l.handle(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).is_none());
        assert!(l.handle("hello").unwrap().contains("-32700"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
