/**
 * Runs the "Analyze with AI" pipeline for a single media item — captions,
 * dominant-color palette, text embeddings, and CLIP image embeddings — so
 * both the media card's per-item menu and the scene browser's "analyze all"
 * action hit the exact same path.
 *
 * Extracted from `media-card.tsx` so there's one authoritative flow for
 * wiping stale thumbs/embeddings, running the captioner, indexing, and
 * persisting to the workspace. The call site does nothing but drive UI.
 */

import type { MediaMetadata } from '@/types/storage'
import {
  captionVideo,
  captionImage,
  type MediaCaption,
  embeddingsProvider,
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_DIM,
  clipProvider,
  CLIP_MODEL_ID,
  CLIP_EMBEDDING_DIM,
  buildEmbeddingText,
  extractDominantColors,
} from '../deps/analysis'
import { useSettingsStore, resolveCaptioningIntervalSec } from '../deps/settings-contract'
import {
  saveCaptionThumbnail,
  deleteCaptionThumbnails,
  deleteCaptionEmbeddings,
  saveCaptionEmbeddings,
  saveCaptionImageEmbeddings,
  getTranscript,
  getCaptionsByContentHash,
  adoptCaptionsFromCache,
} from '@/infrastructure/storage'
import { computeContentHashFromBuffer } from '../utils/content-hash'
import { updateMedia as updateMediaDB } from '@/infrastructure/storage'
import { invalidateMediaCaptionThumbnails } from '../deps/scene-browser'
import { useMediaLibraryStore } from '../stores/media-library-store'
import { mediaLibraryService } from './media-library-service'
import { getMediaType } from '../utils/validation'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('MediaAnalysisService')

export interface AnalyzeBatchResult {
  analyzed: number
  skipped: number
  failed: number
}

export interface AnalyzeBatchOptions {
  /** When true, only analyze media that has no captions yet. Default: false (re-analyze everything). */
  onlyMissing?: boolean
  /** Optional filter for which media to consider (e.g. a single scope id). */
  mediaIds?: readonly string[]
}

class MediaAnalysisService {
  private batchInFlight = false

  /**
   * Analyze a single media item end-to-end. Accepts either a mediaId (resolved
   * from the library store) or the full `MediaMetadata` when the caller
   * already has it. Returns true on success, false on failure — notifications
   * are surfaced via the media-library store either way.
   *
   * When called standalone (not from `analyzeBatch`), wraps itself as a
   * 1-item run so the background progress bar shows a concrete 0→100%
   * instead of a pulsing indeterminate bar.
   */
  async analyzeMedia(mediaOrId: string | MediaMetadata): Promise<boolean> {
    const store = useMediaLibraryStore.getState()
    const media =
      typeof mediaOrId === 'string' ? store.mediaItems.find((m) => m.id === mediaOrId) : mediaOrId
    if (!media) return false

    const ownsRun = !this.batchInFlight && !store.analysisProgress
    if (ownsRun) {
      store.beginAnalysisRun(1)
    }
    try {
      const ok = await this.analyzeOne(media)
      if (ownsRun) {
        useMediaLibraryStore.getState().incrementAnalysisCompleted(1)
      }
      return ok
    } finally {
      if (ownsRun) {
        useMediaLibraryStore.getState().endAnalysisRun()
      }
    }
  }

