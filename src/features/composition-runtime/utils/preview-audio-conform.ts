import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager';
import { getMedia, updateMedia } from '@/infrastructure/storage';
import { opfsService } from '@/features/composition-runtime/deps/media-library';
import { createLogger } from '@/shared/logging/logger';
import type { MediaMetadata } from '@/types/storage';
import {
  mirrorBytesToWorkspace,
  readWorkspaceBlob,
  removeWorkspaceCacheEntry,
} from '@/infrastructure/storage/workspace-fs/cache-mirror';
import { audioBufferToWavBlob } from './audio-buffer-wav';

const log = createLogger('PreviewAudioConform');

const PREVIEW_AUDIO_CONFORM_DIR = 'preview-audio';
const PREVIEW_AUDIO_CONFORM_MIME_TYPE = 'audio/wav';

const pendingPreviewAudioConformLoads = new Map<string, Promise<string | null>>();
const pendingPreviewAudioConformPersists = new Map<string, Promise<void>>();

function buildPreviewAudioConformOpfsPath(mediaId: string): string {
  const shard1 = mediaId.slice(0, 2) || '00';
  const shard2 = mediaId.slice(2, 4) || '00';
  return `${PREVIEW_AUDIO_CONFORM_DIR}/${shard1}/${shard2}/${mediaId}.wav`;
}

export function getPreviewAudioConformCacheKey(mediaId: string): string {
  return `preview-audio:${mediaId}`;
}

export function getCachedPreviewAudioConformUrl(mediaId: string): string | null {
  return blobUrlManager.get(getPreviewAudioConformCacheKey(mediaId));
}

export async function resolvePreviewAudioConformUrl(mediaId: string): Promise<string | null> {
  const cacheKey = getPreviewAudioConformCacheKey(mediaId);
  const cached = blobUrlManager.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = pendingPreviewAudioConformLoads.get(mediaId);
  if (pending) {
    return pending;
  }

  const promise = (async () => {
    try {
      const media = await getMedia(mediaId);
      if (!media?.previewAudioOpfsPath) {
        return null;
      }
      const opfsPath = media.previewAudioOpfsPath;
      const mimeType = media.previewAudioMimeType || PREVIEW_AUDIO_CONFORM_MIME_TYPE;

      let bytes: ArrayBuffer | null = null;
      try {
        bytes = await opfsService.getFile(opfsPath);
      } catch {
        // Fall through to workspace fallback below.
      }

      if (!bytes) {
        // Cross-origin fallback: try to hydrate from the workspace folder.
        const wsBlob = await readWorkspaceBlob(opfsPath.split('/'));
        if (!wsBlob) return null;
        const wsBytes = await wsBlob.arrayBuffer();
        try {
          await opfsService.saveFile(opfsPath, wsBytes);
        } catch (err) {
          log.warn('Failed to back-fill OPFS from workspace', { mediaId, err });
        }
        bytes = wsBytes;
      }

      return blobUrlManager.acquire(
        cacheKey,
        new Blob([bytes], { type: mimeType }),
      );
    } catch (err) {
      log.warn('Failed to resolve preview audio conform asset', { mediaId, err });
      return null;
    } finally {
      pendingPreviewAudioConformLoads.delete(mediaId);
    }
  })();

  pendingPreviewAudioConformLoads.set(mediaId, promise);
  return promise;
}

export async function persistPreviewAudioConform(
  mediaId: string,
  buffer: AudioBuffer,
): Promise<void> {
  const pending = pendingPreviewAudioConformPersists.get(mediaId);
  if (pending) {
    return pending;
  }

  const promise = (async () => {
    const media = await getMedia(mediaId);
    if (!media) {
      return;
    }

    const cacheKey = getPreviewAudioConformCacheKey(mediaId);
    let wavBlob: Blob | null = null;

    if (!blobUrlManager.get(cacheKey)) {
      wavBlob = audioBufferToWavBlob(buffer);
      blobUrlManager.acquire(cacheKey, wavBlob);
    }

    if (media.previewAudioOpfsPath) {
      if (media.previewAudioMimeType !== PREVIEW_AUDIO_CONFORM_MIME_TYPE) {
        await updateMedia(mediaId, {
          previewAudioMimeType: PREVIEW_AUDIO_CONFORM_MIME_TYPE,
          previewAudioConformedAt: media.previewAudioConformedAt ?? Date.now(),
        });
      }
      return;
    }

    const nextBlob = wavBlob ?? audioBufferToWavBlob(buffer);
    const opfsPath = buildPreviewAudioConformOpfsPath(mediaId);
    const bytes = await nextBlob.arrayBuffer();
    await opfsService.saveFile(opfsPath, bytes);

    try {
      await updateMedia(mediaId, {
        previewAudioOpfsPath: opfsPath,
        previewAudioMimeType: PREVIEW_AUDIO_CONFORM_MIME_TYPE,
        previewAudioConformedAt: Date.now(),
      });
    } catch (err) {
      await opfsService.deleteFile(opfsPath).catch(() => undefined);
      throw err;
    }

    // Mirror to the workspace folder so other origins can reuse the
    // conformed WAV without re-running the decode/encode. Fire-and-forget.
    void mirrorBytesToWorkspace(opfsPath.split('/'), bytes);
  })()
    .catch((err) => {
      log.warn('Failed to persist preview audio conform asset', { mediaId, err });
    })
    .finally(() => {
      pendingPreviewAudioConformPersists.delete(mediaId);
    });

  pendingPreviewAudioConformPersists.set(mediaId, promise);
  return promise;
}

export async function deletePreviewAudioConform(
  mediaOrId: MediaMetadata | string,
  options?: { clearMetadata?: boolean },
): Promise<void> {
  const mediaId = typeof mediaOrId === 'string' ? mediaOrId : mediaOrId.id;
  const media = typeof mediaOrId === 'string' ? await getMedia(mediaOrId) : mediaOrId;

  pendingPreviewAudioConformLoads.delete(mediaId);
  pendingPreviewAudioConformPersists.delete(mediaId);
  blobUrlManager.invalidate(getPreviewAudioConformCacheKey(mediaId));

  if (!media) {
    return;
  }

  if (media.previewAudioOpfsPath) {
    try {
      await opfsService.deleteFile(media.previewAudioOpfsPath);
    } catch (err) {
      log.warn('Failed to delete preview audio conform asset', {
        mediaId,
        path: media.previewAudioOpfsPath,
        err,
      });
    }
    void removeWorkspaceCacheEntry(media.previewAudioOpfsPath.split('/'));
  }

  if (options?.clearMetadata) {
    try {
      await updateMedia(mediaId, {
        previewAudioOpfsPath: undefined,
        previewAudioMimeType: undefined,
        previewAudioConformedAt: undefined,
      });
    } catch (err) {
      log.warn('Failed to clear preview audio conform metadata', { mediaId, err });
    }
  }
}
