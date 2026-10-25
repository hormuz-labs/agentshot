// Turns whatever HTML the agent (or a user) writes into a valid AgentShot clip: a full document with the clip's format on
// <html>, GSAP (+ any plugins it uses) and the clip runtime loaded before the clip's own scripts, the house stylesheet,
// a fixed-size stage, and nothing that points at the network (clips render offline and must be repeatable).

export type ClipFormat = { width: number; height: number; fps: number }

const PLUGINS = ['SplitText', 'MorphSVGPlugin', 'DrawSVGPlugin', 'MotionPathPlugin', 'TextPlugin', 'CustomEase']
const lib = (f: string) => `<script src="manul://lib/${f}"></script>`

export function prepareClipHtml(input: string, fmt: ClipFormat, duration: number, overlay = false): string {
  let html = input.trim()
  // nothing from the network: external scripts, stylesheets, @imports, url()s
  html = html
    .replace(/<script[^>]*\bsrc=["']https?:\/\/[^"']*["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<link[^>]*\bhref=["']https?:\/\/[^"']*["'][^>]*>/gi, '')
    .replace(/@import\s+url\(["']?https?:\/\/[^)]*\)\s*;?/gi, '')
    .replace(/url\(["']?https?:\/\/[^)]*\)/gi, 'none')

  if (!/<html[\s>]/i.test(html)) html = `<html><head></head><body>${html}</body></html>`
  if (!/<head[\s>]/i.test(html)) html = html.replace(/<html([^>]*)>/i, '<html$1><head></head>')
  if (!/<body[\s>]/i.test(html)) html = html.replace(/<\/head>/i, '</head><body>').replace(/<\/html>/i, '</body></html>')
  html = html.replace(/^<!doctype[^>]*>\s*/i, '')

  // the format lives on <html>
  const attrs = `data-duration="${round(duration)}" data-width="${fmt.width}" data-height="${fmt.height}" data-fps="${fmt.fps}"`
  html = html.replace(/<html([^>]*)>/i, (_m, a: string) => `<html ${[a.replace(/\s*data-(duration|width|height|fps)="[^"]*"/gi, '').trim(), attrs].filter(Boolean).join(' ')}>`.replace('<html  ', '<html '))

  // libraries, once each, in order: GSAP, plugins in use, runtime; all before the clip's own scripts
  html = html.replace(/<script[^>]*src=["']manul:\/\/lib\/[^"']+["'][^>]*>\s*<\/script>\s*/gi, '')
  const plugins = PLUGINS.filter(p => new RegExp(`\\b${p}\\b`).test(html)).map(p => lib(`${p}.min.js`))
  const head = [
    '<meta charset="utf-8">',
    '<link rel="stylesheet" href="manul://lib/manul.css">',
    `<style>html, body { margin: 0; width: ${fmt.width}px; height: ${fmt.height}px; overflow: hidden; }${overlay ? ' html, body { background: transparent !important; }' : ''}</style>`,
    lib('gsap.min.js'), ...plugins, lib('clip-runtime.js'),
  ].join('\n')
  html = html.replace(/<meta charset=[^>]*>\s*/i, '').replace(/<link rel="stylesheet" href="manul:\/\/lib\/manul\.css">\s*/i, '')
  html = html.replace(/<head([^>]*)>/i, `<head$1>\n${head}\n`)
  return `<!doctype html>\n${html}\n`
}

const round = (n: number) => Math.round(n * 1000) / 1000

/**
 * Move an element (by data-manul-id) by dx, dy px, written into its inline style as the CSS `translate` property.
 * `translate` composes with `transform`, so the clip's own GSAP motion (x, y, scale…) keeps working on top of it.
 */
export function moveElement(html: string, id: string, dx: number, dy: number): string {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const tag = new RegExp(`<([a-zA-Z][\\w-]*)([^>]*?\\bdata-manul-id=["']${esc}["'][^>]*?)(\\/?)>`)
  const m = tag.exec(html)
  if (!m) throw new Error(`No element with data-manul-id="${id}" in the clip.`)
  let attrs = m[2]
  const styleRe = /\sstyle=(["'])([\s\S]*?)\1/
  const sm = styleRe.exec(attrs)
  const style = sm ? sm[2] : ''
  const cur = /(?:^|;)\s*translate:\s*(-?[\d.]+)px\s+(-?[\d.]+)px\s*;?/.exec(style)
  const x = Math.round((cur ? Number(cur[1]) : 0) + dx), y = Math.round((cur ? Number(cur[2]) : 0) + dy)
  const rest = style.replace(/(?:^|;)\s*translate:[^;]*;?/, '').trim().replace(/;\s*$/, '')
  const next = [rest, `translate: ${x}px ${y}px`].filter(Boolean).join('; ')
  attrs = sm ? attrs.replace(styleRe, ` style="${next}"`) : `${attrs} style="${next}"`
  return html.slice(0, m.index) + `<${m[1]}${attrs}${m[3]}>` + html.slice(m.index + m[0].length)
}
