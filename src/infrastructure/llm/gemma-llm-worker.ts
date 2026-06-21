/**
 * Web Worker hosting the on-device Gemma text LLM for the editing agent.
 *
 * Loads `onnx-community/gemma-4-E4B-it-ONNX` (the same model family already used
 * for scene-cut verification, so weights are often already cached) via
 * @huggingface/transformers and runs text-only chat completion on WebGPU. All
 * model loading and inference happen here so the main thread stays responsive.
 *
 * Protocol: see `worker-protocol.ts`.
 */

import {
  AutoTokenizer,
  Gemma4ForConditionalGeneration,
  TextStreamer,
  InterruptableStoppingCriteria,
  StoppingCriteriaList,
  env,
} from '@huggingface/transformers'
import type { LlmWorkerRequest } from './worker-protocol'

const MODEL_ID = 'onnx-community/gemma-4-E4B-it-ONNX'

// Match the scene-verification worker configuration so a single cached copy of
// the weights serves both features.
env.useBrowserCache = true
env.allowLocalModels = false

// transformers.js model/tokenizer types are complex internals that aren't
// exported for external use, so `any` is the pragmatic choice here.
/* eslint-disable @typescript-eslint/no-explicit-any */
let tokenizer: any = null
let model: any = null
/* eslint-enable @typescript-eslint/no-explicit-any */
let loading: Promise<void> | null = null
let disposed = false

/** Stopping criteria per in-flight generation id, so `cancel` can interrupt. */
const activeStops = new Map<number, InterruptableStoppingCriteria>()

function post(message: Record<string, unknown>): void {
  self.postMessage(message)
}

async function ensureLoaded(): Promise<void> {
  if (model && tokenizer) {
    post({ type: 'ready' })
    return
  }
  if (loading) return loading

  disposed = false
  loading = (async () => {
    post({ type: 'progress', stage: 'loading-model', percent: 5 })
    let lastPct = 5

    const loadedTokenizer = await AutoTokenizer.from_pretrained(MODEL_ID)
    if (disposed) return

    const loadedModel = await Gemma4ForConditionalGeneration.from_pretrained(MODEL_ID, {
      dtype: 'q4f16',
      device: 'webgpu',
      progress_callback: (info: { status?: string; total?: number; loaded?: number }) => {
        if (info.status === 'progress' && info.total && info.loaded) {
          const pct = 5 + (info.loaded / info.total) * 90
          if (pct - lastPct > 2) {
            lastPct = pct
            post({ type: 'progress', stage: 'loading-model', percent: Math.round(pct) })
          }
        }
      },
    })

    if (disposed) {
      if (typeof loadedModel.dispose === 'function') loadedModel.dispose()
      return
    }

    tokenizer = loadedTokenizer
    model = loadedModel
    post({ type: 'progress', stage: 'ready', percent: 100 })
    post({ type: 'ready' })
  })()

  try {
    await loading
  } catch (err) {
    post({ type: 'error', message: `Model load failed: ${(err as Error).message}` })
  } finally {
    loading = null
  }
}

async function generate(request: Extract<LlmWorkerRequest, { type: 'generate' }>): Promise<void> {
  if (!model || !tokenizer) {
    post({ type: 'error', id: request.id, message: 'Model not loaded' })
    return
  }

  const stop = new InterruptableStoppingCriteria()
  activeStops.set(request.id, stop)

  try {
    const inputs = tokenizer.apply_chat_template(request.messages, {
      add_generation_prompt: true,
      return_dict: true,
    })

    const streamer = new TextStreamer(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (delta: string) => {
        if (delta) post({ type: 'token', id: request.id, delta })
      },
    })

    const stoppingCriteria = new StoppingCriteriaList()
    stoppingCriteria.push(stop)

    const sample = request.temperature > 0
    const outputs = await model.generate({
      ...inputs,
      max_new_tokens: request.maxTokens,
      do_sample: sample,
      ...(sample ? { temperature: request.temperature, top_p: request.topP } : {}),
      streamer,
      stopping_criteria: stoppingCriteria,
    })

    const promptLength = inputs.input_ids.dims.at(-1)
    const decoded = tokenizer.batch_decode(outputs.slice(null, [promptLength, null]), {
      skip_special_tokens: true,
    })

    post({ type: 'result', id: request.id, text: (decoded[0] ?? '').trim() })
  } catch (err) {
    post({ type: 'error', id: request.id, message: (err as Error).message })
  } finally {
    activeStops.delete(request.id)
  }
}

function dispose(): void {
  disposed = true
  for (const stop of activeStops.values()) stop.interrupt()
  activeStops.clear()
  if (model && typeof model.dispose === 'function') model.dispose()
  model = null
  tokenizer = null
  loading = null
  post({ type: 'disposed' })
}

self.addEventListener('message', (event: MessageEvent<LlmWorkerRequest>) => {
  const message = event.data
  switch (message.type) {
    case 'load':
      void ensureLoaded()
      break
    case 'generate':
      void generate(message)
      break
    case 'cancel':
      activeStops.get(message.id)?.interrupt()
      break
    case 'dispose':
      dispose()
      break
  }
})