  private async analyzeOne(media: MediaMetadata): Promise<boolean> {
    const store = useMediaLibraryStore.getState()
    const mediaType = getMediaType(media.mimeType)
    if (mediaType !== 'video' && mediaType !== 'image') return false

    const { captioningIntervalUnit, captioningIntervalValue } = useSettingsStore.getState()
    const sampleIntervalSec = resolveCaptioningIntervalSec(
      captioningIntervalUnit,
      captioningIntervalValue,
      media.fps,
    )

    store.setTaggingMedia(media.id, true)

    try {
      // Content-addressable cache lookup: if another media item with the
      // same source bytes already produced captions, reuse them instead of
      // re-running the VLM. We resolve the hash once here and thread it
      // through every save* call so the shared bins/thumbs land in the
      // content tree (or so the adoptCaptionsFromCache fast-path can run).
      const contentHash = await this.resolveContentHash(media)

      // Drop every in-memory thumbnail URL and semantic cache entry tied to
      // this media before either adopting cached captions or writing fresh
      // outputs. Otherwise a re-analyze can keep serving stale per-media
      // blobs/embeddings until the next reload.
      invalidateMediaCaptionThumbnails(media.id)

      if (contentHash) {
        const cached = await getCaptionsByContentHash(contentHash, sampleIntervalSec).catch(
          () => undefined,
        )
        if (cached && this.isCacheCompatible(cached, sampleIntervalSec)) {
          // Treat an adopt failure as a cache miss and fall through to a full
          // run rather than aborting the whole analysis.
          let adopted: Awaited<ReturnType<typeof adoptCaptionsFromCache>> | undefined
          try {
            adopted = await adoptCaptionsFromCache(media.id, contentHash, sampleIntervalSec)
          } catch (error) {
            logger.warn('adoptCaptionsFromCache threw — falling through to full analysis', {
              mediaId: media.id,
              error,
            })
            adopted = undefined
          }
          if (adopted) {
            const captions = adopted.data.captions
            store.updateMediaCaptions(media.id, captions)
            try {
              await updateMediaDB(media.id, { aiCaptions: captions })
            } catch (error) {
              logger.warn('Failed to mirror cached captions to media DB', {
                mediaId: media.id,
                error,
              })
            }
            store.showNotification({
              type: 'success',
              message:
                captions.length === 0
                  ? `Reused cached analysis for "${media.fileName}" (no scenes)`
                  : `Reused cached analysis: ${captions.length} scene caption${captions.length === 1 ? '' : 's'} for "${media.fileName}"`,
            })
            return true
          }
        }
      }

      let captions: MediaCaption[]
      const stagedThumbnailBlobs = new Map<number, Blob>()

      const stageThumbnail = async (index: number, blob: Blob): Promise<string | undefined> => {
        stagedThumbnailBlobs.set(index, blob)
        return undefined
      }

      if (mediaType === 'video') {
        const blobUrl = await mediaLibraryService.getMediaBlobUrl(media.id)
        if (!blobUrl) throw new Error('Could not load media file')

        const video = document.createElement('video')
        video.muted = true
        video.preload = 'auto'
        video.src = blobUrl

        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve()
          video.onerror = () => reject(new Error('Failed to load video'))
        })

        try {
          captions = await captionVideo(video, {
            sampleIntervalSec,
            saveThumbnail: stageThumbnail,
          })
        } finally {
          video.src = ''
          URL.revokeObjectURL(blobUrl)
        }
      } else {
        const blobUrl = await mediaLibraryService.getMediaBlobUrl(media.id)
        if (!blobUrl) throw new Error('Could not load media file')

        const response = await fetch(blobUrl)
        const blob = await response.blob()
        URL.revokeObjectURL(blobUrl)
        captions = await captionImage(blob, { saveThumbnail: stageThumbnail })
      }

