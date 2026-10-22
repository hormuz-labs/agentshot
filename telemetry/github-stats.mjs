// Once a day (.github/workflows/github-stats.yml): Manul's public GitHub numbers as one PostHog event, so the
// dashboard shows downloads and stars next to usage. Run by hand: POSTHOG_TOKEN=phc_… node telemetry/github-stats.mjs
// Installer downloads are GitHub's download_count: requests for an installer, not people or completed installs.
// Auto-update .zip files, feeds and blockmaps are left out: running apps fetch those, not people.
const REPO = 'https://api.github.com/repos/hormuz-labs/manul'
const INSTALLERS = { '.dmg': 'mac', '.deb': 'deb', '.AppImage': 'appimage' }

export async function githubStats({ token, fetchImpl = fetch } = {}) {
  const get = async path => {
    const res = await fetchImpl(REPO + path, { headers: {
      accept: 'application/vnd.github+json', 'user-agent': 'manul-github-stats', 'x-github-api-version': '2022-11-28',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    } })
    if (!res.ok) throw new Error(`GitHub ${path}: HTTP ${res.status}`)
    return res.json()
  }
  const stats = { installer_downloads: 0, mac_downloads: 0, deb_downloads: 0, appimage_downloads: 0 }
  for (let page = 1; ; page++) {
    const releases = await get(`/releases?per_page=100&page=${page}`)
    for (const r of releases) {
      if (r.draft || r.prerelease) continue
      for (const a of r.assets || []) {
        const kind = Object.entries(INSTALLERS).find(([ext]) => a.name.endsWith(ext))?.[1]
        if (!kind) continue
        stats.installer_downloads += a.download_count
        stats[`${kind}_downloads`] += a.download_count
      }
    }
    if (releases.length < 100) break
  }
  const repo = await get('')
  Object.assign(stats, { stars: repo.stargazers_count, forks: repo.forks_count })
  // Clone traffic needs a token with push access; without one the event simply leaves it out.
  if (token) {
    try {
      const c = await get('/traffic/clones')
      Object.assign(stats, { clones_14d: c.count, unique_cloners_14d: c.uniques })
    } catch (e) { console.warn(`clone traffic skipped: ${e.message}`) }
  }
  return stats
}

export async function send(stats, { host, token, fetchImpl = fetch, now = new Date() }) {
  const res = await fetchImpl(`${host}/capture/`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: token, event: 'github snapshot', distinct_id: 'manul-github', timestamp: now.toISOString(),
      properties: { ...stats, $process_person_profile: false } }),
  })
  if (!res.ok) throw new Error(`PostHog: HTTP ${res.status}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const token = process.env.POSTHOG_TOKEN
  if (!token) { console.error('POSTHOG_TOKEN is not set'); process.exit(1) }
  const stats = await githubStats({ token: process.env.GH_TRAFFIC_TOKEN || process.env.GITHUB_TOKEN })
  await send(stats, { host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com', token })
  console.log(JSON.stringify(stats))
}
