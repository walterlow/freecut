/**
 * Vite-aware factory for the sentence-embeddings worker.
 * Matches the pattern used by `create-lfm-worker.ts`.
 */
import EmbeddingsWorker from './embeddings-worker.ts?worker';

export function createEmbeddingsWorker(): Worker {
  return new EmbeddingsWorker();
}
