// Handing the cut to another editor: the timeline as Final Cut / Resolve FCPXML, Premiere (FCP 7) XML and OpenTimelineIO,
// with every file it uses. Footage keeps its own in and out points, so the editor can still trim, slip and regrade; motion
// clips and overlays go over as the files AgentShot rendered (overlays with their alpha), music and voiceovers on their own
// tracks with their levels, the music's ducking as volume keyframes.
//
// planOf turns a timeline into a plan (clips on tracks, in seconds); the writers turn a plan into each format. Pure, so
// they are tested without the app (test/handoff.test.ts).
import { cameraRange } from './demo'
import { framing as framingOf, placedVideo } from './framing'
import { duckEnvelope, gainAt, type Envelope, type Region } from './mix'
import { length, type Timeline } from './timeline'

/** A file the cut uses. path: where it is (absolute), once copied next to the exported files. */
export type HandoffMedia = {
  id: string; path: string; name: string; duration: number
  width?: number; height?: number; fps?: number; hasVideo: boolean; hasAudio: boolean
  /** start timecode in frames at the file's own rate (round fps), when the file has one */
  tc?: { frames: number; drop: boolean }
}
/** Where the picture sits in the frame, in pixels (left/top of its box); left out when it simply fits the frame. */
export type Placement = { left: number; top: number; width: number; height: number }
/** A clip: from `in` (s, in its file) for dur, at `start` on the timeline. sound: its level (dB) and keyframes (s from the
 *  clip's start), or null when silent. */
export type HandoffClip = { media: string; name: string; start: number; in: number; dur: number; place?: Placement; sound: { db: number; keys?: Envelope } | null; /** false: only its sound is used */ picture?: false }
export type HandoffPlan = {
  name: string; width: number; height: number; fps: number; duration: number
  /** video[0] is the main track (V1); clips above it are laid over it. */
  video: HandoffClip[][]
  /** sound on its own: music, voiceovers */
  audio: HandoffClip[][]
  media: HandoffMedia[]
  /** what the editor won't see as AgentShot shows it */
  notes: string[]
}

export type PlanInput = {
  name: string
  tl: Timeline
  /** what each project file is (key: the timeline's src) */
  media: Record<string, Omit<HandoffMedia, 'id' | 'name'>>
  /** a motion clip's rendered file (clip.mp4, or overlay.mov with alpha), key: clip id */
  clips: Record<string, { file: string; title: string }>
  /** where someone speaks on the timeline (for the music's ducking) */
  speech?: Region[]
}

const r3 = (n: number) => Math.round(n * 1000) / 1000
const SILENT = -96

