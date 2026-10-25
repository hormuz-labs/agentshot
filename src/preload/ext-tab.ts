// Preload of every tab (and frame) in AgentShot's browser: BrowserSkill's content scripts, run in this isolated world (the
// page's own scripts cannot see it), with a `chrome` object bridged to the extension host. Also answers
// chrome.scripting.executeScript calls for the isolated world.
import { ipcRenderer } from 'electron'
import { makeChrome, type ExtInfo } from './chrome-shim'
import { contentScriptMatches } from '../shared/ext-match'

let info: (ExtInfo & { scripts: { code: string[]; matches?: string[]; all_frames?: boolean; run_at?: string; match_about_blank?: boolean }[] }) | null = null
try { info = ipcRenderer.sendSync('ext:info') } catch { info = null }

if (info?.manifest) {
  const { chrome } = makeChrome({ ipcRenderer, role: 'content', info })
  ;(globalThis as unknown as { chrome: unknown }).chrome = chrome
  const isTop = window.top === window
  const url = location.href
  const run = (cs: { code: string[] }) => { for (const code of cs.code) { try { (0, eval)(code) } catch (e) { console.warn('[bsk content script]', e) } } }
  for (const cs of info.scripts) {
    if (!isTop && !cs.all_frames) continue
    if (!contentScriptMatches(cs, url)) continue
    if (cs.run_at === 'document_start' || document.readyState !== 'loading') run(cs)
    else document.addEventListener('DOMContentLoaded', () => run(cs), { once: true })
  }
  ipcRenderer.on('ext:exec', async (_, reqId, code) => {
    let result: unknown
    try { result = await (0, eval)(code) } catch (e) { result = undefined; console.warn('[bsk executeScript]', e) }
    try { ipcRenderer.send('ext:reply', reqId, result === undefined ? null : JSON.parse(JSON.stringify(result))) }
    catch { ipcRenderer.send('ext:reply', reqId, null) }
  })
}
