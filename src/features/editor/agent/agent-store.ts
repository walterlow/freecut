/**
 * UI + orchestration store for the editing agent. Drives the on-device model
 * load, the chat transcript, the proposed plan, and step-by-step execution.
 *
 * Flow: submit → (load model) → planning (streamed) → awaiting-confirm (if the
 * plan has steps) → running → idle. Every executed step runs through the
 * timeline facade, so each is independently undoable.
 */

import { create } from 'zustand'
import type { LlmMessage } from '@/infrastructure/llm'
import { getAgentAdapter, planRequest, runStep, type PlannedStep } from './agent-service'

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error'
export type AgentPhase = 'idle' | 'planning' | 'awaiting-confirm' | 'running'
export type PlanStepStatus = 'pending' | 'running' | 'done' | 'error'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export interface PlanStepState extends PlannedStep {
  status: PlanStepStatus
  result?: string
}

interface AgentState {
  supported: boolean
  modelStatus: ModelStatus
  loadPercent: number
  loadError: string | null

  messages: ChatMessage[]
  phase: AgentPhase
  streamingText: string
  plan: PlanStepState[] | null

  loadModel: () => Promise<void>
  submit: (text: string) => Promise<void>
  runPlan: () => Promise<void>
  dismissPlan: () => void
  cancel: () => void
  clearChat: () => void
}

let activeController: AbortController | null = null

function newId(): string {
  return crypto.randomUUID()
}

/** Last few turns, mapped for the model; excludes the in-flight user message. */
function buildHistory(messages: ChatMessage[]): LlmMessage[] {
  return messages.slice(-6).map((message) => ({ role: message.role, content: message.content }))
}

export const useAgentStore = create<AgentState>((set, get) => ({
  supported: getAgentAdapter().isSupported(),
  modelStatus: 'idle',
  loadPercent: 0,
  loadError: null,

  messages: [],
  phase: 'idle',
  streamingText: '',
  plan: null,

  loadModel: async () => {
    const adapter = getAgentAdapter()
    if (!adapter.isSupported()) {
      set({ modelStatus: 'error', loadError: 'WebGPU is required to run the on-device assistant.' })
      throw new Error('WebGPU unsupported')
    }
    if (get().modelStatus === 'ready') return
    set({ modelStatus: 'loading', loadError: null })
    try {
      await adapter.load((progress) => set({ loadPercent: progress.percent }))
      set({ modelStatus: 'ready', loadPercent: 100 })
    } catch (error) {
      set({
        modelStatus: 'error',
        loadError: error instanceof Error ? error.message : 'Failed to load the model.',
      })
      throw error
    }
  },

  submit: async (text) => {
    const trimmed = text.trim()
    if (!trimmed || get().phase !== 'idle') return

    const history = buildHistory(get().messages)
    const userMessage: ChatMessage = { id: newId(), role: 'user', content: trimmed }
    set((state) => ({
      messages: [...state.messages, userMessage],
      phase: 'planning',
      streamingText: '',
      plan: null,
    }))

    try {
      await get().loadModel()
    } catch {
      set({ phase: 'idle' })
      return
    }

    const controller = new AbortController()
    activeController = controller

    try {
      const result = await planRequest(trimmed, {
        history,
        signal: controller.signal,
        onToken: (_delta, full) => set({ streamingText: full }),
      })

      const assistantMessage: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content: result.reply || 'Done.',
      }
      const hasSteps = result.steps.length > 0
      set((state) => ({
        messages: [...state.messages, assistantMessage],
        streamingText: '',
        phase: hasSteps ? 'awaiting-confirm' : 'idle',
        plan: hasSteps
          ? result.steps.map((step) => ({ ...step, status: 'pending' as const }))
          : null,
      }))
    } catch (error) {
      if (controller.signal.aborted) {
        set({ phase: 'idle', streamingText: '' })
      } else {
        const message = error instanceof Error ? error.message : 'Something went wrong.'
        set((state) => ({
          messages: [
            ...state.messages,
            { id: newId(), role: 'assistant', content: `Sorry — ${message}` },
          ],
          phase: 'idle',
          streamingText: '',
        }))
      }
    } finally {
      activeController = null
    }
  },

  runPlan: async () => {
    const plan = get().plan
    if (!plan || get().phase !== 'awaiting-confirm') return
    set({ phase: 'running' })

    const results: string[] = []
    for (let index = 0; index < plan.length; index++) {
      set((state) => ({
        plan:
          state.plan?.map((step, i) =>
            i === index ? { ...step, status: 'running' as const } : step,
          ) ?? null,
      }))
      const step = plan[index]
      if (!step) continue
      const result = await runStep(step)
      results.push(`${result.ok ? '✓' : '✕'} ${result.message}`)
      set((state) => ({
        plan:
          state.plan?.map((s, i) =>
            i === index
              ? {
                  ...s,
                  status: result.ok ? ('done' as const) : ('error' as const),
                  result: result.message,
                }
              : s,
          ) ?? null,
      }))
    }

    set((state) => ({
      messages: [
        ...state.messages,
        { id: newId(), role: 'assistant', content: results.join('\n') },
      ],
      phase: 'idle',
    }))
  },

  dismissPlan: () => {
    if (get().phase === 'running') return
    set({ plan: null, phase: 'idle' })
  },

  cancel: () => {
    activeController?.abort()
    activeController = null
    set({ phase: 'idle', streamingText: '' })
  },

  clearChat: () => {
    activeController?.abort()
    activeController = null
    set({ messages: [], plan: null, phase: 'idle', streamingText: '' })
  },
}))
