// One outbound network policy for Node HTTP/WebSocket and Chromium fetch.
// Chromium supplies OS/PAC discovery; explicit environment settings take priority.
import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import { isIP } from 'node:net'
import { ProxyAgent } from 'proxy-agent'
import { getProxyForUrl } from 'proxy-from-env'

export function networkUrl(raw: string) {
  const url = new URL(raw)
  if (url.protocol === 'wss:') url.protocol = 'https:'
  if (url.protocol === 'ws:') url.protocol = 'http:'
  return url
}
export function localNetworkUrl(raw: string) {
  const host = networkUrl(raw).hostname.replace(/^\[|\]$/g, '').toLowerCase()
  // Never send bridge/CDP/mesh traffic or its credentials to an internet proxy.
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1') return true
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number)
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
  }
  return isIP(host) === 6 && /^(fc|fd|fe[89ab])/i.test(host)
}
export function chromiumProxy(raw: string): string {
  for (const choice of raw.split(';').map(s => s.trim())) {
    if (choice === 'DIRECT') return ''
    const match = /^(PROXY|HTTPS|SOCKS|SOCKS4|SOCKS5) (\S+)$/.exec(choice)
    if (match) return `${({ PROXY: 'http', HTTPS: 'https', SOCKS: 'socks5', SOCKS4: 'socks4', SOCKS5: 'socks5' } as Record<string, string>)[match[1]]}://${match[2]}`
  }
  throw new Error('Unsupported system proxy configuration')
}
export function hasEnvironmentProxy() {
  return ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'npm_config_proxy', 'npm_config_http_proxy', 'npm_config_https_proxy'].some(key => !!process.env[key])
}
export async function outboundProxy(raw: string, resolveSystem?: (url: string) => Promise<string>) {
  if (localNetworkUrl(raw)) return ''
  const url = networkUrl(raw).toString()
  // proxy-from-env handles NO_PROXY hosts, suffixes, ports and wildcard.
  if (hasEnvironmentProxy()) return getProxyForUrl(url)
  return resolveSystem ? chromiumProxy(await resolveSystem(url)) : ''
}

let resolveSystem: ((url: string) => Promise<string>) | undefined
export const outboundAgent = new ProxyAgent({
  httpAgent: new HttpAgent({ keepAlive: true }),
  httpsAgent: new HttpsAgent({ keepAlive: true }),
  getProxyForUrl: url => outboundProxy(url, resolveSystem),
})
export function useSystemProxy(resolver: (url: string) => Promise<string>) { resolveSystem = resolver }

export function proxyRulesFromEnvironment() {
  if (!hasEnvironmentProxy()) return undefined
  const sanitize = (raw: string) => {
    if (!raw) return 'direct://'
    const url = new URL(raw.includes('://') ? raw : `http://${raw}`)
    url.username = ''; url.password = ''
    return url.toString().replace(/\/$/, '')
  }
  return {
    mode: 'fixed_servers' as const,
    proxyRules: `http=${sanitize(getProxyForUrl('http://proxy-policy.invalid'))};https=${sanitize(getProxyForUrl('https://proxy-policy.invalid'))}`,
    proxyBypassRules: [(process.env.no_proxy || process.env.NO_PROXY || '').replace(/,/g, ';'), '<local>', '127.0.0.1', '[::1]', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16', '[fc00::]/7', '[fe80::]/10'].join(';'),
  }
}

export function environmentProxyCredentials(host: string, port: number) {
  for (const key of ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY', 'all_proxy', 'ALL_PROXY']) {
    const raw = process.env[key]
    if (!raw) continue
    try {
      const url = new URL(raw.includes('://') ? raw : `http://${raw}`)
      if (url.hostname === host && Number(url.port || (url.protocol === 'https:' ? 443 : 80)) === port && url.username) {
        return { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) }
      }
    } catch { /* Invalid configuration is rejected when connecting, without logging credentials. */ }
  }
}
