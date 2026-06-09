interface AbortableWorkerMessageListenerOptions {
  worker: Worker
  signal?: AbortSignal
  onAbort: () => void
  onMessage: (event: MessageEvent) => void
}

export function addAbortableWorkerMessageListener({
  worker,
  signal,
  onAbort,
  onMessage,
}: AbortableWorkerMessageListenerOptions): (() => void) | null {
  if (signal?.aborted) {
    onAbort()
    return null
  }

  signal?.addEventListener('abort', onAbort, { once: true })
  worker.addEventListener('message', onMessage)

  return () => {
    worker.removeEventListener('message', onMessage)
    signal?.removeEventListener('abort', onAbort)
  }
}
