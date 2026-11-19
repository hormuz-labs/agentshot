export const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ReasoningLevel = typeof REASONING_LEVELS[number]
export type ModelRef = { provider: string; modelId: string; reasoningLevel?: ReasoningLevel }
