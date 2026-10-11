# Manul accounts

When a person signs in, the account service gives them their own Manul key. It's a small Node service, `server.mjs`
running [src/index.ts](src/index.ts), deployed in the cluster next to the gateway
([gateway/README.md](../gateway/README.md)).

```
App ──(Sign in to Manul: system browser, OAuth + PKCE)──▶ Clerk
App ──POST https://account.manul.si/v1/key, Bearer <Clerk access token>──▶ account service
        ──/oauth/userinfo──▶ Clerk                               who is it?
        ──/v1/users/<id>──▶ Clerk Backend API                    do they have a key already?
        ──/api/governance/customers, virtual-keys──▶ Bifrost     first time: their customer and key (inside the cluster)
        ──PATCH metadata──▶ Clerk                                remember which key is theirs
App ◀── { key, email }  (key into the keychain, email shown in Settings)
```

- **Who is who:** each person is a Bifrost *customer* named after their email, with one *virtual key*. The key's name
  is their Clerk user ID and its description is their email. Bifrost keeps customers, keys, budgets, spend and request
  logs in Postgres (database `bifrost` on the `silverfish` Cloud SQL instance). The Clerk user's private metadata links
  back to them: `{ bifrost: { customer_id, virtual_key_id } }`.
- **Same key everywhere:** signing in on another computer returns the same key. Signing out only removes it from that
  computer.
- **Turning someone off:** deactivate their virtual key in Bifrost's dashboard, and signing in again won't make a new
  one. If the key is deleted instead, the next sign-in makes a new one under the same customer.
- **What a new key gets:** `NEW_KEY` in [src/index.ts](src/index.ts), or the `NEW_KEY` environment variable as JSON. By
  default that's 300 requests an hour and the models the gateway's `manul` rule may route to. The budget is the credit
  (below).

## Credit and payments

- **Starting credit:** a new person starts with **$2** (`FREE_CREDIT`). This is their key's budget in Bifrost, with a
  `100Y` reset period so it never resets. Bifrost stops the key with `402 budget_exceeded` when it runs out, and the
  app then says to add credit.
- **Adding credit:** Settings → Keys → Manul key → **Add credit** calls `/v1/checkout`, which opens a Dodo Payments
  checkout for the **Manul credit** product. It's a one-time product where the buyer picks the amount ($5 minimum, $10
  suggested), with tax added on top.
- **Applying a payment:** Dodo's signed `payment.succeeded` webhook to `/v1/dodo/webhook` raises the budget by the price
  before tax. The budget keeps what was already used. Each payment ID is applied once and recorded in the Clerk
  user's private metadata, `payments`. The durable `manul_credit_operations` Postgres table records each intended
  absolute budget before the gateway update. Per-key advisory locks coordinate replicas and media reservations;
  retries after a gateway timeout or Clerk recording failure reuse the same target rather than adding credit twice.
- **Test mode:** this runs in Dodo's **Test Mode**, on the Trypitch business. The product is
  `pdt_0NpQ911WjTgC2ZbB2ljyX` and the webhook endpoint is `ep_3KUfoABJlmYJnHsTr2tDwMurU4T`. Going live means
  creating the same product and webhook in Live Mode, putting their IDs and keys in `manul-secrets`, and setting
  `DODO_API` in manul.yaml to `https://live.dodopayments.com`.
- **Secrets:** `DODO_API_KEY` (Developer → API Keys) and `DODO_WEBHOOK_SECRET` (the endpoint's signing secret) go in
  `manul-secrets`. `DODO_PRODUCT_ID` is already there.

## Voice and music

`POST /v1/voice` (`{ text, voice?, style? }`) and `POST /v1/music` (`{ prompt, seconds, instrumental?, sections? }`),
as the key, return the audio. The request shapes and the vendor calls are in [src/media.ts](src/media.ts), which the
app also uses with a person's own keys. The service picks the vendor and model from media.json (`MEDIA_CONFIG`; see
[gateway/README.md → Voice and music](../gateway/README.md#voice-and-music)). It turns the request away when the
credit left doesn't cover the price (402). It reserves the price from the budget before calling the vendor and
refunds vendor failures. Disabled keys are refused (403). Errors never name the vendor. `GET /v1/voices` lists Manul's voice names.

## Local development

From the project root, fill `gateway/.env` using `.env.example`, then run:

```bash
docker compose -f gateway/docker-compose.yml up -d --build --wait
MANUL_ACCOUNT=http://127.0.0.1:8090 MANUL_GATEWAY=http://127.0.0.1:8089 npm run dev -- --user-data-dir=/tmp/manul-local-test
```

Compose starts Bifrost (8089), the account service (8090), and its persistent Postgres journal. Use a new test email;
local metadata is under `private_metadata.manul_local`, separate from deployed keys and payments. Configure
`CLERK_ISSUER` and the desktop auth overrides together when using a different Clerk instance.

The setup token authorizes local admin API calls before dashboard setup. After creating a dashboard login, set
`BIFROST_AUTH=Basic <base64(username:password)>` in `gateway/.env` and recreate the account container. For host-side
development, stop only the account container and run `npm run account:dev`; it supplies defaults for the same local
database and gateway. `npm run account:build` bundles the server and Postgres driver for the ConfigMap deployment.

For Dodo local testing, expose port 8090 with an HTTPS tunnel, set `PUBLIC_URL` to that URL, and create a separate
test-mode webhook at `<tunnel>/v1/dodo/webhook`. Put its signing secret in `gateway/.env` and recreate the account
container. The existing production-domain webhook does not deliver to localhost.

## Clerk

Clerk application **Manul** runs on its **production** instance, `clerk.manul.si`. Its DNS records (`clerk`,
`accounts`, `clkmail`, `clk._domainkey`, `clk2._domainkey`) are in Cloudflare, DNS only. The OAuth application
**Manul desktop** is set up like this:

- Client ID: `cYz60VvV9IL4cGH5`
- Type: public client (PKCE, no secret)
- Scopes: `openid email profile`
- Redirect URI: `http://127.0.0.1:47619/oauth/callback`

The account service needs that instance's secret key in `manul-secrets` as `CLERK_SECRET_KEY`.

Google sign-in in production uses our own Google OAuth client. That's Google Cloud project **Manul**
(`manul-511207`), whose consent screen is set to External, with redirect URI
`https://clerk.manul.si/v1/oauth_callback`. Its client ID and secret go in Clerk → SSO connections → Google.

The development instance (`good-wildcat-5360.clerk.accounts.dev`, client `5E3y3JppmCuVr1UD`) stays available for
local work. Point the app at it with `MANUL_AUTH_ISSUER` and `MANUL_AUTH_CLIENT_ID`.

## Tests

- `test/account-service.test.ts`: this service, against a fake Clerk and Bifrost.
- `test/account.test.ts`: the app's sign-in, against a fake Clerk and account service.
- `test/account-bifrost.integration.test.ts`: real Bifrost + Postgres, process restart and independent replica retries.
