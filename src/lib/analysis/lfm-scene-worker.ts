/**
 * Web Worker for LFM-2.5-VL scene cut verification.
 *
 * Loads LFM2.5-VL-450M-ONNX via @huggingface/transformers (bundled by Vite).
 * Runs inside a Worker so that model loading and inference don't block the
 * main thread.
 *
 * Messages:
 *   → { type: 'init' }                         — preload model
 *   → { type: 'verify', id, before, after }     — verify a candidate cut
 *   → { type: 'describe', id, image }           — describe an image with tags
 *   ← { type: 'ready' }                         — model loaded
 *   ← { type: 'progress', stage, percent }       — loading progress
 *   ← { type: 'result', id, isSceneCut, reason } — verification result
 *   ← { type: 'caption', id, caption }             — image caption
 *   ← { type: 'error', message }                 — error
 */

import {
  AutoProcessor,
  AutoModelForImageTextToText,
  RawImage,
  env,
} from '@huggingface/transformers'
import {
  LFM_SCENE_CAPTION_PROMPT,
  parseSceneCaptionResponse,
} from './captioning/scene-caption-format'

const MODEL_ID = 'LiquidAI/LFM2.5-VL-450M-ONNX'

// Configure transformers.js for browser worker context
env.useBrowserCache = true
env.allowLocalModels = false

/* eslint-disable @typescript-eslint/no-explicit-any */
let processor: any = null
let model: any = null
/* eslint-enable @typescript-eslint/no-explicit-any */
let loading = false
let disposed = false
let loadGeneration = 0
const DESCRIBE_MAX_NEW_TOKENS = 160

function post(msg: Record<string, unknown>): void {
  self.postMessage(msg)
}

async function loadModel(): Promise<void> {
  if (model && processor) {
    post({ type: 'ready' })
    return
  }
  if (loading) return
  loading = true
  disposed = false
  const thisGen = ++loadGeneration

  try {
    post({ type: 'progress', stage: 'loading-transformers', percent: 0 })
    post({ type: 'progress', stage: 'loading-model', percent: 5 })

    let lastPct = 5
    const loadedProcessor = await AutoProcessor.from_pretrained(MODEL_ID)

    if (disposed || thisGen !== loadGeneration) return

    const loadedModel = await AutoModelForImageTextToText.from_pretrained(MODEL_ID, {
      dtype: {
        vision_encoder: 'fp16',
        embed_tokens: 'fp16',
        decoder_model_merged: 'q4',
      },
      device: 'webgpu',
      progress_callback: disposed
        ? undefined
        : (info: { status?: string; total?: number; loaded?: number }) => {
            if (info.status === 'progress' && info.total && info.loaded) {
              const pct = 5 + (info.loaded / info.total) * 90
              if (pct - lastPct > 2) {
                lastPct = pct
                post({ type: 'progress', stage: 'loading-model', percent: Math.round(pct) })
              }
            }
          },
    })

    if (disposed || thisGen !== loadGeneration) {
      if (typeof loadedModel.dispose === 'function') loadedModel.dispose()
      return
    }

    processor = loadedProcessor
    model = loadedModel
    post({ type: 'progress', stage: 'ready', percent: 100 })
    post({ type: 'ready' })
  } catch (err) {
    if (!disposed) {
      post({ type: 'error', message: `Model load failed: ${(err as Error).message}` })
    }
  } finally {
    loading = false
  }
}

const VERIFY_PROMPT =
  'This image shows two video frames side by side: the left frame is ~1 second before, the right frame is at the potential cut point. Is there an editorial cut between them?\n\n' +
  'NOT a cut — answer SAME:\n' +
  '- Camera movement: pan, tilt, zoom, dolly, tracking, crane, or handheld shake\n' +
  '- Whip pan or motion blur (fast continuous camera move)\n' +
  '- Subject or object motion within the same scene\n' +
  '- Lighting, exposure, or focus change in the same scene\n' +
  '- Gradual transition: dissolve, fade, crossfade\n\n' +
  'IS a cut — answer CUT:\n' +
  '- Completely different scene, location, or subject with no continuous motion\n' +
  '- Abrupt jump to a different camera angle\n\n' +
  'Answer exactly one word: CUT or SAME'