export function planOf(o: PlanInput): HandoffPlan {
  const { tl } = o
  const { width: W, height: H } = tl
  const mix = tl.mix
  const film = mix?.filmDb ?? 0
  const media = new Map<string, HandoffMedia>()
  const notes = new Set<string>()
  const use = (path: string, name?: string) => {
    let m = media.get(path)
    if (!m) {
      const info = o.media[path]
      if (!info) throw new Error(`No details for ${path}.`)
      m = { ...info, id: `m${media.size + 1}`, name: name || basename(path) }
      media.set(path, m)
    }
    return m
  }
  const total = r3(tl.items.reduce((s, i) => s + length(i), 0))
  const v1: HandoffClip[] = [], camera: HandoffClip[] = [], overlays: HandoffClip[][] = []
  let at = 0
  for (const it of tl.items) {
    const len = r3(length(it))
    if (it.kind === 'clip') {
      const c = o.clips[it.clip]
      if (!c) throw new Error(`The motion clip ${it.clip} has no rendered file.`)
      const m = use(c.file, c.title)
      v1.push({ media: m.id, name: c.title, start: at, in: 0, dur: len, sound: m.hasAudio ? { db: film } : null })
    } else {
      const m = use(it.src)
      const demo = it.src === tl.demo?.screen ? tl.demo : undefined
      const silent = it.muted || !m.hasAudio || demo?.audio === 'camera'
      const place = it.framing && m.width && m.height ? placedVideo(m.width, m.height, W, H, it.framing) : undefined
      v1.push({ media: m.id, name: m.name, start: at, in: it.in, dur: len, place, sound: silent ? null : { db: film + (it.db || 0) } })
      const cam = demo && cameraRange(demo, it.in, it.out)
      if (demo && cam && !demo.layout.hidden) {
        const cm = use(demo.camera)
        const l = demo.layout
        const box = cm.width && cm.height ? placedVideo(cm.width, cm.height, l.width, l.height, framingOf({}, 'contain')) : { left: 0, top: 0, width: l.width, height: l.height }
        camera.push({ media: cm.id, name: cm.name, start: r3(at + cam.s - it.in), in: r3(cam.in), dur: r3(cam.out - cam.in),
          place: { left: l.x + box.left, top: l.y + box.top, width: box.width, height: box.height },
          sound: demo.audio === 'camera' && cm.hasAudio && !it.muted ? { db: film + (it.db || 0) } : null })
        notes.add(`The camera is a rectangle over the screen recording: its ${l.shape === 'rectangle' ? 'border' : `${l.shape} shape`} isn't carried over.`)
        if (Math.abs(demo.sync.rate - 1) > 0.0005) notes.add(`The camera plays ${((demo.sync.rate - 1) * 100).toFixed(2)}% off the screen's clock in AgentShot; here it plays at normal speed.`)
      } else if (demo && demo.audio === 'camera' && !it.muted && cam) {
        const cm = use(demo.camera)
        if (cm.hasAudio) camera.push({ media: cm.id, name: cm.name, start: r3(at + cam.s - it.in), in: r3(cam.in), dur: r3(cam.out - cam.in), picture: false, sound: { db: film + (it.db || 0) } })
      }
    }
    at = r3(at + len)
  }
  // Overlays: each on the lowest track above V1 where it doesn't touch another one.
  for (const ov of [...(tl.overlays || [])].sort((a, b) => a.start - b.start)) {
    const c = o.clips[ov.clip]
    if (!c) throw new Error(`The overlay ${ov.clip} has no rendered file.`)
    const m = use(c.file, c.title)
    const start = Math.max(0, ov.start), skip = start - ov.start
    const dur = r3(Math.min(ov.dur - skip, total - start))
    if (dur <= 0) continue
    const clip: HandoffClip = { media: m.id, name: c.title, start: r3(start), in: r3(skip), dur, sound: null }
    const track = overlays.find(t => t.at(-1)!.start + t.at(-1)!.dur <= clip.start + 1e-6)
    if (track) track.push(clip)
    else overlays.push([clip])
  }

  const audio: HandoffClip[][] = []
  const music = mix?.music
  if (music) {
    const m = use(music.src)
    const env = o.speech?.length && music.duckDb ? duckEnvelope(o.speech, music.duckDb) : [{ t: 0, db: 0 }]
    const fade = (t: number) => { const g = Math.min(1, Math.max(0, t / 1), Math.max(0, (total - t) / 2)); return g <= 0 ? SILENT : Math.max(SILENT, 20 * Math.log10(g)) }
    const level = (t: number) => r3(Math.max(SILENT, music.db + gainAt(env, t) + fade(t)))
    const times = [...new Set([0, 1, Math.max(0, total - 2), total, ...env.map(k => k.t)].filter(t => t >= 0 && t <= total))].sort((a, b) => a - b)
    const track: HandoffClip[] = []
    const loop = m.duration > 0.1 ? m.duration : total
    for (let s = 0; s < total - 0.001; s = r3(s + loop)) {
      const dur = r3(Math.min(loop, total - s))
      const keys = [s, ...times.filter(t => t > s && t < s + dur), s + dur].map(t => ({ t: r3(t - s), db: level(t) }))
      track.push({ media: m.id, name: m.name, start: s, in: 0, dur, sound: { db: music.db, keys } })
    }
    audio.push(track)
  }
  const voices = (mix?.voiceovers || []).filter(v => !v.muted && v.start < total).sort((a, b) => a.start - b.start)
  for (const v of voices) {
    const m = use(v.src)
    const clip: HandoffClip = { media: m.id, name: m.name, start: r3(v.start), in: r3(v.in), dur: r3(Math.min(v.out - v.in, total - v.start)), sound: { db: v.db } }
    const track = audio.slice(music ? 1 : 0).find(t => t.at(-1)!.start + t.at(-1)!.dur <= clip.start + 1e-6)
    if (track) track.push(clip)
    else audio.push([clip])
  }
  if (tl.overlays?.length) notes.add('Titles, captions and other overlays are the rendered files (with transparency), not editable text.')
  if (tl.items.some(i => i.kind === 'clip')) notes.add('Motion graphics are the rendered files, not editable text.')
  if (camera.some(c => c.picture === false)) notes.add('The camera\'s sound is on its own track: the screen recording is silent here, as in AgentShot.')
  const video = [v1, ...(camera.length ? [camera] : []), ...overlays]
  return { name: o.name, width: W, height: H, fps: tl.fps, duration: total, video, audio, media: [...media.values()], notes: [...notes] }
}

