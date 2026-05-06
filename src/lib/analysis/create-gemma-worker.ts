/**
 * Factory for the Gemma scene verification worker.
 *
 * Uses Vite's explicit worker import so the worker entry is emitted with the
 * correct module URL and MIME type in both dev and production.
 */
import GemmaSceneWorker from './gemma-scene-worker.ts?worker'

export function createGemmaSceneWorker(): Worker {
  return new GemmaSceneWorker()
}
