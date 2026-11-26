# AgentShot plugin for Claude Code

Edit video from Claude Code with AgentShot's own tools: the transcript, the measurements, the timeline, motion clips
and exports. Claude edits the project you have open in AgentShot, and each new cut arrives there as a Before / After
to keep or send back. Your footage stays on your computer.

Tracking issue: [hormuz-labs/agentshot#140](https://github.com/hormuz-labs/agentshot/issues/140).

## Install

```
/plugin marketplace add hormuz-labs/agentshot
/plugin install agentshot@agentshot
```

Then, in AgentShot, open **Settings → Keys** and switch on **Edit from Claude Code or Codex**. There's no code or
password to copy: the plugin reads what it needs from AgentShot each time.

Use the plugin *or* AgentShot's **Add to Claude Code** button, not both: they're the same server under the same name.

## How it works

```
Claude Code ──stdio──▶ plugin launcher ──HTTP, 127.0.0.1, token──▶ AgentShot's MCP server (src/main/mcp.ts)
```

- The server is the one built into AgentShot (`src/main/mcp.ts`). It's off until switched on, listens on this
  computer only, refuses web pages and other hosts, and needs the token AgentShot makes.
- `bin/agentshot-mcp.mjs` is the launcher. It's the Node twin of the app's Rust launcher (`scripts/launcher`), so it
  runs wherever Claude Code does, Windows included, straight from the plugin folder. For every message it reads the
  port and token from AgentShot's state file (`outside.json` in AgentShot's settings folder), so the token is never
  in Claude Code's settings and a new one needs no new setup.
- While AgentShot is closed it still answers `initialize`, `ping` and the tool list (as AgentShot last gave it), so
  starting a chat doesn't open the editor. The first real request opens AgentShot in the background on macOS (or the
  app at `AGENTSHOT_APP` elsewhere) and waits for it. When editing from agents is switched off, it says how to
  switch it on.
- The `edit-video` skill tells Claude the setup and the workflow.

Environment: `AGENTSHOT_STATE` (the state file, when it isn't in the usual place), `AGENTSHOT_APP` (the app to open),
`AGENTSHOT_FROM` (who AgentShot says is at work; the plugin sets "Claude Code").

## Developing

The sources are in `src/`. `bin/agentshot-mcp.mjs` is a committed, dependency-free bundle, because Claude Code
installs plugins without running `npm install`. Rebuild it after changing the sources:

```
npm run plugin:build
```

`test/plugin-launcher.test.ts` drives the launcher against AgentShot's real MCP server. `test/plugin-packaging.test.ts`
checks the manifests and runs the bundle end to end, and fails when the bundle is stale.

## ChatGPT

ChatGPT apps connect to a remote MCP server over HTTPS rather than starting one on your computer. Offering AgentShot
there needs a hosted endpoint with its own sign-in, which is still open in #140.
