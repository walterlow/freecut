/**
 * Web Worker for Gemma-4 scene cut verification.
 *
 * Loads Gemma-4-E2B-it-ONNX via @huggingface/transformers CDN.
 * Runs inside a Worker to bypass COEP (Cross-Origin-Embedder-Policy)
 * restrictions on the main thread.
 *
 * Messages:
 *   → { type: 'init' }                         — preload model
 *   → { type: 'verify', id, before, after }     — verify a candidate cut
 *   ← { type: 'ready' }                         — model loaded
 *   ← { type: 'progress', stage, percent }       — loading progress
 *   ← { type: 'result', id, isSceneCut, reason } — verification result
 *   ← { type: 'error', message }                 — error
 */

// TODO: Replace CDN imports with a bundled devDependency (`@huggingface/transformers`)
// imported via a Vite worker entry. CDN fetches bypass npm audit and lack SRI hashes,
// meaning a compromised CDN could execute arbitrary code in this Worker context.
// See: https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity
const TRANSFORMERS_CDN_URL = 'https://esm.sh/@huggingface/transformers@4.0.1?bundle';
const WASM_CDN_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.1/dist/';
const MODEL_ID = 'onnx-community/gemma-4-E2B-it-ONNX';

/* eslint-disable @typescript-eslint/no-explicit-any */
let processor: any = null;
let model: any = null;
let transformers: any = null;
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

    const mod = await import(/* @vite-ignore */ TRANSFORMERS_CDN_URL);
    transformers = mod;

    mod.env.useBrowserCache = true;
    mod.env.allowLocalModels = false;
    mod.env.backends.onnx.wasm.wasmPaths = WASM_CDN_URL;

    post({ type: 'progress', stage: 'loading-model', percent: 5 });

    let lastPct = 5;
    processor = await mod.AutoProcessor.from_pretrained(MODEL_ID);

    model = await mod.Gemma4ForConditionalGeneration.from_pretrained(MODEL_ID, {
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
  'Look at these two consecutive video frames. ' +
  'Is this a hard scene cut (completely different scene or shot) or continuous footage ' +
  '(same scene with camera movement, zoom, dissolve, or minor changes)? ' +
  'Answer with exactly one word: CUT or CONTINUOUS';

async function verifyCandidate(
  id: number,
  beforeBlob: Blob,
  afterBlob: Blob,
): Promise<void> {
  if (!model || !processor || !transformers) {
    post({ type: 'error', message: 'Model not loaded' });
    return;
  }

  try {
    const beforeImg = await transformers.RawImage.fromBlob(beforeBlob);
    const afterImg = await transformers.RawImage.fromBlob(afterBlob);

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
      enable_thinking: false,
      add_generation_prompt: true,
    });

    const inputs = await processor(prompt, [beforeImg, afterImg], {
      add_special_tokens: false,
    });

    const outputs = await model.generate({
      ...inputs,
      max_new_tokens: 10,
      do_sample: false,
    });

    const decoded = processor.batch_decode(
      outputs.slice(null, [inputs.input_ids.dims.at(-1), null]),
      { skip_special_tokens: true },
    );

    const answer = (decoded[0] ?? '').trim().toUpperCase();
    post({ type: 'result', id, isSceneCut: answer.startsWith('CUT'), reason: answer });
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
