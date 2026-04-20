/**
 * Per-media AI captions (vision-language-model frame descriptions), with a
 * content-addressable cache so multiple mediaIds resolving to the same source
 * bytes share caption generation cost.
 *
 * Two-location layout:
 *  - Per-media envelope lives at `media/{mediaId}/cache/ai/captions.json`
 *    and mirrors `MediaMetadata.aiCaptions`. It records whether the
 *    companion heavy assets (embeddings bins, thumbnail JPEGs) live under
 *    the per-media cache dir or the shared content tree.
 *  - When the source's SHA-256 is known at save time, embedding bins and
 *    caption thumbnails are written once to `content/{shard}/{hash}/ai/`.
 *    The envelope carries `contentHash` so readers route their bin/thumb
 *    lookups there. The ai-refs file (`content/{shard}/{hash}/ai/refs.json`)
 *    tracks which mediaIds share the cache so the directory can be GC'd
 *    when the last reference goes away.
 *
 * Callers that only know a mediaId still work — lookup helpers consult the
 * envelope to decide whether heavy assets live per-media or shared. Callers
 * that want dedup at save time pass `contentHash` in the options.
 */

import type { MediaCaption } from '@/infrastructure/analysis';
import { createLogger } from '@/shared/logging/logger';

import {
  addAiContentRef,
  deleteAiContent,
  removeAiContentRef,
} from './ai-content-refs';
import {
  readAiOutput,
  readAiOutputAt,
  writeAiOutput,
  writeAiOutputAt,
  deleteAiOutput,
  deleteAiOutputAt,
  type AiOutput,
} from './ai-outputs';
import { readArrayBuffer, readBlob, removeEntry, writeBlob } from './fs-primitives';
import {
  aiOutputPath,
  captionEmbeddingsPath,
  captionImageEmbeddingsPath,
  captionThumbPath,
  captionThumbRelPath,
  captionThumbsDir,
  contentCaptionEmbeddingsPath,
  contentCaptionImageEmbeddingsPath,
  contentCaptionThumbPath,
  contentCaptionThumbRelPath,
  contentCaptionsJsonPath,
} from './paths';
import { requireWorkspaceRoot } from './root';

const logger = createLogger('WorkspaceFS:Captions');

interface SaveCaptionsInput {
  mediaId: string;
  captions: MediaCaption[];
  /** Stable provider id, e.g. `"lfm-captioning"`. */
  service: string;
  /** Model id/version reported by the provider, e.g. `"lfm-2.5-vl"`. */
  model: string;
  /** Sample interval used at generation time — kept for invalidation. */
  sampleIntervalSec?: number;
  /** Text-embedding model id whose vectors are stored in the companion `.bin`. */
  embeddingModel?: string;
  /** Dimension of each text embedding vector. */
  embeddingDim?: number;
  /** CLIP image-embedding model id (separate bin). */
  imageEmbeddingModel?: string;
  /** Dimension of each image embedding vector. */
  imageEmbeddingDim?: number;
  /**
   * SHA-256 of the source media bytes. When provided, the envelope and heavy
   * assets are mirrored into the shared content cache and this mediaId is
   * registered as a ref-holder.
   */
  contentHash?: string;
}

/** Options common to most read/write helpers. */
interface ContentKeyedOptions {
  /**
   * SHA-256 of the source bytes. When present, the helper targets the shared
   * content-addressable location; when absent, falls back to the per-media
   * location for backwards compatibility with pre-cache saves.
   */
  contentHash?: string;
}

export async function getCaptions(
  mediaId: string,
): Promise<MediaCaption[] | undefined> {
  try {
    const envelope = await readAiOutput(mediaId, 'captions');
    return envelope?.data.captions;
  } catch (error) {
    logger.error(`getCaptions(${mediaId}) failed`, error);
    throw new Error(`Failed to load captions: ${mediaId}`);
  }
}

/**
 * Look up the shared-cache captions envelope by content hash. Used at the
 * start of analysis so the expensive captioner can be skipped when another
 * media item has already produced captions for the same source bytes.
 */
