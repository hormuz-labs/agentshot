/** "Connected now", "Last connected 5 minutes ago", …: how Settings → Mobile describes a paired phone. */
export function lastSeenText(device: { online: boolean; lastSeen?: number }, now = Date.now()) {
  if (device.online) return 'Connected now'
  if (!device.lastSeen) return 'Not connected since it was paired'
  const minutes = Math.floor(Math.max(0, now - device.lastSeen) / 60_000)
  if (minutes < 1) return 'Last connected just now'
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'} ago`
  if (minutes < 60) return `Last connected ${unit(minutes, 'minute')}`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Last connected ${unit(hours, 'hour')}`
  const days = Math.floor(hours / 24)
  if (days < 30) return `Last connected ${unit(days, 'day')}`
  return `Last connected ${new Date(device.lastSeen).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
}
