/**
 * Factory for the LFM scene verification worker.
 *
 * Uses Vite's explicit worker import so the worker entry is emitted with the
 * correct module URL and MIME type in both dev and production.
 */
import LfmSceneWorker from './lfm-scene-worker.ts?worker'

export function createLfmSceneWorker(): Worker {
  return new LfmSceneWorker()
}
