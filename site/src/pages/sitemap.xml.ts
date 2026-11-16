import type { APIRoute } from 'astro'
import { COMPARISONS, comparisonPath } from '../data/comparisons'

// Derive static content routes from the site, keeping download/404 pages (noindex) out of search discovery.
const pages = import.meta.glob('./**/*.astro')
const paths = Object.keys(pages)
  .filter(path => !path.includes('[') && path !== './404.astro')
  .map(path => path.replace(/^\.\//, '/').replace(/(?:\/index)?\.astro$/, '/'))
const urls = [...new Set([...paths, ...COMPARISONS.map(c => comparisonPath(c.slug))])].sort()

export const GET: APIRoute = () => new Response(
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(path => `  <url><loc>https://agentshot.si${path}</loc></url>`).join('\n')}\n</urlset>\n`,
  { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
)
