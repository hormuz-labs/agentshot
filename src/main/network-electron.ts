import { app, net, session } from 'electron'
import http from 'node:http'
import https from 'node:https'
import { environmentProxyCredentials, localNetworkUrl, outboundAgent, proxyRulesFromEnvironment, useSystemProxy } from './network'

export async function initializeNetwork() {
  const chromium = session.defaultSession
  const rules = proxyRulesFromEnvironment()
  if (rules) await chromium.setProxy(rules)
  useSystemProxy(url => chromium.resolveProxy(url))
  http.globalAgent = outboundAgent
  https.globalAgent = outboundAgent
  const nodeFetch = globalThis.fetch
  // Node's fetch ignores Chromium's system/PAC proxy configuration. Use the
  // Chromium stack for internet requests, preserving streaming and cancellation.
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    return localNetworkUrl(url) ? nodeFetch(input, init) : net.fetch(input instanceof URL ? input.toString() : input, init)
  }
  const attempted = new WeakSet<object>()
  app.on('login', (event, _contents, _details, auth, callback) => {
    if (!auth.isProxy) return
    const credentials = environmentProxyCredentials(auth.host, auth.port)
    if (!credentials || attempted.has(_details)) return
    attempted.add(_details)
    event.preventDefault()
    callback(credentials.username, credentials.password)
  })
}
