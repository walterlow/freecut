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
        captions: input.captions,
      },
    });
    return written.data.captions;
  } catch (error) {
    logger.error(`saveCaptions(${input.mediaId}) failed`, error);
    throw new Error(`Failed to save captions: ${input.mediaId}`);
  }
}

export async function deleteCaptions(mediaId: string): Promise<void> {
  try {
    await deleteAiOutput(mediaId, 'captions');
  } catch (error) {
    logger.error(`deleteCaptions(${mediaId}) failed`, error);
    throw new Error(`Failed to delete captions: ${mediaId}`);
  }
}
