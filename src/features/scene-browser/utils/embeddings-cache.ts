/**
 * In-memory embeddings cache for the Scene Browser.
 *
 * Caption embeddings live on disk as a packed `Float32Array` bin plus
 * metadata in `captions.json`. The hook layer wants fast synchronous
 * access during ranking, so this module hydrates per-media vectors on
 * first request and keeps them in memory for the session.
 *
 * Cache keys are "scene ids" (`${mediaId}:${captionIndex}`) so the ranker
 * doesn't need to know about media boundaries.
 */

import { createLogger } from '@/shared/logging/logger'
import {
  EMBEDDING_MODEL_DIM,
  EMBEDDING_MODEL_ID,
  CLIP_EMBEDDING_DIM,
  CLIP_MODEL_ID,
  buildEmbeddingText,
  clipProvider,
  embeddingsProvider,
  extractDominantColors,
} from '../deps/analysis'
import {
  mediaLibraryService,
  useMediaLibraryStore,
  type MediaMetadata,
} from '../deps/media-library'
import {
  getCaptionEmbeddings,
  getCaptionImageEmbeddings,
  getCaptionThumbnailBlob,
  getCaptionsEmbeddingsMeta,
  getTranscript,
  saveCaptionEmbeddings,
  saveCaptionImageEmbeddings,
} from '../deps/storage'

const log = createLogger('SceneBrowser:EmbeddingsCache')

/** sceneId → normalized text embedding vector. */
const embeddings = new Map<string, Float32Array>()
/** sceneId → normalized CLIP image embedding vector. */
const imageEmbeddings = new Map<string, Float32Array>()
/** sceneId → dominant-color palette entries (Lab + weight). */
const palettes = new Map<string, Array<{ l: number; a: number; b: number; weight: number }>>()
/** mediaId → outstanding hydration promise so concurrent callers share work. */
const pendingHydrates = new Map<string, Promise<void>>()
/** mediaId → outstanding text indexing (retroactive generate) promise. */
const pendingIndexes = new Map<string, Promise<void>>()
/** mediaId → outstanding image indexing (retroactive generate) promise. */
const pendingImageIndexes = new Map<string, Promise<void>>()
/** mediaIds we've already concluded have no usable text embeddings. */
const missingEmbeddings = new Set<string>()
/** mediaIds we've already concluded have no usable image embeddings. */
const missingImageEmbeddings = new Set<string>()

function sceneId(mediaId: string, captionIndex: number): string {
  return `${mediaId}:${captionIndex}`
}

async function getCaptionStorageOptions(
  mediaId: string,
  fallbackContentHash?: string,
): Promise<{ contentHash?: string; sampleIntervalSec?: number }> {
  const meta = await getCaptionsEmbeddingsMeta(mediaId).catch(() => null)
  return {
    contentHash: meta?.contentHash ?? fallbackContentHash,
    sampleIntervalSec: meta?.sampleIntervalSec,
  }
}

function populateFromInMemory(media: MediaMetadata): boolean {
  const captions = media.aiCaptions
  if (!captions || captions.length === 0) return false
  let found = false
  captions.forEach((caption, i) => {
    if (Array.isArray(caption.embedding) && caption.embedding.length === EMBEDDING_MODEL_DIM) {
      embeddings.set(sceneId(media.id, i), Float32Array.from(caption.embedding))
      found = true
    }
    // Palettes are tiny — always mirror from whatever the store has so
    // the rank-time Map is a read-only snapshot of the source of truth.
    if (Array.isArray(caption.palette) && caption.palette.length > 0) {
      palettes.set(
        sceneId(media.id, i),
        caption.palette.map((entry) => ({
          l: entry.l,
          a: entry.a,
          b: entry.b,
          weight: entry.weight,
        })),
      )
    }
  })
  return found
}

async function hydrateFromDisk(
  mediaId: string,
  expectedCount: number,
): Promise<{
  text: boolean
  image: boolean
}> {
  const meta = await getCaptionsEmbeddingsMeta(mediaId)
  if (!meta) return { text: false, image: false }

  // When the envelope was persisted via the shared content-addressable cache,
  // the packed bins live under `content/{hash}/ai/` rather than per-media;
  // pass the hash so the reader looks up the right file.
  const opts = meta.contentHash
    ? { contentHash: meta.contentHash, sampleIntervalSec: meta.sampleIntervalSec }
    : undefined

  let textOk = false
  if (meta.embeddingModel === EMBEDDING_MODEL_ID && meta.embeddingDim === EMBEDDING_MODEL_DIM) {
    const vectors = await getCaptionEmbeddings(mediaId, meta.embeddingDim, expectedCount, opts)
    if (vectors) {
      vectors.forEach((vector, i) => embeddings.set(sceneId(mediaId, i), vector))
      textOk = true
    }
  }

  let imageOk = false
  if (meta.imageEmbeddingModel === CLIP_MODEL_ID && meta.imageEmbeddingDim === CLIP_EMBEDDING_DIM) {
    const vectors = await getCaptionImageEmbeddings(
      mediaId,
      meta.imageEmbeddingDim,
      expectedCount,
      opts,
    )
    if (vectors) {
      vectors.forEach((vector, i) => imageEmbeddings.set(sceneId(mediaId, i), vector))
      imageOk = true
    }
  }

  return { text: textOk, image: imageOk }
}

