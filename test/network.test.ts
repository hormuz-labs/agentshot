import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { createServer as tlsServer, request } from 'node:https'
import { connect } from 'node:net'
import { once } from 'node:events'
import selfsigned from 'selfsigned'
import { ProxyAgent } from 'proxy-agent'
import { chromiumProxy, environmentProxyCredentials, localNetworkUrl, outboundProxy, proxyRulesFromEnvironment } from '../src/main/network'

const keys = ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'no_proxy', 'NO_PROXY', 'npm_config_proxy', 'npm_config_http_proxy', 'npm_config_https_proxy']
const clean: (() => void)[] = []
beforeEach(() => { for (const key of keys) vi.stubEnv(key, '') })
afterEach(() => { for (const close of clean.splice(0).reverse()) close(); vi.unstubAllEnvs() })

describe('desktop internet proxy policy', () => {
  it('honors environment precedence, WebSocket schemes and NO_PROXY without system fallback', async () => {
    vi.stubEnv('HTTPS_PROXY', 'http://upper:8080')
    vi.stubEnv('https_proxy', 'http://lower:8080')
    const system = vi.fn(async () => 'PROXY system:8888')
    expect(await outboundProxy('wss://relay.agentshot.si/worker', system)).toBe('http://lower:8080')
    vi.stubEnv('NO_PROXY', '.agentshot.si')
    expect(await outboundProxy('wss://relay.agentshot.si/worker', system)).toBe('')
    expect(proxyRulesFromEnvironment()!.proxyRules).toContain('lower:8080')
    expect(system).not.toHaveBeenCalled()
  })
  it('resolves OS/PAC proxies dynamically, including SOCKS and direct routes', async () => {
    expect(await outboundProxy('wss://relay.agentshot.si', async () => 'PROXY college:3128; DIRECT')).toBe('http://college:3128')
    expect(chromiumProxy('SOCKS5 proxy:1080')).toBe('socks5://proxy:1080')
    expect(chromiumProxy('HTTPS proxy:443')).toBe('https://proxy:443')
    expect(chromiumProxy('DIRECT')).toBe('')
  })
  it('never proxies loopback, LAN or mesh traffic even with ALL_PROXY', async () => {
    vi.stubEnv('ALL_PROXY', 'http://internet:8080')
    for (const host of ['localhost', '127.0.0.5', '192.168.1.1', '10.8.0.2', '172.16.0.3', '100.64.1.2', '[::1]', '[fd00::1]', 'desktop.local']) {
      expect(localNetworkUrl(`https://${host}:47821`)).toBe(true)
      expect(await outboundProxy(`https://${host}:47821`)).toBe('')
    }
    expect(localNetworkUrl('https://172.32.0.1')).toBe(false)
  })
  it('keeps proxy passwords out of Chromium rules and supplies them only to the matching proxy', () => {
    vi.stubEnv('HTTPS_PROXY', 'http://alice:secret%40pass@college:3128')
    expect(proxyRulesFromEnvironment()!.proxyRules).not.toContain('secret')
    expect(environmentProxyCredentials('college', 3128)).toEqual({ username: 'alice', password: 'secret@pass' })
    expect(environmentProxyCredentials('attacker', 3128)).toBeUndefined()
  })
  it('real authenticated CONNECT reaches HTTPS with remote DNS and verified TLS', async () => {
    const cert = await selfsigned.generate([{ name: 'commonName', value: 'private.example' }], { keySize: 2048 })
    const tls = tlsServer({ key: cert.private, cert: cert.cert }, (_req, res) => res.end('through proxy'))
    tls.listen(0, '127.0.0.1'); await once(tls, 'listening'); clean.push(() => tls.close())
    const port = (tls.address() as { port: number }).port
    let authority = '', authorization = ''
    const sockets = new Set<import('node:net').Socket>()
    const proxy = createServer()
    proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
    proxy.on('connect', (req, client, head) => {
      authority = req.url!; authorization = req.headers['proxy-authorization'] || ''
      if (authorization !== `Basic ${Buffer.from('alice:password').toString('base64')}`) { client.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); return }
      const upstream = connect(port, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        upstream.write(head); client.pipe(upstream).pipe(client)
      })
      upstream.on('error', () => client.destroy()); client.on('close', () => upstream.destroy())
    })
    proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening')
    clean.push(() => { for (const socket of sockets) socket.destroy(); proxy.close() })
    const agent = new ProxyAgent({ getProxyForUrl: () => `http://alice:password@127.0.0.1:${(proxy.address() as { port: number }).port}` })
    clean.push(() => agent.destroy())
    const body = await new Promise<string>((resolve, reject) => {
      const req = request('https://private.example/', { agent, ca: cert.cert }, res => {
        let text = ''; res.on('data', data => text += data); res.on('end', () => resolve(text))
      })
      req.on('error', reject); req.end()
    })
    expect(body).toBe('through proxy'); expect(authority).toBe('private.example:443')
  })
})
