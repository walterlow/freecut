/**
 * Lazy thumbnail generator for captions that were created before the
 * Scene Browser feature landed (`thumbRelPath` missing). Opens the source
 * media, seeks to the caption timestamp, captures a JPEG, and persists it
 * alongside the rest of that media's caption thumbs so the Scene Browser
 * can pick it up on subsequent reads.
 *
 * Work is queued globally so we never spin up more than one HTMLVideoElement
 * at a time — 161-caption libraries can otherwise exhaust memory on long
 * clips. Images are handled via `fetch` + `createImageBitmap` (same as the
 * LFM provider's image path).
 */

import { createLogger } from '@/shared/logging/logger';
import { mediaLibraryService, useMediaLibraryStore, type MediaMetadata } from '../deps/media-library';
import { probeCaptionThumbnail, saveCaptionThumbnail } from '../deps/storage';

const log = createLogger('SceneBrowser:LazyThumb');

const PERSIST_DEBOUNCE_MS = 1500;
const pendingPersists = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Rewrite `captions.json` + the metadata mirror for `mediaId` with the
 * current in-memory captions array. Coalesces rapid fire-and-forget
 * updates from a stream of thumbnail writes into a single disk write per
 * ~{@link PERSIST_DEBOUNCE_MS}ms window — 161 captions that each land a
 * thumb in quick succession otherwise trigger 161 JSON rewrites.
 */
function schedulePersist(mediaId: string): void {
  const existing = pendingPersists.get(mediaId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingPersists.delete(mediaId);
    const latest = useMediaLibraryStore.getState().mediaById[mediaId];
    if (!latest?.aiCaptions) return;
    void mediaLibraryService
      .updateMediaCaptions(mediaId, latest.aiCaptions)
      .catch((error) => {
        log.warn('Persisting caption thumb pointers failed', { mediaId, error });
      });
  }, PERSIST_DEBOUNCE_MS);
  pendingPersists.set(mediaId, timer);
}

const MAX_DIM = 512;
const SEEK_TIMEOUT_MS = 8_000;

interface PendingRequest {
  mediaId: string;
  captionIndex: number;
  timeSec: number;
  resolve: (relPath: string | null) => void;
}

const queue: PendingRequest[] = [];
let running = false;
const resultCache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

function cacheKey(mediaId: string, captionIndex: number): string {
  return `${mediaId}:${captionIndex}`;
}

/**
 * Drop the memoized probe + generation results for every caption of
 * `mediaId` so a re-analyzed media starts from a clean slate. Queued
 * requests that haven't started yet are dropped; in-flight generations
 * are left to finish and are discarded at the write site via the
 * `taggingMediaIds` gate below.
 */
export function invalidateLazyThumbCache(mediaId: string): void {
  const prefix = `${mediaId}:`;
  for (const key of resultCache.keys()) {
    if (key.startsWith(prefix)) resultCache.delete(key);
  }
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    const request = queue[i]!;
    if (request.mediaId === mediaId) {
      request.resolve(null);
      queue.splice(i, 1);
    }
  }
  const pendingPersist = pendingPersists.get(mediaId);
  if (pendingPersist) {
    clearTimeout(pendingPersist);
    pendingPersists.delete(mediaId);
  }
}