export async function getCaptionsByContentHash(
  hash: string,
): Promise<AiOutput<'captions'> | undefined> {
  try {
    return await readAiOutputAt(contentCaptionsJsonPath(hash), 'captions');
  } catch (error) {
    logger.warn(`getCaptionsByContentHash(${hash}) failed`, error);
    return undefined;
  }
}

export async function saveCaptions(input: SaveCaptionsInput): Promise<MediaCaption[]> {
  const data = {
    sampleIntervalSec: input.sampleIntervalSec,
    embeddingModel: input.embeddingModel,
    embeddingDim: input.embeddingDim,
    imageEmbeddingModel: input.imageEmbeddingModel,
    imageEmbeddingDim: input.imageEmbeddingDim,
    contentHash: input.contentHash,
    captions: input.captions,
  };

  try {
    const written = await writeAiOutput({
      mediaId: input.mediaId,
      kind: 'captions',
      service: input.service,
      model: input.model,
      params: input.sampleIntervalSec !== undefined ? { sampleIntervalSec: input.sampleIntervalSec } : {},
      data,
    });

    if (input.contentHash) {
      try {
        await writeAiOutputAt(contentCaptionsJsonPath(input.contentHash), {
          mediaId: input.mediaId,
          kind: 'captions',
          service: input.service,
          model: input.model,
          params: input.sampleIntervalSec !== undefined ? { sampleIntervalSec: input.sampleIntervalSec } : {},
          data,
        });
        await addAiContentRef(input.contentHash, input.mediaId);
      } catch (error) {
        // Per-media envelope is already the authoritative record; log and move
        // on so caption save doesn't fail the whole analyze pipeline.
        logger.warn(`saveCaptions: content-cache mirror failed for ${input.contentHash}`, error);
      }
    }

    return written.data.captions;
  } catch (error) {
    logger.error(`saveCaptions(${input.mediaId}) failed`, error);
    throw new Error(`Failed to save captions: ${input.mediaId}`);
  }
}

/**
 * Read the raw embedding metadata saved alongside captions — both text
 * and image model identifiers so ranking can decide whether each bin is
 * safe to load back in.
 */
export async function getCaptionsEmbeddingsMeta(
  mediaId: string,
): Promise<{
  embeddingModel?: string;
  embeddingDim?: number;
  imageEmbeddingModel?: string;
  imageEmbeddingDim?: number;
  contentHash?: string;
} | null> {
  const envelope = await readAiOutput(mediaId, 'captions');
  if (!envelope) return null;
  return {
    embeddingModel: envelope.data.embeddingModel,
    embeddingDim: envelope.data.embeddingDim,
    imageEmbeddingModel: envelope.data.imageEmbeddingModel,
    imageEmbeddingDim: envelope.data.imageEmbeddingDim,
    contentHash: envelope.data.contentHash,
  };
}

/**
 * Persist caption embeddings as a contiguous `Float32Array`. Layout is
 * `captionCount * embeddingDim` floats, stored in caption index order.
 * The companion `captions.json` records {@link embeddingModel} and
 * {@link embeddingDim} so a later read can detect model-drift before
 * trusting the payload. Writes to the shared content cache when
 * {@link ContentKeyedOptions.contentHash} is provided, otherwise to the
 * per-media cache dir.
 */
export async function saveCaptionEmbeddings(
  mediaId: string,
  vectors: Float32Array[],
  embeddingDim: number,
  opts: ContentKeyedOptions = {},
): Promise<void> {
  if (vectors.length === 0) return;
  const root = requireWorkspaceRoot();
  const packed = new Float32Array(vectors.length * embeddingDim);
  vectors.forEach((vector, index) => {
    if (vector.length !== embeddingDim) {
      throw new Error(
        `Embedding dim mismatch at index ${index}: got ${vector.length}, expected ${embeddingDim}`,
      );
    }
    packed.set(vector, index * embeddingDim);
  });
  const target = opts.contentHash
    ? contentCaptionEmbeddingsPath(opts.contentHash)
    : captionEmbeddingsPath(mediaId);
  try {
    await writeBlob(root, target, packed.buffer);
  } catch (error) {
    logger.error(`saveCaptionEmbeddings(${mediaId}) failed`, error);
    throw new Error(`Failed to save caption embeddings: ${mediaId}`);
  }
}