/**
 * Ensure embeddings for every caption on `mediaId` are present in memory.
 * Reuses already-loaded vectors; concurrent callers share a single disk read.
 */
export function ensureEmbeddingsLoaded(mediaId: string): Promise<void> {
  const existing = pendingHydrates.get(mediaId)
  if (existing) return existing

  const promise = (async () => {
    const media = useMediaLibraryStore.getState().mediaById[mediaId]
    if (!media || !media.aiCaptions || media.aiCaptions.length === 0) return

    let textHydrated = populateFromInMemory(media)
    let imageHydrated = imageEmbeddings.has(sceneId(mediaId, 0))

    if (!textHydrated || !imageHydrated) {
      const loaded = await hydrateFromDisk(mediaId, media.aiCaptions.length)
      textHydrated ||= loaded.text
      imageHydrated ||= loaded.image
    }

    if (!textHydrated) missingEmbeddings.add(mediaId)
    if (!imageHydrated) missingImageEmbeddings.add(mediaId)
  })()
    .catch((error) => {
      log.warn('Embedding hydrate failed', { mediaId, error })
      missingEmbeddings.add(mediaId)
      missingImageEmbeddings.add(mediaId)
    })
    .finally(() => {
      pendingHydrates.delete(mediaId)
    })

  pendingHydrates.set(mediaId, promise)
  return promise
}

/**
 * Run the embedding model over captions that have never been indexed,
 * save the resulting `.bin`, patch captions.json with the model metadata,
 * and populate the cache. Caller is responsible for opening the gate via
 * `embeddingsProvider.ensureReady()` — skipped here so background indexing
 * can decide when to pay the model-download cost.
 */
export function indexMediaCaptions(mediaId: string): Promise<void> {
  const existing = pendingIndexes.get(mediaId)
  if (existing) return existing

  const promise = (async () => {
    const state = useMediaLibraryStore.getState()
    const media = state.mediaById[mediaId]
    if (!media || !media.aiCaptions || media.aiCaptions.length === 0) return
    if (state.taggingMediaIds.has(mediaId)) return

    await embeddingsProvider.ensureReady()
    // The main Analyze-with-AI pipeline owns this media during its run.
    // Re-check after the (potentially long) model download to avoid racing
    // it with a re-analysis that just started.
    if (useMediaLibraryStore.getState().taggingMediaIds.has(mediaId)) return

    // Gather the same context signals the main pipeline uses so a
    // retroactively-indexed caption is embedded identically to one
    // generated by Analyze-with-AI — otherwise semantic ranking would
    // get two flavors of vectors in one library and drift in quality.
    const transcript = await getTranscript(mediaId).catch(() => null)
    const colorResults = await Promise.all(
      media.aiCaptions.map(async (caption) => {
        if (!caption.thumbRelPath) return { phrase: '', palette: [] as const }
        try {
          const blob = await getCaptionThumbnailBlob(caption.thumbRelPath)
          if (!blob) return { phrase: '', palette: [] as const }
          return await extractDominantColors(blob)
        } catch {
          return { phrase: '', palette: [] as const }
        }
      }),
    )

    const texts = media.aiCaptions.map((caption, i) =>
      buildEmbeddingText({
        caption: { text: caption.text, timeSec: caption.timeSec },
        sceneData: caption.sceneData,
        transcriptSegments: transcript?.segments,
        colorPhrase: colorResults[i]?.phrase ?? '',
      }),
    )

    const vectors = await embeddingsProvider.embedBatch(texts)
    if (vectors.length !== texts.length) {
      throw new Error(`Embedding returned ${vectors.length} vectors for ${texts.length} captions`)
    }

    const storageOptions = await getCaptionStorageOptions(mediaId, media.contentHash)
    await saveCaptionEmbeddings(mediaId, vectors, EMBEDDING_MODEL_DIM, storageOptions)
    // Persist the model metadata on captions.json so future sessions know
    // the bin matches. We rewrite the full captions payload — cheap, since
    // retroactive indexing is an explicit user action, not a hot path.
    // Stamp the extracted palettes onto each caption so retroactive
    // indexing also populates color data for legacy captions without it.
    const capturedCaptions = media.aiCaptions.map((caption, i) => {
      const palette = colorResults[i]?.palette
      const next = { ...caption }
      if (palette && palette.length > 0) next.palette = [...palette]
      return next
    })
    await mediaLibraryService.updateMediaCaptions(mediaId, capturedCaptions, {
      embeddingModel: EMBEDDING_MODEL_ID,
      embeddingDim: EMBEDDING_MODEL_DIM,
      contentHash: storageOptions.contentHash,
      sampleIntervalSec: storageOptions.sampleIntervalSec,
    })
    useMediaLibraryStore.getState().updateMediaCaptions(mediaId, capturedCaptions)

    vectors.forEach((vector, i) => {
      embeddings.set(sceneId(mediaId, i), vector)
    })
    missingEmbeddings.delete(mediaId)
  })().finally(() => {
    pendingIndexes.delete(mediaId)
  })

  pendingIndexes.set(mediaId, promise)
  return promise
}

