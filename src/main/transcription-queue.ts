/** Small checkpoint-sized work units. Interactive work goes first; renders hold background work
 * at the next checkpoint, without pausing tasks a render may itself be awaiting. */
export class TranscriptionQueue {
  private pending: { key: string; foreground: boolean; run: () => Promise<unknown>; resolve: (v: any) => void; reject: (e: unknown) => void }[] = []
  private active = 0
  private rendering = false
  private closed = false
  constructor(private capacity = 1) {}

  setRendering(rendering: boolean) { this.rendering = rendering; this.drain() }
  close() { this.closed = true; for (const t of this.pending.splice(0)) t.reject(new Error('Transcription stopped; saved chunks will resume.')) }
  promote(key: string) {
    for (const task of this.pending) if (task.key.startsWith(key)) task.foreground = true
    this.drain()
  }
  add<T>(key: string, foreground: boolean, run: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Transcription stopped; saved chunks will resume.'))
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ key, foreground, run, resolve, reject })
      this.drain()
    })
  }
  private drain() {
    while (this.active < this.capacity) {
      let i = this.pending.findIndex(t => t.foreground)
      if (i < 0 && !this.rendering) i = 0
      const task = i < 0 ? undefined : this.pending.splice(i, 1)[0]
      if (!task) return
      this.active++
      void Promise.resolve().then(task.run).then(task.resolve, task.reject).finally(() => { this.active--; this.drain() })
    }
  }
}
