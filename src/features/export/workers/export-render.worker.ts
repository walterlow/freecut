import { renderAudioOnly, renderComposition } from '../utils/client-render-engine';
import { isGifUrl, isWebpUrl } from '@/utils/media-utils';
import { createLogger } from '@/lib/logger';
import type { ImageItem } from '@/types/timeline';
import type { RenderProgress } from '../utils/client-renderer';
import type {
  ExportRenderWorkerRequest,
  ExportRenderWorkerResponse,
} from './export-render-worker.types';

// Some third-party browser libs assume `window` exists.
// In dedicated workers, alias it to `globalThis` to avoid runtime crashes.
const workerGlobal = globalThis as any;
if (typeof workerGlobal.window === 'undefined') {
  workerGlobal.window = workerGlobal;
}

const log = createLogger('ExportRenderWorker');

const activeRequests = new Map<string, AbortController>();

function compositionHasAnimatedImage(
  tracks: Array<{ items: Array<{ type: string; src?: string; label?: string }> }>
): boolean {
  for (const track of tracks) {
    for (const item of track.items ?? []) {
      if (item.type !== 'image') continue;
      const imageItem = item as ImageItem;
      const label = (imageItem.label ?? '').toLowerCase();
      if (isGifUrl(imageItem.src) || label.endsWith('.gif') ||
          isWebpUrl(imageItem.src) || label.endsWith('.webp')) {
        return true;
      }
    }
  }
  return false;
}

function compositionHasAudio(
  tracks: Array<{ items: Array<{ type: string; muted?: boolean }> }>
): boolean {
  for (const track of tracks) {
    for (const item of track.items ?? []) {
      if (item.type === 'audio' && item.muted !== true) {
        return true;
      }
      if (item.type === 'video' && item.muted !== true) {
        return true;
      }
    }
  }
  return false;
}

self.onmessage = async (event: MessageEvent<ExportRenderWorkerRequest>) => {
  const message = event.data;

  if (message.type === 'cancel') {
    const controller = activeRequests.get(message.requestId);
    if (controller) {
      controller.abort();
    }
    return;
  }

  if (message.type !== 'start') {
    return;
  }

  const { requestId, settings, composition } = message;
  const controller = new AbortController();
  activeRequests.set(requestId, controller);

  try {
    const tracks = composition.tracks ?? [];

    if (settings.mode === 'video' && compositionHasAnimatedImage(composition.tracks ?? [])) {
      throw new Error('WORKER_REQUIRES_MAIN_THREAD:animated-image');
    }
    if (compositionHasAudio(tracks) && typeof OfflineAudioContext === 'undefined') {
      throw new Error('WORKER_REQUIRES_MAIN_THREAD:audio-context');
    }

    const onProgress = (progress: RenderProgress) => {
      const response: ExportRenderWorkerResponse = {
        type: 'progress',
        requestId,
        progress,
      };
      self.postMessage(response);
    };

    const result = settings.mode === 'audio'
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
      });

    const complete: ExportRenderWorkerResponse = {
      type: 'complete',
      requestId,
      result,
    };
    self.postMessage(complete);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      const cancelled: ExportRenderWorkerResponse = {
        type: 'cancelled',
        requestId,
      };
      self.postMessage(cancelled);
      return;
    }

    const messageText = error instanceof Error ? error.message : String(error);
    log.error('Export worker failed', { requestId, error: messageText });
    const failure: ExportRenderWorkerResponse = {
      type: 'error',
      requestId,
      error: messageText,
    };
    self.postMessage(failure);
  } finally {
    activeRequests.delete(requestId);
  }
};

export {};