async function seekVideoTo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Seek timed out at ${timeSec}s`));
    }, SEEK_TIMEOUT_MS);
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Video seek failed'));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = Math.max(0, timeSec);
  });
}

async function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 360;
  const scale = Math.min(MAX_DIM / Math.max(vw, vh), 1);
  const width = Math.max(1, Math.round(vw * scale));
  const height = Math.max(1, Math.round(vh * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('OffscreenCanvas 2d context unavailable');
  context.drawImage(video, 0, 0, width, height);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
}

async function captureImage(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(MAX_DIM / Math.max(bitmap.width, bitmap.height), 1);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('OffscreenCanvas 2d context unavailable');
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
  } finally {
    bitmap.close();
  }
}

/**
 * Patch the in-memory media item so subsequent renders see the new path,
 * then schedule a debounced write-back so the pointer survives reloads.
 */
function patchStoreThumbPath(mediaId: string, captionIndex: number, relPath: string): void {
  const store = useMediaLibraryStore.getState();
  const media = store.mediaById[mediaId];
  if (!media || !media.aiCaptions) return;
  const existing = media.aiCaptions[captionIndex];
  if (!existing || existing.thumbRelPath === relPath) return;
  const updated: NonNullable<MediaMetadata['aiCaptions']> = media.aiCaptions.map((caption, i) =>
    i === captionIndex ? { ...caption, thumbRelPath: relPath } : caption,
  );
  store.updateMediaCaptions(mediaId, updated);
  schedulePersist(mediaId);
}

async function generateOne(request: PendingRequest): Promise<string | null> {
  const { mediaId, captionIndex, timeSec } = request;
  const state = useMediaLibraryStore.getState();
  const media = state.mediaById[mediaId];
  if (!media) return null;
  // A concurrent Analyze-with-AI run owns this media's thumbs for the
  // duration of its sweep — skip lazy work so we don't race the main
  // pipeline and clobber a fresh thumbnail with a stale one.
  if (state.taggingMediaIds.has(mediaId)) return null;

  const isImage = media.mimeType.startsWith('image/');
  const blobUrl = await mediaLibraryService.getMediaBlobUrl(mediaId);
  if (!blobUrl) return null;

  try {
    let jpeg: Blob;
    if (isImage) {
      const response = await fetch(blobUrl);
      const sourceBlob = await response.blob();
      jpeg = await captureImage(sourceBlob);
    } else {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'auto';
      video.crossOrigin = 'anonymous';
      video.src = blobUrl;
      try {
        await new Promise<void>((resolve, reject) => {
          const onLoad = () => { cleanup(); resolve(); };
          const onError = () => { cleanup(); reject(new Error('Video load failed')); };
          const cleanup = () => {
            video.removeEventListener('loadedmetadata', onLoad);
            video.removeEventListener('error', onError);
          };
          video.addEventListener('loadedmetadata', onLoad, { once: true });
          video.addEventListener('error', onError, { once: true });
        });
        await seekVideoTo(video, timeSec);
        jpeg = await captureFrame(video);
      } finally {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    }

    // Re-check the tagging gate before writing — Analyze-with-AI may have
    // started between our initial check and the slow seek + capture above.
    if (useMediaLibraryStore.getState().taggingMediaIds.has(mediaId)) {
      return null;
    }
    const relPath = await saveCaptionThumbnail(mediaId, captionIndex, jpeg);
    patchStoreThumbPath(mediaId, captionIndex, relPath);
    return relPath;
  } catch (error) {
    log.warn('Lazy thumbnail generation failed', { mediaId, captionIndex, timeSec, error });
    return null;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const request = queue.shift()!;
      const key = cacheKey(request.mediaId, request.captionIndex);
      const relPath = await generateOne(request);
      resultCache.set(key, relPath);
      request.resolve(relPath);
    }
  } finally {
    running = false;
  }
}

/**
 * Request a thumbnail for a caption that has no persisted `thumbRelPath`.
 * Returns the rel path of either the freshly-saved or already-on-disk thumb,
 * or `null` when generation fails. Concurrent callers for the same
 * (mediaId, captionIndex) share one job.
 *
 * The disk probe runs outside the generation queue so all scenes can probe
 * in parallel on reload — only probe misses pay the price of the serial
 * video-seek generation pipeline.
 */
export function requestLazyCaptionThumbnail(
  mediaId: string,
  captionIndex: number,
  timeSec: number,
): Promise<string | null> {
  const key = cacheKey(mediaId, captionIndex);
  const cached = resultCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    const existing = await probeCaptionThumbnail(mediaId, captionIndex);
    if (existing) {
      patchStoreThumbPath(mediaId, captionIndex, existing);
      resultCache.set(key, existing);
      return existing;
    }
    const generated = await new Promise<string | null>((resolve) => {
      queue.push({ mediaId, captionIndex, timeSec, resolve });
      void drain();
    });
    resultCache.set(key, generated);
    return generated;
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}
