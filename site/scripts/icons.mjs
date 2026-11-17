#!/usr/bin/env node
// The site's icons, cut from the app's own icon (build/icon.png) so the two can't drift apart again.
// The app icon has room around the cat for the dock; on a page that room just makes the cat small, so each file here
// is the cat trimmed to its outline, then scaled.
//   node site/scripts/icons.mjs            write site/public/{icon,icon-56,favicon,favicon-48,apple-touch-icon}.png
//   node site/scripts/icons.mjs --check    exit 1 if the app icon changed since they were written
import { chromium } from 'playwright-core'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const site = join(import.meta.dirname, '..')
const source = join(site, '..', 'build', 'icon.png')
const out = join(site, 'public')
const stampFile = join(out, 'icons.json')
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/** name → pixels, and for the one icon iOS shows on a home screen, the background and margin it needs there. */
export const ICONS = [
  { file: 'icon.png', size: 256 },
  { file: 'icon-56.png', size: 80 }, // shown at 28–40 px; twice that for sharp screens
  { file: 'favicon.png', size: 32 },
  { file: 'favicon-48.png', size: 48 },
  { file: 'apple-touch-icon.png', size: 512, background: '#f6f3ec', margin: 0.1 }, // iOS paints transparent pixels black
]

export const stamp = bytes => createHash('sha256').update(bytes).update(JSON.stringify(ICONS)).digest('hex').slice(0, 16)

/**
 * The square that holds everything drawn, centred on it: { x, y, side } in source pixels.
 * `alpha` is one byte per pixel, row by row; pixels fainter than `floor` are treated as empty.
 */
export function trim(alpha, width, height, floor = 16) {
  let left = width, right = -1, top = height, bottom = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (alpha[y * width + x] > floor) { if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y }
  }
  if (right < 0) return { x: 0, y: 0, side: Math.min(width, height) }
  const side = Math.max(right - left + 1, bottom - top + 1)
  return { x: Math.round((left + right + 1 - side) / 2), y: Math.round((top + bottom + 1 - side) / 2), side }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bytes = readFileSync(source)
  const want = stamp(bytes)
  if (process.argv.includes('--check')) {
    const have = existsSync(stampFile) ? JSON.parse(readFileSync(stampFile, 'utf8')).source : ''
    if (have !== want || ICONS.some(i => !existsSync(join(out, i.file)))) { console.error('site icons are out of date with build/icon.png: run node site/scripts/icons.mjs'); process.exit(1) }
    console.log('site icons match the app icon')
  } else {
    const browser = await chromium.launch({ executablePath: CHROME })
    const page = await browser.newPage()
    // drawn on a canvas in the page: the trim is measured from the picture's own alpha, then each size is cut from it
    const made = await page.evaluate(async ({ src, icons, trimSource }) => {
      const trim = new Function(`return (${trimSource})`)()
      const img = new Image(); img.src = src; await img.decode()
      const probe = new OffscreenCanvas(img.width, img.height).getContext('2d')
      probe.drawImage(img, 0, 0)
      const rgba = probe.getImageData(0, 0, img.width, img.height).data
      const alpha = new Uint8Array(img.width * img.height)
      for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]
      const box = trim(alpha, img.width, img.height)
      const result = {}
      for (const icon of icons) {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = icon.size
        const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high'
        if (icon.background) { ctx.fillStyle = icon.background; ctx.fillRect(0, 0, icon.size, icon.size) }
        const pad = Math.round(icon.size * (icon.margin ?? 0))
        ctx.drawImage(img, box.x, box.y, box.side, box.side, pad, pad, icon.size - pad * 2, icon.size - pad * 2)
        result[icon.file] = canvas.toDataURL('image/png').split(',')[1]
      }
      return result
    }, { src: `data:image/png;base64,${bytes.toString('base64')}`, icons: ICONS, trimSource: trim.toString() })
    await browser.close()
    for (const [file, b64] of Object.entries(made)) writeFileSync(join(out, file), Buffer.from(b64, 'base64'))
    writeFileSync(stampFile, JSON.stringify({ source: want }, null, 1) + '\n')
    console.log(`wrote ${ICONS.length} icons from build/icon.png`)
  }
}
