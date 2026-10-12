import { driver, type Config, type PopoverDOM } from 'driver.js'
import '@/tour.css'

/** The same card, font tokens, buttons and keyboard behavior for every Manul walkthrough. */
export function decorateTour(popover: PopoverDOM, label: string, index: number, total: number, skip: () => void) {
  popover.wrapper.setAttribute('aria-modal', 'true')
  const heading = document.createElement('div')
  heading.className = 'manul-tour-heading'
  const logo = document.createElement('img')
  logo.src = './manul.png'; logo.width = 26; logo.height = 26; logo.alt = ''
  const caption = document.createElement('span')
  caption.textContent = label
  heading.append(logo, caption)
  popover.title.before(heading)
  const track = document.createElement('div')
  track.className = 'manul-tour-track'; track.setAttribute('aria-hidden', 'true')
  const fill = document.createElement('span')
  fill.style.width = `${((index + 1) / total) * 100}%`
  track.append(fill); popover.footer.before(track)
  const button = document.createElement('button')
  button.type = 'button'; button.className = 'manul-tour-skip'; button.textContent = index === 0 ? 'Not now' : 'Skip tour'
  button.onclick = skip
  popover.footer.prepend(button)
  requestAnimationFrame(() => { if (popover.wrapper.isConnected) popover.nextButton.focus({ preventScroll: true }) })
}

export function createTour(config: Config) {
  const tour = driver({
    animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    duration: 220,
    overlayColor: getComputedStyle(document.documentElement).getPropertyValue('--color-fg').trim(),
    overlayOpacity: document.documentElement.classList.contains('dark') ? 0.18 : 0.3,
    overlayClickBehavior: 'none', allowKeyboardControl: false,
    stagePadding: 5, stageRadius: 12, popoverOffset: 14,
    popoverClass: 'manul-tour', disableActiveInteraction: true,
    showProgress: true, progressText: '{{current}} / {{total}}',
    nextBtnText: 'Next', prevBtnText: 'Back', doneBtnText: 'Done', closeBtnLabel: 'Skip walkthrough',
    ...config,
  })
  const keyboard = (e: KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault(); e.stopImmediatePropagation()
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.manul-tour button'))
        .filter(b => !b.disabled && getComputedStyle(b).display !== 'none')
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[(current + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation()
      document.querySelector<HTMLButtonElement>('.manul-tour-skip')?.click()
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault(); e.stopImmediatePropagation()
      document.querySelector<HTMLButtonElement>(e.key === 'ArrowLeft' ? '.driver-popover-prev-btn' : '.driver-popover-next-btn')?.click()
    } else if ([' ', 'b', 'B', 'n', 'N'].includes(e.key) || e.metaKey || e.ctrlKey) e.stopPropagation()
  }
  window.addEventListener('keydown', keyboard, true)
  return { tour, cleanup: () => { window.removeEventListener('keydown', keyboard, true); tour.destroy() } }
}
