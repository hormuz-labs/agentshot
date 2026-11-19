export const CLAUDE_CODE_PROVIDER = 'claude-code'
export type ClaudeCodeStatus = {
  available: boolean; connected: boolean; enabled: boolean; subscription: boolean
  email?: string; authMethod?: string; warning?: string
}
