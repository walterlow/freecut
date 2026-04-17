/**
 * Per-media scene-detection results.
 *
 * Stored at `media/{mediaId}/cache/ai/scenes.json` as an {@link AiOutput}
 * envelope. Scene cuts are a property of the source media (not the timeline
 * clip), so caching by `mediaId` survives trim/split edits.
 *
 * Detection parameters (method, sample interval, verification model) are
 * persisted in the envelope so consumers can skip the expensive recompute
 * when the requested parameters match, and re-run when they don't.
 */

import type { SceneCut } from '@/infrastructure/analysis';
import { createLogger } from '@/shared/logging/logger';

import { readAiOutput, writeAiOutput, deleteAiOutput } from './ai-outputs';
import type { ScenesPayload, SceneCutPayload } from './ai-outputs';

const logger = createLogger('WorkspaceFS:Scenes');

export interface SavedScenes {
  method: 'histogram' | 'optical-flow';
  sampleIntervalMs: number;
  verificationModel?: string;
  fps: number;
  cuts: SceneCut[];
}

interface SaveScenesInput extends SavedScenes {
  mediaId: string;
  /** Stable provider id (e.g. `"scene-detect-histogram"`, `"scene-detect-optical-flow"`). */
  service: string;
  /** Detector/model identifier — for histogram this is just `"histogram"`. */
  model: string;
}

function cutsToPayload(cuts: SceneCut[]): SceneCutPayload[] {
  return cuts.map((cut) => ({
    frame: cut.frame,
    time: cut.time,
    motion: cut.motion,
    verified: cut.verified,
  }));
}

function payloadToCuts(cuts: SceneCutPayload[]): SceneCut[] {
  return cuts as unknown as SceneCut[];
}

export async function getScenes(mediaId: string): Promise<SavedScenes | undefined> {
  try {
    const envelope = await readAiOutput(mediaId, 'scenes');
    if (!envelope) return undefined;
    const data: ScenesPayload = envelope.data;
    return {
      method: data.method,
      sampleIntervalMs: data.sampleIntervalMs,
      verificationModel: data.verificationModel,
      fps: data.fps,
      cuts: payloadToCuts(data.cuts),
    };
  } catch (error) {
    logger.error(`getScenes(${mediaId}) failed`, error);
    throw new Error(`Failed to load scenes: ${mediaId}`);
  }
}

export async function saveScenes(input: SaveScenesInput): Promise<SavedScenes> {
  try {
    const payload: ScenesPayload = {
      method: input.method,
      sampleIntervalMs: input.sampleIntervalMs,
      verificationModel: input.verificationModel,
      fps: input.fps,
      cuts: cutsToPayload(input.cuts),
    };
    await writeAiOutput({
      mediaId: input.mediaId,
      kind: 'scenes',
      service: input.service,
      model: input.model,
      params: {
        method: input.method,
        sampleIntervalMs: input.sampleIntervalMs,
        verificationModel: input.verificationModel ?? null,
      },
      data: payload,
    });
    return {
      method: input.method,
      sampleIntervalMs: input.sampleIntervalMs,
      verificationModel: input.verificationModel,
      fps: input.fps,
      cuts: input.cuts,
    };
  } catch (error) {
    logger.error(`saveScenes(${input.mediaId}) failed`, error);
    throw new Error(`Failed to save scenes: ${input.mediaId}`);
  }
}

export async function deleteScenes(mediaId: string): Promise<void> {
  try {
    await deleteAiOutput(mediaId, 'scenes');
  } catch (error) {
    logger.error(`deleteScenes(${mediaId}) failed`, error);
    throw new Error(`Failed to delete scenes: ${mediaId}`);
  }
}
