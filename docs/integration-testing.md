# Clerk, Dodo Payments, and Bifrost: end-to-end testing

## What the flow should do

```text
Desktop app → Clerk OAuth sign-in (PKCE, system browser)
            → account service POST /v1/key
            → Clerk userinfo + user private metadata
            → Bifrost customer + virtual key + $2 starting budget
            → key encrypted on this computer

Desktop agent → Bifrost /openai/responses → configured AI vendor
              → request usage charged against the user's budget

Add credit → account service POST /v1/checkout → Dodo hosted checkout
           → signed payment.succeeded webhook → account service
           → Bifrost budget increased + payment recorded in Clerk
           → app refreshes balance on window focus
```

Voice and music with a Manul account go through the account service, not Bifrost's inference route. The service generates audio and reduces the key's budget by its configured price.

## Checked on 2026-10-11

| Check | Result |
| --- | --- |
| TypeScript and desktop production build | Passed |
| Account, payments, media, and app gateway tests | 46 passed after fixes |
| Real Bifrost + Postgres payment recovery tests | 6 passed: provisioning, restart, ambiguous writes, two replicas, deactivation, concurrent audio/top-up |
| Actual Bifrost v2.2.6 with fake Gemini, Claude, and GPT | 3 passed, including tool-call state and images |
| Electron Manul-key settings screen | Passed; paste/remove and model selection |
| Production Clerk OAuth client | Public client, PKCE required, matching client ID and callback |
| Clerk secret in local `.env` | Can read the matching Manul OAuth application |
| Deployed account `/healthz` | HTTP 200 |
| Unauthenticated account/key/balance and invalid gateway key | HTTP 401 |
| Unsigned webhook | HTTP 401 |
| Signed unrelated webhook with local signing secret | HTTP 200, skipped without credit changes |
| Dodo test-mode API key and credit product | Valid; one-time USD, $5 minimum, $10 suggested, tax exclusive |
| Dodo Manul webhook | Enabled, correct account URL, subscribed to `payment.succeeded`; signing secret matches |
| Dodo $10 checkout price preview | HTTP 200, $10 subtotal |
| Real Gemini through local Bifrost | HTTP 200, reply `OK`, usage returned |
| Local account → actual Dodo test checkout | $4 rejected locally (400), $10 created test checkout (200) |
| Human Clerk login and completed paid test checkout | Still require the manual steps below |
| Deployed pods, logs, and backend environment | Inspection blocked by Kubernetes permissions |

Passing mocked tests or a webhook signature check does not establish that the whole real payment and credit flow passes.

## Five fixes implemented

1. **Double-credit on retry:** a durable Postgres operation journal records the absolute target budget before updating Bifrost. Per-key advisory locks serialize independent replicas, and retries reconcile the same recorded target. Verified after a process/store restart, a lost gateway response, and concurrent webhook delivery.
2. **Disabled audio keys:** shared account authentication now checks `is_active`, returning 403 before checkout or voice/music calls. Verified with an actual disabled Bifrost key.
3. **Local server import failure:** the server imports `src/index.ts`; a local launcher and full Compose stack now start the account service. Production deployment uses a bundled server including the Postgres driver.
4. **Local Azure mismatch:** key grants are filtered by `BIFROST_PROVIDERS`; Compose and the host launcher supply the local provider set, while production includes Azure. The local routing default is now Gemini to match the available vendor key.
5. **Payment minimum mismatch:** explicit checkout amounts below $5 are rejected before contacting Dodo. Checkout fixes currency to USD and disables currency selection.

These changes are in the checkout/local stack; remote services need deployment before their behavior changes.

The full repository test run found six unrelated failures due to missing native `manul-beats`, `manul-vision`, and `manul-speakers` executables; account/gateway tests passed.

## Fresh local test (recommended for these fixes)

```bash
docker compose -f gateway/docker-compose.yml up -d --build --wait
MANUL_ACCOUNT=http://127.0.0.1:8090 MANUL_GATEWAY=http://127.0.0.1:8089 npm run dev -- --user-data-dir=/tmp/manul-local-test
```

Use a new test email. Local Clerk links/payments live under `private_metadata.manul_local`, separate from deployed accounts. Open `http://127.0.0.1:8089` for the local dashboard. Its initial built-in `vk-dev` is expected; it is configured seed data, not an old user account.

Before setting up the dashboard, the account service can use `BIFROST_SETUP_TOKEN`. After you create the admin login, set `BIFROST_AUTH` in `gateway/.env` to `Basic <base64(username:password)>` and recreate the account container.

Follow the manual sign-in/AI/payment steps below using local account/gateway URLs. For Dodo payment delivery, expose local port 8090 through an HTTPS tunnel, set `PUBLIC_URL` in `gateway/.env`, create a separate test webhook targeting `<tunnel>/v1/dodo/webhook`, and use that endpoint's signing secret. Recreate the account container to reload `.env`. The existing `account.manul.si` webhook targets the deployed service.

