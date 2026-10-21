# Crash reports and usage statistics

Manul asks once, on first run, with two boxes that start **unticked**:

- **Send crash reports**: crashes and errors go to [PostHog](https://posthog.com)'s error tracking through Manul's
  proxy.
- **Share usage statistics**: a short, fixed list of events goes to [PostHog](https://posthog.com) through Manul's
  proxy.

Closing the dialog counts as no to both. Either can be changed at any time in **Settings → About**, and the change
takes effect at once. Builds made from source never ask and send nothing, because the addresses below are only set
in release builds.

## What is never sent

Your footage, file or folder names, paths, project titles, prompts, agent replies, transcripts, API keys, or URLs.
Users' IP addresses are not passed on to PostHog.

## Usage statistics

Every event and property is listed in [`src/shared/telemetry.ts`](../src/shared/telemetry.ts). The app drops
anything else, and the proxy rebuilds each event from the same list and refuses anything that isn't on it.

| Event | Properties |
|---|---|
| `app opened` | none |
| `project created` | none |
| `motion project created` | `example` (the public id of the gallery example it started from, or none), `aspect` (16:9, 9:16 or 1:1), `reference` (whether your own reference video came with it) |
| `active time` | `seconds` of use while Manul is focused and you are not idle (sent in steps of at least a minute) |
| `agent run` | `provider` and `model` used, `tools`: the names of Manul's tools it called, `toolCalls`, `ok`, `seconds` |
| `version decided` | `accepted`: whether you kept the version the agent proposed |
| `export finished` | `preset` (original, landscape, vertical, square), `captions` (none, srt, burn), `by` (user or agent), `ok`, `seconds` |
| `tool installed` | `tool` (e.g. whisper), `ok` |

Every event also carries `app_version`, `os`, `arch`, and a random installation ID that is not tied to you. Saying no
deletes anything unsent and the ID, and saying yes again starts a new one. Events wait on disk while offline (at most
500) and are retried with the same IDs, so they are not counted twice.

## Crash reports

Sentry's Electron SDK, running only inside the app, catches native crashes of the app and its windows and uncaught
errors in the main process and the interface. Nothing goes to Sentry: each report becomes a PostHog `$exception`
event (its type, message and stack frames) and goes through the proxy, which rebuilds it field by field. To keep your
data out of reports:

- local variable values, console output, network requests and screenshots are switched off;
- file paths in error messages are replaced with `<path>`;
- the computer's name and user details are removed;
- a native crash says only that it crashed: its minidump stays on the computer.

The SDK runs in release builds either way, but nothing is sent unless crash reports are ticked. A crash from before
you said yes is never sent later. See [`src/main/crash.ts`](../src/main/crash.ts).

## How the pieces fit

```
Manul ── usage batches, crash reports ──▶ analytics.manul.si (Cloudflare Worker, telemetry/proxy) ──▶ PostHog
GitHub Actions, daily (telemetry/github-stats.mjs) ── downloads, stars, forks, clones ──▶ PostHog
```

- **PostHog** is the same project as Pitch's (one place for both apps), on its free tier: usage events, error
  tracking and the account service's events all fit well inside the free monthly allowances for now. Keep billing
  limits at $0 in PostHog (Billing → each product) so nothing is ever charged.
- **Proxy** ([`proxy/worker.ts`](proxy/worker.ts)), on Cloudflare Workers' free plan. It accepts only `POST /batch/` for Manul's PostHog project,
  limits each IP to 30 batches a minute, and passes on nothing from the request but the cleaned events.
- **Dashboards** are made in PostHog. There is no server of ours to run.
- **GitHub numbers** come from [`.github/workflows/github-stats.yml`](../.github/workflows/github-stats.yml) as one
  `github snapshot` event a day. Installer downloads are GitHub's `download_count` for `.dmg`, `.deb` and `.AppImage`
  files: requests, not people or completed installs. Clone counts cover GitHub's rolling 14 days and need a token
  with push access.

## Setting it up

1. **PostHog.** Create a project. Note its project token (`phc_…`, public by design: it can only send events) and its
   region's capture host (`https://us.i.posthog.com` or `https://eu.i.posthog.com`).
2. **Proxy.** Put the token and host in [`proxy/wrangler.toml`](proxy/wrangler.toml). Then, from `telemetry/proxy`,
   run `npx wrangler deploy`. It serves `analytics.manul.si`, so remove that name's old tunnel route first.
3. **GitHub repository settings.**
   - Variables: `MANUL_TELEMETRY_URL=https://analytics.manul.si`, `MANUL_POSTHOG_TOKEN`, and for the daily snapshot
     `POSTHOG_TOKEN` and `POSTHOG_HOST`.
   - Secret, optional: `GH_TRAFFIC_TOKEN` for clone counts.

   The release workflow builds them in.

Tests: `npm test -- test/telemetry.test.ts`.
