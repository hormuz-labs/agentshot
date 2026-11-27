// The hosted server (chat-host) reaching a person's cloud worker: a real bridge in cloud-worker mode, leased to them.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { MobileBridge } from '../src/main/mobile-bridge'
import { signWorkerToken } from '../account/src/index'
import { media, open, rpc, upload, WorkerError, type Worker } from '../chat-host/src/worker'
import { createServer as createTls, type Server as TlsServer } from 'node:tls'
import { X509Certificate } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { generate } from 'selfsigned'

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

const servers: TlsServer[] = []
const sockets = new Set<import('node:tls').TLSSocket>()
afterEach(async () => { for (const s of sockets) s.destroy(); sockets.clear(); await Promise.all(servers.splice(0).map(s => new Promise(ok => s.close(ok)))) })
/** Something answering TLS with a certificate of its own: what it was sent, and what to do when a request arrives. */
async function tlsServer(onData: (socket: import('node:tls').TLSSocket, sofar: Buffer) => void = () => {}) {
  const pem = await generate([{ name: 'commonName', value: 'worker' }], { keySize: 2048 })
  const got = { bytes: 0, requests: 0, closed: 0 }
  const server = createTls({ key: pem.private, cert: pem.cert }, socket => {
    let sofar = Buffer.alloc(0), counted = false
    socket.on('error', () => {})
    sockets.add(socket)
    socket.on('close', () => { got.closed++ })
    socket.on('data', c => { got.bytes += c.length; sofar = Buffer.concat([sofar, c]); if (!counted) { counted = true; got.requests++ }; onData(socket, sofar) })
  })
  servers.push(server)
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok))
  const url = `https://127.0.0.1:${(server.address() as AddressInfo).port}`
  const fingerprint = new X509Certificate(pem.cert).fingerprint256.replaceAll(':', '').toLowerCase()
  const worker: Worker = { id: 'raw', urls: [url], fingerprint, token: 'lease.secret-token', expiresAt: Date.now() + 60_000 }
  return { worker, got, url }
}

describe('what may be asked again', () => {
  it('sends nothing, not even the lease token, to a server whose certificate isn’t the one leased', async () => {
    const { worker, got } = await tlsServer()
    const failed = await rpc({ ...worker, fingerprint: 'ab'.repeat(32) }, 'project:recent', []).catch(e => e)
    expect(failed).toBeInstanceOf(WorkerError)
    expect(failed).toMatchObject({ status: 0, unsent: true })
    expect(failed.message).toMatch(/certificate/)
    await new Promise(ok => setTimeout(ok, 50))
    expect(got.bytes).toBe(0)
  })

  it('says a worker that can’t be reached took nothing', async () => {
    const failed = await rpc({ id: 'x', urls: ['https://127.0.0.1:1'], fingerprint: 'ab'.repeat(32), token: 't', expiresAt: 0 }, 'project:recent', []).catch(e => e)
    expect(failed).toMatchObject({ status: 0, unsent: true })
    expect(failed.message).toMatch(/can’t be reached/)
  })

  it('gives up on an address that doesn’t answer in time, and goes to the next', async () => {
    // accepts the connection and never finishes the handshake
    const { createServer } = await import('node:net')
    const silent = createServer(() => {}); await new Promise<void>(ok => silent.listen(0, '127.0.0.1', ok))
    try {
      const { worker } = await leasedWorker()
      const res = await open({ ...worker, urls: [`https://127.0.0.1:${(silent.address() as AddressInfo).port}`, ...worker.urls] }, '/hello', { method: 'GET', connectMs: 200 })
      res.resume()
      expect(res.statusCode).toBe(200)
    } finally { silent.close() }
  })

  it('never sends a request again once it is on its way: the worker may have begun the work', async () => {
    // takes the request, then goes away without answering (it crashed, or the connection dropped mid-render)
    const { worker, got, url } = await tlsServer(socket => socket.destroy())
    const failed = await rpc({ ...worker, urls: [url, url] }, 'outside:call', ['/space/p', 'ffmpeg', {}]).catch(e => e)
    expect(failed).toBeInstanceOf(WorkerError)
    expect(failed).toMatchObject({ status: 0, unsent: false })
    expect(failed.message).toMatch(/stopped answering/)
    expect(got.requests).toBe(1) // not the second address
  })

  it('a request that times out is not sent again either', async () => {
    const { worker, got, url } = await tlsServer()
    const failed = await rpc({ ...worker, urls: [url, url] }, 'outside:call', ['/space/p', 'ffmpeg', {}], 150).catch(e => e)
    expect(failed).toMatchObject({ status: 0, unsent: false })
    expect(got.requests).toBe(1)
  })

  it('lets go of the worker when the file being sent stops arriving', async () => {
    const { worker, got } = await tlsServer()
    const file = new Readable({ read() {} })
    const sending = upload(worker, 'clip.mp4', 1000, file).catch(e => e)
    file.push(Buffer.from('half of it'))
    await vi.waitFor(() => expect(got.bytes).toBeGreaterThan(0))
    file.destroy() // the browser tab closed
    expect(await sending).toBeInstanceOf(WorkerError)
    await vi.waitFor(() => expect(got.closed).toBe(1))
  })
})

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
