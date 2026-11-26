# AgentShot in Claude and ChatGPT (on the web)

An MCP server on the internet, so anyone can use AgentShot from Claude (claude.ai, the apps, Claude Code) or ChatGPT
without installing anything. They connect AgentShot, sign in with their AgentShot account (Google on Clerk), and their
edits run on **their own cloud worker**. The tools are the same ones AgentShot's MCP server has on a computer
([src/main/mcp.ts](../src/main/mcp.ts)), and `open_editor` shows the same editor page
([src/mcp-app](../src/mcp-app)) beside the chat.

```
Claude / ChatGPT ──MCP over HTTPS, Bearer <Clerk token>──▶ chat-host (mcp.agentshot.si/mcp)
   │  no token: 401 + where to sign in (/.well-known/oauth-protected-resource) ──▶ Clerk (OAuth, PKCE)
   ▼
chat-host ──/oauth/userinfo──▶ Clerk                          who is it
          ──POST /v1/key (their token)──▶ account service     their AgentShot key (as the desktop app gets it)
          ──POST /v1/workers/lease (their key)──▶ account     their worker: addresses, certificate, lease token
          ──/rpc outside:tools · outside:call──▶ their worker the tools, on their own projects (the bridge checks)
          ◀──/media?project&file (ranges)── their worker      the editor's video, through signed links here
```

- **Tools:** `projects` lists the person's projects in their space (newest first); every other tool takes `project`.
  `add_files` (a path on a computer) is left out; `add_video` takes a link instead: an https address the person gives,
  or the link ChatGPT gives a tool for an attached file. Only https and public addresses are fetched
  ([src/intake.ts](src/intake.ts)).
- **The editor:** `ui://agentshot/editor.html`, the same file AgentShot serves on a computer. Its video plays from
  `/media/<signed link>/<file>` here: a link is for one person and one project, and runs out after six hours.
- **Credits:** work on the worker is charged to the person's wallet as it is from the phone. The chat's own model
  (Claude, ChatGPT) is the chat's, so it costs AgentShot nothing.

## Setting it up

1. **Clerk** (dashboard → Configure → OAuth applications): switch on **Dynamic client registration** so Claude and
   ChatGPT can register themselves, and (Settings → Client onboarding) **Publish DCR support**. Check:
   `curl https://clerk.agentshot.si/.well-known/oauth-authorization-server` must show a `registration_endpoint`.
   With it on, Clerk shows people a consent screen the first time ("AgentShot wants to…").
2. **DNS:** `mcp.agentshot.si` to the cluster's ingress, with TLS, like `account.agentshot.si`.
3. **Secrets** (`manul-secrets`): `CHAT_LINK_SECRET`, a random string (`openssl rand -base64 48`); it signs video
   links. **Mesh:** a Headscale pre-auth key for the sidecar, `CHAT_MESH_AUTHKEY`
   (`headscale preauthkeys create --user agentshot --reusable --expiration 8760h`), so chat-host reaches the workers.
4. **Deploy:** `gateway/k8s/deploy-chat-host.sh` (it bundles the server and the editor page into two ConfigMaps, as
   the account service ships, and applies [gateway/k8s/chat-host.yaml](../gateway/k8s/chat-host.yaml)). Then route
   `mcp.agentshot.si` to the `chat-host` service in the ingress, as `account.agentshot.si` is routed.
5. **Try it:** in Claude, Settings → Connectors → Add custom connector → `https://mcp.agentshot.si/mcp`; in ChatGPT,
   Settings → Apps → developer mode → Create → the same address. Sign in, then: "add this video
   <link> to AgentShot and open the editor".
6. **Listing:** Claude's connector directory and ChatGPT's app directory, once it has run for a while.

## Settings

| Variable | What |
|---|---|
| `PUBLIC_URL` | where it is, e.g. `https://mcp.agentshot.si` |
| `CLERK_ISSUER` | `https://clerk.agentshot.si` |
| `ACCOUNT_URL` | the account service, inside the cluster: `http://account` |
| `LINK_SECRET` | signs the editor's video links |
| `EDITOR_PAGE` | the built editor page (`npm run chat-host:build` makes it beside the bundled server) |
| `PORT` | 8080 |

## Developing

`npx vitest run test/chat-host*.test.ts` runs it against a real bridge in cloud-worker mode, with Clerk and the
account service as they answer. To run the server: `npm run chat-host:build`, then `EDITOR_PAGE=out/chat-host/editor.html` `PUBLIC_URL=… CLERK_ISSUER=… ACCOUNT_URL=… LINK_SECRET=… node chat-host/server.mjs`.
