// Conversations in the real app with a real model (needs GEMINI_API_KEY; skipped without). Run after npm run build.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
if (!process.env.GEMINI_API_KEY) { console.log('conversations e2e: skipped (no GEMINI_API_KEY)'); process.exit(0) }
const root = join(import.meta.dirname, '..', '..')
const out = mkdtempSync(join(tmpdir(), 'manul-conv-')), ud = mkdtempSync(join(tmpdir(), 'manul-ud-'))
execFileSync(join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, 'ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=320x240:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(out, 'cv.mp4')])
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${ud}`], env: { ...process.env, MANUL_PROJECTS: join(out, 'cvp') } })
const win = await app.firstWindow()
await win.waitForSelector('text=What are we making?')
await dismissOnboarding(win)
await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => f) }, join(out, 'cv.mp4'))
await win.click('text=Drop a video here')
await win.locator('textarea').first().fill('Reply with just the word apple. Do not edit anything.')
await win.locator('button:has(svg.lucide-arrow-up)').click()
await win.waitForSelector('video')
await win.waitForSelector('text=/apple/i', { timeout: 60000 })
await win.waitForSelector('text=Working…', { state: 'detached', timeout: 60000 })
await win.click('button[title="Conversations"]'); await win.click('text=New conversation')
await win.waitForTimeout(800)
assert.equal(await win.locator('text=Reply with just the word apple').count(), 0, 'the new conversation starts empty')
await win.locator('textarea[placeholder="Ask for an edit…"]').fill('Reply with just the word banana. Do not edit anything.')
await win.keyboard.press('Enter')
await win.waitForSelector('text=/banana/i', { timeout: 60000 })
await win.waitForSelector('text=Working…', { state: 'detached', timeout: 60000 })
await win.click('button[title="Conversations"]')
await win.waitForTimeout(300)
await win.screenshot({ path: join(out, 'conversations.png') })
await win.locator('[data-radix-popper-content-wrapper] button:has-text("Reply with just the word apple")').click()
await win.waitForSelector('text=Reply with just the word apple', { timeout: 10000 })
await win.waitForTimeout(1000)
await win.screenshot({ path: join(out, 'after-switch.png') })
assert.equal(await win.locator('text=Reply with just the word banana').count(), 0, 'switching back shows only that thread')
console.log('conversations e2e: ok')
await app.close()
