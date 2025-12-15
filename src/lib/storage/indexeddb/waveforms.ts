import type { WaveformData } from '@/types/storage';
import { getDB, reconnectDB } from './connection';
import { createLogger } from '@/lib/logger';

const logger = createLogger('IndexedDB:Waveforms');

/**
 * Save waveform data to IndexedDB.
 */
export async function saveWaveform(waveform: WaveformData): Promise<void> {
  try {
    let db = await getDB();
    if (!db.objectStoreNames.contains('waveforms')) {
      logger.warn('waveforms store not found, attempting reconnection...');
      db = await reconnectDB();
    }
    await db.put('waveforms', waveform);
  } catch (error) {
    logger.error('Failed to save waveform:', error);
    throw new Error('Failed to save waveform');
  }
}

/**
 * Get waveform by ID (mediaId).
 */
export async function getWaveform(
  id: string
): Promise<WaveformData | undefined> {
  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains('waveforms')) {
      logger.warn('waveforms store not found, attempting reconnection...');
      const newDb = await reconnectDB();
      if (!newDb.objectStoreNames.contains('waveforms')) {
        throw new Error('waveforms store not found after reconnection');
      }
      return await newDb.get('waveforms', id);
    }
    return await db.get('waveforms', id);
  } catch (error) {
    logger.error(`Failed to get waveform ${id}:`, error);
    return undefined;
  }
}

/**
 * Delete waveform by ID.
 */
export async function deleteWaveform(id: string): Promise<void> {
  try {
    let db = await getDB();
    if (!db.objectStoreNames.contains('waveforms')) {
      db = await reconnectDB();
      if (!db.objectStoreNames.contains('waveforms')) {
        return;
      }
    }
    await db.delete('waveforms', id);
  } catch (error) {
    logger.error(`Failed to delete waveform ${id}:`, error);
    throw new Error(`Failed to delete waveform: ${id}`);
  }
}