/** Stitch two frame blobs side-by-side into a single image for single-image VLMs. */
async function stitchSideBySide(beforeBlob: Blob, afterBlob: Blob): Promise<RawImage> {
  const [beforeBmp, afterBmp] = await Promise.all([
    createImageBitmap(beforeBlob),
    createImageBitmap(afterBlob),
  ])
  const w = beforeBmp.width + afterBmp.width
  const h = Math.max(beforeBmp.height, afterBmp.height)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(beforeBmp, 0, 0)
  ctx.drawImage(afterBmp, beforeBmp.width, 0)
  beforeBmp.close()
  afterBmp.close()
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  return RawImage.fromBlob(blob)
}

async function verifyCandidate(id: number, beforeBlob: Blob, afterBlob: Blob): Promise<void> {
  if (!model || !processor) {
    post({ type: 'error', message: 'Model not loaded' })
    return
  }

  try {
    const stitched = await stitchSideBySide(beforeBlob, afterBlob)

    post({
      type: 'debug',
      id,
      stitchedSize: `${stitched.width}x${stitched.height}`,
    })

    const messages = [
      {
        role: 'user',
        content: [{ type: 'image' }, { type: 'text', text: VERIFY_PROMPT }],
      },
    ]

    const prompt = processor.apply_chat_template(messages, {
      add_generation_prompt: true,
    })

    post({
      type: 'debug',
      id,
      prompt: typeof prompt === 'string' ? prompt.slice(0, 500) : 'non-string prompt',
    })

    const inputs = await processor(stitched, prompt, { add_special_tokens: false })

    post({
      type: 'debug',
      id,
      inputIds: inputs.input_ids?.dims?.toString(),
      pixelValues: inputs.pixel_values?.dims?.toString(),
    })

    const outputs = await model.generate({
      ...inputs,
      max_new_tokens: 16,
      do_sample: false,
    })

    const decoded = processor.batch_decode(
      outputs.slice(null, [inputs.input_ids.dims.at(-1), null]),
      { skip_special_tokens: true },
    )

    const raw = (decoded[0] ?? '').trim()
    // Robust keyword detection — handles preamble or explanation from the model.
    // Conservative: default to SAME (not a cut) when ambiguous, since optical
    // flow already flagged this as a candidate.
    const hasCut = /\bCUT\b/i.test(raw)
    const hasSame = /\bSAME\b/i.test(raw)
    const isCut = hasCut && !hasSame
    post({ type: 'result', id, isSceneCut: isCut, reason: raw })
  } catch (err) {
    post({ type: 'result', id, isSceneCut: false, reason: `error: ${(err as Error).message}` })
  }
}

async function describeImage(id: number, imageBlob: Blob): Promise<void> {
  if (!model || !processor) {
    post({ type: 'error', message: 'Model not loaded' })
    return
  }

  try {
    const image = await RawImage.fromBlob(imageBlob)

    const messages = [
      {
        role: 'user',
        content: [{ type: 'image' }, { type: 'text', text: LFM_SCENE_CAPTION_PROMPT }],
      },
    ]

    const prompt = processor.apply_chat_template(messages, {
      add_generation_prompt: true,
    })

    const inputs = await processor(image, prompt, { add_special_tokens: false })

    const outputs = await model.generate({
      ...inputs,
      max_new_tokens: DESCRIBE_MAX_NEW_TOKENS,
      do_sample: false,
      repetition_penalty: 1.05,
    })

    const decoded = processor.batch_decode(
      outputs.slice(null, [inputs.input_ids.dims.at(-1), null]),
      { skip_special_tokens: true },
    )

    const parsed = parseSceneCaptionResponse(decoded[0] ?? '')
    post({
      type: 'caption',
      id,
      caption: parsed.text,
      sceneData: parsed.sceneData,
    })
  } catch (err) {
    post({ type: 'caption', id, caption: '', error: (err as Error).message })
  }
}

/** Release model and processor to free VRAM. */
function dispose(): void {
  disposed = true
  if (model) {
    // transformers.js models expose a dispose() that releases WebGPU buffers
    if (typeof model.dispose === 'function') model.dispose()
    model = null
  }
  processor = null
  loading = false
  post({ type: 'disposed' })
}

// Use addEventListener (not self.onmessage =) so the bootstrap wrapper
// can set onmessage for message buffering without conflicting.
self.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data
  if (msg.type === 'init') {
    void loadModel()
  } else if (msg.type === 'verify') {
    void verifyCandidate(msg.id, msg.before, msg.after)
  } else if (msg.type === 'describe') {
    void describeImage(msg.id, msg.image)
  } else if (msg.type === 'dispose') {
    dispose()
  }
})
