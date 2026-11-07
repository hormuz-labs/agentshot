// The page's motion, with GSAP (ScrollTrigger, SplitText) and Lenis. Everything here is decoration on top of a page
// that reads fine without it: with reduced motion, or if this never loads, nothing is hidden (the head script only hides
// [data-reveal] once it knows this script will run, and takes that back after a few seconds if it doesn't).
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import Lenis from 'lenis'

gsap.registerPlugin(ScrollTrigger, SplitText)
const root = document.documentElement
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches
;(window as unknown as { __motion: boolean }).__motion = true

if (reduced) root.classList.remove('motion')
else start()

function start() {
  const lenis = new Lenis({ lerp: 0.11 })
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add(t => lenis.raf(t * 1000))
  gsap.ticker.lagSmoothing(0)
  // in-page links glide instead of jumping
  document.addEventListener('click', e => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[href*="#"]')
    if (!a) return
    const url = new URL(a.href)
    if (url.pathname !== location.pathname || !url.hash) return
    const el = document.querySelector(url.hash)
    if (!el) return
    e.preventDefault()
    history.replaceState(null, '', url.hash)
    lenis.scrollTo(el as HTMLElement, { offset: -76, duration: 1.3 })
  })
  // a dialog (the film, an example) holds the page still
  document.querySelectorAll('dialog').forEach(d => {
    new MutationObserver(() => (d.open ? lenis.stop() : lenis.start())).observe(d, { attributes: true, attributeFilter: ['open'] })
  })

  document.fonts.ready.then(() => {
    hero()
    reveal()
    fill()
    slide()
    jobs()
    chat()
    traces()
    counters()
    shapes()
    magnetic()
    stickers()
    ScrollTrigger.refresh()
  })
}

/** The headline rises letter by letter out of its lines; the shapes spring in around it, then scatter as you leave. */
function hero() {
  const h = document.querySelector<HTMLElement>('[data-hero]')
  if (!h) return
  const title = h.querySelector<HTMLElement>('h1')!
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } })
  SplitText.create(title, {
    type: 'lines,words,chars', mask: 'lines', autoSplit: true,
    onSplit: self => tl.from(self.chars, { yPercent: 118, rotation: 8, duration: 1.15, stagger: 0.024 }, 0),
  })
  tl.from(h.querySelectorAll('.hero-sticker'), { scale: 0, rotation: -60, duration: 1.3, ease: 'elastic.out(1.1, 0.45)' }, 0.75)
    .from(h.querySelectorAll('.tag, .lede, .hero-cta, .reassure, .film-link'), { y: 28, opacity: 0, duration: 1, stagger: 0.07 }, 0.45)
    .fromTo(h.querySelectorAll('.shape'), { scale: 0, opacity: 0, rotation: -70 }, { scale: 1, opacity: 1, rotation: 0, duration: 1.7, stagger: 0.09, ease: 'elastic.out(1, 0.6)' }, 0.25)
  h.querySelectorAll<HTMLElement>('.shape').forEach((s, i) => gsap.to(s, {
    x: (i % 2 ? -1 : 1) * 140, scale: 1.2, ease: 'none',
    scrollTrigger: { trigger: h, start: 'top top', end: 'bottom top', scrub: true },
  }))
}

function reveal() {
  ScrollTrigger.batch('[data-reveal]', {
    start: 'top 90%',
    onEnter: els => gsap.to(els, { opacity: 1, y: 0, duration: 1, stagger: 0.08, ease: 'expo.out', overwrite: true }),
  })
}

/** A statement lights up word by word as it scrolls through. */
function fill() {
  document.querySelectorAll<HTMLElement>('[data-fill]').forEach(el => {
    const split = SplitText.create(el, { type: 'words', aria: 'none' })
    gsap.fromTo(split.words, { opacity: 0.13 }, { opacity: 1, stagger: 0.1, ease: 'none', scrollTrigger: { trigger: el, start: 'top 80%', end: 'bottom 45%', scrub: 0.6 } })
  })
}

/** Giant words slide sideways while the section holds still (desktop); on phones each row drifts as it passes. */
function slide() {
  const sec = document.querySelector<HTMLElement>('[data-slide]')
  if (!sec) return
  const a = sec.querySelector<HTMLElement>('[data-track]')!, b = sec.querySelector<HTMLElement>('[data-track2]')!
  const mm = gsap.matchMedia()
  mm.add('(min-width: 760px)', () => {
    const dist = () => Math.max(0, a.scrollWidth - innerWidth + 40)
    const tween = gsap.to(a, { x: () => -dist(), ease: 'none', scrollTrigger: { trigger: sec, pin: true, scrub: 0.8, start: 'center center', end: () => '+=' + dist() * 0.7, invalidateOnRefresh: true, anticipatePin: 1 } })
    gsap.fromTo(b, { x: () => -(b.scrollWidth - innerWidth) }, { x: 0, ease: 'none', scrollTrigger: { trigger: sec, start: 'center center', end: () => '+=' + dist() * 0.7, scrub: 0.8, invalidateOnRefresh: true } })
    sec.querySelectorAll('.slide-shape').forEach((s, i) => gsap.fromTo(s, { rotation: -120 * (i % 2 ? -1 : 1), scale: 0.3 }, { rotation: 120 * (i % 2 ? -1 : 1), scale: 1, ease: 'none', scrollTrigger: { trigger: s, containerAnimation: tween, start: 'left right', end: 'right left', scrub: true } }))
  })
  mm.add('(max-width: 759px)', () => {
    gsap.fromTo(a, { x: 0 }, { x: () => -(a.scrollWidth - innerWidth), ease: 'none', scrollTrigger: { trigger: sec, start: 'top bottom', end: 'bottom top', scrub: 0.6, invalidateOnRefresh: true } })
    gsap.fromTo(b, { x: () => -(b.scrollWidth - innerWidth) }, { x: 0, ease: 'none', scrollTrigger: { trigger: sec, start: 'top bottom', end: 'bottom top', scrub: 0.6, invalidateOnRefresh: true } })
  })
}