/**
 * Load caption embeddings back into an array of `Float32Array`s. Returns
 * `null` when no `.bin` exists (pre-feature captions) or when the saved
 * vector count doesn't match `expectedCount` (captions changed under our
 * feet and the bin is stale). Reads from the shared content cache when
 * {@link ContentKeyedOptions.contentHash} is provided, otherwise per-media.
 */
export async function getCaptionEmbeddings(
  mediaId: string,
  embeddingDim: number,
  expectedCount: number,
  opts: ContentKeyedOptions = {},
): Promise<Float32Array[] | null> {
  if (expectedCount === 0) return [];
  const root = requireWorkspaceRoot();
  const target = opts.contentHash
    ? contentCaptionEmbeddingsPath(opts.contentHash)
    : captionEmbeddingsPath(mediaId);
  try {
    const buffer = await readArrayBuffer(root, target);
    if (!buffer) return null;
    const expectedFloats = expectedCount * embeddingDim;
    const got = buffer.byteLength / Float32Array.BYTES_PER_ELEMENT;
    if (got !== expectedFloats) {
      logger.warn(
        `getCaptionEmbeddings(${mediaId}): bin has ${got} floats, expected ${expectedFloats} — treating as stale`,
      );
      return null;
    }
    const packed = new Float32Array(buffer);
    const vectors: Float32Array[] = [];
    for (let i = 0; i < expectedCount; i += 1) {
      vectors.push(packed.slice(i * embeddingDim, (i + 1) * embeddingDim));
    }
    return vectors;
  } catch (error) {
    logger.warn(`getCaptionEmbeddings(${mediaId}) failed`, error);
    return null;
  }
}

export async function deleteCaptionEmbeddings(
  mediaId: string,
  opts: ContentKeyedOptions = {},
): Promise<void> {
  const root = requireWorkspaceRoot();
  // Always clear the per-media location — safe no-op when file is absent.
  try {
    await removeEntry(root, captionEmbeddingsPath(mediaId));
  } catch (error) {
    logger.warn(`deleteCaptionEmbeddings(${mediaId}) failed`, error);
  }
  try {
    await removeEntry(root, captionImageEmbeddingsPath(mediaId));
  } catch (error) {
    logger.warn(`deleteCaptionImageEmbeddings(${mediaId}) failed`, error);
  }
  // Shared content-tree bins are GC'd by deleteSharedCaptionsIfUnreferenced
  // when the last ref goes away; individual deletes don't touch them.
  void opts.contentHash;
}

/**
 * Persist per-caption CLIP image embeddings. Same layout as text
 * embeddings — `captionCount * embeddingDim` packed floats in caption
 * order. Safe to call independently of {@link saveCaptionEmbeddings};
 * either bin can exist without the other.
 */
export async function saveCaptionImageEmbeddings(
  mediaId: string,
  vectors: Float32Array[],
  embeddingDim: number,
  opts: ContentKeyedOptions = {},
): Promise<void> {
  if (vectors.length === 0) return;
  const root = requireWorkspaceRoot();
  const packed = new Float32Array(vectors.length * embeddingDim);
  vectors.forEach((vector, index) => {
    if (vector.length !== embeddingDim) {
      throw new Error(
        `Image embedding dim mismatch at index ${index}: got ${vector.length}, expected ${embeddingDim}`,
      );
    }
    packed.set(vector, index * embeddingDim);
  });
  const target = opts.contentHash
    ? contentCaptionImageEmbeddingsPath(opts.contentHash)
    : captionImageEmbeddingsPath(mediaId);
  try {
    await writeBlob(root, target, packed.buffer);
  } catch (error) {
    logger.error(`saveCaptionImageEmbeddings(${mediaId}) failed`, error);
    throw new Error(`Failed to save caption image embeddings: ${mediaId}`);
  }
}

