// Paid cloud jobs through the real UI, against a stand-in worker: the export dialog offers them with a price for the
// film in hand, asks before spending, sends the film, and what comes back is a version to accept or reject.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundledBinary } from './helpers.mjs'

const root = join(import.meta.dirname, '..', '..')
const out = process.argv[2] || mkdtempSync(join(tmpdir(), 'agentshot-cloud-e2e-'))
const tmp = mkdtempSync(join(tmpdir(), 'agentshot-cloud-'))
const clip = join(tmp, 'talk.mp4')
execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip])

// ---- the worker: answers as the real one is specified to, and keeps what it was asked
const asked = []
let job = null
let looks = 0
const send = (res, status, body) => {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))
  res.writeHead(status, { 'content-type': Buffer.isBuffer(body) ? 'video/mp4' : 'application/json', 'content-length': data.length }).end(data)
}
const worker = createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = Buffer.concat(chunks)
  asked.push({ method: req.method, path: req.url, headers: req.headers, body })
  if (!req.url.startsWith('/v1/')) return send(res, 404, { error: 'Not found.' }) // the account service lives elsewhere
  if (req.headers['x-agentshot-api'] !== '1') return send(res, 400, { error: 'Update the app.' })
  if (req.url === '/v1/offers') return send(res, 200, { api: '1', offers: [
    { kind: 'upscale', name: 'Upscale to 4K', creditsPerSecond: 2.5, minCredits: 40, maxSeconds: 1800, maxBytes: 4294967296, refund: 'Credits come back in full if the job fails, or if you cancel before its machine is running.' },
    { kind: 'voice', name: 'Isolate the voice', creditsPerSecond: 0.5, minCredits: 20, maxSeconds: 7200, maxBytes: 4294967296, refund: 'Credits come back in full if the job fails, or if you cancel before its machine is running.' },
  ] })
  if (req.headers.authorization !== 'Bearer sk-bf-ada' || req.headers['x-manul-key-id'] !== 'vk_ada') return send(res, 401, { error: 'Sign in to AgentShot again.' })
  if (req.url === '/v1/jobs' && req.method === 'POST') {
    const b = JSON.parse(body.toString())
    job = { id: '1794610731-25b051dc', kind: b.kind, status: 'awaiting_upload', error: null, seconds: b.seconds, bytes: b.bytes, name: b.name, credits: 40, charged: 0, refunded: 0, createdAt: 1794610731, startedAt: null, finishedAt: null }
    return send(res, 200, { job, upload: `/v1/jobs/${job.id}/input` })
  }
  if (req.url.endsWith('/input')) { Object.assign(job, { status: 'queued', charged: 40 }); return send(res, 200, job) }
  if (req.url.endsWith('/output')) return send(res, 200, readFileSync(clip)) // stands for the film in 4K: it has to be a real film to become a version
  if (job && req.url === `/v1/jobs/${job.id}`) { job.status = ['running', 'done'][Math.min(looks++, 1)]; return send(res, 200, job) }
  send(res, 404, { error: 'There’s no such job.' })
})
await new Promise(ok => worker.listen(0, '127.0.0.1', ok))
const at = `http://127.0.0.1:${worker.address().port}`

