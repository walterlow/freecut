/**
 * Single entry point for "this media's captions are about to change —
 * drop every cached thumbnail resource tied to it." Called by
 * Analyze-with-AI (and any future re-caption flow) before the pipeline
 * deletes old thumbs and writes new ones.
 *
 * Combines the blob URL cache (the hook that hands JPEG URLs to <img/>
 * rows) and the lazy-thumb probe/generation cache (the queue that fills
 * in pointers for pre-feature captions) in one call so callers don't
 * have to know about the internal split.
 */

import { invalidateMediaCaptionThumbBlobs } from '../hooks/use-caption-thumbnail';
import { invalidateEmbeddingsCache } from './embeddings-cache';
import { invalidateLazyThumbCache } from './lazy-thumb';
import { useMediaLibraryStore } from '../deps/media-library';

export function invalidateMediaCaptionThumbnails(mediaId: string): void {
  const thumbRelPaths = useMediaLibraryStore.getState().mediaById[mediaId]?.aiCaptions?.map(
    (caption) => caption.thumbRelPath,
  ) ?? [];
  invalidateMediaCaptionThumbBlobs(mediaId, thumbRelPaths);
  invalidateLazyThumbCache(mediaId);
  // Semantic embeddings are tied 1:1 to caption indexes — a re-analyze
  // throws away the old caption array and generates a fresh one, so the
  // cached vectors no longer correspond to their (new) scenes.
  invalidateEmbeddingsCache(mediaId);
}