To reset this local stack again (Bifrost plus local credit journal):

```bash
docker compose -f gateway/docker-compose.yml down --volumes
docker compose -f gateway/docker-compose.yml up -d --build --wait
```

This does not reset Clerk users or the desktop profile. Use a new test email/profile after a local data reset.

## Environment placement

- Desktop overrides live in a root `.env`, next to `package.json`. Load it explicitly with:

  ```bash
  node --env-file=.env node_modules/electron-vite/bin/electron-vite.js dev
  ```

- The deployment secret-update script reads `gateway/.env`. Copy the template's structure from `gateway/.env.example`; provide the actual server keys there for an authorized deployment.
- Root `.env` changes do not alter a remote account service or gateway. `gateway/k8s/set-secrets.sh` updates the current cluster and restarts services; running it requires deployment permissions.
- Root and gateway `.env` files are ignored by Git.
- The desktop defaults to `https://clerk.manul.si`, `https://account.manul.si`, and `https://gateway.manul.si`. Its OAuth client ID is `cYz60VvV9IL4cGH5`.
- For another deployment, configure `MANUL_AUTH_ISSUER`, `MANUL_AUTH_CLIENT_ID`, `MANUL_ACCOUNT`, and `MANUL_GATEWAY` together. The account service's `CLERK_ISSUER` and `CLERK_SECRET_KEY` must target the same Clerk instance; its `BIFROST_URL` must target the gateway that accepts the resulting keys.
- Compose now starts Bifrost, the account service, and its Postgres journal.

## Manual test: deployed services

Use one dedicated test user throughout and Dodo **Test Mode**. These steps exercise the current deployed services.

### 1. Start a clean desktop profile

From the project root:

```bash
node node_modules/electron-vite/bin/electron-vite.js dev -- --user-data-dir=/tmp/manul-integration-manual
```

Do not load provider keys for this test. Your own Gemini/Anthropic/OpenAI keys can select a direct vendor route and bypass Bifrost. The temporary profile avoids saved keys; also ensure those provider variables are not exported in the terminal.

### 2. Verify Clerk and account provisioning

1. Open **Settings → Keys → Manul key** (`⌘,`).
2. Click **Sign in to Manul**.
3. Complete email-code sign-in in the system browser. Test Google sign-in separately if you intend to support it.
4. The browser returns to `http://127.0.0.1:47619/oauth/callback`.
5. Return to the app. It should show the email and **$2.00 credit left** for a genuinely new account with no usage.
6. In Clerk Dashboard → Manul → **Production** → Users, locate that email. Its private metadata should contain:

   ```json
   { "bifrost": { "customer_id": "...", "virtual_key_id": "..." } }
   ```

7. In `https://admin.manul.si`, inspect that Bifrost customer and virtual key. The key name should be the Clerk user ID, its description the email, its initial budget $2, its reset duration `100Y`, and its request rate 300/hour.
8. Sign out and sign back in. The virtual-key ID and budget should be reused. No extra $2 or duplicate customer/key should appear.
9. Restart the app and check that the sign-in/key persists.

If callback port 47619 is busy, close the other app instance using it. The callback page says “Signed in” before account provisioning finishes; the app's final status and error determine whether the entire sign-in worked.

### 3. Verify Bifrost with real AI traffic

1. Confirm the app's selected model is **Manul**.
2. Create a project with a short disposable video.
3. Ask: **“Describe this video briefly without changing it.”**
4. Expect a real streamed reply. In Bifrost request logs, match the test user's key/customer, selected provider, routed model, token usage, and cost. The current production and local configurations route `manul` to Gemini.
5. Ask: **“Trim the timeline to the first five seconds.”** Expect a tool call, completed edit, and follow-up reply. This tests multi-step agent traffic.
6. Reopen/focus Settings → Keys → Manul key. Credit should decrease by the logged usage. Use the dashboard or balance API for precision: the UI rounds the displayed balance.

For a direct route check, set these variables to the test user's virtual-key **value** and **ID** from the Bifrost dashboard:

```bash
export MANUL_KEY='your-test-virtual-key-value'
export MANUL_KEY_ID='your-test-virtual-key-id'

curl -i https://gateway.manul.si/openai/responses \
  -H "Authorization: Bearer $MANUL_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"manul","input":"Reply with OK only.","max_output_tokens":256}'

curl -sS https://account.manul.si/v1/balance \
  -H "Authorization: Bearer $MANUL_KEY" \
  -H "X-Manul-Key-Id: $MANUL_KEY_ID"
```

Expected balance shape: `{ "credit": 2, "used": 0.01, "left": 1.99 }` (example usage only). Sending real AI requests consumes credit.

### 4. Verify Dodo payment → credit

