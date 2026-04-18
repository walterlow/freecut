import { useEffect, useRef, useState } from 'react';
import { getCaptionThumbnailBlob } from '../deps/storage';
import { requestLazyCaptionThumbnail } from '../utils/lazy-thumb';

/**
 * Module-scoped blob URL cache keyed by `thumbRelPath`. Scene Browser rows
 * are virtualized / remount frequently, so loading the same JPEG for every
 * mount would thrash the workspace-fs read path. Entries are evicted by
 * {@link invalidateMediaCaptionThumbBlobs} when the source media is
 * re-analyzed — without that, a blob URL keeps pointing at the pre-reanalyze
 * JPEG content even after the on-disk file changes.
 */
const blobUrlCache = new Map<string, string>();
const pendingLoads = new Map<string, Promise<string | null>>();

/**
 * Revoke and drop every blob URL that lives under a media's
 * captions-thumbs directory. Callers should invoke this before a
 * re-analysis run so the next render loads the freshly-written JPEG
 * instead of the cached pre-overwrite blob.
 */
export function invalidateMediaCaptionThumbBlobs(mediaId: string): void {
  const prefix = `media/${mediaId}/cache/ai/captions-thumbs/`;
  for (const [key, url] of blobUrlCache) {
    if (key.startsWith(prefix)) {
      URL.revokeObjectURL(url);
      blobUrlCache.delete(key);
    }
  }
  for (const key of pendingLoads.keys()) {
    if (key.startsWith(prefix)) pendingLoads.delete(key);
  }
}

async function loadBlobUrl(relPath: string): Promise<string | null> {
  const cached = blobUrlCache.get(relPath);
  if (cached) return cached;
  const pending = pendingLoads.get(relPath);
  if (pending) return pending;

  const promise = (async () => {
    const blob = await getCaptionThumbnailBlob(relPath);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    blobUrlCache.set(relPath, url);
    return url;
  })();
  pendingLoads.set(relPath, promise);
  try {
    return await promise;
  } finally {
    pendingLoads.delete(relPath);
  }
}

interface LazyRequest {
  mediaId: string;
  captionIndex: number;
  timeSec: number;
}

/**
 * Resolve a caption thumbnail `thumbRelPath` to a blob URL. When the
 * persisted path is missing and a `lazy` descriptor is supplied, the
 * generator is queued to seek the source media, capture a JPEG, persist
 * it, and hand the resulting path back to this hook on a subsequent
 * render (via the store patch inside `lazy-thumb.ts`).
 */
export function useCaptionThumbnail(
  thumbRelPath: string | undefined,
  lazy?: LazyRequest,
): string | null {
  const [url, setUrl] = useState<string | null>(() => (
    thumbRelPath ? blobUrlCache.get(thumbRelPath) ?? null : null
  ));
  const latestPath = useRef(thumbRelPath);
  latestPath.current = thumbRelPath;

  useEffect(() => {
    if (thumbRelPath) {
      const cached = blobUrlCache.get(thumbRelPath);
      if (cached) {
        setUrl(cached);
        return;
      }
      setUrl(null);
      void loadBlobUrl(thumbRelPath).then((loaded) => {
        if (latestPath.current === thumbRelPath) {
          setUrl(loaded);
        }
      });
      return;
    }

    // No persisted thumbnail — lazy-generate if we know how.
    setUrl(null);
    if (!lazy) return;
    let cancelled = false;
    void requestLazyCaptionThumbnail(lazy.mediaId, lazy.captionIndex, lazy.timeSec)
      .then((relPath) => {
        if (cancelled || !relPath) return;
        void loadBlobUrl(relPath).then((loaded) => {
          if (!cancelled && latestPath.current === undefined) {
            setUrl(loaded);
          }
        });
      });
    return () => { cancelled = true; };
  }, [thumbRelPath, lazy?.mediaId, lazy?.captionIndex, lazy?.timeSec]);

  return url;
}
