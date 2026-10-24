// The motion gallery on the start screen: real examples, each with the prompt that made it and credit to its maker.
// Posters first; a card plays (muted) while hovered; opening one shows the whole video with sound, who made it, its
// tags and the full prompt, and one action: use it. Tags and ids are prompt-motion.com's own.
import { useEffect, useMemo, useRef, useState } from 'react'
import * as D from '@radix-ui/react-dialog'
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, Copy, X } from 'lucide-react'
import type { GalleryExample } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const PAGE = 12
const clock = (s?: number) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)

/** What the example's prompt asks the user for ("Ask me for: …"): its first sentence, said to the user, kept short. */
export function inputsOf(prompt?: string) {
  const m = prompt?.match(/ask me for:?\s*([^\n<]+)/i)
  if (!m) return null
  let s = m[1].split(/(?<=[.;])\s/)[0].trim().replace(/[.;]$/, '')
    .replace(/\bmy\b/gi, 'your').replace(/\bme\b/gi, 'you').replace(/\bI\b/g, 'you')
  if (s.length > 140) { const cut = s.lastIndexOf(',', 140); s = cut > 40 ? `${s.slice(0, cut)}, and more` : `${s.slice(0, s.lastIndexOf(' ', 137))}…` }
  return s
}

export function useGallery() {
  const [list, setList] = useState<GalleryExample[]>([])
  useEffect(() => { window.manul.gallery.list().then(setList).catch(() => setList([])) }, [])
  return list
}

function Card({ e, onOpen }: { e: GalleryExample; onOpen: () => void }) {
  const [hover, setHover] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  // a short pause before playing, so sweeping the pointer across the grid doesn't start a dozen videos
  useEffect(() => {
    if (!hover) return
    const t = setTimeout(() => { video.current?.play().catch(() => {}) }, 160)
    return () => clearTimeout(t)
  }, [hover])
  return (
    <button
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      data-example={e.id}
      className="group text-left outline-none"
    >
      <span className="relative block aspect-[16/10] overflow-hidden rounded-xl bg-raised ring-1 ring-line transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(.16,1,.3,1)] group-hover:-translate-y-0.5 group-hover:shadow-[0_10px_30px_-12px_var(--color-shade)] group-focus-visible:ring-2 group-focus-visible:ring-amber motion-reduce:transform-none">
        <img src={e.poster} alt="" loading="lazy" draggable={false} className="absolute inset-0 size-full object-cover" />
        {hover && <video ref={video} src={e.video} muted loop playsInline preload="auto" className="absolute inset-0 size-full object-cover" />}
        {e.duration != null && <span className="absolute bottom-1.5 right-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10.5px] tabular-nums text-white">{clock(e.duration)}</span>}
      </span>
      <span className="mt-2 block truncate text-[13px] text-fg">{e.title}</span>
      <span className="block truncate text-[11.5px] text-faint">@{e.creator.handle}{e.kind === 'skill' ? ' · made with a skill' : ''}</span>
    </button>
  )
}

