// Playback must move the playhead without rebuilding thumbnail tiles or restarting video decoding.
// Cover imported footage, a proposal without a stored timeline, and an unrendered edit across a cut.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'manul-playback-'))
const source = join(tmp, 'footage.mp4')
execFileSync(join(root, 'resources/bin', `${process.platform}-${process.arch}`, 'ffmpeg'), [
  '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=640x360:r=60:d=2',
  '-f', 'lavfi', '-i', 'color=blue:s=640x360:r=60:d=4', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source,
])
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/_API_KEY$|_TOKEN$/.test(k)))
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...env, MANUL_PROJECTS: join(tmp, 'projects') } })
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1400, height: 860 })
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await app.evaluate(({ ipcMain }, file) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => [file]) }, source)
  await win.click('[data-tour="import"]')
  await win.getByRole('button', { name: 'Start', exact: true }).click()
  await win.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  await win.waitForFunction(async () => (await window.manul.tabs.get()).active)
  const dir = await win.evaluate(() => window.manul.tabs.get().then(t => t.active))
  const framesReady = () => win.waitForFunction(() => {
    const images = [...document.querySelectorAll('[data-testid="timeline-filmstrip"] img')]
    return images.length >= 4 && images.every(img => img.complete && img.naturalWidth > 0)
  })
  const checkPlayback = async label => {
    await framesReady()
    const result = await win.locator('[data-tour="picture"] video').evaluate(async video => {
      video.currentTime = 0.25
      await new Promise(resolve => video.addEventListener('seeked', resolve, { once: true }))
      const tiles = [...document.querySelectorAll('[data-testid="timeline-filmstrip"] img')]
      const pieces = [...document.querySelectorAll('[data-piece]')]
      const picture = document.querySelector('[data-tour="picture"]')
      const timeline = document.querySelector('[data-tour="timeline"]')
      let removedTiles = 0, removedVideos = 0, seeks = 0
      const onSeek = () => seeks++
      video.addEventListener('seeking', onSeek)
      const observer = new MutationObserver(records => {
        for (const record of records) for (const node of record.removedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue
          removedTiles += Number(node.matches('[data-testid="timeline-filmstrip"], [data-testid="timeline-filmstrip"] img')) + node.querySelectorAll('[data-testid="timeline-filmstrip"]').length
          removedVideos += Number(node.matches('video')) + node.querySelectorAll('video').length
        }
      })
      observer.observe(timeline, { childList: true, subtree: true })
      observer.observe(picture, { childList: true, subtree: true })
      const start = video.getVideoPlaybackQuality().totalVideoFrames
      await video.play()
      await new Promise(resolve => setTimeout(resolve, 1200))
      video.pause()
      await new Promise(resolve => requestAnimationFrame(resolve))
      observer.disconnect(); video.removeEventListener('seeking', onSeek)
      return { removedTiles, removedVideos, seeks, time: video.currentTime,
        decoded: video.getVideoPlaybackQuality().totalVideoFrames - start,
        sameTiles: tiles.every(tile => tile.isConnected), samePieces: pieces.every(piece => piece.isConnected) }
    })
    assert.equal(result.removedTiles, 0, `${label}: timeline frames stay mounted while the playhead moves`)
    assert.equal(result.removedVideos, 0, `${label}: the preview video stays mounted`)
    assert.equal(result.seeks, 0, `${label}: playback does not repeatedly seek`)
    assert.ok(result.sameTiles && result.samePieces, `${label}: playback preserves the filmstrip and piece identities`)
    assert.ok(result.time > 1 && result.decoded > 20, `${label}: frames continue decoding: ${JSON.stringify(result)}`)
  }
  await checkPlayback('Original')

  // Agent-generated versions can have only a video path, without a timeline saved with the version.
  const p = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  copyFileSync(source, join(dir, 'renders/proposed.mp4'))
  p.media['renders/proposed.mp4'] = p.media[p.versions[0].path]
  p.versions.push({ id: 'proposal', path: 'renders/proposed.mp4', title: 'Proposed cut', createdAt: Date.now(), by: 'agent' })
  p.proposal = 'proposal'
  writeFileSync(join(dir, 'project.json'), JSON.stringify(p))
  await win.evaluate(async dir => { await window.manul.project.close(dir); await window.manul.project.open(dir) }, dir)
  await app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows().find(w => w.isVisible()).webContents.send('project', p), p)
  await win.waitForFunction(() => document.querySelector('[data-tour="picture"] video')?.src.includes('proposed.mp4'))
  await win.waitForFunction(() => document.querySelector('[data-tour="picture"] video')?.readyState >= 2)
  await checkPlayback('Proposal without a stored timeline')

  await win.evaluate(dir => window.manul.project.decide(dir, false), dir)
  await win.evaluate(dir => window.manul.timeline.edit(dir, [{ op: 'split', at: 2 }, { op: 'split', at: 4 }]), dir)
  await win.waitForFunction(() => document.querySelectorAll('video[data-edit-player]').length === 2)
  await win.waitForFunction(() => [...document.querySelectorAll('video[data-edit-player]')].every(v => v.readyState >= 2))
  await win.locator('video[data-edit-player="0"]').evaluate(v => v.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })))
  await win.waitForFunction(() => document.querySelector('video[data-edit-player="1"]').style.visibility === 'visible')
  const live = await win.evaluate(async () => {
    const front = document.querySelector('video[data-edit-player="1"]')
    const samples = [], canvas = document.createElement('canvas')
    canvas.width = 1; canvas.height = 1
    const ctx = canvas.getContext('2d')
    const start = front.getVideoPlaybackQuality().totalVideoFrames
    for (let i = 0; i < 8; i++) {
      await new Promise(resolve => setTimeout(resolve, 75))
      ctx.drawImage(front, 0, 0, 1, 1)
      samples.push({ visible: getComputedStyle(front).visibility, rgb: [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3) })
    }
    return { samples, decoded: front.getVideoPlaybackQuality().totalVideoFrames - start }
  })
  assert.ok(live.samples.every(s => s.visible === 'visible' && s.rgb[2] > 180 && s.rgb[0] < 50), `the active video stays visible after a cut: ${JSON.stringify(live)}`)
  assert.ok(live.decoded > 10, 'live playback keeps decoding after the cut')
  console.log('playback e2e: ok')
} finally {
  await app.close()
}
