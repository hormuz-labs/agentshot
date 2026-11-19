# Google phone connection regression checklist

Google discovery is account-based, not UDP pairing discovery. The desktop sends a heartbeat every 30 seconds; the account lists only registrations heard from within two minutes. The phone probes the certificate-pinned `/hello` endpoint with an account-issued token.

## One remote transport: Headscale / tsnet (Android and iPhone)

LAN remains available; remote connections use the embedded userspace Tailscale mesh coordinated by Headscale. Tailscale prefers direct peer connections and uses its standard DERP fallback when NAT/firewalls prevent direct traffic. The separate application WSS router has been removed. Existing certificate-pinned TLS stays end to end inside the mesh, including relayed video traffic. Headscale itself does not transfer videos.

Desktop helpers retry startup and stop stale instances. The phone restarts a failed saved mesh and refreshes account routes after connection failure. Android now refreshes Java-provided interfaces on connectivity changes; Android and iOS notify tsnet to rebind after network changes. The iOS bridge uses the same Go userspace node, not a separate OS VPN; persistent device state stays in Application Support. This does not grant indefinite iOS background execution.

`scripts/mesh/mobile/mobile_test.go` verifies mesh-only CONNECT targets and preservation of TLS bytes buffered after headers. `scripts/mesh/derp_test.go` runs two real upstream DERP clients through authenticated HTTP CONNECT, with proxy-side DNS and certificate verification. This tests DERP transport, **not** a full Headscale/direct-to-DERP network transition.

## Desktop internet proxies

Desktop internet fetches use Electron's Chromium stack (system proxy/PAC discovery); Node HTTP uses a proxy-aware agent. The Go mesh helper receives a private, authenticated loopback CONNECT adapter that resolves the actual system/PAC proxy separately for each control/DERP destination. This adapter only carries mesh infrastructure traffic and is **not** a public application relay. Direct peer UDP remains managed by tsnet. `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` (and lowercase equivalents) override system discovery; `NO_PROXY` is honored. Basic proxy credentials embedded in environment proxy URLs are supported and are not logged by the helper. Localhost, LAN and mesh application requests remain direct. No TLS verification is disabled: institutional TLS inspection requires a properly trusted institutional CA. Unrelated external CLI tools have their own proxy capabilities.

`test/network.test.ts` covers policy, local bypass, credentials and real authenticated HTTPS CONNECT with proxy-side DNS. `test/e2e/network.e2e.ts` tests actual Electron streaming fetch through a proxy for URL and Request inputs. Physical tests are still needed for institution-specific PAC failover, NTLM/Kerberos or interactive proxy authentication, and TLS-inspecting networks; these are not certified by the local Basic-auth test.

`test/mesh-proxy.test.ts` verifies the native adapter's authentication, destination restrictions and large opaque transfers through an authenticated upstream proxy.

## Build and infrastructure checks

- Desktop: `scripts/build-mesh.sh desktop`; Android: `scripts/build-mesh.sh android` with SDK/NDK and JDK available.
- iOS: on macOS with Xcode and Go, run `scripts/build-mesh.sh ios` before Flutter builds. It generates the linked `mobile/ios/Frameworks/Mobile.xcframework` for devices and simulators; binaries are ignored. The mobile CI workflow now builds this framework before its iOS simulator build.
- Headscale must remain publicly reachable at `mesh.agentshot.si` over port 443 with its ts2021 HTTP upgrade preserved (the existing Caddy/TCP load balancer, not GKE's ordinary HTTPS ingress).
- Headscale currently advertises Tailscale's public DERP map. Confirm the returned map and reachability of its DERP hosts from the actual college proxy. An HTTP CONNECT proxy must permit the Headscale and DERP hostnames on port 443. Explicitly blocked upgrades/CONNECT cannot be guaranteed accessible.
- No new public WSS service, DNS name or relay secret is required. Updated desktop and mobile binaries are still required. Full Headscale + forced-DERP + physical iOS validation remains outstanding.

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
npx vitest run test/network.test.ts test/mesh-proxy.test.ts test/mesh.test.ts test/worker-heartbeat.test.ts test/account.test.ts test/account-service.test.ts test/mobile-bridge.test.ts test/wallet-workers.test.ts
(cd scripts/mesh && go test -race ./...)
cd mobile
flutter test --no-pub test/account_connection_test.dart test/connection_probe_test.dart test/mesh_lifecycle_test.dart
```

## Device/network validation still required

- Android phone and desktop on the same home Wi-Fi, then on separate networks/mobile data.
- Guest Wi-Fi with client isolation, office firewall, VPN and captive portal. Verify mesh DERP fallback where permitted; networks that block all routes must report failure rather than bypass TLS.
- Desktop suspend/resume, Wi-Fi reconnect, DHCP change, mesh-helper exit, and startup without internet followed by internet restoration.
- Phone background/resume and Wi-Fi/mobile-data switching during connection; Google account sign-out and sign-in on both devices.
- iOS and Android same-Wi-Fi and away connectivity, including a desktop behind the college VPN. Verify Wi-Fi/mobile-data switching and background/resume on each platform.
- Proxy-only desktop internet, environment and OS/PAC configurations, Basic credentials, rejected credentials, trusted institutional CA and proxy outage/recovery.
- Slow account service, account outage, expired credentials, unavailable mesh control server and desktop restart during connection.
- Two personal desktops under the same account, with one offline; ensure the chosen machine's credentials are used.

Unit tests cannot establish router, OS permission, mobile background-policy or production mesh reachability. Ship both updated phone and desktop builds, then run this matrix on physical devices.
