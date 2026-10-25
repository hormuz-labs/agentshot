import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UsageTelemetry } from '../src/main/telemetry'
import { exceptionProperties, sanitize, scrubEvent, scrubPaths } from '../src/shared/telemetry'
import proxy, { clean } from '../telemetry/proxy/worker'
// @ts-expect-error plain .mjs script
import { githubStats, send } from '../telemetry/github-stats.mjs'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function setup(status = 200) {
  const dir = mkdtempSync(join(tmpdir(), 'agentshot-usage-'))
  dirs.push(dir)
  const file = join(dir, 'usage.json')
  let now = 0
  let enabled = true
  let focused = true
  let idle = 0
  const post = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: status < 300, status }) as Response)
  const create = () => new UsageTelemetry({ file, endpoint: 'https://example.test/', token: 'phc_test', enabled: () => enabled,
    focused: () => focused, idleSeconds: () => idle, now: () => now, post: post as unknown as typeof fetch, context: { app_version: '1.2.3' } })
  const sent = (i = 0) => JSON.parse(post.mock.calls[i][1].body as string)
  return { create, post, sent, advance: () => { now += 15_000 }, focus: (v: boolean) => { focused = v }, idle: (v: number) => { idle = v },
    enabled: (v: boolean) => { enabled = v }, state: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('usage statistics', () => {
  it('starts with the default monotonic clock and sends nothing without an endpoint', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentshot-clock-'))
    dirs.push(dir)
    const usage = new UsageTelemetry({ file: join(dir, 'usage.json'), endpoint: '', token: '', enabled: () => true, focused: () => true, idleSeconds: () => 0 })
    expect(usage.available).toBe(false)
    expect(() => { usage.start(); usage.tick(); usage.track('app opened', {}) }).not.toThrow()
  })

  it('records nothing until the user says yes', async () => {
    const t = setup()
    t.enabled(false)
    const usage = t.create()
    usage.track('project created', {})
    for (let i = 0; i < 8; i++) { t.advance(); usage.tick() }
    await usage.flush()
    expect(t.post).not.toHaveBeenCalled()
  })

  it('counts focused, non-idle time and sends it with the listed properties only', async () => {
    const t = setup()
    const usage = t.create()
    t.advance(); usage.tick()
    t.focus(false); t.advance(); usage.tick()
    t.focus(true); t.idle(60); t.advance(); usage.tick()
    t.idle(0); t.advance(); usage.tick()
    expect(t.state().activeSeconds).toBe(30)
    const restored = t.create()
    t.advance(); restored.tick()
    t.advance(); restored.tick()
    restored.track('export finished', { preset: 'vertical', captions: 'burn', by: 'user', ok: true, seconds: 12.345, file: '/Users/x/secret.mp4' } as never)
    await restored.flush()
    const body = t.sent()
    expect(t.post.mock.calls[0][0]).toBe('https://example.test/batch/')
    expect(body.api_key).toBe('phc_test')
    expect(body.batch.map((e: { event: string }) => e.event)).toEqual(['active time', 'export finished'])
    expect(body.batch[0].properties).toMatchObject({ seconds: 60, app_version: '1.2.3', $process_person_profile: false, $geoip_disable: true })
    expect(body.batch[1].properties).not.toHaveProperty('file')
    expect(body.batch[1].properties.seconds).toBe(12.3)
    expect(t.state().pending).toHaveLength(0)
  })

  it('retries with the same UUIDs, and does not count suspended hours', async () => {
    const t = setup()
    const usage = t.create()
    usage.track('app opened', {})
    t.post.mockRejectedValueOnce(new Error('offline'))
    await usage.flush()
    expect(t.state().pending).toHaveLength(1)
    await usage.flush()
    expect(t.sent(0).batch[0].uuid).toBe(t.sent(1).batch[0].uuid)
    expect(t.state().pending).toHaveLength(0)
    for (let i = 0; i < 100; i++) t.advance()
    usage.tick()
    expect(t.state().activeSeconds).toBe(15)
  })

  it('keeps one active-time event while offline and caps the queue', async () => {
    const t = setup()
    const usage = t.create()
    for (let i = 0; i < 40; i++) { t.advance(); usage.tick() } // ten minutes, offline
    expect(t.state().pending.filter((e: { event: string }) => e.event === 'active time')).toHaveLength(1)
    expect(t.state().activeSeconds).toBe(540)
    for (let i = 0; i < 600; i++) usage.track('app opened', {})
    expect(t.state().pending).toHaveLength(500)
  })

  it('drops a batch the server rejects, but keeps it on a server error or rate limit', async () => {
    for (const [status, kept] of [[400, 0], [429, 1], [503, 1]] as const) {
      const t = setup(status)
      const usage = t.create()
      usage.track('app opened', {})
      await usage.flush()
      expect(t.state().pending).toHaveLength(kept)
    }
  })

  it('discards queued data and forgets the ID on a no', async () => {
    const t = setup()
    const usage = t.create()
    usage.track('app opened', {})
    const original = t.state().installationId
    t.enabled(false); usage.setEnabled(false)
    expect(t.state()).toMatchObject({ pending: [], activeSeconds: 0 })
    expect(t.state().installationId).not.toBe(original)
    await usage.flush()
    expect(t.post).not.toHaveBeenCalled()
  })
})