/** Clips whose picture isn't shown (a camera used for its sound only). */
const soundOnly = (c: HandoffClip) => c.picture === false

export function basename(p: string) { return p.split(/[\\/]/).pop() || p }

// ---------------------------------------------------------------- time

/** A frame rate as a fraction: 29.97 → 30000/1001. */
export function rateOf(fps: number): { num: number; den: number; base: number; ntsc: boolean } {
  for (const base of [24, 30, 48, 60, 120]) if (Math.abs(fps - base * 1000 / 1001) < 0.02) return { num: base * 1000, den: 1001, base, ntsc: true }
  if (Math.abs(fps - Math.round(fps)) < 0.01) return { num: Math.round(fps), den: 1, base: Math.round(fps), ntsc: false }
  return { num: Math.round(fps * 100), den: 100, base: Math.round(fps), ntsc: false }
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a))
/** Rational seconds, as FCPXML writes them ("1001/30000s"). */
type Rat = { n: number; d: number }
const rat = (n: number, d: number): Rat => { const g = gcd(n, d) || 1; return { n: n / g, d: d / g } }
const add = (a: Rat, b: Rat) => rat(a.n * b.d + b.n * a.d, a.d * b.d)
const fcpTime = (t: Rat) => (t.n === 0 ? '0s' : t.d === 1 ? `${t.n}s` : `${t.n}/${t.d}s`)

/** Timeline frames: where clips start and end, so neighbours meet exactly on a frame. */
type Framed = { clip: HandoffClip; start: number; end: number; in: number }
function framed(clips: HandoffClip[], fps: number): Framed[] {
  const f = (t: number) => Math.round(t * fps - 1e-6)
  return clips.map(clip => ({ clip, start: f(clip.start), end: f(clip.start + clip.dur), in: f(clip.in) })).filter(c => c.end > c.start)
}
/** A file's start timecode as seconds (Rat), from its frames at its own rate; drop-frame counted the SMPTE way. */
function tcSeconds(m: HandoffMedia): Rat {
  if (!m.tc) return rat(0, 1)
  const r = rateOf(m.fps || 30)
  return rat(m.tc.frames * r.den, r.num)
}

// ---------------------------------------------------------------- FCPXML (Final Cut Pro, DaVinci Resolve)

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export function fileUrl(path: string, localhost = false) {
  const p = path.replace(/\\/g, '/')
  const abs = /^[A-Za-z]:\//.test(p) ? `/${p}` : p
  return `file://${localhost ? 'localhost' : ''}${abs.split('/').map(s => encodeURIComponent(s).replace(/%3A/g, ':')).join('/')}`
}

