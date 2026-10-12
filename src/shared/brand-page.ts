import { MANUL_LOGO } from './brand.ts'

/** The same full-body Manul mark on desktop sign-in and account/checkout return pages. */
export const brandPage = (message: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Manul</title><link rel="icon" href="${MANUL_LOGO}"><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fbfbf9;color:#141413;font:15px system-ui,sans-serif}
main{max-width:420px;padding:32px;text-align:center}img{width:128px;height:128px;object-fit:contain}h1{margin:16px 0 12px;font:normal 32px Georgia,serif;letter-spacing:-.02em}p{margin:0;color:#52514f;line-height:1.7}
@media(prefers-color-scheme:dark){body{background:#0e0d0c;color:#efe8df}p{color:#a39888}}
</style></head><body><main><img src="${MANUL_LOGO}" alt="Manul, a fluffy Pallas’s cat"><h1>Manul</h1><p>${message}</p></main></body></html>`
