# Crash reports and usage statistics

AgentShot asks once, on first run, with two boxes that start **unticked**:

- **Send crash reports**: crashes and errors go to [PostHog](https://posthog.com)'s error tracking through AgentShot's
  proxy.
- **Share usage statistics**: a short, fixed list of events goes to [PostHog](https://posthog.com) through AgentShot's
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
| `active time` | `seconds` of use while AgentShot is focused and you are not idle (sent in steps of at least a minute) |
| `agent run` | `provider` and `model` used, `tools`: the names of AgentShot's tools it called, `toolCalls`, `ok`, `seconds` |
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
AgentShot ── usage batches, crash reports ──▶ telemetry.agentshot.si (Cloudflare Worker, telemetry/proxy) ──▶ PostHog
GitHub Actions, daily (telemetry/github-stats.mjs) ── downloads, stars, forks, clones ──▶ PostHog
```

- **PostHog** is the same project as Pitch's (one place for both apps), on its free tier: usage events, error
  tracking and the account service's events all fit well inside the free monthly allowances for now. Keep billing
  limits at $0 in PostHog (Billing → each product) so nothing is ever charged.
- **Proxy** ([`proxy/worker.ts`](proxy/worker.ts)), on Cloudflare Workers' free plan. It accepts only `POST /batch/` for AgentShot's PostHog project,
  limits each IP to 30 batches a minute, and passes on nothing from the request but the cleaned events.
- **Dashboards** are made in PostHog. There is no server of ours to run.
- **GitHub numbers** come from [`.github/workflows/github-stats.yml`](../.github/workflows/github-stats.yml) as one
  `github snapshot` event a day. They are GitHub's `download_count`, so requests and never people. Each is a running
  total: chart the change from one day to the next. Clone counts cover GitHub's rolling 14 days and need a token
  with push access.

## How many people use it

Nothing here counts people exactly, and nothing is collected to make it so. These are the numbers there are, from the
least to the most direct:

| Question | Number | What it really is |
|---|---|---|
| How many downloads? | `installer_downloads` (and `mac_`, `windows_`, `deb_`, `appimage_downloads`) | Every request for an installer. Homebrew, apt, the Linux and Windows updaters and our own release jobs fetch these too, so it runs well ahead of people. |
| How many people clicked Download? | `button_downloads` | Installers fetched by the name without a version (`AgentShot-arm64.dmg`), which only the website's and README's buttons use. Mac and Windows only. |
| How much is it in use? | `update_checks` (and `mac_`, `windows_`, `linux_update_checks`) | Requests for the update feed. An installed app asks when it starts and every six hours after, so one app left open all day is four. |
| How many people use it, of those who said yes? | People with an `app opened` event, per day or week | One random ID per installation that ticked "Share usage statistics". The boxes start unticked, so this is a floor. |
| How many have an account? | People with the account service's `manul signed in` event, or the user count in Clerk | People who signed in for an AgentShot key. Those using their own model key never appear. |

## Setting it up

1. **PostHog.** Create a project. Note its project token (`phc_…`, public by design: it can only send events) and its
   region's capture host (`https://us.i.posthog.com` or `https://eu.i.posthog.com`).
2. **Proxy.** Put the token and host in [`proxy/wrangler.toml`](proxy/wrangler.toml). Then, from `telemetry/proxy`,
   run `npx wrangler deploy`. It serves `telemetry.agentshot.si` (`analytics.agentshot.si` is the separate AgentShot analytics dashboard).
3. **GitHub repository settings.**
   - Variables: `MANUL_TELEMETRY_URL=https://telemetry.agentshot.si`, `MANUL_POSTHOG_TOKEN`, and for the daily snapshot
     `POSTHOG_TOKEN` and `POSTHOG_HOST`.
   - Secret, optional: `GH_TRAFFIC_TOKEN` for clone counts.

   The release workflow builds them in.

Tests: `npm test -- test/telemetry.test.ts`.
