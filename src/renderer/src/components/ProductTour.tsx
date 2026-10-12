import { useCallback, useEffect, useRef, useState } from 'react'
import { useCommands } from '@/lib/commands'
import { productTourSteps, readTourProgress, saveTourProgress, type TourPhase } from '@/lib/product-tour'
import { createTour, decorateTour } from '@/lib/tour-driver'

type Session = { phase: TourPhase; project: string | null }

/** Driver.js supplies the spotlight and positioning; every visible style belongs to Manul. */
export function ProductTour({ project, restored, blocked, ready, onPrepare, onKeys }: {
  project: string | null; restored: boolean; blocked: boolean; ready: boolean
  onPrepare(): void; onKeys(): void
}) {
  const [progress, setProgress] = useState(readTourProgress)
  const [eligible, setEligible] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const resume = useRef(0)
  const paused = blocked || modalOpen

  useEffect(() => {
    const check = () => setModalOpen(Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]:not(.manul-tour)'))
      .some(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'))
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state', 'style'] })
    check()
    return () => observer.disconnect()
  }, [])

  // A new installation has no projects. Existing users discover the replay entry without an interruption.
  useEffect(() => {
    let cancelled = false
    window.manul.project.recent().then(recent => {
      if (cancelled) return
      if (recent.length && !readTourProgress().home) {
        const saved = { home: 'skipped', editor: 'skipped' } as const
        saveTourProgress(saved); setProgress(saved)
      }
      setEligible(true)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const begin = useCallback((phase: TourPhase) => {
    onPrepare()
    resume.current = 0
    setSession({ phase, project })
  }, [onPrepare, project])

  useCommands([{ id: 'tour', title: 'Product tour', keywords: 'help onboarding walkthrough tutorial demo getting started', run: () => begin(project ? 'editor' : 'home') }], [begin])

  useEffect(() => {
    if (!restored || !eligible || paused || session) return
    if (!project && !progress.home) begin('home')
    else if (project && progress.home === 'completed' && !progress.editor) begin('editor')
  }, [restored, eligible, paused, session, project, progress, begin])

  // Moving to a project ends the home tour and queues the editor's invitation.
  useEffect(() => {
    if (!session || session.project === project) return
    if (session.phase === 'home' && project) {
      const saved = { ...readTourProgress(), home: 'completed' } as const
      saveTourProgress(saved); setProgress(saved)
    }
    setSession(null)
  }, [project, session])

  useEffect(() => {
    if (!session || paused || session.project !== project) return
    let disposing = false
    const focusBefore = document.activeElement as HTMLElement | null
    const steps = productTourSteps(session.phase, navigator.platform, ready)
    const finish = (status: 'completed' | 'skipped') => {
      const saved = { ...readTourProgress(), [session.phase]: status }
      if (session.phase === 'home' && status === 'skipped') saved.editor = 'skipped'
      saveTourProgress(saved); setProgress(saved); setSession(null)
    }
    const skipTour = () => { disposing = true; finish('skipped'); tour.destroy() }
    const { tour, cleanup } = createTour({
      steps,
      onHighlightStarted: (_el, _step, { index }) => { resume.current = index ?? 0 },
      onDoneClick: () => { finish('completed'); disposing = true; tour.destroy() },
      onCloseClick: skipTour,
      onDestroyed: () => { if (!disposing) finish('skipped') },
      onPopoverRender: (popover, { index }) => {
        const at = index ?? 0
        popover.wrapper.dataset.tourPhase = session.phase
        decorateTour(popover, session.phase === 'home' ? 'Getting started' : 'Directing your film', at, steps.length, skipTour)
        if ((session.phase === 'home' && at === 1) || (session.phase === 'editor' && at === 1 && !ready)) {
          const keys = document.createElement('button')
          keys.type = 'button'; keys.className = 'manul-tour-action'; keys.textContent = 'Open Settings → Keys'
          keys.onclick = onKeys
          popover.description.append(keys)
        }
      },
    })
    // Let sidebar/pane preparation and restored tabs commit before resolving the first target.
    const frame = requestAnimationFrame(() => tour.drive(resume.current))
    return () => {
      disposing = true
      cancelAnimationFrame(frame)
      cleanup()
      if (focusBefore?.isConnected) focusBefore.focus({ preventScroll: true })
    }
  }, [session, paused, project, onKeys, ready])

  return null
}
