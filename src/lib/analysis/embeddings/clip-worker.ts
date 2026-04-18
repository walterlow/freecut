/**
 * Web Worker for CLIP image + text embeddings.
 *
 * Loads both halves of `Xenova/clip-vit-base-patch32` (q8 quantized,
 * ~90 MB total) so the same worker can embed:
 *   - scene thumbnails at caption time (image encoder), producing
 *     vectors that get stored in `captions-image-embeddings.bin`, and
 *   - search queries at query time (text encoder), producing a vector
 *     in the *same* 512-dim space so cosine similarity against image
 *     embeddings is meaningful.
 *
 * Kept separate from the all-MiniLM text worker because the models are
 * large and users who never switch to semantic search shouldn't pay the
 * CLIP download cost.
 *
 * Messages:
 *   → { type: 'init' }
 *   → { type: 'embed-images', id, blobs: Blob[] }
 *   → { type: 'embed-text',   id, texts: string[] }
 *   → { type: 'dispose' }
 *   ← { type: 'ready', dim: number }
 *   ← { type: 'progress', percent: number }
 *   ← { type: 'vectors', id, vectors: Float32Array[] }
 *   ← { type: 'error', id?, message }
 */

import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
  env,
  type PreTrainedTokenizer,
  type Processor,
  type PreTrainedModel,
} from '@huggingface/transformers';

const MODEL_ID = 'Xenova/clip-vit-base-patch32';

env.useBrowserCache = true;
env.allowLocalModels = false;

/* eslint-disable @typescript-eslint/no-explicit-any -- transformers.js
   tensor types vary by version; the worker stays schema-stable. */
let tokenizer: PreTrainedTokenizer | null = null;
let processor: Processor | null = null;
let textModel: PreTrainedModel | null = null;
let visionModel: PreTrainedModel | null = null;
let loading = false;
let disposed = false;
let loadGeneration = 0;
let embeddingDim = 512;

function post(msg: Record<string, unknown>): void {
  self.postMessage(msg);
}

async function loadModel(): Promise<void> {
  if (tokenizer && processor && textModel && visionModel) {
    post({ type: 'ready', dim: embeddingDim });
    return;
  }
  if (loading) return;
  loading = true;
  disposed = false;
  const thisGen = ++loadGeneration;

  try {
    let lastPct = 0;
    const onProgress = (info: { status?: string; total?: number; loaded?: number }) => {
      if (info.status === 'progress' && info.total && info.loaded) {
        const pct = (info.loaded / info.total) * 100;
        if (pct - lastPct > 2) {
          lastPct = pct;
          post({ type: 'progress', percent: Math.round(pct) });
        }
      }
    };

    const [loadedTokenizer, loadedProcessor, loadedTextModel, loadedVisionModel] = await Promise.all([
      AutoTokenizer.from_pretrained(MODEL_ID),
      AutoProcessor.from_pretrained(MODEL_ID),
      CLIPTextModelWithProjection.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        progress_callback: onProgress,
      } as any),
      CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        progress_callback: onProgress,
      } as any),
    ]);

    if (disposed || thisGen !== loadGeneration) return;

    tokenizer = loadedTokenizer;
    processor = loadedProcessor;
    textModel = loadedTextModel;
    visionModel = loadedVisionModel;

    // Probe the projection dim with a tiny warmup; different CLIP
    // variants project to 512, 768, or 1024 dims and we want to be sure
    // before callers start packing bins.
    try {
      const tokens = tokenizer(['probe'], { padding: true, truncation: true }) as any;
      const output = (await (textModel as any)(tokens)) as any;
      const dims: number[] | undefined = output?.text_embeds?.dims;
      if (Array.isArray(dims) && dims.length > 0) {
        embeddingDim = Number(dims[dims.length - 1]);
      }
    } catch {
      // Stick with the default dim if the probe fails — the real embed
      // calls will surface a more specific error if the model is bad.
    }

    post({ type: 'ready', dim: embeddingDim });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    loading = false;
  }
}

function normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vector.length; i += 1) sum += vector[i]! * vector[i]!;
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) out[i] = vector[i]! / norm;
  return out;
}

function splitPacked(packed: Float32Array, count: number, dim: number): Float32Array[] {
  const vectors: Float32Array[] = [];
  for (let i = 0; i < count; i += 1) {
    vectors.push(normalize(packed.slice(i * dim, (i + 1) * dim)));
  }
  return vectors;
}

async function embedImages(id: number, blobs: Blob[]): Promise<void> {
  if (!processor || !visionModel) {
    post({ type: 'error', id, message: 'CLIP worker not ready (vision)' });
    return;
  }
  if (blobs.length === 0) {
    post({ type: 'vectors', id, vectors: [] });
    return;
  }
  try {
    const images = await Promise.all(blobs.map((blob) => RawImage.fromBlob(blob)));
    const inputs = await (processor as any)(images);
    const output = (await (visionModel as any)(inputs)) as any;
    const data = output?.image_embeds?.data as Float32Array | undefined;
    if (!data) throw new Error('CLIP vision model returned no image_embeds');
    post({ type: 'vectors', id, vectors: splitPacked(data, blobs.length, embeddingDim) });
  } catch (error) {
    post({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
  }
}

async function embedTexts(id: number, texts: string[]): Promise<void> {
  if (!tokenizer || !textModel) {
    post({ type: 'error', id, message: 'CLIP worker not ready (text)' });
    return;
  }
  if (texts.length === 0) {
    post({ type: 'vectors', id, vectors: [] });
    return;
  }
  try {
    const tokens = (tokenizer as any)(texts, { padding: true, truncation: true });
    const output = (await (textModel as any)(tokens)) as any;
    const data = output?.text_embeds?.data as Float32Array | undefined;
    if (!data) throw new Error('CLIP text model returned no text_embeds');
    post({ type: 'vectors', id, vectors: splitPacked(data, texts.length, embeddingDim) });
  } catch (error) {
    post({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
  }
}

self.addEventListener('message', (event: MessageEvent) => {
  const message = event.data;
  if (!message || typeof message.type !== 'string') return;

  if (message.type === 'init') {
    void loadModel();
    return;
  }

  if (message.type === 'embed-images') {
    const id = typeof message.id === 'number' ? message.id : 0;
    const blobs = Array.isArray(message.blobs) ? (message.blobs as Blob[]) : [];
    void embedImages(id, blobs);
    return;
  }

  if (message.type === 'embed-text') {
    const id = typeof message.id === 'number' ? message.id : 0;
    const texts = Array.isArray(message.texts)
      ? (message.texts as unknown[]).filter((t): t is string => typeof t === 'string')
      : [];
    void embedTexts(id, texts);
    return;
  }

  if (message.type === 'dispose') {
    disposed = true;
    tokenizer = null;
    processor = null;
    textModel = null;
    visionModel = null;
    loading = false;
    return;
  }
});
/* eslint-enable @typescript-eslint/no-explicit-any */
