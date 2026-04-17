/**
 * Per-media transcripts backed by the workspace folder.
 *
 * Persisted at `media/{mediaId}/cache/ai/transcript.json` as an
 * {@link AiOutput} envelope. Reads fall back to the legacy
 * `cache/transcript.json` path and rewrite-forward on next save, so this is
 * invisible to callers.
 *
 * The public API still exposes {@link MediaTranscript} — the flat record
 * shape predates the envelope and is what the UI and indexers consume.
 */

import type { MediaTranscript } from '@/types/storage';
import { createLogger } from '@/shared/logging/logger';

import { requireWorkspaceRoot } from './root';
import { readJson, removeEntry } from './fs-primitives';
import { legacyTranscriptPath } from './paths';
import {
  readAiOutput,
  writeAiOutput,
  deleteAiOutput,
  getMediaIdsWithAiOutput,
  transcriptFromLegacy,
  transcriptToLegacy,
} from './ai-outputs';

const logger = createLogger('WorkspaceFS:Transcripts');

async function readLegacyTranscript(mediaId: string): Promise<MediaTranscript | undefined> {
  const root = requireWorkspaceRoot();
  const legacy = await readJson<MediaTranscript>(root, legacyTranscriptPath(mediaId));
  return legacy ?? undefined;
}

export async function getTranscript(
  mediaId: string,
): Promise<MediaTranscript | undefined> {
  try {
    const envelope = await readAiOutput(mediaId, 'transcript');
    if (envelope) return transcriptToLegacy(envelope);

    const legacy = await readLegacyTranscript(mediaId);
    return legacy ?? undefined;
  } catch (error) {
    logger.error(`getTranscript(${mediaId}) failed`, error);
    throw new Error(`Failed to load transcript: ${mediaId}`);
  }
}

export async function getTranscriptMediaIds(
  mediaIds: string[],
): Promise<Set<string>> {
  if (mediaIds.length === 0) return new Set();
  try {
    const ready = await getMediaIdsWithAiOutput(mediaIds, 'transcript');
    const missing = mediaIds.filter((id) => !ready.has(id));
    if (missing.length > 0) {
      const legacyResults = await Promise.all(
        missing.map(async (id) => ((await readLegacyTranscript(id)) ? id : null)),
      );
      for (const id of legacyResults) {
        if (id) ready.add(id);
      }
    }
    return ready;
  } catch (error) {
    logger.error('getTranscriptMediaIds failed', error);
    throw new Error('Failed to enumerate transcripts');
  }
}

export async function saveTranscript(
  transcript: MediaTranscript,
): Promise<MediaTranscript> {
  try {
    const envelope = transcriptFromLegacy(transcript);
    const written = await writeAiOutput({
      mediaId: envelope.mediaId,
      kind: 'transcript',
      service: envelope.service,
      model: envelope.model,
      params: envelope.params,
      data: envelope.data,
    });

    // Fire-and-forget legacy-path cleanup on successful migration.
    const root = requireWorkspaceRoot();
    void removeEntry(root, legacyTranscriptPath(transcript.mediaId)).catch(
      (error) => logger.warn(`legacy transcript cleanup failed for ${transcript.mediaId}`, error),
    );

    return transcriptToLegacy(written);
  } catch (error) {
    logger.error(`saveTranscript(${transcript.mediaId}) failed`, error);
    throw new Error(`Failed to save transcript: ${transcript.mediaId}`);
  }
}

export async function deleteTranscript(mediaId: string): Promise<void> {
  try {
    await deleteAiOutput(mediaId, 'transcript');
    const root = requireWorkspaceRoot();
    await removeEntry(root, legacyTranscriptPath(mediaId));
  } catch (error) {
    logger.error(`deleteTranscript(${mediaId}) failed`, error);
    throw new Error(`Failed to delete transcript: ${mediaId}`);
  }
}
