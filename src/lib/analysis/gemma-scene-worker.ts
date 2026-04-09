/**
 * Web Worker for Gemma-4 scene cut verification.
 *
 * Loads Gemma-4-E2B-it-ONNX via @huggingface/transformers (bundled by Vite).
 * Runs inside a Worker so that model loading and inference don't block the
 * main thread.
 *
 * Messages:
 *   → { type: 'init' }                         — preload model
 *   → { type: 'verify', id, before, after }     — verify a candidate cut
 *   ← { type: 'ready' }                         — model loaded
 *   ← { type: 'progress', stage, percent }       — loading progress
 *   ← { type: 'result', id, isSceneCut, reason } — verification result
 *   ← { type: 'error', message }                 — error
 */

import {
  AutoProcessor,
  Gemma4ForConditionalGeneration,
  RawImage,
  env,
} from '@huggingface/transformers';

const MODEL_ID = 'onnx-community/gemma-4-E2B-it-ONNX';

// Configure transformers.js for browser worker context
env.useBrowserCache = true;
env.allowLocalModels = false;

/* eslint-disable @typescript-eslint/no-explicit-any */
let processor: any = null;
let model: any = null;
/* eslint-enable @typescript-eslint/no-explicit-any */
let loading = false;

function post(msg: Record<string, unknown>): void {
  self.postMessage(msg);
}

async function loadModel(): Promise<void> {
  if (model && processor) { post({ type: 'ready' }); return; }
  if (loading) return;
  loading = true;

  try {
    post({ type: 'progress', stage: 'loading-transformers', percent: 0 });
    post({ type: 'progress', stage: 'loading-model', percent: 5 });

    let lastPct = 5;
    processor = await AutoProcessor.from_pretrained(MODEL_ID);

    model = await Gemma4ForConditionalGeneration.from_pretrained(MODEL_ID, {
      dtype: 'q4f16',
      device: 'webgpu',
      progress_callback: (info: { status?: string; total?: number; loaded?: number }) => {
        if (info.status === 'progress' && info.total && info.loaded) {
          const pct = 5 + (info.loaded / info.total) * 90;
          if (pct - lastPct > 2) {
            lastPct = pct;
            post({ type: 'progress', stage: 'loading-model', percent: Math.round(pct) });
          }
        }
      },
    });

    post({ type: 'progress', stage: 'ready', percent: 100 });
    post({ type: 'ready' });
  } catch (err) {
    post({ type: 'error', message: `Model load failed: ${(err as Error).message}` });
  } finally {
    loading = false;
  }
}

const VERIFY_PROMPT =
  'These two images are frames from a video, taken about 1 second apart. ' +
  'Do they show DIFFERENT scenes or camera angles (a scene cut), ' +
  'or the SAME scene with movement? ' +
  'Reply with only one word: CUT or SAME';

async function verifyCandidate(
  id: number,
  beforeBlob: Blob,
  afterBlob: Blob,
): Promise<void> {
  if (!model || !processor) {
    post({ type: 'error', message: 'Model not loaded' });
    return;
  }

  try {
    const beforeImg = await RawImage.fromBlob(beforeBlob);
    const afterImg = await RawImage.fromBlob(afterBlob);

    post({
      type: 'debug',
      id,
      beforeSize: `${beforeImg.width}x${beforeImg.height}`,
      afterSize: `${afterImg.width}x${afterImg.height}`,
      beforeBlobSize: beforeBlob.size,
      afterBlobSize: afterBlob.size,
    });

    const messages = [
      {
        role: 'user',
        content: [
          { type: 'image' },
          { type: 'image' },
          { type: 'text', text: VERIFY_PROMPT },
        ],
      },
    ];

    const prompt = processor.apply_chat_template(messages, {
      enable_thinking: true,
      add_generation_prompt: true,
    });

    post({ type: 'debug', id, prompt: typeof prompt === 'string' ? prompt.slice(0, 500) : 'non-string prompt' });

    const inputs = await processor(prompt, [beforeImg, afterImg], null, {
      add_special_tokens: false,
    });

    post({
      type: 'debug',
      id,
      inputIds: inputs.input_ids?.dims?.toString(),
      pixelValues: inputs.pixel_values?.dims?.toString(),
    });

    const outputs = await model.generate({
      ...inputs,
      max_new_tokens: 128,
      do_sample: false,
    });

    const decoded = processor.batch_decode(
      outputs.slice(null, [inputs.input_ids.dims.at(-1), null]),
      { skip_special_tokens: true },
    );

    const raw = (decoded[0] ?? '').trim();
    // With thinking enabled, output is: <think>...reasoning...</think>\n\nFINAL_ANSWER
    // Extract the part after </think> if present, otherwise use the whole output
    const afterThink = raw.includes('</think>') ? raw.split('</think>').pop()!.trim() : raw;
    const answer = afterThink.toUpperCase();
    post({ type: 'result', id, isSceneCut: answer.startsWith('CUT'), reason: raw });
  } catch (err) {
    post({ type: 'result', id, isSceneCut: false, reason: `error: ${(err as Error).message}` });
  }
}

// Use addEventListener (not self.onmessage =) so the bootstrap wrapper
// can set onmessage for message buffering without conflicting.
self.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data;
  if (msg.type === 'init') {
    void loadModel();
  } else if (msg.type === 'verify') {
    void verifyCandidate(msg.id, msg.before, msg.after);
  }
});