export async function getCaptionImageEmbeddings(
  mediaId: string,
  embeddingDim: number,
  expectedCount: number,
  opts: ContentKeyedOptions = {},
): Promise<Float32Array[] | null> {
  if (expectedCount === 0) return [];
  const root = requireWorkspaceRoot();
  const target = opts.contentHash
    ? contentCaptionImageEmbeddingsPath(opts.contentHash)
    : captionImageEmbeddingsPath(mediaId);
  try {
    const buffer = await readArrayBuffer(root, target);
    if (!buffer) return null;
    const expectedFloats = expectedCount * embeddingDim;
    const got = buffer.byteLength / Float32Array.BYTES_PER_ELEMENT;
    if (got !== expectedFloats) {
      logger.warn(
        `getCaptionImageEmbeddings(${mediaId}): bin has ${got} floats, expected ${expectedFloats} — treating as stale`,
      );
      return null;
    }
    const packed = new Float32Array(buffer);
    const vectors: Float32Array[] = [];
    for (let i = 0; i < expectedCount; i += 1) {
      vectors.push(packed.slice(i * embeddingDim, (i + 1) * embeddingDim));
    }
    return vectors;
  } catch (error) {
    logger.warn(`getCaptionImageEmbeddings(${mediaId}) failed`, error);
    return null;
  }
}

/**
 * Persist a single caption thumbnail JPEG. Returns the workspace-relative
 * path to stash on the corresponding `MediaCaption.thumbRelPath` so the
 * Scene Browser can load the blob back on demand. Writes to the shared
 * content tree when {@link ContentKeyedOptions.contentHash} is provided
 * so duplicate imports of the same source share a single thumbnail set.
 */
export async function saveCaptionThumbnail(
  mediaId: string,
  index: number,
  blob: Blob,
  opts: ContentKeyedOptions = {},
): Promise<string> {
  const root = requireWorkspaceRoot();
  const segments = opts.contentHash
    ? contentCaptionThumbPath(opts.contentHash, index)
    : captionThumbPath(mediaId, index);
  const relPath = opts.contentHash
    ? contentCaptionThumbRelPath(opts.contentHash, index)
    : captionThumbRelPath(mediaId, index);
  try {
    await writeBlob(root, segments, blob);
    return relPath;
  } catch (error) {
    logger.error(`saveCaptionThumbnail(${mediaId}, ${index}) failed`, error);
    throw new Error(`Failed to save caption thumbnail: ${mediaId}#${index}`);
  }
}

/**
 * Load a previously-saved caption thumbnail by its workspace-relative path.
 * Returns `null` when the file is missing (captions from before the feature
 * landed, or the directory was pruned). Works for both per-media and
 * content-tree paths since the relPath encodes the full location.
 */
export async function getCaptionThumbnailBlob(
  relPath: string,
): Promise<Blob | null> {
  const root = requireWorkspaceRoot();
  const segments = relPath.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  try {
    return await readBlob(root, segments);
  } catch (error) {
    logger.warn(`getCaptionThumbnailBlob(${relPath}) failed`, error);
    return null;
  }
}

/**
 * Probe the conventional caption thumbnail path for a (mediaId, captionIndex)
 * pair. Returns the workspace-relative path when the file exists so the
 * caller can reuse it without regenerating — useful for captions whose
 * `thumbRelPath` pointer was dropped across a reload but whose JPEG is
 * still on disk. When `contentHash` is provided the content-tree location
 * is probed first.
 */
export async function probeCaptionThumbnail(
  mediaId: string,
  captionIndex: number,
  opts: ContentKeyedOptions = {},
): Promise<string | null> {
  if (opts.contentHash) {
    const shared = contentCaptionThumbRelPath(opts.contentHash, captionIndex);
    if (await getCaptionThumbnailBlob(shared)) return shared;
  }
  const local = captionThumbRelPath(mediaId, captionIndex);
  return (await getCaptionThumbnailBlob(local)) ? local : null;
}

