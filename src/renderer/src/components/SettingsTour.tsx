import { useEffect } from 'react'
import { createTour, decorateTour } from '@/lib/tour-driver'
import { SETTINGS_TOUR_STEPS } from '@/lib/settings-tour'

export function SettingsTour({ index, onIndex, onFinish }: {
  index: number; onIndex(index: number): void; onFinish(status: 'completed' | 'skipped'): void
}) {
  useEffect(() => {
    let disposing = false
    const finish = (status: 'completed' | 'skipped') => { disposing = true; onFinish(status); tour.destroy() }
    const { tour, cleanup } = createTour({
      steps: SETTINGS_TOUR_STEPS.map(s => s.step),
      waitForElement: 3000,
      onNextClick: () => onIndex(index + 1),
      onPrevClick: () => { if (index > 0) onIndex(index - 1) },
      onDoneClick: () => finish('completed'),
      onCloseClick: () => finish('skipped'),
      onDestroyed: () => { if (!disposing) onFinish('skipped') },
      onPopoverRender: (popover) => {
        popover.wrapper.dataset.tourPhase = 'settings'
        decorateTour(popover, index < 2 ? 'API keys' : 'Browser', index, SETTINGS_TOUR_STEPS.length, () => finish('skipped'))
      },
    })
    const frame = requestAnimationFrame(() => tour.drive(index))
    return () => { disposing = true; cancelAnimationFrame(frame); cleanup() }
  }, [index, onIndex, onFinish])
  return null
}
