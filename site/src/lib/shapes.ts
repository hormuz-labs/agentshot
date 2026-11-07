// AgentShot's glossy shapes, drawn as inline SVG: things a film is made of (a play button, a reel, clips stacked on a
// timeline, a note, a waveform, sparks). Each is a gradient body, a soft drop shadow and a gloss on top, so they read as
// objects floating over the page. Rendered at build time; motion.ts makes them drift, lean and spin.
let n = 0
const id = (p: string) => `${p}${++n}`

export const C = { yellow: '#FFE01A', coral: '#FF5A36', pink: '#FF4FB0', violet: '#7B61FF', sky: '#4FC8FF', mint: '#3CF2B5' }
export type Ramp = keyof typeof ramps
const ramps = {
  film: [C.violet, C.pink, C.coral, C.yellow],
  hot: [C.pink, C.coral, C.yellow],
  cool: [C.mint, C.sky, C.violet],
  sun: [C.yellow, C.coral],
  berry: [C.violet, C.pink],
  sea: [C.sky, C.violet],
  lime: [C.mint, C.yellow],
}
type Opts = { cls?: string; depth?: number; ramp?: Ramp; style?: string; label?: string }

const lin = (gid: string, stops: string[], x2 = 1, y2 = 1, units = 'objectBoundingBox') =>
  `<linearGradient id="${gid}" x1="0" y1="0" x2="${x2}" y2="${y2}" gradientUnits="${units}">${stops.map((c, i) => `<stop offset="${(i / (stops.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join('')}</linearGradient>`
const gloss = (gid: string) =>
  `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".62"/><stop offset=".45" stop-color="#fff" stop-opacity=".08"/><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient>`
const wrap = (kind: string, svg: string, o: Opts = {}) =>
  `<div class="shape shape-${kind} ${o.cls || ''}" data-depth="${o.depth ?? 0.3}" style="${o.style || ''}" aria-hidden="true">${svg}</div>`

/** A filled glossy shape from a path in a 100 × 100 box. */
function solid(kind: string, d: string, o: Opts = {}, ramp: Ramp = 'hot') {
  const g = id('sg'), s = id('ss')
  return wrap(kind, `<svg viewBox="-6 -6 112 112"><defs>${lin(g, ramps[o.ramp || ramp])}${gloss(s)}</defs>
<path d="${d}" fill="#000" fill-opacity=".35" transform="translate(3 6)" stroke="#000" stroke-opacity=".35" stroke-width="6" stroke-linejoin="round"/>
<path d="${d}" fill="url(#${g})" stroke="url(#${g})" stroke-width="6" stroke-linejoin="round"/>
<path d="${d}" fill="url(#${s})"/></svg>`, o)
}

function star(points: number, r1: number, r2: number) {
  const p: string[] = []
  for (let i = 0; i < points * 2; i++) {
    const a = (Math.PI / points) * i - Math.PI / 2, r = i % 2 ? r2 : r1
    p.push(`${(50 + r * Math.cos(a)).toFixed(1)} ${(50 + r * Math.sin(a)).toFixed(1)}`)
  }
  return 'M' + p.join('L') + 'Z'
}
const PATHS = {
  // a play button: a triangle with soft corners
  play: 'M24 12Q24 4 31 8L88 42Q96 50 88 58L31 92Q24 96 24 88Z',
  spark: star(8, 50, 16),
  spark4: star(4, 50, 13),
  note: 'M16 8H84Q96 8 96 20V58Q96 70 84 70H48L26 90V70H16Q4 70 4 58V20Q4 8 16 8Z',
  diamond: 'M50 4L96 50L50 96L4 50Z',
}
export const play = (o: Opts = {}) => solid('play', PATHS.play, o, 'hot')
export const spark = (o: Opts = {}) => solid('spark', PATHS.spark, o, 'sun')
export const spark4 = (o: Opts = {}) => solid('spark4', PATHS.spark4, o, 'berry')
export const note = (o: Opts = {}) => solid('note', PATHS.note, o, 'cool')
export const diamond = (o: Opts = {}) => solid('diamond', PATHS.diamond, o, 'berry')

/** A film reel: a spinning conic torus (CSS) with five holes. */
export const reel = (o: Opts = {}) =>
  `<div class="shape shape-reel ${o.cls || ''}" data-depth="${o.depth ?? 0.3}" style="${o.style || ''}" aria-hidden="true"><i class="reel-body${o.ramp ? ` ramp-${o.ramp}` : ''}"></i><i class="reel-shade"></i><i class="reel-holes"></i></div>`

/** Clips on a timeline: three glossy bars, offset like tracks. */
export function clips(o: Opts = {}) {
  const rows: Ramp[] = ['berry', 'hot', 'cool']
  let defs = '', body = ''
  rows.forEach((r, i) => {
    const g = id('pg'), s = id('ps'), w = [150, 116, 136][i], x = [0, 30, 12][i]
    defs += lin(g, ramps[r], 1, 0) + gloss(s)
    body += `<g transform="translate(${x} ${6 + i * 40})"><rect x="3" y="6" width="${w}" height="34" rx="12" fill="#000" fill-opacity=".35"/><rect width="${w}" height="34" rx="12" fill="url(#${g})"/><rect width="${w}" height="34" rx="12" fill="url(#${s})"/><rect x="10" y="9" width="4" height="16" rx="2" fill="#fff" fill-opacity=".8"/></g>`
  })
  // the playhead across them
  body += '<rect x="96" y="0" width="5" height="136" rx="2.5" fill="#fff"/><path d="M88 0H109L98.5 12Z" fill="#fff"/>'
  return wrap('clips', `<svg viewBox="0 0 190 140"><defs>${defs}</defs>${body}</svg>`, o)
}

/** A waveform as a glossy coil. */
export function wave(o: Opts = {}) {
  const g = id('wg')
  const pts: string[] = []
  for (let x = 0; x <= 300; x += 3) pts.push(`${x} ${(60 + Math.sin(x / 9) * (14 + 30 * Math.sin((x / 300) * Math.PI))).toFixed(1)}`)
  const d = 'M' + pts.join('L')
  return wrap('wave', `<svg viewBox="0 -4 300 128"><defs>${lin(g, ramps[o.ramp || 'cool'], 300, 0, 'userSpaceOnUse')}</defs>
<path d="${d}" fill="none" stroke="#000" stroke-opacity=".3" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" transform="translate(3 7)"/>
<path d="${d}" fill="none" stroke="url(#${g})" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
<path d="${d}" fill="none" stroke="#fff" stroke-opacity=".38" stroke-width="3" stroke-linecap="round" transform="translate(-1.5 -3)"/></svg>`, o)
}

/** A tilted sticker with a word on it. */
export const sticker = (text: string, o: Opts & { tone?: 'yellow' | 'pink' | 'mint' | 'violet' | 'coral' } = {}) =>
  `<span class="sticker sticker-${o.tone || 'yellow'} ${o.cls || ''}" style="${o.style || ''}">${text}</span>`
