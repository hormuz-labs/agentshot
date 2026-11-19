/** Public connection metadata only. OAuth credentials never cross IPC. */
export type ChatGPTStatus = {
  available: boolean
  active?: string
  accounts: { id: string; label: string; connected: boolean }[]
  warning?: string
}
export const CHATGPT_PROVIDER = 'chatgpt'
export const CHATGPT_USAGE = 'https://chatgpt.com/settings/usage'
