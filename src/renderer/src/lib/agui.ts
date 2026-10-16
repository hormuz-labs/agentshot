// Folds the AG-UI event stream from the main process into what the agent panel draws, per project.
import { useEffect, useSyncExternalStore } from 'react'
import type { BaseEvent } from '@ag-ui/core'
import { emptyAgentState, reduce, type AgentState } from '../../../shared/agui-state'

// one store for every open project; events arrive tagged with the project's folder
const states = new Map<string, AgentState>()
const listeners = new Set<() => void>()
let wired = false
function wire() {
  if (wired) return
  wired = true
  window.manul.agent.onEvent((dir, e) => {
    states.set(dir, reduce(states.get(dir) || emptyAgentState(), e as BaseEvent & Record<string, any>))
    listeners.forEach(l => l())
  })
}

export function useAgent(dir: string | null): AgentState {
  useEffect(() => { wire(); if (dir) window.manul.agent.attach(dir) }, [dir])
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => (dir && states.get(dir)) || EMPTY,
  )
}
const EMPTY = emptyAgentState()
