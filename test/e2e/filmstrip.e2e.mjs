// Real imported video: visible, distinct thumbnails; seeking and range selection still work.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'manul-filmstrip-'))
const source = join(tmp, 'footage.mp4')
execFileSync(join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, 'ffmpeg'), [
  '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red:s=640x360:r=60:d=2',
  '-f', 'lavfi', '-i', 'color=blue:s=640x360:r=60:d=2', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source,
])
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...process.env, MANUL_PROJECTS: join(tmp, 'projects') } })
try {
  const win = await app.firstWindow()
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await app.evaluate(({ ipcMain }, file) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => file) }, source)
  await win.click('text=Drop a video here')
  await win.locator('button:has(svg.lucide-arrow-up)').click()
  await win.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  await win.waitForFunction(() => {
    const images = [...document.querySelectorAll('[data-testid="timeline-filmstrip"] img')]
    return images.length >= 4 && images.every(img => img.complete && img.naturalWidth > 0)
  })
  const sources = await win.locator('[data-testid="timeline-filmstrip"] img').evaluateAll(images => images.map(img => img.src))
  const pixels = sources.map(src => [...execFileSync(join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, 'ffmpeg'), [
    '-loglevel', 'error', '-i', decodeURIComponent(new URL(src).pathname), '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ])])
  assert.ok(pixels[0][0] > 200 && pixels[0][2] < 40, 'start shows the red scene')
  assert.ok(pixels.at(-1)[2] > 200 && pixels.at(-1)[0] < 40, 'end shows the blue scene')
  const bar = win.getByTestId('timeline-scrubber')
  assert.equal(await win.getByRole('slider', { name: 'Timeline zoom' }).count(), 0, 'zoom has no draggable slider')
  assert.equal(await win.getByRole('button', { name: /Zoom (in|out) timeline/ }).count(), 0, 'zoom has no plus or minus buttons')
  assert.equal(await win.getByTestId('timeline-scale').innerText(), '', 'the fitted timeline has no Fit label')
  assert.equal(await win.getByText('60 fps', { exact: true }).count(), 1, 'the readout shows the actual source rate')
  const box = await bar.boundingBox()
  await win.mouse.click(box.x + box.width * 0.75, box.y + 30)
  await win.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 3) < 0.15)
  await win.mouse.move(box.x + box.width * 0.25, box.y + 30)
  await win.mouse.down()
  await win.mouse.move(box.x + box.width * 0.7, box.y + 30, { steps: 8 })
  await win.mouse.up()
  assert.equal(await bar.locator('.border-amber').count(), 1, 'dragging selects a range on the filmstrip')
  const beforeZoom = await win.locator('[data-testid="timeline-filmstrip"] img').first().boundingBox()
  await win.getByTestId('timeline-viewport').hover()
  await win.keyboard.down('Control')
  await win.mouse.wheel(0, -140)
  await win.keyboard.up('Control')
  await win.waitForFunction(() => {
    const el = document.querySelector('[data-testid="timeline-viewport"]')
    const img = el.querySelector('img')
    return el.scrollWidth >= el.clientWidth * 3.9 && img && img.complete && img.naturalWidth > 0
  })
  const zoomBox = await bar.boundingBox()
  assert.ok(zoomBox.width >= box.width * 3.9, 'zoom expands time across a scrollable strip')
  await win.getByTestId('timeline-viewport').evaluate(el => { el.scrollLeft = el.scrollWidth })
  await win.waitForFunction(() => {
    const strip = document.querySelector('[data-testid="timeline-filmstrip"]')
    const imgs = [...strip.querySelectorAll('img')]
    const last = imgs.at(-1)
    return last && last.complete && last.naturalWidth > 0 && last.getBoundingClientRect().right >= strip.getBoundingClientRect().right - 2 && last.getBoundingClientRect().width <= 113
  })
  const zoomFrame = await win.locator('[data-testid="timeline-filmstrip"] img').first().boundingBox()
  assert.ok(zoomFrame.width / zoomBox.width < beforeZoom.width / box.width, `each thumbnail covers a smaller time interval when zoomed: ${JSON.stringify({ zoomFrame, zoomBox, beforeZoom, box })}`)
  await win.getByTestId('timeline-viewport').hover()
  await win.keyboard.down('Control')
  await win.mouse.wheel(0, -2000)
  await win.keyboard.up('Control')
  await win.waitForFunction(() => document.querySelector('[data-testid="timeline-filmstrip"]').dataset.frameCount === '240')
  assert.match(await win.getByTestId('timeline-scale').innerText(), /s visible · Frame view/)
  assert.ok(await win.locator('[data-testid="timeline-filmstrip"] img').count() <= 24, 'only the visible source frames are rendered')
  await win.getByRole('button', { name: 'Fit timeline', exact: true }).click()
  await win.waitForFunction(() => {
    const el = document.querySelector('[data-testid="timeline-viewport"]')
    return el.scrollWidth <= el.clientWidth + 2 && el.scrollLeft === 0
  })
  const viewport = win.getByTestId('timeline-viewport')
  await viewport.hover()
  await win.keyboard.down('Control')
  await win.mouse.wheel(0, -70)
  await win.keyboard.up('Control')
  await win.waitForFunction(() => document.querySelector('[data-testid="timeline-scale"]').textContent.includes('s visible'))
  await win.getByRole('button', { name: 'Fit timeline', exact: true }).click()
  await win.waitForFunction(() => {
    const images = [...document.querySelectorAll('[data-testid="timeline-filmstrip"] img')]
    return images.length >= 4 && images.every(img => img.complete && img.naturalWidth > 0) && parseFloat(images[0].style.left) === 0 && parseFloat(images[0].style.width) > 10
  })
  await win.screenshot({ path: join(tmp, 'filmstrip.png') })
  console.log('filmstrip e2e: ok; screenshot:', join(tmp, 'filmstrip.png'))
} finally { await app.close() }