/** Job cards stack: the one underneath sinks back and dims as the next slides over it. */
function jobs() {
  const cards = [...document.querySelectorAll<HTMLElement>('[data-job]')]
  cards.forEach((card, i) => {
    const next = cards[i + 1]
    if (!next) return
    gsap.to(card, { scale: 0.92, ease: 'none', scrollTrigger: { trigger: next, start: 'top bottom', end: 'top 18%', scrub: true } })
    gsap.to(card.querySelector('.job-in'), { opacity: 0.3, ease: 'none', scrollTrigger: { trigger: next, start: 'top 80%', end: 'top 25%', scrub: true } })
  })
}

/** A session: each note pops in from the right, AgentShot's answer follows it from the left. */
function chat() {
  document.querySelectorAll<HTMLElement>('[data-chat] li').forEach(li => {
    const tl = gsap.timeline({ scrollTrigger: { trigger: li, start: 'top 86%', toggleActions: 'play none none reverse' } })
    tl.from(li.querySelector('q'), { x: 60, scale: 0.85, opacity: 0, duration: 0.8, ease: 'back.out(1.8)' })
      .from(li.querySelectorAll('p, .mono'), { x: -40, opacity: 0, duration: 0.7, stagger: 0.08, ease: 'expo.out' }, 0.25)
  })
}

/** The measurement traces draw themselves left to right. */
function traces() {
  document.querySelectorAll<HTMLElement>('.trace svg').forEach(s => gsap.from(s, { clipPath: 'inset(0 100% 0 0)', duration: 1.6, ease: 'power3.inOut', scrollTrigger: { trigger: s, start: 'top 88%' } }))
}

/** Numbers count up when they arrive. */
function counters() {
  document.querySelectorAll<HTMLElement>('[data-count]').forEach(el => {
    const to = Number(el.dataset.count), o = { v: 0 }
    gsap.to(o, { v: to, duration: 1.8, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 85%' }, onUpdate: () => (el.textContent = String(Math.round(o.v))) })
  })
}

/** Shapes drift with the scroll, bob when idle, and lean toward the cursor. */
function shapes() {
  document.querySelectorAll<HTMLElement>('.shape[data-depth]').forEach((s, i) => {
    if (s.closest('[data-hero]') || s.classList.contains('slide-shape')) return
    const d = parseFloat(s.dataset.depth || '0')
    if (!d) return
    const sec = s.closest('section, footer') || s.parentElement!
    gsap.to(s, { yPercent: -80 * d, rotation: (i % 2 ? -1 : 1) * 45 * d, ease: 'none', scrollTrigger: { trigger: sec, start: 'top bottom', end: 'bottom top', scrub: true } })
  })
  document.querySelectorAll<HTMLElement>('.shape > svg').forEach((svg, i) => gsap.to(svg, { y: 10 + (i % 3) * 5, duration: 2.4 + (i % 3) * 0.6, yoyo: true, repeat: -1, ease: 'sine.inOut' }))
  if (!fine) return
  const all = [...document.querySelectorAll<HTMLElement>('.shape')].map(s => {
    const target = (s.firstElementChild as HTMLElement) || s, d = parseFloat(s.dataset.depth || '0.3')
    return { d, x: gsap.quickTo(target, 'x', { duration: 1.2, ease: 'power3.out' }), r: gsap.quickTo(s, 'rotationY', { duration: 1.2, ease: 'power3.out' }) }
  })
  addEventListener('pointermove', e => {
    const nx = e.clientX / innerWidth - 0.5
    all.forEach(s => { s.x(nx * 80 * s.d); s.r(nx * 30 * s.d) })
  }, { passive: true })
}

/** Buttons that lean toward the pointer. */
function magnetic() {
  if (!fine) return
  document.querySelectorAll<HTMLElement>('.magnetic').forEach(el => {
    const x = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'elastic.out(1, 0.4)' }), y = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'elastic.out(1, 0.4)' })
    el.addEventListener('pointermove', e => { const r = el.getBoundingClientRect(); x((e.clientX - r.left - r.width / 2) * 0.25); y((e.clientY - r.top - r.height / 2) * 0.35) })
    el.addEventListener('pointerleave', () => { x(0); y(0) })
  })
}

/** Stickers wobble when you touch them, and can be dragged around with a mouse. */
async function stickers() {
  const els = document.querySelectorAll<HTMLElement>('.sticker.drag')
  if (!els.length) return
  els.forEach(el => el.addEventListener('pointerenter', () => gsap.fromTo(el, { rotation: -16 }, { rotation: -7, duration: 0.9, ease: 'elastic.out(1.2, 0.3)' })))
  if (!fine) return
  const { Draggable } = await import('gsap/Draggable')
  gsap.registerPlugin(Draggable)
  els.forEach(el => Draggable.create(el, {
    bounds: 'body',
    onPress() { gsap.to(el, { scale: 1.12, rotation: 4, duration: 0.3 }) },
    onRelease() { gsap.to(el, { scale: 1, rotation: -7, duration: 0.8, ease: 'elastic.out(1, 0.4)' }) },
  }))
}
