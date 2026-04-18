/**
 * Per-media AI captions (vision-language-model frame descriptions).
 *
 * Stored at `media/{mediaId}/cache/ai/captions.json` as an {@link AiOutput}
 * envelope. A denormalized copy lives on `MediaMetadata.aiCaptions` as a
 * read-path convenience for UI consumers — writers must keep them in sync.
 */

import type { MediaCaption } from '@/infrastructure/analysis';
import { createLogger } from '@/shared/logging/logger';

import { readAiOutput, writeAiOutput, deleteAiOutput } from './ai-outputs';
import { readArrayBuffer, readBlob, removeEntry, writeBlob } from './fs-primitives';
import {
  captionEmbeddingsPath,
  captionImageEmbeddingsPath,
  captionThumbPath,
  captionThumbRelPath,
  captionThumbsDir,
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

export async function saveCaptions(input: SaveCaptionsInput): Promise<MediaCaption[]> {
  try {
    const written = await writeAiOutput({
      mediaId: input.mediaId,
      kind: 'captions',
      service: input.service,
      model: input.model,
      params: input.sampleIntervalSec !== undefined ? { sampleIntervalSec: input.sampleIntervalSec } : {},
      data: {
        sampleIntervalSec: input.sampleIntervalSec,
        embeddingModel: input.embeddingModel,
        embeddingDim: input.embeddingDim,
        imageEmbeddingModel: input.imageEmbeddingModel,
        imageEmbeddingDim: input.imageEmbeddingDim,
        captions: input.captions,
      },
    });
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
} | null> {
  const envelope = await readAiOutput(mediaId, 'captions');
  if (!envelope) return null;
  return {
    embeddingModel: envelope.data.embeddingModel,
    embeddingDim: envelope.data.embeddingDim,
    imageEmbeddingModel: envelope.data.imageEmbeddingModel,
    imageEmbeddingDim: envelope.data.imageEmbeddingDim,
  };
}

/**
 * Persist caption embeddings as a contiguous `Float32Array`. Layout is
 * `captionCount * embeddingDim` floats, stored in caption index order.
 * The companion `captions.json` records {@link embeddingModel} and
 * {@link embeddingDim} so a later read can detect model-drift before
 * trusting the payload.
 */
export async function saveCaptionEmbeddings(
  mediaId: string,
  vectors: Float32Array[],
  embeddingDim: number,
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
  try {
    await writeBlob(root, captionEmbeddingsPath(mediaId), packed.buffer);
  } catch (error) {
    logger.error(`saveCaptionEmbeddings(${mediaId}) failed`, error);
    throw new Error(`Failed to save caption embeddings: ${mediaId}`);
  }
}

/**
 * Load caption embeddings back into an array of `Float32Array`s. Returns
 * `null` when no `.bin` exists (pre-feature captions) or when the saved
 * vector count doesn't match `expectedCount` (captions changed under our
 * feet and the bin is stale).
 */
export async function getCaptionEmbeddings(
  mediaId: string,
  embeddingDim: number,
  expectedCount: number,
): Promise<Float32Array[] | null> {
  if (expectedCount === 0) return [];
  const root = requireWorkspaceRoot();
  try {
    const buffer = await readArrayBuffer(root, captionEmbeddingsPath(mediaId));
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

export async function deleteCaptionEmbeddings(mediaId: string): Promise<void> {
  const root = requireWorkspaceRoot();
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
  try {
    await writeBlob(root, captionImageEmbeddingsPath(mediaId), packed.buffer);
  } catch (error) {
    logger.error(`saveCaptionImageEmbeddings(${mediaId}) failed`, error);
    throw new Error(`Failed to save caption image embeddings: ${mediaId}`);
  }
}

export async function getCaptionImageEmbeddings(
  mediaId: string,
  embeddingDim: number,
  expectedCount: number,
): Promise<Float32Array[] | null> {
  if (expectedCount === 0) return [];
  const root = requireWorkspaceRoot();
  try {
    const buffer = await readArrayBuffer(root, captionImageEmbeddingsPath(mediaId));
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

export async function deleteCaptions(mediaId: string): Promise<void> {
  try {
    await deleteAiOutput(mediaId, 'captions');
    await deleteCaptionThumbnails(mediaId);
    await deleteCaptionEmbeddings(mediaId);
  } catch (error) {
    logger.error(`deleteCaptions(${mediaId}) failed`, error);
    throw new Error(`Failed to delete captions: ${mediaId}`);
  }
}

/**
 * Persist a single caption thumbnail JPEG. Returns the workspace-relative
 * path to stash on the corresponding `MediaCaption.thumbRelPath` so the
 * Scene Browser can load the blob back on demand.
 */
export async function saveCaptionThumbnail(
  mediaId: string,
  index: number,
  blob: Blob,
): Promise<string> {
  const root = requireWorkspaceRoot();
  try {
    await writeBlob(root, captionThumbPath(mediaId, index), blob);
    return captionThumbRelPath(mediaId, index);
  } catch (error) {
    logger.error(`saveCaptionThumbnail(${mediaId}, ${index}) failed`, error);
    throw new Error(`Failed to save caption thumbnail: ${mediaId}#${index}`);
  }
}

/**
 * Load a previously-saved caption thumbnail by its workspace-relative path.
 * Returns `null` when the file is missing (captions from before the feature
 * landed, or the directory was pruned).
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
 * still on disk.
 */
export async function probeCaptionThumbnail(
  mediaId: string,
  captionIndex: number,
): Promise<string | null> {
  const relPath = captionThumbRelPath(mediaId, captionIndex);
  const blob = await getCaptionThumbnailBlob(relPath);
  return blob ? relPath : null;
}

/**
 * Remove the `captions-thumbs` directory for a media item. No-op when the
 * directory is absent; never throws — thumbnail cleanup is opportunistic.
 */
export async function deleteCaptionThumbnails(mediaId: string): Promise<void> {
  const root = requireWorkspaceRoot();
  try {
    await removeEntry(root, captionThumbsDir(mediaId), { recursive: true });
  } catch (error) {
    logger.warn(`deleteCaptionThumbnails(${mediaId}) failed`, error);
  }
}
