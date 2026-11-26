// AgentShot for Claude and ChatGPT on the web, as a plain Node server (Node 24 runs the .ts files as they are), in
// Kubernetes next to the account service; its settings come from the environment (gateway/k8s/chat-host.yaml).
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { chatHost } from './src/host.ts'
import { People } from './src/people.ts'
import { addVideo } from './src/intake.ts'

const need = name => { const v = process.env[name]; if (!v) throw new Error(`Set ${name} (see chat-host/README.md).`); return v }
const clerk = need('CLERK_ISSUER')
// the editor page, built by scripts/build-mcp-app.mjs (the Dockerfile builds it beside this file)
const html = readFileSync(process.env.EDITOR_PAGE || new URL('./editor.html', import.meta.url), 'utf8')

createServer(chatHost({
  publicUrl: need('PUBLIC_URL'),
  clerk,
  people: new People({ clerk, account: need('ACCOUNT_URL') }),
  secret: need('LINK_SECRET'),
  page: () => html,
  addVideo: (worker, url, dir) => addVideo(worker, url, dir),
})).listen(Number(process.env.PORT || 8080), () => console.log('chat-host listening'))
