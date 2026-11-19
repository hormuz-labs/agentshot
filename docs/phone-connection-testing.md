# Google phone connection regression checklist

Google discovery is account-based, not UDP pairing discovery. The desktop sends a heartbeat every 30 seconds; the account lists only registrations heard from within two minutes. The phone probes the certificate-pinned `/hello` endpoint with an account-issued token.

## Outbound relay (Android and iPhone)

Both the desktop and phone connect outbound to `wss://relay.agentshot.si` on port 443. A loopback CONNECT proxy on the phone carries the existing certificate-pinned TLS session through opaque binary WebSocket frames to the desktop bridge. The public relay cannot read HTTP, footage, tokens inside TLS, or events. No inbound port forwarding or phone access to the desktop VPN is required. Google/account authentication issues short-lived, role- and owner-bound routing tickets; the bridge separately verifies its own application token.

Worker tickets renew in place without restarting active downloads or SSE. A pool lessee change closes previous tunnels, and new routes are tied to the current lessee. Replaced desktop instances do not compete for the same identity. Direct LAN discovery stays available; Android retains its legacy mesh fallback. Intentionally blocked outbound WebSockets, captive portals and unavailable internet still cannot be bypassed.

Coverage: `test/relay.test.ts` covers authorization, binary forwarding, replacement, renewal, revocation, duplicate streams and oversized frames. `mobile/test/relay_connection_test.dart` uses a real Node HTTPS desktop behind an unresolvable hostname to verify Dart CONNECT, TLS pinning, bridge authorization, route serialization and proxy restart.

## Desktop internet proxies

Desktop internet fetches use Electron's Chromium stack (system proxy/PAC discovery); Node HTTP and relay WebSockets use a proxy-aware agent with dynamic system resolution. `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` (and lowercase equivalents) override system discovery; `NO_PROXY` is honored. Basic proxy credentials embedded in proxy URLs are supported and are not logged. Localhost, LAN and mesh connections remain direct. No TLS verification is disabled: institutional TLS inspection requires a properly trusted institutional CA. Native mesh helpers and unrelated external CLI tools have their own proxy capabilities; the WSS relay does not depend on the mesh helper succeeding.

`test/network.test.ts` covers policy, local bypass, credentials and real authenticated HTTPS CONNECT with proxy-side DNS. `test/e2e/network.e2e.ts` tests actual Electron streaming fetch through a proxy for URL and Request inputs. Physical tests are still needed for institution-specific PAC failover, NTLM/Kerberos or interactive proxy authentication, and TLS-inspecting networks; these are not certified by the local Basic-auth test.

## Relay deployment (not yet deployed)

1. Generate at least 32 random characters for `RELAY_SECRET` and place it in `manul-secrets` (or `gateway/.env`, then `gateway/k8s/set-secrets.sh`). Never commit the secret.
2. Point DNS `relay.agentshot.si` to the existing global gateway ingress IP. The GKE managed certificate must become active before WSS is usable.
3. Run the existing deployment workflow `gateway/k8s/deploy.sh`. It now bundles and applies `gateway/k8s/relay.yaml` and supplies account and relay with the same secret.
4. Check HTTPS `/healthz`, worker registration and real WSS upgrades from outside the cluster. Then ship both updated desktop and mobile builds.

The router currently requires **one replica**, with `Recreate` deployment strategy: sockets and routing state are in memory. Multiple replicas behind a random load balancer will break stream pairing. Restarts cause bounded reconnects but are not zero-downtime/high-availability. A load balancer can close long-lived WSS connections despite ping keepalives; clients must reconnect. Do not claim production reliability before the physical/network matrix below is completed.

## Automated coverage

| Failure or scenario | Regression coverage |
| --- | --- |
| Wrong Google account | `test/account-service.test.ts`: personal desktop owner isolation |
| Desktop offline / stale heartbeat | Account registration expiration and phone offline error |
| Desktop returns after network outage | Heartbeat retry and new registration |
| Desktop Wi-Fi address changes | Heartbeat publishes current URLs; phone refreshes stale listing |
| Desktop bridge identity resets / account token expires | Account issues new token; phone refreshes credentials |
| Initial desktop mesh join fails or helper exits | Heartbeat retries mesh startup, without delaying LAN registration |
| First address unreachable / container addresses listed | Parallel real TLS probes find another working address |
| Wrong TLS certificate | Real TLS probe rejects mismatched fingerprint |
| Desktop refuses token | Probe rejects 401; account credential refresh is attempted |
| Redirect returned instead of desktop response | Probe does not follow redirects |
| TCP/TLS/headers/body stall | Whole probe deadline; losing HTTP clients closed |
| Saved phone proxy is stale | Failed probes trigger mesh restart even with a saved proxy port |
| Mesh unavailable on platform | Bounded failure, no unhandled platform exception |
| Sign-in expires during refresh or mesh join | Authentication failure preserved, not reported as desktop offline |
| Malformed registration among valid computers | Bad entries skipped without hiding valid entries |
| Mesh IPv4 / IPv6 ranges | Address classification tests |

Run:

```sh
npx vitest run test/network.test.ts test/relay.test.ts test/worker-heartbeat.test.ts test/account.test.ts test/account-service.test.ts test/mobile-bridge.test.ts test/wallet-workers.test.ts
cd mobile
flutter test --no-pub test/account_connection_test.dart test/connection_probe_test.dart test/relay_connection_test.dart
```

## Device/network validation still required

- Android phone and desktop on the same home Wi-Fi, then on separate networks/mobile data.
- Guest Wi-Fi with client isolation, office firewall, VPN and captive portal. Verify outbound relay fallback where permitted; networks that block all routes must report failure rather than bypass TLS.
- Desktop suspend/resume, Wi-Fi reconnect, DHCP change, mesh-helper exit, and startup without internet followed by internet restoration.
- Phone background/resume and Wi-Fi/mobile-data switching during connection; Google account sign-out and sign-in on both devices.
- iOS and Android same-Wi-Fi and away connectivity, including a desktop behind the college VPN. Verify Wi-Fi/mobile-data switching and background/resume on each platform.
- Proxy-only desktop internet, environment and OS/PAC configurations, Basic credentials, rejected credentials, trusted institutional CA and proxy outage/recovery.
- Slow account service, account outage, expired credentials, unavailable mesh control server and desktop restart during connection.
- Two personal desktops under the same account, with one offline; ensure the chosen machine's credentials are used.

Unit tests cannot establish router, OS permission, mobile background-policy or production mesh reachability. Ship both updated phone and desktop builds, then run this matrix on physical devices.