describe('what may be sent', () => {
  it('keeps only listed events and properties, as short plain values', () => {
    expect(sanitize('made up', {})).toBeNull()
    expect(sanitize('agent run', { provider: 'anthropic', model: 'x'.repeat(100), tools: ['bash', 3, 'cut'], toolCalls: 4, ok: true, seconds: 1, prompt: 'hi' }))
      .toEqual({ provider: 'anthropic', model: 'x'.repeat(64), tools: ['bash', 'cut'], toolCalls: 4, ok: true, seconds: 1 })
  })

  it('removes file paths and user details from crash reports', () => {
    expect(scrubPaths("ENOENT: open '/Users/ana/Clients/Acme launch.mov'")).toBe("ENOENT: open '<path>'")
    expect(scrubPaths('C:\\Users\\ana\\My film.mp4: failed')).toBe('<path>: failed')
    expect(scrubPaths('ffmpeg could not read /Volumes/Card/Wedding day/A001.mov')).toBe('ffmpeg could not read <path>')
    expect(scrubPaths('see ~/Movies/a b.mp4, retrying')).toBe('see <path>, retrying')
    expect(scrubPaths('at app:///out/main/index.js:10')).toBe('at app:///out/main/index.js:10')
    const e = scrubEvent({ message: 'no /home/ana/x.mp4', server_name: 'anas-laptop', user: { ip_address: '1.2.3.4' },
      breadcrumbs: [{ category: 'console', message: 'prompt' }, { category: 'electron', message: 'ready', data: { url: 'x' } }] })
    expect(e).toEqual({ message: 'no <path>', breadcrumbs: [{ category: 'electron', message: 'ready', data: undefined }] })
  })
})

describe('crash reports as PostHog error tracking', () => {
  const crash = {
    level: 'fatal', message: 'ignored when there is an exception', user: { ip_address: '1.2.3.4' },
    exception: { values: [{ type: 'TypeError', value: "Cannot read 'x' of '/Users/ada/Clients/Acme/cut.mp4'", mechanism: { type: 'onerror', handled: false },
      stacktrace: { frames: [{ filename: 'app:///out/main/index.js', function: 'render', lineno: 12, colno: 4, in_app: true, vars: { secret: 1 } }] } }] },
  }

  it('sends the type, the scrubbed message and the frames, and nothing else of the report', () => {
    expect(exceptionProperties(scrubEvent(structuredClone(crash)))).toEqual({
      $exception_level: 'fatal',
      $exception_list: [{ type: 'TypeError', value: "Cannot read 'x' of '<path>'", mechanism: { type: 'onerror', handled: false },
        stacktrace: { type: 'raw', frames: [{ platform: 'node:javascript', filename: 'app:///out/main/index.js', function: 'render', lineno: 12, colno: 4, in_app: true }] } }],
    })
  })

  it('a native crash says only that it crashed: the minidump stays on the machine', () => {
    expect(exceptionProperties({ level: 'fatal' }).$exception_list).toEqual([expect.objectContaining({ type: 'Native crash', mechanism: { type: 'minidump', handled: false } })])
  })

  it('the proxy rebuilds it, and refuses a crash with no exception', () => {
    const id = '6f1c2a54-8e43-4b8e-9d0e-1c2b3a4d5e6f'
    const props = { ...exceptionProperties(crash), distinct_id: id, os: 'darwin', $ip: '1.2.3.4' }
    props.$exception_list[0].value = 'at /home/ada/secret.mov'   // a client that didn't scrub
    const out = clean({ uuid: id, event: '$exception', timestamp: '2026-10-21T10:00:00Z', properties: props })!
    expect(out.properties).toMatchObject({ distinct_id: id, os: 'darwin', $process_person_profile: false, $exception_level: 'fatal' })
    expect(JSON.stringify(out)).not.toMatch(/1\.2\.3\.4|secret|\/home/)
    expect(clean({ uuid: id, event: '$exception', timestamp: '2026-10-21T10:00:00Z', properties: { distinct_id: id } })).toBeNull()
  })
})

