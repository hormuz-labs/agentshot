# Manul workspace and hosting

All first-party application source lives in this repository:

| Path | Component | Build / run |
| --- | --- | --- |
| `src/` | Electron desktop editor | `npm run dev`, `npm run build` |
| `site/` | Astro website and interactive editor demo | `npm run site:dev`, `npm run site:build` |
| `account/` | Account, wallet, and payment service | `npm run account:dev`, `npm run account:build` |
| `gateway/` | Bifrost configuration, Compose, and Kubernetes deployment | `npm run stack:up` |
| `mobile/` | Mobile clients | See the platform projects in this directory |

The website is a static product site with a miniature editor demo. The full editor runs in
Electron. Accounts and the AI gateway are separate server services. Clerk, payment providers,
and AI providers are external services whose credentials are configured separately.

## Development

Use Node 22.19 or newer. The desktop and site use independent npm packages and lockfiles;
this lets website-only hosts install Astro without downloading Electron, ffmpeg, or ML models.
No nested Git repository or submodule is needed.

```sh
# Website only, from the repository root
npm run site:install
npm run site:dev
npm run site:build       # portable static output: site/dist/
npm run site:preview

# Desktop dependencies and development
npm ci
npm run dev
```

The existing browser checks run against `http://localhost:4321` using local Chrome. Override
the executable with `CHROME=/path/to/chrome`; pass a URL with `npm run site:test:sizes -- <url>`.

## Current website hosting

Verified on 2026-10-25 from the upstream README and the successful **Cloudflare Pages** GitHub
check on commit `21e2affde898a94bbc548a597224d1115a33ed2f`:

- Host: Cloudflare Pages, project **manul-site**.
- Domain: **https://agentshot.si**.
- Cloudflare account ID: `85c6289c2a2a8ced3b1a0b6d0e30a371`.
- Existing source: `hormuz-labs/manul-site`, branch `main`.
- Existing build: `npm run build`, output `dist`.
- The account and gateway deployment is documented separately in `account/README.md` and
  `gateway/README.md`, with Kubernetes manifests in `gateway/k8s/`.

Importing the code does not change the live Pages project's source or its domain configuration.

## Deploy this repository to the existing Cloudflare Pages project

`.github/workflows/site.yml` builds the site on relevant pushes and pull requests and retains
the static output as an artifact. To publish that output to the existing project:

1. In the **manul** GitHub repository, set secret `CLOUDFLARE_API_TOKEN` to a token with
   Cloudflare Pages Edit permission for the account above.
2. Set repository variable `CLOUDFLARE_ACCOUNT_ID` to the account ID above.
3. Disable automatic production and preview Git deployments from the old repository in the
   Cloudflare Pages project settings so that it cannot overwrite monorepo deployments.
4. Set repository variable `SITE_DEPLOY_ENABLED` to `true`.
5. Run the **Website** workflow on `main`. It uploads `site/dist` with Wrangler to the existing
   `manul-site` project and production branch `main`, retaining its custom domain.
6. Verify `https://agentshot.si`, then disable the old repository's release-following workflow.

Git-integrated Pages projects can receive Wrangler deployments; this avoids needing to change
the existing project's Git repository binding. This cutover requires GitHub and Cloudflare
configuration; it has not been performed by the source import.

The migrated **Follow AgentShot releases for site** workflow updates `site/src/release.json`
hourly from `hormuz-labs/agentshot` releases, then explicitly dispatches **Website** (bot pushes
do not trigger push workflows). The repository must allow Actions to write contents and dispatch
workflows. If `main` requires pull requests, adapt this updater to the repository's branch rules.

For a new Pages project connected directly to this monorepo, set its root directory to `site`,
build command to `npm run build`, output directory to `dist`, and Node version to 22. The
existing `site/public/_headers` supplies the site's caching and content-type rules on Pages.

## Host on another server

Upload `site/dist/` to any static host, or build the included nginx container:

```sh
docker build -t manul-site ./site
docker run --rm -p 4321:80 manul-site
```

Open `http://localhost:4321`. The container serves Astro's directory routes and custom 404
page, and mirrors the caching/content-type rules from Cloudflare's `_headers` file.
Put it behind your hosting platform's HTTPS ingress for a public domain.

To run the website alongside the existing local account service, database, and gateway:

1. Create `gateway/.env` using `gateway/.env.example` and fill in the service credentials.
2. Run `npm run stack:up` from the root.
3. Open the website on port 4321, accounts on 8090, and the gateway dashboard on 8089.
4. Run `npm run stack:down` to stop the stack; named data volumes persist.

The site is an optional Compose profile, so it can also run alone:
`docker compose -f gateway/docker-compose.yml --profile site up -d --build site`.
The existing Compose service defaults are for local development; consult the account/gateway
deployment documentation for database, domain, and service configuration for your host.
