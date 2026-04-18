import ClipWorker from './clip-worker.ts?worker';

export function createClipWorker(): Worker {
  return new ClipWorker();
}