describe('usage proxy', () => {
  const env = { POSTHOG_HOST: 'https://ph.test', POSTHOG_TOKEN: 'phc_test' }
  const id = '6f1c2a54-8e43-4b8e-9d0e-1c2b3a4d5e6f'
  const event = { uuid: id, event: 'agent run', timestamp: '2026-10-08T10:00:00Z',
    properties: { distinct_id: id, provider: 'openai', model: 'gpt', tools: ['cut'], toolCalls: 1, ok: true, seconds: 3, app_version: '1.0.0' } }
  const call = (body: unknown, init: RequestInit = {}) => proxy.fetch(new Request('https://analytics.test/batch/',
    { method: 'POST', body: JSON.stringify(body), headers: { 'cf-connecting-ip': '1.2.3.4' }, ...init }), env)

  it('rebuilds each event from the list, so nothing extra reaches PostHog', () => {
    expect(clean({ ...event, properties: { ...event.properties, $ip: '1.2.3.4', path: '/Users/x' } })).toEqual({
      uuid: id, event: 'agent run', timestamp: event.timestamp,
      properties: { distinct_id: id, $process_person_profile: false, $geoip_disable: true, provider: 'openai', model: 'gpt', tools: ['cut'], toolCalls: 1, ok: true, seconds: 3, app_version: '1.0.0' },
    })
    expect(clean({ ...event, event: '$pageview' })).toBeNull()
    expect(clean({ ...event, properties: { ...event.properties, model: { nested: true } } })).toBeNull()
  })

  it('forwards a good batch without the client\'s headers, and refuses anything else', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    try {
      expect((await call({ api_key: 'phc_test', batch: [event] })).status).toBe(200)
      const [url, init] = upstream.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://ph.test/batch/')
      expect(init.headers).toEqual({ 'content-type': 'application/json' })
      expect((await call({ api_key: 'phc_other', batch: [event] })).status).toBe(400)
      expect((await call({ api_key: 'phc_test', batch: [{ ...event, event: 'x' }] })).status).toBe(400)
      expect((await call({ api_key: 'phc_test', batch: Array(51).fill(event) })).status).toBe(400)
      expect((await proxy.fetch(new Request('https://analytics.test/'), env)).status).toBe(404)
      expect(upstream).toHaveBeenCalledTimes(1)
      const limited = await proxy.fetch(new Request('https://analytics.test/batch/', { method: 'POST', body: '{}' }),
        { ...env, LIMITER: { limit: async () => ({ success: false }) } })
      expect(limited.status).toBe(429)
    } finally { upstream.mockRestore() }
  })
})

describe('GitHub stats', () => {
  it('counts installer downloads only, and sends one snapshot event', async () => {
    const responses: Record<string, unknown> = {
      '/releases?per_page=100&page=1': [
        { assets: [{ name: 'Manul-1.0.0-arm64.dmg', download_count: 10 }, { name: 'Manul-1.0.0-arm64-mac.zip', download_count: 500 },
          { name: 'manul_1.0.0_amd64.deb', download_count: 4 }, { name: 'Manul-1.0.0.AppImage', download_count: 2 }] },
        { prerelease: true, assets: [{ name: 'Manul-1.1.0-beta.dmg', download_count: 99 }] },
      ],
      '': { stargazers_count: 40, forks_count: 3 },
      '/traffic/clones': { count: 12, uniques: 5 },
    }
    const fetchImpl = vi.fn(async (url: string) => {
      const path = url.replace('https://api.github.com/repos/hormuz-labs/agentshot', '')
      return new Response(JSON.stringify(responses[path]), { status: 200 })
    })
    const stats = await githubStats({ token: 't', fetchImpl })
    expect(stats).toEqual({ installer_downloads: 16, mac_downloads: 10, deb_downloads: 4, appimage_downloads: 2, stars: 40, forks: 3, clones_14d: 12, unique_cloners_14d: 5 })
    const capture = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 200 }))
    await send(stats, { host: 'https://ph.test', token: 'phc_test', fetchImpl: capture, now: new Date('2026-10-08T03:17:00Z') })
    expect(JSON.parse(capture.mock.calls[0][1].body as string)).toMatchObject({ event: 'github snapshot', distinct_id: 'manul-github', properties: { stars: 40 } })
  })
})