1. Record the test key's current `credit`, `used`, and `left`.
2. Click **Add credit** in the app.
3. Expect a Dodo **test checkout** for “Manul credit,” with a $5 minimum and $10 suggested amount.
4. Select $10, keep the payment currency USD, and complete the payment using Dodo's documented successful test payment details.
5. In Dodo → Payments, verify status `succeeded`, the product, amount, tax, and metadata:

   ```json
   { "user_id": "your-clerk-user-id", "virtual_key_id": "your-bifrost-key-id" }
   ```

6. In Dodo → Developer → Webhooks → the Manul endpoint → Logs, find this payment's `payment.succeeded` delivery. It must return HTTP 200; the handler should report `credited: 10`.
7. Inspect Bifrost: `max_limit` should rise by exactly $10 and `current_usage` should remain unchanged.
8. Inspect Clerk private metadata: `payments` should contain that payment ID with value `10`.
9. Return focus to the app. Its balance refreshes on focus, not continuously. If the webhook is still arriving, wait and focus/reopen Settings again.
10. With no intervening usage, `new left = old left + 10`. Sales tax is not credited.
11. Replay the same successfully recorded event from Dodo's delivery log. Expect `already: true`, with no further budget increase. Automated tests also cover recording failures, lost gateway responses, restarts, and concurrent deliveries.

The `/paid` page is a static message, not proof that credit was applied. A generic dashboard sample without the user's/key's metadata is intentionally skipped and also does not prove crediting works.

### 5. Check failure and recovery paths

Use the dedicated test key for dashboard changes.

| Action | Expected result |
| --- | --- |
| Cancel Clerk login in the app | Returns to sign-in; no key provisioned |
| Close a Dodo checkout without paying | No credit added |
| Use Dodo's documented declined test payment | Payment fails; no credit added |
| Send an unsigned webhook | HTTP 401; no credit change |
| Replay an already recorded successful payment | HTTP 200, `already: true`; no extra credit |
| Set test key budget below usage, then request AI | Budget rejection, normally HTTP 402; app asks for credit |
| Complete another USD test top-up | Key can make requests again |
| Deactivate test key in Bifrost | Gateway rejects traffic; fresh sign-in returns 403 |
| Call voice/music with that disabled key | HTTP 403 before any vendor call |
| Sign in on another computer/profile | Same key ID and existing balance |

For voice/music, ask the agent to generate a short narration or instrumental bed, then check the account-service logs and balance. These calls reduce `max_limit` rather than increasing Bifrost's token `current_usage`, so the existing `credit` field is not a lifetime-purchases total.

The webhook only processes USD payments; checkout now fixes its billing currency to USD and disables currency selection.

### 6. Observe the backend

Someone with access to the cluster can run:

```bash
kubectl -n manul get deploy,pods
kubectl -n manul logs deploy/account --all-pods=true --since=15m
kubectl -n manul logs deploy/bifrost --since=15m
```

If listing pods is forbidden, the cluster administrator must grant the appropriate read permissions. The current shell's Kubernetes identity could not inspect these resources during the audit.

## Repeat automated checks

```bash
npm run typecheck
npx vitest run test/account.test.ts test/account-service.test.ts test/account-media.test.ts test/media.test.ts test/gateway.test.ts
npm run build
node test/e2e/manul-key.e2e.mjs
```

Actual Bifrost translation tests require a disposable probe container. They use fake vendors and require no real vendor keys:

```bash
docker run -d --name manul-bifrost-probe --user 0 \
  -p 127.0.0.1:18089:8080 \
  -e ANTHROPIC_API_KEY=probe-only \
  -e GEMINI_API_KEY=probe-only \
  -e OPENAI_API_KEY=probe-only \
  -e MANUL_DEV_KEY=sk-bf-dev-change-me \
  -e BIFROST_SETUP_TOKEN=probe-only \
  -v "$PWD/gateway/config.probe.json:/app/data/config.json:ro" \
  maximhq/bifrost:v2.2.6

# Wait until the probe is healthy, then:
BIFROST_PROBE=http://127.0.0.1:18089 npx vitest run test/gateway-translation.test.ts

# With Compose's local account-db running, also test persistent account credit recovery:
BIFROST_PROBE=http://127.0.0.1:18089 \
BIFROST_TEST_SETUP_TOKEN=probe-only \
ACCOUNT_TEST_DATABASE_URL=postgresql://manul:local-manul@127.0.0.1:55439/manul_account \
npx vitest run test/account-bifrost.integration.test.ts

docker stop manul-bifrost-probe
docker rm manul-bifrost-probe
```

## Completion criteria

Record the test user's Clerk ID, Bifrost customer/key IDs, Dodo payment ID and delivery status, and before/after balances. Keep key values out of that report.

The flow passes when a new user can sign in, get one persistent key and starting credit, perform a real agent/tool call through Bifrost, buy USD test credit, receive it exactly once via webhook, and resume traffic after budget exhaustion. The five listed failures have regression coverage; human sign-in and a completed Dodo test checkout still need the manual checks above.
