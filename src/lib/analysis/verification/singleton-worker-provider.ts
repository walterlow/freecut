import type { SceneVerificationProvider } from './types'

interface CreateSingletonSceneVerificationProviderOptions<TId extends string> {
  id: TId
  label: string
  createWorker: () => Worker
}

export function createSingletonSceneVerificationProvider<TId extends string>({
  id,
  label,
  createWorker,
}: CreateSingletonSceneVerificationProviderOptions<TId>): SceneVerificationProvider & { id: TId } {
  let worker: Worker | null = null

  const resetWorker = () => {
    if (!worker) return
    worker.terminate()
    worker = null
  }

  return {
    id,
    label,
    getWorker() {
      if (!worker) {
        worker = createWorker()
      }
      return worker
    },
    resetWorker,
    disposeWorker() {
      if (!worker) return
      worker.postMessage({ type: 'dispose' })
      const currentWorker = worker
      worker = null
      setTimeout(() => currentWorker.terminate(), 500)
    },
  }
}
