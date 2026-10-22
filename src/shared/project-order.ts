/** Creation order, not last-opened order: selecting or editing a project must not move it in the sidebar. */
export function newestProjects<T extends { dir: string; createdAt?: number }>(projects: readonly T[]): T[] {
  const time = (p: T) => Number.isFinite(p.createdAt) ? p.createdAt! : 0
  return [...projects].sort((a, b) => time(b) - time(a) || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0))
}