async function launch(name, signedIn) {
  const ud = join(tmp, name)
  mkdirSync(ud, { recursive: true })
  if (signedIn) writeFileSync(join(ud, 'config.json'), JSON.stringify({ account: { email: 'ada@example.com', keyId: 'vk_ada' } }))
  // MANUL_ACCOUNT keeps a test from ever asking the real account service anything
  const env = { ...process.env, MANUL_PROJECTS: join(tmp, `${name}-projects`), MANUL_WORKER: at, MANUL_ACCOUNT: at, ...(signedIn ? { MANUL_KEY: 'sk-bf-ada' } : {}) }
  if (!signedIn) delete env.MANUL_KEY
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${ud}`], env })
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => [f]) }, clip)
  await win.click('[data-tour="import"]')
  await win.locator('button:has(svg.lucide-arrow-up)').click()
  await win.waitForSelector('video')
  return { app, win }
}
const openExport = async win => {
  await win.getByRole('button', { name: 'Export', exact: true }).click()
  return win.getByRole('dialog')
}

// ---- signed in: the whole job
let { app, win } = await launch('ada', true)
try {
  const dialog = await openExport(win)
  const section = dialog.locator('[data-cloud-jobs]')
  await section.waitFor()
  // a three-second film costs each job its minimum
  const upscale = section.locator('[data-cloud-offer="upscale"]'), voice = section.locator('[data-cloud-offer="voice"]')
  assert.match(await upscale.innerText(), /Upscale to 4K\s+40 credits/)
  assert.match(await voice.innerText(), /Isolate the voice\s+20 credits/)
  assert.equal(asked.filter(a => a.path === '/v1/jobs').length, 0, 'looking at the prices asks for no job')

  // asking first: the price is said again with what happens to it, and nothing is sent until the person says yes
  await upscale.getByRole('button', { name: 'Run' }).click()
  assert.match(await upscale.innerText(), /This takes 40 credits, once the film has been sent\. Credits come back in full if the job fails/)
  await upscale.scrollIntoViewIfNeeded()
  await win.screenshot({ path: join(out, '1-asking.png') })
  await upscale.getByRole('button', { name: 'Not now' }).click()
  assert.equal(asked.filter(a => a.path === '/v1/jobs').length, 0, 'saying no sent nothing')
  await upscale.getByRole('button', { name: 'Run' }).click()
  await upscale.getByRole('button', { name: 'Use 40 credits' }).click()
  await section.locator('[role=status]', { hasText: 'Upscale to 4K has started, for 40 credits.' }).waitFor()
  await section.scrollIntoViewIfNeeded()
  await win.screenshot({ path: join(out, '2-started.png') })
  // one job at a time for a project
  assert.equal(await voice.getByRole('button', { name: 'Run' }).isDisabled(), true)

  // what was sent: the film as it stands, whole, with its size and who is asking
  const dir = await win.evaluate(() => window.agentshot.tabs.get().then(t => t.active))
  const create = asked.find(a => a.path === '/v1/jobs')
  const sent = JSON.parse(create.body.toString())
  assert.equal(sent.kind, 'upscale')
  assert.ok(Math.abs(sent.seconds - 3) < 0.2, `seconds ${sent.seconds}`)
  const upload = asked.find(a => a.path.endsWith('/input'))
  assert.equal(upload.method, 'PUT')
  assert.equal(Number(upload.headers['content-length']), sent.bytes)
  assert.equal(upload.body.length, sent.bytes)
  assert.equal(upload.headers['transfer-encoding'], undefined)
  for (const a of [create, upload]) { assert.equal(a.headers.authorization, 'Bearer sk-bf-ada'); assert.equal(a.headers['x-manul-key-id'], 'vk_ada'); assert.equal(a.headers['x-agentshot-api'], '1') }

  // what comes back is a version waiting for a yes or a no, not a change made behind the person's back
  await win.keyboard.press('Escape')
  // while it runs, the jobs tray says where it has got to
  const tray = () => win.evaluate(() => window.agentshot.jobs.list()).then(list => list.find(j => j.kind === 'cloud'))
  const said = new Set()
  let p, proposed
  for (let i = 0; i < 180 && !proposed; i++) {
    const j = await tray()
    if (j?.detail) said.add(j.detail)
    p = await win.evaluate(d => window.agentshot.project.open(d), dir)
    proposed = p.versions.find(v => v.id === p.proposal)
    if (!proposed) await win.waitForTimeout(500)
  }
  assert.ok([...said].some(s => /Waiting for a machine|Working on it/.test(s)), `the tray never said where the job was: ${[...said]}`)
  if (!proposed) throw new Error(`the film never came back: ${JSON.stringify({ versions: p.versions.map(v => v.title), job: await tray() })}`)
  assert.equal(proposed.title, 'Upscaled to 4K')
  assert.match(proposed.path, /^renders\/cloud-[0-9a-f-]+\.mp4$/)
  assert.notEqual(p.current, p.proposal, 'the film on screen is still the person’s own until they accept')
  assert.equal(statSync(join(dir, proposed.path)).size, statSync(clip).size)
  assert.deepEqual(readdirSync(join(dir, 'renders')).filter(f => f.endsWith('.part')), [], 'no half-fetched film is left')
  await win.screenshot({ path: join(out, '3-arrived.png') })
} finally { await app.close() }

// ---- not signed in: the offers show, and say what is needed
;({ app, win } = await launch('nobody', false))
try {
  const before = asked.length
  const dialog = await openExport(win)
  const section = dialog.locator('[data-cloud-jobs]')
  await section.waitFor()
  assert.match(await section.innerText(), /Sign in to AgentShot to use these/)
  for (const kind of ['upscale', 'voice']) assert.equal(await section.locator(`[data-cloud-offer="${kind}"]`).getByRole('button', { name: 'Run' }).isDisabled(), true)
  assert.deepEqual(asked.slice(before).filter(a => a.path.startsWith('/v1/jobs')), [], 'nothing is asked in the name of someone not signed in')

  // ---- and when the worker can't be reached, there is nothing to show: the dialog is as it always was
  await win.keyboard.press('Escape')
  await new Promise(ok => worker.close(ok))
  worker.closeAllConnections?.()
  const again = await openExport(win)
  await again.getByText('Finish it in another editor').waitFor()
  await win.waitForTimeout(1500)
  assert.equal(await again.locator('[data-cloud-jobs]').count(), 0)
  console.log('cloud e2e ok:', out)
} finally { await app.close() }
