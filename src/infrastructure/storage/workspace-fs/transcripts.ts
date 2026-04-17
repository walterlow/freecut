/**
 * Per-media transcripts backed by the workspace folder.
 *
 * Stored at `media/{mediaId}/cache/transcript.json`. Pure JSON record —
 * no binary data or handles involved.
 */

import type { MediaTranscript } from '@/types/storage';
import { createLogger } from '@/shared/logging/logger';

import { requireWorkspaceRoot } from './root';
import {
  readJson,
  removeEntry,
  writeJsonAtomic,
} from './fs-primitives';
import { transcriptPath } from './paths';

const logger = createLogger('WorkspaceFS:Transcripts');

export async function getTranscript(
  mediaId: string,
): Promise<MediaTranscript | undefined> {
  const root = requireWorkspaceRoot();
  try {
    const transcript = await readJson<MediaTranscript>(root, transcriptPath(mediaId));
    return transcript ?? undefined;
  } catch (error) {
    logger.error(`getTranscript(${mediaId}) failed`, error);
    throw new Error(`Failed to load transcript: ${mediaId}`);
  }
}

export async function getTranscriptMediaIds(
  mediaIds: string[],
): Promise<Set<string>> {
  if (mediaIds.length === 0) return new Set();
  const root = requireWorkspaceRoot();
  try {
    const ready = new Set<string>();
    const results = await Promise.all(
      mediaIds.map(async (id) => {
        const t = await readJson<MediaTranscript>(root, transcriptPath(id));
        return t ?? null;
      }),
    );
    results.forEach((r) => {
      if (r?.mediaId) ready.add(r.mediaId);
    });
    return ready;
  } catch (error) {
    logger.error('getTranscriptMediaIds failed', error);
    throw new Error('Failed to enumerate transcripts');
  }
}

export async function saveTranscript(
  transcript: MediaTranscript,
): Promise<MediaTranscript> {
  const root = requireWorkspaceRoot();
  try {
    await writeJsonAtomic(root, transcriptPath(transcript.mediaId), transcript);
    return transcript;
  } catch (error) {
    logger.error(`saveTranscript(${transcript.mediaId}) failed`, error);
    throw new Error(`Failed to save transcript: ${transcript.mediaId}`);
  }
}

export async function deleteTranscript(mediaId: string): Promise<void> {
  const root = requireWorkspaceRoot();
  try {
    await removeEntry(root, transcriptPath(mediaId));
  } catch (error) {
    logger.error(`deleteTranscript(${mediaId}) failed`, error);
    throw new Error(`Failed to delete transcript: ${mediaId}`);
  }
}
