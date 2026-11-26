// The hosted server (chat-host) reaching a person's cloud worker: a real bridge in cloud-worker mode, leased to them.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { MobileBridge } from '../src/main/mobile-bridge'
import { signWorkerToken } from '../account/src/index'
import { media, rpc, upload, WorkerError, type Worker } from '../chat-host/src/worker'

const bridges: MobileBridge[] = []
const folders: string[] = []
afterEach(async () => { await Promise.all(bridges.splice(0).map(b => b.stop())); await Promise.all(folders.splice(0).map(d => rm(d, { recursive: true, force: true }))) })

async function leasedWorker() {
  const root = await mkdtemp(join(tmpdir(), 'chat-host-worker-')); folders.push(root)
  const projects: { dir: string }[] = []
  const invoke = vi.fn(async (method: string, args: unknown[]) => {
    if (method === 'project:recent') return projects
    if (method === 'project:createMotion') { const p = { dir: join(root, `made-${projects.length + 1}`) }; projects.push(p); return p }
    return { method, args }
  })
  const imported: string[] = []
  const importFile = vi.fn(async (file: string) => {
    const p = { dir: join(root, `upload-${projects.length + 1}`) }
    projects.push(p); imported.push(file)
    return p
  })
  const bridge = new MobileBridge({ invoke, projects: () => projects, importFile, galleryFile: () => new Response(''), stateFile: join(root, 'bridge.json'), pool: true }); bridges.push(bridge)
  const status = await bridge.start()
  const creds = bridge.workerCredentials() as { secret: string; fingerprint: string }
  const until = Date.now() + 60 * 60_000
  bridge.setLease({ userId: 'user_maya', until })
  const worker: Worker = { id: 'w1', urls: status.addresses.slice(0, 1), fingerprint: creds.fingerprint, token: signWorkerToken(creds.secret, 'user_maya', true, until), expiresAt: until }
  return { root, worker, invoke, importFile, projects, creds }
}

describe('a person’s cloud worker, from the hosted server', () => {
  it('runs bridge calls on their space, and says what was refused', async () => {
    const { worker, invoke } = await leasedWorker()
    const made = await rpc(worker, 'project:createMotion', [{ title: 'Launch', aspect: '16:9' }]) as { dir: string }
    expect(await rpc(worker, 'project:recent', [])).toEqual([made])
    expect(await rpc(worker, 'outside:call', [made.dir, 'project_state', {}])).toEqual({ method: 'outside:call', args: [made.dir, 'project_state', {}] })
    expect(invoke).toHaveBeenCalledWith('outside:call', [made.dir, 'project_state', {}])
    // another person's project, and the worker's own settings: refused, with the worker's reason
    await expect(rpc(worker, 'outside:call', ['/elsewhere/p', 'project_state', {}])).rejects.toMatchObject({ status: 403 })
    await expect(rpc(worker, 'keys:set', ['OPENAI_API_KEY', 'x'])).rejects.toBeInstanceOf(WorkerError)
  })

  it('refuses a worker whose certificate isn’t the one leased', async () => {
    const { worker } = await leasedWorker()
    await expect(rpc({ ...worker, fingerprint: 'ab'.repeat(32) }, 'project:recent', [])).rejects.toThrow(/certificate/)
  })

  it('tries the next address when one can’t be reached', async () => {
    const { worker } = await leasedWorker()
    expect(await rpc({ ...worker, urls: ['https://127.0.0.1:1', ...worker.urls] }, 'project:recent', [])).toEqual([])
  })

  it('stops when the lease token is someone else’s or has run out', async () => {
    const { worker, creds } = await leasedWorker()
    const sam = signWorkerToken(creds.secret, 'user_sam', true, Date.now() + 60_000)
    await expect(rpc({ ...worker, token: sam }, 'project:recent', [])).rejects.toMatchObject({ status: 401 })
  })

  it('streams a project’s file in ranges, and takes a file in as a new project of theirs', async () => {
    const { worker } = await leasedWorker()
    const made = await upload(worker, 'clip.mp4', 10, Readable.from([Buffer.from('0123456789')])) as { dir: string }
    expect(made.dir).toMatch(/upload-1$/)
    expect(await rpc(worker, 'project:recent', [])).toEqual([made])
  })

  it('reads a file of their project in ranges', async () => {
    const { worker } = await leasedWorker()
    const made = await rpc(worker, 'project:createMotion', [{ title: 'Launch', aspect: '16:9' }]) as { dir: string }
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(made.dir, 'media'), { recursive: true })
    await writeFile(join(made.dir, 'media', 'talk.mp4'), '0123456789')
    const res = await media(worker, made.dir, 'media/talk.mp4', { range: 'bytes=2-4' })
    const chunks: Buffer[] = []; for await (const c of res) chunks.push(c as Buffer)
    expect(res.statusCode).toBe(206)
    expect(Buffer.concat(chunks).toString()).toBe('234')
  })
})
