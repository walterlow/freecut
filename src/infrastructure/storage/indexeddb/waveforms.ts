import type {
  WaveformBin,
  WaveformData,
  WaveformMeta,
  WaveformRecord,
} from '@/types/storage';
import { getDB, reconnectDB } from './connection';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('IndexedDB:Waveforms');
const BIN_KEY_PREFIX = ':bin:';

async function getStore() {
  let db = await getDB();
  if (!db.objectStoreNames.contains('waveforms')) {
    logger.warn('waveforms store not found, attempting reconnection...');
    db = await reconnectDB();
    if (!db.objectStoreNames.contains('waveforms')) {
      throw new Error('waveforms store not found after reconnection');
    }
  }
  return db;
}

/**
 * Get waveform by ID (mediaId).
 * Returns legacy single-record waveforms only.
 */
export async function getWaveform(
  id: string
): Promise<WaveformData | undefined> {
  try {
    const db = await getStore();
    const record = await db.get('waveforms', id);
    if (!record) return undefined;
    if ('kind' in record) {
      return undefined;
    }
    return record;
  } catch (error) {
    logger.error(`Failed to get waveform ${id}:`, error);
    return undefined;
  }
}

/**
 * Get any waveform record by key (legacy, meta, or bin).
 */
export async function getWaveformRecord(
  id: string
): Promise<WaveformRecord | undefined> {
  try {
    const db = await getStore();
    return await db.get('waveforms', id);
  } catch (error) {
    logger.error(`Failed to get waveform record ${id}:`, error);
    return undefined;
  }
}

/**
 * Save a waveform record (legacy, meta, or bin).
 */
export async function saveWaveformRecord(
  data: WaveformRecord
): Promise<void> {
  const db = await getStore();
  try {
    await db.put('waveforms', data);
  } catch (error) {
    logger.error(`Failed to save waveform record ${data.id}:`, error);
    throw error;
  }
}

/**
 * Load waveform meta completion marker.
 */
export async function getWaveformMeta(
  mediaId: string
): Promise<WaveformMeta | undefined> {
  const record = await getWaveformRecord(mediaId);
  if (!record || !('kind' in record) || record.kind !== 'meta') {
    return undefined;
  }
  return record;
}

/**
 * Save waveform meta completion marker.
 */
export async function saveWaveformMeta(meta: WaveformMeta): Promise<void> {
  await saveWaveformRecord(meta);
}

/**
 * Save one waveform bin.
 */
export async function saveWaveformBin(bin: WaveformBin): Promise<void> {
  await saveWaveformRecord(bin);
}

/**
 * Delete waveform by ID.
 * Deletes legacy record, meta marker, and all bin records for mediaId.
 */
export async function deleteWaveform(id: string): Promise<void> {
  try {
    const db = await getStore();
    const tx = db.transaction('waveforms', 'readwrite');

    // Delete direct key (legacy waveform or meta marker).
    await tx.store.delete(id);

    // Delete all indexed records for this media (bins + any legacy duplicates).
    const index = tx.store.index('mediaId');
    let cursor = await index.openCursor(id);
    while (cursor) {
      // Keep direct key already deleted; still safe to delete again.
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  } catch (error) {
    logger.error(`Failed to delete waveform ${id}:`, error);
    throw new Error(`Failed to delete waveform: ${id}`);
  }
}

/**
 * Get all bin records for a completed waveform (parallel read by key).
 */
export async function getWaveformBins(
  mediaId: string,
  binCount: number
): Promise<(WaveformBin | undefined)[]> {
  try {
    const db = await getStore();
    const keys: string[] = [];
    for (let i = 0; i < binCount; i++) {
      keys.push(`${mediaId}${BIN_KEY_PREFIX}${i}`);
    }
    const records = await Promise.all(keys.map((key) => db.get('waveforms', key)));
    return records.map((record) =>
      record && 'kind' in record && record.kind === 'bin' ? record : undefined
    );
  } catch (error) {
    logger.error(`Failed to get waveform bins ${mediaId}:`, error);
    return [];
  }
}
