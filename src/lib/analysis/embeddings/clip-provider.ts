/**
 * Singleton provider over the CLIP image/text worker.
 *
 * Exposes three operations — `ensureReady`, `embedImages`, and
 * `embedTextForImages` — that together let the Scene Browser index
 * thumbnails and search them by free-form text queries, both running
 * off-thread so the UI stays responsive while the model downloads.
 */

import { createLogger } from '@/shared/logging/logger';
import { createClipWorker } from './create-clip-worker';
import type { EmbeddingsOptions } from './types';

const log = createLogger('ClipProvider');

export const CLIP_MODEL_ID = 'Xenova/clip-vit-base-patch32';
export const CLIP_EMBEDDING_DIM = 512;

const INIT_TIMEOUT_MS = 120_000;

let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;
let nextId = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = createClipWorker();
    worker.addEventListener('error', (event) => {
      log.error('CLIP worker errored', event.message);
    });
  }
  return worker;
}

function ensureReady(options: EmbeddingsOptions = {}): Promise<void> {
  if (readyPromise) return readyPromise;
  const w = getWorker();

  readyPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('CLIP worker init timed out'));
    }, INIT_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      w.removeEventListener('message', onMessage);
      options.signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(options.signal?.reason ?? new Error('CLIP init aborted'));
    };

    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'ready') {
        cleanup();
        resolve();
        return;
      }
      if (message.type === 'progress') {
        options.onProgress?.({ stage: 'loading-model', percent: message.percent ?? 0 });
        return;
      }
      if (message.type === 'error' && message.id === undefined) {
        cleanup();
        reject(new Error(message.message ?? 'CLIP worker init failed'));
      }
    };

    if (options.signal?.aborted) {
      cleanup();
      reject(options.signal.reason);
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });

    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'init' });
  });

  readyPromise.catch(() => {
    readyPromise = null;
  });

  return readyPromise;
}

type EmbedRequest =
  | { kind: 'images'; payload: Blob[] }
  | { kind: 'text'; payload: string[] };

function runEmbed(request: EmbedRequest, options: EmbeddingsOptions = {}): Promise<Float32Array[]> {
  if (request.payload.length === 0) return Promise.resolve([]);

  return ensureReady(options).then(() => new Promise<Float32Array[]>((resolve, reject) => {
    const id = ++nextId;
    const w = getWorker();

    const cleanup = () => {
      w.removeEventListener('message', onMessage);
      options.signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(options.signal?.reason ?? new Error('CLIP embed aborted'));
    };

    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.id !== id) return;
      if (message.type === 'vectors') {
        cleanup();
        resolve(message.vectors as Float32Array[]);
        return;
      }
      if (message.type === 'error') {
        cleanup();
        reject(new Error(message.message ?? 'CLIP embed failed'));
      }
    };

    if (options.signal?.aborted) {
      cleanup();
      reject(options.signal.reason);
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });

    w.addEventListener('message', onMessage);
    if (request.kind === 'images') {
      w.postMessage({ type: 'embed-images', id, blobs: request.payload });
    } else {
      w.postMessage({ type: 'embed-text', id, texts: request.payload });
    }
  }));
}

/**
 * Natural-sentence templates for CLIP query expansion. CLIP was trained
 * on descriptive captions (`"a photo of a cat sitting on a windowsill"`),
 * not bare keywords, so a one-word query like `"fighting"` embeds into a
 * lonely corner of the joint space where random unrelated images can
 * score higher than they should (a vertical tower against "fighting"
 * scored 0.21 in one test run — classic short-query noise).
 *
 * Embedding the query through each template and averaging the resulting
 * vectors re-anchors it inside the distribution of sentences CLIP was
 * trained on, boosting real matches and suppressing noise. Standard
 * retrieval-quality trick; ~5–15 points of nDCG in the literature.
 */
const CLIP_QUERY_TEMPLATES = [
  (q: string) => `a photo of ${q}`,
  (q: string) => `a picture of ${q}`,
  (q: string) => `a scene showing ${q}`,
  (q: string) => q,
];

function averageAndNormalize(vectors: Float32Array[]): Float32Array {
  const dim = vectors[0]!.length;
  const out = new Float32Array(dim);
  for (const v of vectors) {
    for (let i = 0; i < dim; i += 1) out[i] += v[i]!;
  }
  let sum = 0;
  for (let i = 0; i < dim; i += 1) sum += out[i]! * out[i]!;
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < dim; i += 1) out[i] /= norm;
  return out;
}

export const clipProvider = {
  ensureReady,

  /**
   * Embed a batch of image blobs with the CLIP vision encoder. Returned
   * vectors live in the 512-dim joint space, so cosine similarity against
   * text-encoder outputs is meaningful.
   */
  embedImages(blobs: Blob[], options?: EmbeddingsOptions): Promise<Float32Array[]> {
    return runEmbed({ kind: 'images', payload: blobs }, options);
  },

  /**
   * Embed text with the CLIP text encoder so results can be compared to
   * stored image embeddings. This is the low-level path — call it when
   * you're indexing canonical text (e.g. captions). For user search
   * queries use {@link embedQueryForImages} instead; it averages a few
   * natural-language templates to counter CLIP's well-known short-query
   * noise.
   */
  embedTextForImages(texts: string[], options?: EmbeddingsOptions): Promise<Float32Array[]> {
    return runEmbed({ kind: 'text', payload: texts }, options);
  },

  /**
   * Embed a single user query by ensembling across {@link CLIP_QUERY_TEMPLATES}.
   * Returns one 512-dim vector — the L2-normalized mean of the
   * per-template embeddings — suitable for cosine-similarity ranking
   * against stored image embeddings.
   */
  async embedQueryForImages(query: string, options?: EmbeddingsOptions): Promise<Float32Array | null> {
    const trimmed = query.trim();
    if (!trimmed) return null;
    const templates = CLIP_QUERY_TEMPLATES.map((t) => t(trimmed));
    const vectors = await runEmbed({ kind: 'text', payload: templates }, options);
    if (vectors.length === 0) return null;
    return averageAndNormalize(vectors);
  },

  dispose(): void {
    if (!worker) return;
    worker.postMessage({ type: 'dispose' });
    worker.terminate();
    worker = null;
    readyPromise = null;
  },
};
