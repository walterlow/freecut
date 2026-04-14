import type { MediaTranscript } from '@/types/storage';
import { getDB } from './connection';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('IndexedDB:Transcripts');

export async function getTranscript(mediaId: string): Promise<MediaTranscript | undefined> {
  try {
    const db = await getDB();
    return await db.get('transcripts', mediaId);
  } catch (error) {
    logger.error(`Failed to get transcript for media ${mediaId}:`, error);
    throw new Error(`Failed to load transcript: ${mediaId}`);
  }
}

export async function getTranscriptMediaIds(mediaIds: string[]): Promise<Set<string>> {
  if (mediaIds.length === 0) {
    return new Set();
  }

  try {
    const db = await getDB();
    const results = await Promise.all(mediaIds.map((mediaId) => db.get('transcripts', mediaId)));
    const readyIds = new Set<string>();
    results.forEach((result) => {
      if (result?.mediaId) {
        readyIds.add(result.mediaId);
      }
    });
    return readyIds;
  } catch (error) {
    logger.error('Failed to enumerate transcript media IDs:', error);
    throw new Error('Failed to enumerate transcripts');
  }
}

export async function saveTranscript(transcript: MediaTranscript): Promise<MediaTranscript> {
  try {
    const db = await getDB();
    await db.put('transcripts', transcript);
    return transcript;
  } catch (error) {
    logger.error(`Failed to save transcript for media ${transcript.mediaId}:`, error);
    throw new Error(`Failed to save transcript: ${transcript.mediaId}`);
  }
}

export async function deleteTranscript(mediaId: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete('transcripts', mediaId);
  } catch (error) {
    logger.error(`Failed to delete transcript for media ${mediaId}:`, error);
    throw new Error(`Failed to delete transcript: ${mediaId}`);
  }
}
