/**
 * Orchestrates retroactive semantic indexing when the user switches into
 * semantic mode. Hydrates embeddings for media that already have them on
 * disk; runs the embedding model for media that don't.
 *
 * Exposes progress so the panel can surface a banner ("Indexing 3/12
 * clips…") while work is in flight. Designed to be safe to mount many
 * times — the underlying cache + promise maps deduplicate real work.
 */

import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@/shared/logging/logger'
import { useMediaLibraryStore } from '../deps/media-library'
import { useSettingsStore } from '../deps/settings'
import {
  ensureEmbeddingsLoaded,
  indexMediaCaptions,
  indexMediaImageCaptions,
  isMediaMissingEmbeddings,
  isMediaMissingImageEmbeddings,
} from '../utils/embeddings-cache'

const log = createLogger('SceneBrowser:SemanticIndex')

export interface SemanticIndexProgress {
  /** Running indexer is generating fresh embeddings (slow path). */
  indexing: number
  /** Total clips that need indexing in the current pass. */
  indexTotal: number
  /** Model is downloading — blocks even the hydration path. */
  loadingModel: boolean
  /** A clip just finished indexing — used by the banner for a pulse. */
  lastCompletedAt: number
}

const INITIAL_PROGRESS: SemanticIndexProgress = {
  indexing: 0,
  indexTotal: 0,
  loadingModel: false,
  lastCompletedAt: 0,
}

export function useSemanticIndex(): SemanticIndexProgress {
  const mode = useSettingsStore((s) => s.captionSearchMode)
  const mediaItems = useMediaLibraryStore((s) => s.mediaItems)
  const taggingMediaIds = useMediaLibraryStore((s) => s.taggingMediaIds)
  const [progress, setProgress] = useState<SemanticIndexProgress>(INITIAL_PROGRESS)
  const runIdRef = useRef(0)

  useEffect(() => {
    if (mode !== 'semantic') {
      setProgress(INITIAL_PROGRESS)
      return
    }

    const runId = ++runIdRef.current

    const candidates = mediaItems.filter(
      (media) => (media.aiCaptions?.length ?? 0) > 0 && !taggingMediaIds.has(media.id),
    )
    if (candidates.length === 0) {
      setProgress(INITIAL_PROGRESS)
      return
    }

    let cancelled = false

    void (async () => {
      // Phase 1: hydrate everything that already has on-disk embeddings.
      // Parallel because the bulk of the work is just reading a small bin.
      await Promise.all(candidates.map((media) => ensureEmbeddingsLoaded(media.id)))
      if (cancelled || runId !== runIdRef.current) return

      // Phase 2: fill in text embeddings that are missing (fast path on
      // already-downloaded all-MiniLM model, ~20ms per caption).
      const needsTextIndex = candidates.filter((media) => isMediaMissingEmbeddings(media.id))
      const needsImageIndex = candidates.filter((media) => isMediaMissingImageEmbeddings(media.id))
      const totalToIndex = needsTextIndex.length + needsImageIndex.length
      if (totalToIndex === 0) {
        setProgress(INITIAL_PROGRESS)
        return
      }

      setProgress({
        indexing: 0,
        indexTotal: totalToIndex,
        loadingModel: true,
        lastCompletedAt: 0,
      })

      let done = 0
      const advance = () => {
        done += 1
        setProgress({
          indexing: done,
          indexTotal: totalToIndex,
          loadingModel: false,
          lastCompletedAt: Date.now(),
        })
      }

      for (const media of needsTextIndex) {
        if (cancelled || runId !== runIdRef.current) return
        try {
          await indexMediaCaptions(media.id)
        } catch (error) {
          log.warn('Retroactive text embedding failed', {
            mediaId: media.id,
            fileName: media.fileName,
            error,
          })
        }
        advance()
      }

      // Phase 3: image indexing. This is the expensive side — CLIP is
      // ~90 MB to download and ~50 ms per image, so do it strictly after
      // text indexing so at least keyword → text semantic is immediately
      // usable while visual search warms up.
      for (const media of needsImageIndex) {
        if (cancelled || runId !== runIdRef.current) return
        try {
          await indexMediaImageCaptions(media.id)
        } catch (error) {
          log.warn('Retroactive image embedding failed', {
            mediaId: media.id,
            fileName: media.fileName,
            error,
          })
        }
        advance()
      }

      if (!cancelled && runId === runIdRef.current) {
        setProgress(INITIAL_PROGRESS)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [mode, mediaItems, taggingMediaIds])

  return progress
}
