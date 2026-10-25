import type { AgentShotApi } from '../../preload/index'

declare global {
  interface Window { agentshot: AgentShotApi }
}
