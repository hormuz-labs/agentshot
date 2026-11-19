# Subscription connections (#14)

The local GPL desktop app can connect ChatGPT through OpenAI's documented
public-client OAuth flow. Settings → Keys → Your own keys → OpenAI → Connect →
ChatGPT subscription opens the system browser. Choose a **ChatGPT plan** model to use the
subscription instead of API billing. Multiple account/workspace registrations
remain separate. Sign out retains the host and client registration, but removes
tokens and attempts remote revocation.

If the initial code exchange returns `invalid_grant`, discard the one-use code
and automatically restart authorization once with the issued client ID, fresh
state, nonce, PKCE and callback listener. The unverified registration stays
separate from saved accounts until identity validation succeeds. Repeated
failures show a safe error code and request reference, never raw token bodies.

## Scope and release gate

- Local, open-source desktop execution only. Cloud workers cannot load or manage
  subscription credentials; tokens are never forwarded to AgentShot services.
- Eligible editing-agent requests use the public Responses endpoint, streaming
  with `store: false` and full local history. Unsupported request parameters and
  hosted tools are excluded. Function tools execute locally.
- Image/voice/music generation continues to require existing API keys or
  AgentShot credits. ChatGPT limits are shared with other apps.
- A selected subscription model becoming unavailable does **not** silently fall
  back to API billing. Users must explicitly choose another model.
- Before offering this in a paid product/plan or remotely hosted environment,
  obtain OpenAI approval via its interest form. This implementation does not
  establish that approval. A real account sign-in/inference test is still needed
  before release; automated tests use synthetic credentials and signed test JWTs.

## Credential handling

`chatgpt.enc` in Electron userData is encrypted with `safeStorage`, written
atomically with owner-only permissions. Linux `basic_text` storage is refused.
Tokens never appear in renderer state, `process.env`, tools, analytics or model
metadata. ID tokens are signature-verified against OpenAI JWKS and checked for
issuer, client audience, expiry, nonce and returning identity. Rotating refreshes
are serialized in the main process; sign-out cannot be undone by a late refresh.
Sign-out/account switching aborts in-flight inference. If revocation cannot be
confirmed, settings directs the user to disconnect the app in ChatGPT settings.

## Anthropic

Settings → Keys → Anthropic → Connect → Claude Code offers
**Sign in through Claude Code** and **Use existing sign-in**.
AgentShot runs Anthropic's published, unmodified Claude Code binary from the
official Agent SDK. Claude Code owns browser login, credential storage and
inference. AgentShot only reads `claude auth status` public connection metadata;
it never reads Claude credential files or intermediates subscription tokens.
All Claude Code authentication methods remain available. The panel distinguishes
Claude subscription authentication from API-key or third-party billing.

Choose a **Claude Code · own billing** model to use this backend. Model discovery
uses Claude Code's initialization handshake without sending an inference turn.
The backend exposes the existing editor, memory, browser and fenced file/shell
tools through an in-process MCP server. Built-in Claude Code filesystem/shell
tools and user/project settings are not enabled for editing requests. The
AgentShot SQLite transcript remains authoritative across restarts and backend
switches; hidden CLI sessions are not resumed. Interrupted tool calls are not
automatically replayed. Stop cancels inference and tool operations. Disconnect
disables only AgentShot's connection, not the user's other Claude Code sessions.

Mobile sign-in and cloud-worker Claude execution are not implemented. Using or
distributing Claude Code inside a product requires compliance with Anthropic's
commercial terms and published hosting conditions. This implementation does not
establish a commercial agreement. Real-account login and editing smoke tests are
required before release.

## Provider references

- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/siwc/ui-ux-guidelines
- https://openai.com/form/sign-in-with-chatgpt-interest/
- https://code.claude.com/docs/en/legal-and-compliance
