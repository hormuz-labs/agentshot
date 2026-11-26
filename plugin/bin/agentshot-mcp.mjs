#!/usr/bin/env node

// plugin/src/main.ts
import { spawn } from "node:child_process";
import { homedir } from "node:os";

// plugin/src/launcher.ts
import { request } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

// plugin/src/version.ts
var VERSION = "0.1.0";

// plugin/src/launcher.ts
var PROTOCOL = "2025-06-18";
var SWITCH_ON = `Editing from other agents is switched off in AgentShot. Ask the user to open AgentShot's Settings \u2192 Keys and switch on "Edit from Claude Code or Codex".`;
var NOT_OPEN = "AgentShot isn't open. Ask the user to open it, then try again.";
var INSTRUCTIONS = "AgentShot is a video editor on this computer. These tools edit the project the user has open in it; start with project_state.";
function defaultStateFile(env, platform, home) {
  if (env.AGENTSHOT_STATE) return env.AGENTSHOT_STATE;
  if (platform === "darwin") return join(home, "Library", "Application Support", "AgentShot", "outside.json");
  if (platform === "win32") return join(env.APPDATA || join(home, "AppData", "Roaming"), "AgentShot", "outside.json");
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "AgentShot", "outside.json");
}
async function readState(file) {
  try {
    const v = JSON.parse(await readFile(file, "utf8"));
    const port = Number(v?.port);
    return { enabled: v?.enabled === true, port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 0, token: typeof v?.token === "string" ? v.token : "" };
  } catch {
    return void 0;
  }
}
function send(state, from, message) {
  return new Promise((ok, fail) => {
    let connected = false;
    const req = request({
      host: "127.0.0.1",
      port: state.port,
      path: "/mcp",
      method: "POST",
      agent: false,
      headers: {
        host: `127.0.0.1:${state.port}`,
        authorization: `Bearer ${state.token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "user-agent": "agentshot-mcp",
        "x-agentshot-from": from,
        "content-length": String(Buffer.byteLength(message)),
        connection: "close"
      }
    }, (res) => {
      const parts = [];
      res.on("data", (p) => parts.push(p));
      res.on("end", () => ok({ status: res.statusCode || 0, body: Buffer.concat(parts).toString("utf8").trim() }));
      res.on("error", fail);
    });
    const timer = setTimeout(() => {
      if (!connected) req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
    }, 2e3);
    req.on("socket", (s) => s.once("connect", () => {
      connected = true;
      clearTimeout(timer);
    }));
    req.on("error", (e) => {
      clearTimeout(timer);
      connected ? fail(e) : ok("closed");
    });
    req.end(message);
  });
}
var error = (id, message, code = -32e3) => JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
var result = (id, value) => JSON.stringify({ jsonrpc: "2.0", id, result: value });
function oneLine(body) {
  try {
    return JSON.stringify(JSON.parse(body));
  } catch {
    return body.replace(/\r?\n/g, " ");
  }
}
var Launcher = class {
  constructor(o) {
    this.o = o;
    this.from = (o.from || "Another agent").replace(/[^A-Za-z0-9 ]/g, "").slice(0, 40) || "Another agent";
  }
  opened = false;
  from;
  get toolsFile() {
    return join(dirname(this.o.stateFile), "outside-tools.json");
  }
  async trySend(line) {
    const s = await readState(this.o.stateFile);
    return s && s.enabled && s.port && s.token ? send(s, this.from, line) : "closed";
  }
  /** What can be answered without AgentShot: getting ready, and the tools as it last listed them. */
  async answerClosed(msg) {
    if (msg.method === "initialize") {
      const asked = msg.params?.protocolVersion;
      return result(msg.id, { protocolVersion: typeof asked === "string" ? asked : PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "agentshot", version: VERSION }, instructions: INSTRUCTIONS });
    }
    if (msg.method === "ping") return result(msg.id, {});
    if (msg.method === "tools/list") {
      try {
        const tools = JSON.parse(await readFile(this.toolsFile, "utf8"));
        if (Array.isArray(tools)) return result(msg.id, { tools });
      } catch {
      }
    }
    return void 0;
  }
  /** The line to write back for one message, if it is owed an answer. */
  async handle(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return error(null, "Not JSON.", -32700);
    }
    if (!msg || typeof msg !== "object") return error(null, "Not JSON.", -32700);
    const id = msg.id ?? null;
    let sent;
    try {
      sent = await this.trySend(line);
    } catch (e) {
      return id === null ? void 0 : error(id, `AgentShot stopped answering (${e.message}).`);
    }
    if (sent === "closed") {
      if (id === null || typeof msg.method !== "string") return void 0;
      const ready = await this.answerClosed({ id, method: msg.method, params: msg.params });
      if (ready) return ready;
      if (!(await readState(this.o.stateFile))?.enabled) return error(id, SWITCH_ON);
      if (this.o.openApp && !this.opened) {
        this.opened = true;
        try {
          this.o.openApp();
        } catch {
        }
        const until = Date.now() + (this.o.waitMs ?? 4e4);
        while (sent === "closed" && Date.now() < until) {
          await new Promise((ok) => setTimeout(ok, this.o.intervalMs ?? 250));
          try {
            sent = await this.trySend(line);
          } catch (e) {
            return error(id, `AgentShot stopped answering (${e.message}).`);
          }
        }
      }
      if (sent === "closed") {
        const s = await readState(this.o.stateFile);
        return error(id, !s?.enabled ? SWITCH_ON : NOT_OPEN);
      }
    }
    if (sent.status === 200 && sent.body) return oneLine(sent.body);
    if (sent.status >= 200 && sent.status < 300) return void 0;
    if (id === null) return void 0;
    let said;
    try {
      said = JSON.parse(sent.body)?.error?.message;
    } catch {
    }
    return error(id, typeof said === "string" && said ? said : "AgentShot refused the request.");
  }
};
async function serve(input, output, launcher2) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const answer = await launcher2.handle(line);
    if (answer !== void 0 && !output.write(`${answer}
`)) await new Promise((ok) => output.once("drain", ok));
  }
}

// plugin/src/main.ts
function opener(env) {
  const start = (command, args) => () => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {
    });
    child.unref();
  };
  const app = env.AGENTSHOT_APP;
  if (process.platform === "darwin") return start("/usr/bin/open", ["-g", "-a", app || "AgentShot"]);
  return app ? start(app, []) : void 0;
}
var launcher = new Launcher({
  stateFile: defaultStateFile(process.env, process.platform, homedir()),
  from: process.env.AGENTSHOT_FROM || "Claude Code",
  openApp: opener(process.env)
});
await serve(process.stdin, process.stdout, launcher);