export function toFcpxml(plan: HandoffPlan): string {
  const r = rateOf(plan.fps)
  const fr = (n: number) => rat(n * r.den, r.num)
  const T = (n: number) => fcpTime(fr(n))
  const byId = new Map(plan.media.map(m => [m.id, m]))
  const formats: string[] = [`<format id="r0" frameDuration="${fcpTime(rat(r.den, r.num))}" width="${plan.width}" height="${plan.height}"/>`]
  const assets: string[] = []
  plan.media.forEach((m, i) => {
    let fmt = ''
    if (m.hasVideo) {
      const mr = rateOf(m.fps || plan.fps)
      fmt = `f${i + 1}`
      formats.push(`<format id="${fmt}" frameDuration="${fcpTime(rat(mr.den, mr.num))}" width="${m.width || plan.width}" height="${m.height || plan.height}"/>`)
    }
    const frames = Math.ceil(m.duration * r.num / r.den)
    assets.push(`<asset id="${m.id}" name="${esc(m.name)}" start="${fcpTime(tcSeconds(m))}" duration="${T(frames)}"${m.hasVideo ? ` hasVideo="1" format="${fmt}" videoSources="1"` : ''}${m.hasAudio ? ' hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"' : ''}>` +
      `<media-rep kind="original-media" src="${esc(fileUrl(m.path))}"/></asset>`)
  })
  // The conformed size is the file fit to the frame; AgentShot's placement is a scale and a move from there.
  const transform = (c: HandoffClip) => {
    const m = byId.get(c.media)!
    if (!c.place || !m.width || !m.height || soundOnly(c)) return ''
    const fit = placedVideo(m.width, m.height, plan.width, plan.height, framingOf({}, 'contain'))
    const scale = c.place.width / fit.width
    const dx = c.place.left + c.place.width / 2 - plan.width / 2, dy = c.place.top + c.place.height / 2 - plan.height / 2
    // FCPXML position: percent of the frame height, from the centre, y up
    const pos = `${num(dx / plan.height * 100)} ${num(-dy / plan.height * 100)}`
    return `<adjust-transform position="${pos}" scale="${num(scale)} ${num(scale)}"/>`
  }
  const volume = (c: HandoffClip, f: Framed) => {
    if (!c.sound) return ''
    const keys = c.sound.keys
    if (!keys?.length) return c.sound.db ? `<adjust-volume amount="${num(c.sound.db)}dB"/>` : ''
    const at = add(tcSeconds(byId.get(c.media)!), fr(f.in))
    const kf = keys.map(k => `<keyframe time="${fcpTime(add(at, fr(Math.round(k.t * r.num / r.den))))}" value="${num(k.db)}dB"/>`).join('')
    return `<adjust-volume><param name="amount"><keyframeAnimation>${kf}</keyframeAnimation></param></adjust-volume>`
  }
  // inner: the clip's adjustments, then what is connected to it (lane), as the DTD orders them
  const clipXml = (f: Framed, lane: number | null, offset: Rat, inner = '') => {
    const c = f.clip, m = byId.get(c.media)!
    const start = add(tcSeconds(m), fr(f.in))
    const picture = m.hasVideo && !soundOnly(c)
    const src = !picture ? ' srcEnable="audio"' : !c.sound && m.hasAudio ? ' srcEnable="video"' : ''
    const body = `${picture ? transform(c) : ''}${volume(c, f)}${inner}`
    return `<asset-clip ref="${m.id}"${lane != null ? ` lane="${lane}"` : ''} offset="${fcpTime(offset)}" name="${esc(c.name)}" start="${fcpTime(start)}" duration="${T(f.end - f.start)}"${src}${body ? `>${body}</asset-clip>` : '/>'}`
  }
  // Connected clips hang on the V1 clip under their first frame (or a gap where V1 is empty); their offset is in that
  // clip's own time.
  const v1 = framed(plan.video[0] || [], plan.fps)
  const spine: { kind: 'clip' | 'gap'; f?: Framed; start: number; end: number; children: string[] }[] = []
  let cursor = 0
  for (const f of v1) {
    if (f.start > cursor) spine.push({ kind: 'gap', start: cursor, end: f.start, children: [] })
    spine.push({ kind: 'clip', f, start: f.start, end: f.end, children: [] })
    cursor = f.end
  }
  const end = Math.round(plan.duration * plan.fps - 1e-6)
  if (cursor < end) spine.push({ kind: 'gap', start: cursor, end, children: [] })
  const hang = (f: Framed, lane: number) => {
    const host = spine.find(s => f.start >= s.start && f.start < s.end) || spine.at(-1)!
    const hostStart = host.kind === 'clip' ? add(tcSeconds(byId.get(host.f!.clip.media)!), fr(host.f!.in)) : rat(0, 1)
    host.children.push(clipXml(f, lane, add(hostStart, fr(f.start - host.start))))
  }
  plan.video.slice(1).forEach((track, i) => framed(track, plan.fps).forEach(f => hang(f, i + 1)))
  plan.audio.forEach((track, i) => framed(track, plan.fps).forEach(f => hang(f, -(i + 1))))
  const spineXml = spine.map(s => s.kind === 'gap'
    ? `<gap name="Gap" offset="${T(s.start)}" start="0s" duration="${T(s.end - s.start)}"${s.children.length ? `>${s.children.join('')}</gap>` : '/>'}`
    : clipXml(s.f!, null, fr(s.start), s.children.join(''))).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
<resources>
${[...formats, ...assets].join('\n')}
</resources>
<library>
<event name="${esc(plan.name)}">
<project name="${esc(plan.name)}">
<sequence format="r0" duration="${T(end)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
<spine>
${spineXml}
</spine>
</sequence>
</project>
</event>
</library>
</fcpxml>
`
}

const num = (n: number) => String(Math.round(n * 10000) / 10000)

// ---------------------------------------------------------------- FCP 7 XML (Premiere Pro, DaVinci Resolve)

export function toXmeml(plan: HandoffPlan): string {
  const r = rateOf(plan.fps)
  const rate = `<rate><timebase>${r.base}</timebase><ntsc>${r.ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`
  const byId = new Map(plan.media.map(m => [m.id, m]))
  const frames = (s: number) => Math.round(s * plan.fps - 1e-6)
  const written = new Set<string>()
  const fileXml = (m: HandoffMedia) => {
    const id = `file-${m.id}`
    if (written.has(id)) return `<file id="${id}"/>`
    written.add(id)
    const mr = rateOf(m.fps || plan.fps)
    const tc = m.tc ? `<timecode><rate><timebase>${mr.base}</timebase><ntsc>${mr.ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate><frame>${m.tc.frames}</frame><displayformat>${m.tc.drop ? 'DF' : 'NDF'}</displayformat></timecode>` : ''
    return `<file id="${id}"><name>${esc(m.name)}</name><pathurl>${esc(fileUrl(m.path, true))}</pathurl>${rate}<duration>${Math.ceil(m.duration * plan.fps)}</duration>${tc}<media>` +
      (m.hasVideo ? `<video><samplecharacteristics>${rate}<width>${m.width || plan.width}</width><height>${m.height || plan.height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></video>` : '') +
      (m.hasAudio ? '<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio>' : '') +
      '</media></file>'
  }
  const param = (id: string, name: string, min: number, max: number, value: string, keys = '') => `<parameter authoringApp="PremierePro"><parameterid>${id}</parameterid><name>${name}</name><valuemin>${min}</valuemin><valuemax>${max}</valuemax><value>${value}</value>${keys}</parameter>`
  const motion = (c: HandoffClip) => {
    const m = byId.get(c.media)!
    const sized = m.width && m.height && (m.width !== plan.width || m.height !== plan.height)
    if ((!c.place && !sized) || !m.width || !m.height) return ''
    // Premiere's scale is percent of the file's own size; its centre is the offset as a share of the frame (y down)
    const place = c.place || placedVideo(m.width, m.height, plan.width, plan.height, framingOf({}, 'contain'))
    const scale = place.width / m.width * 100
    const h = (place.left + place.width / 2 - plan.width / 2) / plan.width, v = (place.top + place.height / 2 - plan.height / 2) / plan.height
    return `<filter><effect><name>Basic Motion</name><effectid>basic</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>` +
      param('scale', 'Scale', 0, 1000, num(scale)) +
      `<parameter authoringApp="PremierePro"><parameterid>center</parameterid><name>Center</name><value><horiz>${num(h)}</horiz><vert>${num(v)}</vert></value></parameter></effect></filter>`
  }
  const levels = (c: HandoffClip, f: Framed) => {
    const s = c.sound!
    const gain = (db: number) => num(Math.pow(10, db / 20))
    if (!s.keys?.length && !s.db) return ''
    const keys = (s.keys || []).map(k => `<keyframe><when>${f.in + frames(k.t)}</when><value>${gain(k.db)}</value></keyframe>`).join('')
    return `<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audiolevels</effecttype><mediatype>audio</mediatype>` +
      param('level', 'Level', 0, 3.98109, gain(s.keys?.[0]?.db ?? s.db), keys) + '</effect></filter>'
  }
  let n = 0
  type Item = { id: string; xml: (links: string) => string; link: { track: number; kind: 'video' | 'audio'; index: number } }
  const videoTracks: Item[][] = [], audioTracks: Item[][] = []
  const item = (f: Framed, kind: 'video' | 'audio', track: number, index: number): Item => {
    const c = f.clip, m = byId.get(c.media)!
    const id = `clipitem-${++n}`
    return {
      id, link: { track, kind, index },
      xml: links => `<clipitem id="${id}"><masterclipid>masterclip-${m.id}</masterclipid><name>${esc(c.name)}</name><enabled>TRUE</enabled><duration>${Math.ceil(m.duration * plan.fps)}</duration>${rate}` +
        `<start>${f.start}</start><end>${f.end}</end><in>${f.in}</in><out>${f.in + f.end - f.start}</out>${fileXml(m)}` +
        (kind === 'audio' ? `<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>${levels(c, f)}` : motion(c)) +
        `${links}</clipitem>`,
    }
  }
  const pairs: [Item, Item][] = []
  plan.video.forEach((track, ti) => {
    const vt: Item[] = []
    for (const f of framed(track, plan.fps)) {
      const m = byId.get(f.clip.media)!
      const v = m.hasVideo && !soundOnly(f.clip) ? item(f, 'video', ti + 1, vt.length + 1) : null
      if (v) vt.push(v)
      if (f.clip.sound) {
        // a clip's own sound goes on the audio track of the same number, linked to its picture
        while (audioTracks.length <= ti) audioTracks.push([])
        const a = item(f, 'audio', ti + 1, audioTracks[ti].length + 1)
        audioTracks[ti].push(a)
        if (v) pairs.push([v, a])
      }
    }
    videoTracks.push(vt)
  })
  const base = audioTracks.length
  plan.audio.forEach((track, i) => {
    const t: Item[] = []
    for (const f of framed(track, plan.fps)) t.push(item(f, 'audio', base + i + 1, t.length + 1))
    audioTracks.push(t)
  })
  const linkOf = (it: Item) => `<link><linkclipref>${it.id}</linkclipref><mediatype>${it.link.kind}</mediatype><trackindex>${it.link.track}</trackindex><clipindex>${it.link.index}</clipindex></link>`
  const linked = new Map<string, string>()
  for (const [v, a] of pairs) { const l = linkOf(v) + linkOf(a); linked.set(v.id, l); linked.set(a.id, l) }
  const tracks = (ts: Item[][]) => ts.map(t => `<track>${t.map(it => it.xml(linked.get(it.id) || '')).join('\n')}</track>`).join('\n')
  const total = Math.round(plan.duration * plan.fps - 1e-6)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
<sequence id="sequence-1"><name>${esc(plan.name)}</name><duration>${total}</duration>${rate}
<timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
<media>
<video><format><samplecharacteristics>${rate}<width>${plan.width}</width><height>${plan.height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>
${tracks(videoTracks)}
</video>
<audio><numOutputChannels>2</numOutputChannels><format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>
${tracks(audioTracks)}
</audio>
</media>
</sequence>
</xmeml>
`
}

// ---------------------------------------------------------------- OpenTimelineIO (Resolve, Avid, Nuke, OTIO tools)

export function toOtio(plan: HandoffPlan): string {
  const r = rateOf(plan.fps)
  const rate = r.num / r.den
  const byId = new Map(plan.media.map(m => [m.id, m]))
  const RT = (value: number) => ({ OTIO_SCHEMA: 'RationalTime.1', rate, value })
  const range = (start: number, dur: number) => ({ OTIO_SCHEMA: 'TimeRange.1', start_time: RT(start), duration: RT(dur) })
  const tcFrames = (m: HandoffMedia) => { const t = tcSeconds(m); return Math.round(t.n / t.d * rate) }
  const gap = (dur: number) => ({ OTIO_SCHEMA: 'Gap.1', name: '', metadata: {}, source_range: range(0, dur), effects: [], markers: [], enabled: true })
  const clip = (f: Framed) => {
    const c = f.clip, m = byId.get(c.media)!, tc = tcFrames(m)
    return {
      OTIO_SCHEMA: 'Clip.2', name: c.name, enabled: true, effects: [], markers: [],
      metadata: { agentshot: { ...(c.sound ? { db: c.sound.db, ...(c.sound.keys ? { keys: c.sound.keys } : {}) } : {}), ...(c.place ? { place: c.place } : {}) } },
      source_range: range(tc + f.in, f.end - f.start),
      media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: 'ExternalReference.1', name: m.name, metadata: {}, target_url: fileUrl(m.path), available_range: range(tc, Math.ceil(m.duration * rate)), available_image_bounds: null } },
      active_media_reference_key: 'DEFAULT_MEDIA',
    }
  }
  const track = (name: string, kind: 'Video' | 'Audio', fs: Framed[]) => {
    const children: object[] = []
    let at = 0
    for (const f of fs) {
      if (f.start > at) children.push(gap(f.start - at))
      children.push(clip(f))
      at = f.end
    }
    return { OTIO_SCHEMA: 'Track.1', name, kind, enabled: true, metadata: {}, source_range: null, effects: [], markers: [], children }
  }
  const video = plan.video.map((t, i) => track(`V${i + 1}`, 'Video', framed(t, plan.fps).filter(f => byId.get(f.clip.media)!.hasVideo && !soundOnly(f.clip))))
  const own = plan.video.map(t => framed(t, plan.fps).filter(f => f.clip.sound)).filter(t => t.length)
  const audio = [...own, ...plan.audio.map(t => framed(t, plan.fps))].map((t, i) => track(`A${i + 1}`, 'Audio', t))
  return JSON.stringify({
    OTIO_SCHEMA: 'Timeline.1', name: plan.name, metadata: { agentshot: { notes: plan.notes } }, global_start_time: null,
    tracks: { OTIO_SCHEMA: 'Stack.1', name: 'tracks', enabled: true, metadata: {}, source_range: null, effects: [], markers: [], children: [...video, ...audio] },
  }, null, 2)
}

/** The note that goes with the files: how to open them in each editor, and what doesn't carry over. */
export function readmeOf(plan: HandoffPlan, files: { fcpxml: string; xml: string; otio: string }) {
  return [
    `${plan.name}: the cut from AgentShot, for another editor`,
    '',
    `Final Cut Pro: File → Import → XML…, choose ${files.fcpxml}`,
    `DaVinci Resolve: File → Import → Timeline…, choose ${files.fcpxml} (or ${files.otio})`,
    `Premiere Pro: File → Import…, choose ${files.xml}`,
    '',
    'The files the cut uses are in Media. If you move this folder, your editor will ask you to find them again: point it',
    'at Media.',
    ...(plan.notes.length ? ['', 'What looks different from AgentShot:', ...plan.notes.map(n => `- ${n}`)] : []),
    '',
  ].join('\n')
}