      if (captions.length > 0) {
        let embeddingModel: string | undefined
        let embeddingDim: number | undefined
        let imageEmbeddingModel: string | undefined
        let imageEmbeddingDim: number | undefined
        let captionsWithEmbeddings = captions

        const thumbBlobs = captions.map((_, index) => stagedThumbnailBlobs.get(index) ?? null)

        const colorResults = await Promise.all(
          thumbBlobs.map(async (blob) => {
            if (!blob) return { phrase: '', palette: [] as const }
            try {
              return await extractDominantColors(blob)
            } catch {
              return { phrase: '', palette: [] as const }
            }
          }),
        )
        const palettesByIndex = colorResults.map((r) => r.palette)

        captionsWithEmbeddings = captions.map((caption, i) => {
          const palette = palettesByIndex[i]
          const next = { ...caption } as typeof caption & {
            palette?: typeof palette
          }
          if (palette && palette.length > 0) next.palette = [...palette]
          return next
        })

        try {
          await embeddingsProvider.ensureReady()

          const transcript = await getTranscript(media.id).catch(() => null)

          const texts = captions.map((caption, i) =>
            buildEmbeddingText({
              caption: { text: caption.text, timeSec: caption.timeSec },
              sceneData: caption.sceneData,
              transcriptSegments: transcript?.segments,
              colorPhrase: colorResults[i]?.phrase ?? '',
            }),
          )

          const vectors = await embeddingsProvider.embedBatch(texts)
          if (vectors.length === captions.length) {
            await saveCaptionEmbeddings(media.id, vectors, EMBEDDING_MODEL_DIM, {
              contentHash,
              sampleIntervalSec,
            })
            embeddingModel = EMBEDDING_MODEL_ID
            embeddingDim = EMBEDDING_MODEL_DIM
            captionsWithEmbeddings = captionsWithEmbeddings.map((caption, i) => ({
              ...caption,
              embedding: Array.from(vectors[i]!),
            }))
          }
        } catch (error) {
          store.showNotification({
            type: 'warning',
            message: `Semantic indexing skipped for "${media.fileName}" — keyword search still works.`,
          })
          void error
        }

        try {
          const validBlobs = thumbBlobs.filter((b): b is Blob => b !== null)
          if (validBlobs.length > 0 && validBlobs.length === captions.length) {
            await clipProvider.ensureReady()
            const imageVectors = await clipProvider.embedImages(validBlobs)
            if (imageVectors.length === captions.length) {
              await saveCaptionImageEmbeddings(media.id, imageVectors, CLIP_EMBEDDING_DIM, {
                contentHash,
                sampleIntervalSec,
              })
              imageEmbeddingModel = CLIP_MODEL_ID
              imageEmbeddingDim = CLIP_EMBEDDING_DIM
            }
          }
        } catch (error) {
          void error
        }

        if (stagedThumbnailBlobs.size > 0) {
          captionsWithEmbeddings = await Promise.all(
            captionsWithEmbeddings.map(async (caption, index) => {
              const blob = stagedThumbnailBlobs.get(index)
              if (!blob) return caption
              try {
                const thumbRelPath = await saveCaptionThumbnail(media.id, index, blob, {
                  contentHash,
                  sampleIntervalSec,
                })
                return { ...caption, thumbRelPath }
              } catch {
                return caption
              }
            }),
          )
        }

        await mediaLibraryService.updateMediaCaptions(media.id, captionsWithEmbeddings, {
          sampleIntervalSec,
          embeddingModel,
          embeddingDim,
          imageEmbeddingModel,
          imageEmbeddingDim,
          contentHash,
        })
        store.updateMediaCaptions(media.id, captionsWithEmbeddings)

        const sceneCaptionCountLabel = `${captions.length} scene caption${captions.length === 1 ? '' : 's'}`
        store.showNotification({
          type: 'success',
          message: `Generated ${sceneCaptionCountLabel} for "${media.fileName}"`,
        })
      } else {
        await mediaLibraryService.updateMediaCaptions(media.id, [], {
          sampleIntervalSec,
          contentHash,
        })
        store.updateMediaCaptions(media.id, [])
        await deleteCaptionThumbnails(media.id)
        await deleteCaptionEmbeddings(media.id)
        store.showNotification({
          type: 'info',
          message: `No scene captions generated for "${media.fileName}"`,
        })
      }
      return true
    } catch (error) {
      store.showNotification({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to analyze media',
      })
      return false
    } finally {
      store.setTaggingMedia(media.id, false)
    }
  }

  /**
   * Analyze a batch of media sequentially. Sequential avoids thrashing the
   * shared WebGPU device and CLIP model — parallelism here would starve the
   * preview canvas and risk OOM on longer videos.
   *
   * A single batch is the unit of concurrency — calling twice while one is
   * running is a no-op (second call resolves immediately with zeros). The
   * per-item tagging flag blocks any overlapping per-card "Analyze" clicks.
   */
  async analyzeBatch(options: AnalyzeBatchOptions = {}): Promise<AnalyzeBatchResult> {
    if (this.batchInFlight) {
      return { analyzed: 0, skipped: 0, failed: 0 }
    }
    this.batchInFlight = true

    const store = useMediaLibraryStore.getState()
    const all = store.mediaItems
    const pool = options.mediaIds ? all.filter((m) => options.mediaIds!.includes(m.id)) : all

    const targets = pool.filter((m) => {
      const type = getMediaType(m.mimeType)
      if (type !== 'video' && type !== 'image') return false
      if (options.onlyMissing && (m.aiCaptions?.length ?? 0) > 0) return false
      return true
    })

    let analyzed = 0
    let failed = 0
    let cancelled = 0
    const skipped = pool.length - targets.length

    try {
      if (targets.length === 0) {
        store.showNotification({
          type: 'info',
          message: options.onlyMissing ? 'No unanalyzed media to process.' : 'No media to analyze.',
        })
        return { analyzed: 0, skipped, failed: 0 }
      }

      store.beginAnalysisRun(targets.length)
      store.showNotification({
        type: 'info',
        message:
          targets.length === 1
            ? `Analyzing "${firstName(targets)}"…`
            : `Analyzing ${targets.length} media files…`,
      })

      for (const media of targets) {
        // Cancel is cooperative — the in-flight item finishes first. Any
        // remaining items are skipped but still counted toward `completed`
        // so the progress bar reaches 100% and unmounts cleanly instead
        // of stranding the user with a stuck bar.
        const { analysisProgress } = useMediaLibraryStore.getState()
        if (analysisProgress?.cancelRequested) {
          cancelled = targets.length - (analyzed + failed)
          useMediaLibraryStore.getState().incrementAnalysisCompleted(cancelled)
          break
        }
        logger.info('batch analyzing media', { mediaId: media.id, fileName: media.fileName })
        const ok = await this.analyzeOne(media)
        if (ok) analyzed += 1
        else failed += 1
        useMediaLibraryStore.getState().incrementAnalysisCompleted(1)
      }

      if (targets.length > 1) {
        const suffix = failed > 0 ? ` — ${failed} failed` : ''
        const cancelSuffix = cancelled > 0 ? ` (${cancelled} cancelled)` : ''
        store.showNotification({
          type: cancelled > 0 ? 'warning' : failed === 0 ? 'success' : 'warning',
          message: `Analyzed ${analyzed}/${targets.length}${suffix}${cancelSuffix}`,
        })
      }
    } finally {
      useMediaLibraryStore.getState().endAnalysisRun()
      this.batchInFlight = false
    }

    return { analyzed, skipped, failed }
  }

  /** Ask the currently running analysis to stop after the in-flight item. */
  requestCancel(): void {
    useMediaLibraryStore.getState().requestAnalysisCancel()
  }

  isBatchInFlight(): boolean {
    return this.batchInFlight
  }

  /**
   * Resolve the SHA-256 content hash for a media item. Prefers the cached
   * value on `MediaMetadata.contentHash` when present; otherwise reads the
   * source blob once, hashes, and persists the result so future analyze
   * runs (and the shared-cache check) skip the hashing step.
   *
   * Returns `undefined` only when the source blob can't be loaded — the
   * cache lookup is skipped in that case and analysis proceeds as usual.
   */
  private async resolveContentHash(media: MediaMetadata): Promise<string | undefined> {
    if (media.contentHash) return media.contentHash
    try {
      const file = await mediaLibraryService.getMediaFile(media.id)
      if (!file) return undefined
      const buffer = await file.arrayBuffer()
      const hash = await computeContentHashFromBuffer(buffer)
      try {
        await updateMediaDB(media.id, { contentHash: hash })
      } catch (error) {
        logger.warn('Failed to persist contentHash on media metadata', { mediaId: media.id, error })
      }
      return hash
    } catch (error) {
      logger.warn('Failed to compute contentHash; skipping caption cache lookup', {
        mediaId: media.id,
        error,
      })
      return undefined
    }
  }

  /**
   * Cache-hit acceptance check. Today we only gate on sampleIntervalSec
   * since that's the one user-visible param that changes output cardinality.
   * When the captioner or embedding model versions bump, callers should flush
   * the shared cache rather than relying on a version check here — shared
   * cache GC is cheap via the ai-refs file.
   */
  private isCacheCompatible(
    envelope: Awaited<ReturnType<typeof getCaptionsByContentHash>>,
    sampleIntervalSec: number,
  ): boolean {
    if (!envelope) return false
    const envInterval = (envelope.params as { sampleIntervalSec?: number }).sampleIntervalSec
    if (envInterval === undefined) {
      // Legacy cache (pre-versioning): fall back to the interval recorded in
      // `data` so users who changed their interval get a fresh analysis
      // instead of silently reusing the old density.
      const dataInterval = (envelope.data as { sampleIntervalSec?: number }).sampleIntervalSec
      if (dataInterval === undefined) return true
      return Math.abs(dataInterval - sampleIntervalSec) < 0.01
    }
    return Math.abs(envInterval - sampleIntervalSec) < 0.01
  }
}

function firstName(items: readonly MediaMetadata[]): string {
  return items[0]?.fileName ?? ''
}

export const mediaAnalysisService = new MediaAnalysisService()