function Viewer({ list, index, onIndex, onClose, onUse, onTag }: {
  list: GalleryExample[]; index: number; onIndex: (i: number) => void; onClose: () => void; onUse: (e: GalleryExample) => void; onTag: (slug: string) => void
}) {
  const e = list[index]
  const [copied, setCopied] = useState(false)
  const [full, setFull] = useState(false)
  useEffect(() => { setCopied(false); setFull(false) }, [e?.id])
  if (!e) return null
  const go = (d: number) => onIndex((index + d + list.length) % list.length)
  const copy = async () => { await navigator.clipboard.writeText(e.prompt || ''); setCopied(true); setTimeout(() => setCopied(false), 1400) }
  return (
    <D.Root open onOpenChange={v => { if (!v) onClose() }}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-scrim backdrop-blur-[3px]" />
        <D.Content
          aria-describedby={undefined}
          onKeyDown={ev => {
            if ((ev.target as HTMLElement).closest('video')) return
            if (ev.key === 'ArrowRight') { ev.preventDefault(); go(1) }
            if (ev.key === 'ArrowLeft') { ev.preventDefault(); go(-1) }
          }}
          className="fixed left-1/2 top-1/2 z-50 flex h-[min(760px,88vh)] w-[min(1240px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl shadow-shade outline-none animate-in"
        >
          <div className="relative flex min-w-0 flex-1 items-center justify-center bg-black">
            <video key={e.id} src={e.video} poster={e.poster} controls autoPlay playsInline className="max-h-full max-w-full" />
            <button onClick={() => go(-1)} aria-label="Previous example" className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white/80 backdrop-blur hover:bg-white/20 hover:text-white"><ChevronLeft className="size-5" /></button>
            <button onClick={() => go(1)} aria-label="Next example" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white/80 backdrop-blur hover:bg-white/20 hover:text-white"><ChevronRight className="size-5" /></button>
          </div>

          <aside className="flex w-[380px] shrink-0 flex-col border-l border-line">
            <div className="flex items-start gap-3 px-6 pb-4 pt-6">
              <div className="min-w-0 flex-1">
                <D.Title className="font-serif text-[22px] leading-tight text-fg">{e.title}</D.Title>
                <p className="mt-1.5 text-[13px] text-dim">
                  by <a href={e.creator.url || `https://x.com/${e.creator.handle}`} target="_blank" rel="noreferrer" className="text-fg hover:underline">@{e.creator.handle}</a>
                  {e.post && <> · <a href={e.post} target="_blank" rel="noreferrer" className="inline-flex items-center hover:text-fg hover:underline">View post<ArrowUpRight className="size-3" /></a></>}
                </p>
              </div>
              <D.Close aria-label="Close" className="-mr-2 rounded-md p-1.5 text-faint hover:bg-hover hover:text-fg"><X className="size-4" /></D.Close>
            </div>

            <div className="flex flex-wrap gap-1.5 px-6 pb-4">
              {e.tags.map(t => (
                <button key={t.slug} onClick={() => onTag(t.slug)} className="rounded-full border border-line px-2.5 py-0.5 text-[11.5px] text-dim hover:border-line-strong hover:text-fg">{t.name}</button>
              ))}
              <span className="px-1 py-0.5 text-[11.5px] tabular-nums text-faint">{[clock(e.duration), e.width && e.height ? `${e.width}×${e.height}` : '', e.sound ? 'sound' : ''].filter(Boolean).join(' · ')}</span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col border-t border-line">
              <div className="flex items-center px-6 pb-2 pt-4">
                <span className="flex-1 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">{e.kind === 'skill' ? 'Made with a skill' : 'The prompt'}</span>
                {e.prompt && (
                  <button onClick={copy} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-dim hover:bg-hover hover:text-fg">
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? 'Copied' : 'Copy'}
                  </button>
                )}
              </div>
              {e.prompt ? (
                <div className={cn('relative mx-6 min-h-0 flex-1', full ? 'overflow-auto' : 'overflow-hidden')}>
                  <pre className="whitespace-pre-wrap break-words font-sans text-[12.5px] leading-[1.6] text-dim">{e.prompt}</pre>
                  {!full && (
                    <div className="absolute inset-x-0 bottom-0 flex h-24 items-end justify-center bg-gradient-to-t from-panel via-panel/90 to-transparent pb-1">
                      <button onClick={() => setFull(true)} className="rounded-full border border-line bg-panel px-3 py-1 text-[12px] text-dim hover:text-fg">Read the whole prompt</button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="mx-6 text-[12.5px] leading-[1.6] text-dim">
                  This one was made with {e.skill ? <a href={e.skill} target="_blank" rel="noreferrer" className="text-fg hover:underline">a skill</a> : 'a skill'} rather
                  than a prompt. AgentShot can still match its look from the video.
                </p>
              )}
            </div>

            <div className="border-t border-line px-6 py-4">
              <Button variant="primary" className="h-10 w-full rounded-xl text-[14px]" onClick={() => onUse(e)}>Use this example</Button>
              <p className="mt-2 text-center text-[11px] text-faint">Your content, made the way this one was. Credit stays with @{e.creator.handle}.</p>
            </div>
          </aside>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

/** The gallery: tag filter, a grid that grows, and the viewer. */
export function Gallery({ list, onUse }: { list: GalleryExample[]; onUse: (e: GalleryExample) => void }) {
  const [tag, setTag] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)
  const [open, setOpen] = useState<number | null>(null)
  const tags = useMemo(() => {
    const n = new Map<string, { name: string; slug: string; count: number }>()
    for (const e of list) for (const t of e.tags) n.set(t.slug, { ...t, count: (n.get(t.slug)?.count || 0) + 1 })
    return [...n.values()].sort((a, b) => b.count - a.count)
  }, [list])
  const filtered = useMemo(() => (tag ? list.filter(e => e.tags.some(t => t.slug === tag)) : list), [list, tag])
  const pick = (slug: string | null) => { setTag(slug); setShown(PAGE) }
  if (!list.length) return null
  return (
    <section data-gallery className="w-full">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="font-serif text-[22px] text-fg">Start from an example</h2>
        <span className="text-[12px] text-faint">{list.length} motion videos, each with the prompt that made it</span>
      </div>

      <div role="tablist" aria-label="Filter by tag" className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {[{ name: 'All', slug: null as string | null, count: list.length }, ...tags].map(t => (
          <button key={t.slug ?? 'all'} role="tab" aria-selected={tag === t.slug} onClick={() => pick(t.slug)}
            className={cn('shrink-0 rounded-full px-3 py-1 text-[12.5px] transition-colors',
              tag === t.slug ? 'bg-fg text-panel' : 'border border-line text-dim hover:border-line-strong hover:text-fg')}>
            {t.name}<span className={cn('ml-1.5 tabular-nums', tag === t.slug ? 'opacity-60' : 'text-faint')}>{t.count}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-x-4 gap-y-5">
        {filtered.slice(0, shown).map((e, i) => <Card key={e.id} e={e} onOpen={() => setOpen(i)} />)}
      </div>
      {shown < filtered.length && (
        <div className="mt-6 flex justify-center">
          <button onClick={() => setShown(s => s + PAGE * 2)} className="rounded-full border border-line px-4 py-1.5 text-[13px] text-dim hover:border-line-strong hover:text-fg">
            Show more <span className="text-faint">· {filtered.length - shown} left</span>
          </button>
        </div>
      )}
      <p className="mt-6 text-center text-[11px] text-faint">
        Collected by <a href="https://prompt-motion.com" target="_blank" rel="noreferrer" className="hover:text-fg hover:underline">prompt-motion.com</a>; every video and prompt belongs to the person credited on it.
      </p>

      {open != null && (
        <Viewer list={filtered} index={open} onIndex={setOpen} onClose={() => setOpen(null)}
          onUse={e => { setOpen(null); onUse(e) }}
          onTag={slug => { setOpen(null); pick(slug) }} />
      )}
    </section>
  )
}