/**
 * Remove the per-media `captions-thumbs` directory. Shared thumbnails in the
 * content tree are untouched — they're GC'd via
 * {@link deleteSharedCaptionsIfUnreferenced} when the last media ref drops.
 */
export async function deleteCaptionThumbnails(mediaId: string): Promise<void> {
  const root = requireWorkspaceRoot();
  try {
    await removeEntry(root, captionThumbsDir(mediaId), { recursive: true });
  } catch (error) {
    logger.warn(`deleteCaptionThumbnails(${mediaId}) failed`, error);
  }
}

/**
 * Decrement the shared content cache for `hash` on behalf of `mediaId`. If
 * no mediaIds remain, tears down the entire `content/{shard}/{hash}/ai/`
 * subtree — captions envelope, bins, and thumbnails in one sweep. Safe to
 * call when the hash has no shared cache (returns early).
 */
export async function deleteSharedCaptionsIfUnreferenced(
  hash: string,
  mediaId: string,
): Promise<void> {
  try {
    const remaining = await removeAiContentRef(hash, mediaId);
    if (remaining === 0) {
      // deleteAiContent is a warn-and-continue no-op when the dir is absent.
      await deleteAiContent(hash);
    }
  } catch (error) {
    logger.warn(`deleteSharedCaptionsIfUnreferenced(${hash}, ${mediaId}) failed`, error);
  }
}

export async function deleteCaptions(mediaId: string): Promise<void> {
  // Read the envelope first so we know whether a shared cache ref needs to
  // be released. Missing envelope means there's nothing to deref.
  let contentHash: string | undefined;
  try {
    const envelope = await readAiOutput(mediaId, 'captions');
    contentHash = envelope?.data.contentHash;
  } catch {
    contentHash = undefined;
  }

  try {
    await deleteAiOutput(mediaId, 'captions');
    await deleteCaptionThumbnails(mediaId);
    await deleteCaptionEmbeddings(mediaId);
  } catch (error) {
    logger.error(`deleteCaptions(${mediaId}) failed`, error);
    throw new Error(`Failed to delete captions: ${mediaId}`);
  }

  if (contentHash) {
    await deleteSharedCaptionsIfUnreferenced(contentHash, mediaId);
  }
}

/**
 * Populate a media item's per-media caption state from the shared content
 * cache. Writes `media/{mediaId}/cache/ai/captions.json` from the shared
 * envelope (so subsequent reads are cheap local reads) and registers this
 * media as a ref-holder. Heavy assets (bins, thumbnails) are not copied —
 * they stay shared in the content tree and are resolved by readers that
 * carry `contentHash` through.
 *
 * Returns the persisted captions on success, or `undefined` when the cache
 * miss (so the caller falls through to full analysis).
 */
export async function adoptCaptionsFromCache(
  mediaId: string,
  hash: string,
): Promise<AiOutput<'captions'> | undefined> {
  const envelope = await getCaptionsByContentHash(hash);
  if (!envelope) return undefined;

  try {
    await writeAiOutputAt(aiOutputPath(mediaId, 'captions'), {
      mediaId,
      kind: 'captions',
      service: envelope.service,
      model: envelope.model,
      params: envelope.params,
      data: { ...envelope.data, contentHash: hash },
    });
    await addAiContentRef(hash, mediaId);
    return envelope;
  } catch (error) {
    logger.warn(`adoptCaptionsFromCache(${mediaId}, ${hash}) failed`, error);
    // On failure the mediaId has no local envelope — caller should fall
    // through to regenerating captions rather than trusting a partial state.
    try {
      await deleteAiOutputAt(
        aiOutputPath(mediaId, 'captions'),
        `adoptCaptionsFromCache: rollback ${mediaId}`,
      );
    } catch {
      // ignore rollback failure; worst case is a stale envelope on disk
    }
    return undefined;
  }
}
