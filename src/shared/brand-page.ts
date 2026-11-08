import { AGENTSHOT_LOGO } from './brand.ts'

/** The same full-body AgentShot mark on desktop sign-in and account/checkout return pages. */
export const brandPage = (message: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgentShot</title><link rel="icon" href="${AGENTSHOT_LOGO}"><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0c11;color:#f6f3ec;font:15px system-ui,sans-serif}
main{max-width:420px;padding:32px;text-align:center}img{width:128px;height:128px;object-fit:contain}h1{margin:16px 0 12px;font:800 34px system-ui,sans-serif;letter-spacing:-.03em}p{margin:0;color:#c3bfcf;line-height:1.7}
@media(prefers-color-scheme:light){body{background:#f7f6fb;color:#15131c}p{color:#4f4b5e}}
</style></head><body><main><img src="${AGENTSHOT_LOGO}" alt="AgentShot"><h1>AgentShot</h1><p>${message}</p></main></body></html>`
