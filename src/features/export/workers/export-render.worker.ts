import { renderAudioOnly, renderComposition } from '../utils/canvas-render-orchestrator'
import { isGifUrl, isWebpUrl } from '@/shared/utils/media-utils'
import { createLogger } from '@/shared/logging/logger'
import type { ImageItem } from '@/types/timeline'
import type { RenderProgress } from '../utils/client-renderer'
import type {
  ExportRenderWorkerRequest,
  ExportRenderWorkerResponse,
} from './export-render-worker.types'

// Some third-party browser libs assume `window` exists.
// In dedicated workers, alias it to `globalThis` to avoid runtime crashes.
type WorkerGlobalWithWindow = typeof globalThis & { window?: unknown }
const workerGlobal = globalThis as WorkerGlobalWithWindow
if (typeof workerGlobal.window === 'undefined') {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: globalThis,
  })
}

const log = createLogger('ExportRenderWorker')

// Capture floating rejections / uncaught errors with their stack. Bare
// mediabunny asserts surface only "Assertion failed"; without the stack the
// failing call site is invisible, so log it explicitly here.
self.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  log.error('Export worker unhandled rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  })
})
self.addEventListener('error', (event) => {
  log.error('Export worker uncaught error', {
    error: event.message,
    stack: event.error instanceof Error ? event.error.stack : undefined,
    filename: event.filename,
    lineno: event.lineno,
  })
})

const activeRequests = new Map<string, AbortController>()

function compositionHasAnimatedImage(
  tracks: Array<{ items: Array<{ type: string; src?: string; label?: string }> }>,
): boolean {
  for (const track of tracks) {
    for (const item of track.items ?? []) {
      if (item.type !== 'image') continue
      const imageItem = item as ImageItem
      const label = (imageItem.label ?? '').toLowerCase()
      if (
        isGifUrl(imageItem.src) ||
        label.endsWith('.gif') ||
        isWebpUrl(imageItem.src) ||
        label.endsWith('.webp')
      ) {
        return true
      }
    }
  }
  return false
}

function compositionHasAudio(
  tracks: Array<{ items: Array<{ type: string; muted?: boolean }> }>,
): boolean {
  for (const track of tracks) {
    for (const item of track.items ?? []) {
      if (item.type === 'audio' && item.muted !== true) {
        return true
      }
      if (item.type === 'video' && item.muted !== true) {
        return true
      }
    }
  }
  return false
}

self.onmessage = async (event: MessageEvent<ExportRenderWorkerRequest>) => {
  const message = event.data

  if (message.type === 'cancel') {
    const controller = activeRequests.get(message.requestId)
    if (controller) {
      controller.abort()
    }
    return
  }

  if (message.type !== 'start') {
    return
  }

  const { requestId, settings, composition } = message
  const controller = new AbortController()
  activeRequests.set(requestId, controller)

  try {
    const tracks = composition.tracks ?? []

    if (settings.mode === 'video' && compositionHasAnimatedImage(composition.tracks ?? [])) {
      throw new Error('WORKER_REQUIRES_MAIN_THREAD:animated-image')
    }
    if (compositionHasAudio(tracks) && typeof OfflineAudioContext === 'undefined') {
      throw new Error('WORKER_REQUIRES_MAIN_THREAD:audio-context')
    }

    const onProgress = (progress: RenderProgress) => {
      const response: ExportRenderWorkerResponse = {
        type: 'progress',
        requestId,
        progress,
      }
      self.postMessage(response)
    }

    const result =
      settings.mode === 'audio'
        ? await renderAudioOnly({
            settings,
            composition,
            onProgress,
            signal: controller.signal,
          })
        : await renderComposition({
            settings,
            composition,
            onProgress,
            signal: controller.signal,
          })

    const complete: ExportRenderWorkerResponse = {
      type: 'complete',
      requestId,
      result,
    }
    self.postMessage(complete)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      const cancelled: ExportRenderWorkerResponse = {
        type: 'cancelled',
        requestId,
      }
      self.postMessage(cancelled)
      return
    }

    const messageText = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    // Surface the stack: bare mediabunny asserts report only "Assertion failed",
    // so without the stack the failing call site is invisible on the main thread.
    log.error('Export worker failed', { requestId, error: messageText, stack })
    const failure: ExportRenderWorkerResponse = {
      type: 'error',
      requestId,
      error: messageText,
    }
    self.postMessage(failure)
  } finally {
    activeRequests.delete(requestId)
  }
}

export {}
