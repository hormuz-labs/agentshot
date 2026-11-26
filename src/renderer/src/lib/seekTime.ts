// What a person types to go to a moment: "20", "20.5", "1:20", "1:02:03.5", "1h2m3s", "90s", "2m". Seconds, or null.
export function parseSeekTime(text: string): number | null {
  const s = text.trim().toLowerCase().replace(/\s+/g, '')
  if (!s) return null
  // clock: [[h:]m:]s(.fff)
  if (/^\d+(?:\.\d+)?$|^\d+:\d{1,2}(?:\.\d+)?$|^\d+:\d{1,2}:\d{1,2}(?:\.\d+)?$/.test(s)) {
    const parts = s.split(':').map(Number)
    if (parts.slice(1).some(p => p >= 60)) return null
    return parts.reduce((total, p) => total * 60 + p, 0)
  }
  // units: 1h2m3.5s, 2m, 90s (each unit at most once, in order)
  const m = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(s)
  if (!m || (m[1] == null && m[2] == null && m[3] == null)) return null
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}