/**
 * Generate CLIP image embeddings for every thumbnail-bearing caption on
 * `mediaId`, persist the bin, update captions.json with the image model
 * metadata, and populate the cache. Skips captions whose thumbnails are
 * missing on disk — the count of saved vectors is allowed to be less
 * than the caption count only when the persisted bin layout still
 * matches 1:1 (which is why we pre-require all thumbs to exist; if any
 * are missing we bail rather than emit a short-count bin).
 */
export function indexMediaImageCaptions(mediaId: string): Promise<void> {
  const existing = pendingImageIndexes.get(mediaId)
  if (existing) return existing

  const promise = (async () => {
    const state = useMediaLibraryStore.getState()
    const media = state.mediaById[mediaId]
    if (!media || !media.aiCaptions || media.aiCaptions.length === 0) return
    if (state.taggingMediaIds.has(mediaId)) return

    // Load every thumbnail up front — CLIP expects one vector per
    // caption index, so a missing thumb anywhere in the series means we
    // can't write a coherent bin for this media. Lazy-thumb will
    // eventually generate them on next Scene Browser visit; skip and
    // retry next time.
    const blobs: Blob[] = []
    for (const caption of media.aiCaptions) {
      if (!caption.thumbRelPath) return
      const blob = await getCaptionThumbnailBlob(caption.thumbRelPath)
      if (!blob) return
      blobs.push(blob)
    }

    await clipProvider.ensureReady()
    if (useMediaLibraryStore.getState().taggingMediaIds.has(mediaId)) return

    const vectors = await clipProvider.embedImages(blobs)
    if (vectors.length !== blobs.length) {
      throw new Error(`CLIP returned ${vectors.length} vectors for ${blobs.length} thumbnails`)
    }

    const storageOptions = await getCaptionStorageOptions(mediaId, media.contentHash)
    await saveCaptionImageEmbeddings(mediaId, vectors, CLIP_EMBEDDING_DIM, storageOptions)

    // Patch captions.json with the image-model metadata. Fetch the latest
    // captions from the store so we preserve concurrent edits (rare, but
    // re-analyze-and-index-at-the-same-time is the exact race we care about).
    const latest = useMediaLibraryStore.getState().mediaById[mediaId]
    if (latest?.aiCaptions) {
      await mediaLibraryService.updateMediaCaptions(mediaId, latest.aiCaptions, {
        embeddingModel: EMBEDDING_MODEL_ID,
        embeddingDim: EMBEDDING_MODEL_DIM,
        imageEmbeddingModel: CLIP_MODEL_ID,
        imageEmbeddingDim: CLIP_EMBEDDING_DIM,
        contentHash: storageOptions.contentHash ?? latest.contentHash,
        sampleIntervalSec: storageOptions.sampleIntervalSec,
      })
    }

    vectors.forEach((vector, i) => {
      imageEmbeddings.set(sceneId(mediaId, i), vector)
    })
    missingImageEmbeddings.delete(mediaId)
  })().finally(() => {
    pendingImageIndexes.delete(mediaId)
  })

  pendingImageIndexes.set(mediaId, promise)
  return promise
}

/**
 * Drop cached embeddings for `mediaId`. Call after Analyze-with-AI finishes
 * (new embeddings will be hydrated from the fresh in-memory caption array
 * on next access) or when embeddings-on-disk go out of sync.
 */
export function invalidateEmbeddingsCache(mediaId: string): void {
  const prefix = `${mediaId}:`
  for (const key of embeddings.keys()) {
    if (key.startsWith(prefix)) embeddings.delete(key)
  }
  for (const key of imageEmbeddings.keys()) {
    if (key.startsWith(prefix)) imageEmbeddings.delete(key)
  }
  for (const key of palettes.keys()) {
    if (key.startsWith(prefix)) palettes.delete(key)
  }
  missingEmbeddings.delete(mediaId)
  missingImageEmbeddings.delete(mediaId)
  pendingHydrates.delete(mediaId)
  pendingIndexes.delete(mediaId)
  pendingImageIndexes.delete(mediaId)
}

/** Read-only view of the in-memory text embeddings cache, for ranking. */
export function getEmbeddingsSnapshot(): Map<string, Float32Array> {
  return embeddings
}

/** Read-only view of the in-memory CLIP image embeddings cache. */
export function getImageEmbeddingsSnapshot(): Map<string, Float32Array> {
  return imageEmbeddings
}

/** Read-only view of the in-memory color palette cache. */
export function getPalettesSnapshot(): Map<
  string,
  Array<{ l: number; a: number; b: number; weight: number }>
> {
  return palettes
}

/** Whether the given media is known to be missing text embeddings. */
export function isMediaMissingEmbeddings(mediaId: string): boolean {
  return missingEmbeddings.has(mediaId)
}

/** Whether the given media is known to be missing image embeddings. */
export function isMediaMissingImageEmbeddings(mediaId: string): boolean {
  return missingImageEmbeddings.has(mediaId)
}
