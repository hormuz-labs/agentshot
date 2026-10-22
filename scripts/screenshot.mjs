// The README screenshots: a demo project in a throwaway profile (a title film with a spoken line, its transcript, a
// conversation with the agent's steps, a note boxed on the frame and a proposed version), captured at 2×:
//   docs/start.png   the home screen
//   docs/chat.png    the conversation, the film beside it, the project tree
//   docs/inline.png  a box drawn on the picture, and the message box that opens at it
//   docs/dark.png    the same, in the dark theme
//   npm run build && node scripts/screenshot.mjs
// The conversation and the proposal are staged (sent to the window as the agent would send them); nothing calls a model.
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const bin = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`)
const tmp = mkdtempSync('/tmp/mshot-')
const font = join(root, 'resources', 'fonts', 'Inter-Bold.ttf')
const ffmpeg = args => execFileSync(join(bin, 'ffmpeg'), ['-y', '-loglevel', 'error', ...args])

// a spoken line with a few fillers (macOS say), over a warm gradient title
execFileSync('say', ['-v', 'Samantha', '-o', join(tmp, 'voice.aiff'),
  'So, um, the manul is a small wild cat from the steppes of Central Asia. Uh, it has round pupils, and the thickest fur of any cat. Honestly, it is, um, the grumpiest looking cat on Earth.'])
const title = `drawtext=fontfile=${font}:text='The Pallas cat':fontsize=128:fontcolor=white:x=(w-tw)/2:y=(h-th)/2-40,` +
  `drawtext=fontfile=${font}:text='a field guide':fontsize=44:fontcolor=white@0.75:x=(w-tw)/2:y=(h/2)+70`
const gradient = ['-f', 'lavfi', '-i', 'gradients=s=1920x1080:c0=0x2a1708:c1=0xf2a541:c2=0x6b3a1a:x0=0:y0=0:x1=1920:y1=1080:speed=0.004:r=30']
ffmpeg([...gradient, '-i', join(tmp, 'voice.aiff'), '-vf', title, '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(tmp, 'Pallas cat.mp4')])
// the proposed cut: the same title with a lower third
ffmpeg(['-i', join(tmp, 'Pallas cat.mp4'), '-vf',
  `drawbox=x=120:y=820:w=760:h=150:color=black@0.55:t=fill,drawtext=fontfile=${font}:text='Otocolobus manul':fontsize=64:fontcolor=white:x=160:y=845,` +
  `drawtext=fontfile=${font}:text='Pallas cat · Central Asia':fontsize=32:fontcolor=white@0.7:x=160:y=920`,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'copy', join(tmp, 'v2 Ums cut, lower third.mp4')])

// the conversation as the agent leaves it: the request, its steps, its reply
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const said = (id, content) => ({ id: `r-${id}`, role: 'tool', toolCallId: id, content })
const conversation = film => [
  { id: 'u1', role: 'user', content: 'Cut the ums, then add a lower third that says “Otocolobus manul” when the cat is named' },
  { id: 'a1', role: 'assistant', content: '', toolCalls: [call('c1', 'transcript', { search: 'um' }), call('c2', 'analyze_video', { media: film })] },
  said('c1', '4 fillers: “um” 0:00.6, “uh” 0:05.9, “um” 0:11.2, “honestly” 0:09.8'), said('c2', '1 shot, steady; speech −18 LUFS'),
  { id: 'a2', role: 'assistant', content: '', toolCalls: [call('c3', 'ffmpeg', { args: ['-i', film, '-filter_complex', '[0:v]trim…', 'renders/v2.mp4'] }), call('c4', 'propose_version', { title: 'Ums cut, lower third' })] },
  said('c3', 'ok'), said('c4', 'proposed v2'),
  { id: 'a3', role: 'assistant', content: 'Cut four fillers, 2.1 s in all, each in the quiet before the next word so nothing jumps. The lower third comes in on “manul” at 0:04.6 and holds for three seconds.\n\nCompare before and after on the film, then keep it or send it back.' },
]

const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...process.env, MANUL_PROJECTS: join(tmp, 'p') } })
const shot = async (win, name) => {
  await win.mouse.move(5, 400)
  await win.waitForTimeout(600)
  await win.screenshot({ path: join(tmp, `${name}.png`) })
  execFileSync('sips', ['-Z', '2400', join(tmp, `${name}.png`), '--out', join(root, 'docs', `${name}.png`)], { stdio: 'ignore' })
  console.log(`docs/${name}.png`)
}
try {
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(x => x.isVisible()) || BrowserWindow.getAllWindows()[0]; w.setSize(1440, 860); w.center() })
  await win.waitForSelector('text=What are we making?')
  // a placeholder key so the agent's input shows (nothing is sent)
  await win.evaluate(() => window.manul.keys.set('GEMINI_API_KEY', 'screenshot-placeholder'))
  await win.reload()
  await win.waitForSelector('text=What are we making?')
  await win.locator('textarea').fill('Cut the ums, then add a lower third that says “Otocolobus manul” when the cat is named')
  await shot(win, 'start')

  await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => f) }, join(tmp, 'Pallas cat.mp4'))
  await win.locator('textarea').fill('')
  await win.click('text=Drop a video here')
  await win.locator('button[aria-label="Start"]').click()
  await win.waitForSelector('[data-project-title]', { timeout: 30_000 })
  await win.waitForFunction(d => window.manul.project.open(d).then(p => Object.keys(p.transcripts || {}).length > 0),
    await win.evaluate(() => window.manul.tabs.get().then(t => t.active)), { timeout: 120_000, polling: 1000 }) // transcribed
  // the speakers job and the filmstrip finish first (each sends the project again, which would replace what's staged)
  await win.waitForSelector('text=Finding who speaks', { state: 'detached', timeout: 180_000 }).catch(() => {})
  await win.waitForFunction(() => { const i = [...document.querySelectorAll('[data-testid="timeline-filmstrip"] img')]; return i.length > 2 && i.every(x => x.complete) }, null, { timeout: 60_000 }).catch(() => {})
  await win.waitForTimeout(1500)

  // stage what the agent would have done: a proposed version, a note boxed on the frame, the conversation
  const dir = await win.locator('[data-project-row][aria-current="true"]').getAttribute('data-project-row')
  const [rel] = await win.evaluate(([d, f]) => window.manul.project.import(d, f), [dir, join(tmp, 'v2 Ums cut, lower third.mp4')])
  await win.waitForTimeout(1500)
  await win.waitForSelector('text=Finding who speaks', { state: 'detached', timeout: 180_000 }).catch(() => {}) // the import's own job
  const p = await win.evaluate(d => window.manul.project.open(d), dir)
  const film = p.versions[0].path
  const staged = {
    ...p,
    versions: [...p.versions, { id: 'v2', path: rel, title: 'Ums cut, lower third', createdAt: Date.now(), by: 'agent' }],
    proposal: 'v2',
    conversations: (p.conversations || []).map(c => (c.id === p.conversation ? { ...c, title: 'Ums out, the cat’s name on screen' } : c)),
    notes: [{ id: 'n1', anchor: { t0: 4.2, box: { x: 0.06, y: 0.74, w: 0.42, h: 0.17 } }, text: 'name goes here', status: 'open', createdAt: Date.now() }],
  }
  // sent again before each shot, in case a background job has sent the project since
  const stage = () => app.evaluate(({ BrowserWindow }, [d, np, msgs]) => {
    const wc = BrowserWindow.getAllWindows().find(x => x.isVisible()).webContents
    wc.send('project', np)
    wc.send('agui', d, { type: 'MESSAGES_SNAPSHOT', messages: msgs })
  }, [dir, staged, conversation(film)])
  const at = async t => { await win.evaluate(t => { const v = [...document.querySelectorAll('video')].find(v => v.checkVisibility()); v.pause(); v.currentTime = t }, t); await win.waitForTimeout(500) }
  await stage()
  await win.waitForTimeout(800)
  await at(4.4)
  await shot(win, 'chat')

  // a box around the lower third, and the message box that opens under it
  await stage()
  await win.waitForTimeout(500)
  await at(5.2)
  await win.locator('button:has-text("Box")').click()
  const v = await win.locator('video').first().boundingBox()
  // the picture is letterboxed: its 16:9 rectangle inside the player
  const ph = v.width * 9 / 16, top = v.y + (v.height - ph) / 2
  await win.mouse.move(v.x + v.width * 0.05, top + ph * 0.74); await win.mouse.down()
  await win.mouse.move(v.x + v.width * 0.47, top + ph * 0.92, { steps: 8 }); await win.mouse.up()
  await win.locator('[data-inline-ask] textarea').fill('make the name bigger')
  await shot(win, 'inline')
  await win.keyboard.press('Escape')

  await win.evaluate(() => document.documentElement.classList.add('dark'))
  await stage()
  await win.waitForTimeout(800)
  await at(4.4)
  await shot(win, 'dark')
} finally { await app.close() }
