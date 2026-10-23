# Manul anywhere connection

Sign in to the same Manul account on phone and computer. The desktop registers
with this relay using an outbound WebSocket. The phone discovers that account's
online computers and opens its own outbound WebSocket. Neither device needs an
inbound port, a VPN, a shared Wi-Fi network, or a public IP address.

## Run publicly

For Manul's existing `silverfish` cluster, run `sh relay/deploy.sh` from the
repository root. This deploys the bundled relay and adds its route/certificate to
the existing load balancer. Set a DNS-only Cloudflare A record for
`relay.manul.si` to `136.81.176.70`. If gcloud hangs looking up
`metadata.google.internal` on a development machine, prefix the command with
`GCE_METADATA_ROOT=127.0.0.1:9` to bypass that unavailable VM metadata lookup.
The standalone Docker setup is below.

1. In Clerk's **Manul desktop** public OAuth application, add the redirect URI
   `si.manul.mobile://oauth/callback`. Keep the existing desktop loopback redirect.
   Enable the `openid email profile offline_access` scopes and refresh-token grant.
   The existing client ID is public; no OAuth secret belongs in either app.
   Providers enabled in Manul's hosted sign-in (including Google or GitHub if
   configured there) are automatically available to both clients.
2. Point `relay.manul.si` DNS to an internet-facing server. Allow incoming ports
   80 and 443 **on that server**, not on users' computers.
3. From the repository root, on that server:

   ```sh
   docker compose -f relay/compose.yml up -d --build
   curl --fail https://relay.manul.si/healthz
   ```

   Caddy obtains the HTTPS certificate and forwards WebSocket upgrades. Use one
   relay replica: the live directory and tunnel rendezvous are process-local.
   Scaling requires shared routing or user-affine routing, not random replicas.
4. Desktop: Settings → Mobile → Sign in to Manul. Phone: Sign in to Manul,
   then select the computer. Mobile connection enablement survives desktop
   restart; disabling it persists. The computer must be awake and Manul running.

For an existing ingress, build `relay/Dockerfile`, expose port 8091 internally,
and route HTTPS/WSS to it with long-lived connections supported. Do not expose
the plain HTTP listener publicly. `CLERK_ISSUER` defaults to
`https://clerk.manul.si`. No Clerk secret key or database is required.

Custom deployments set desktop `MANUL_RELAY`, `MANUL_AUTH_ISSUER`, and
`MANUL_AUTH_CLIENT_ID` environment variables and the matching Flutter
`--dart-define=NAME=value` values. The mobile callback remains the URI above.
For relay-only development: `node --experimental-strip-types relay/start.ts`.

## Transport and trust

The cloud service forwards bytes; the existing bridge's TLS session runs inside
the WebSocket tunnel, from Flutter to the desktop. This preserves streaming,
range requests, uploads, SSE and the validated operation allowlist. Videos are
streamed rather than base64-encoded into whole-file messages. Cloud restarts and
network changes trigger discovery/reconnect; in-progress transfers must be retried.

Clerk verifies identity for discovery, every WebSocket, and periodic live-session
checks. The desktop independently verifies the phone's OAuth identity before
issuing a short-lived bridge token. OAuth credentials live in OS secure storage;
they are not the billing key or a provider API key. One device's disconnect
revokes its bridge token and blocks its current device ID until bridge restart.
Signing out removes the local OAuth session; account-wide OAuth revocation is
managed through the identity provider.

The relay sees account IDs, OAuth bearer tokens, desktop names, certificate
fingerprints and traffic timing/size. Application bytes are TLS ciphertext.
**The relay directory is trusted to supply the correct desktop fingerprint**;
this is not independently verified device identity against a malicious directory.
Normal clients never accept an arbitrary certificate. There is no custom cipher
or shared application-data key on the relay.

The relay bounds payloads, connections, outstanding authentication, and connection
attempts, and closes slow/broken streams. Its built-in IP limits use the actual TCP
peer (not untrusted forwarded headers); put internet-scale per-client rate limits
at the trusted ingress. No request body or bearer-token logging is enabled here.

## Reference and verification

```sh
npx vitest run test/mobile-relay.test.ts test/mobile-bridge.test.ts test/account.test.ts
npm run typecheck
cd mobile_app
flutter analyze
flutter test
```

Public use requires the DNS/HTTPS deployment and Clerk registration above.
Local integration tests do not establish public deployment or real-device
cross-network verification. Verify on a phone using cellular data, including
playback, uploads, exports, desktop restart, mobile network switch, and sign-out.
