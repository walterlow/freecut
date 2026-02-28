/**
 * OPFS Waveform Storage
 *
 * Multi-resolution binary format for efficient waveform storage with random access:
 *
 * Header (48 bytes):
 *   - Magic: "WFORM" (5 bytes)
 *   - Version: uint8 (1 byte)
 *   - Duration: float32 (4 bytes)
 *   - Channels: uint8 (1 byte)
 *   - Level count: uint8 (1 byte)
 *   - Reserved: (36 bytes)
 *
 * Level Index (12 bytes per level):
 *   - Sample rate: uint16 (2 bytes)
 *   - Sample count: uint32 (4 bytes)
 *   - Data offset: uint32 (4 bytes)
 *   - Reserved: (2 bytes)
 *
 * Data:
 *   - Float32 peak values for each level, concatenated
 *
 * Resolution levels (for efficient zoom rendering):
 *   - Level 0: 1000 samples/sec (highest detail, zoomed in)
 *   - Level 1: 200 samples/sec (medium detail)
 *   - Level 2: 50 samples/sec (low detail, zoomed out)
 *   - Level 3: 10 samples/sec (overview)
 */

import { createLogger } from '@/shared/logging/logger';
import { getCacheMigration } from '@/infrastructure/storage/cache-version';

const logger = createLogger('WaveformOPFS');

const MAGIC = 'WFORM';
const BINARY_VERSION = 1; // Version stored in file header (for parsing)
const HEADER_SIZE = 48;
const LEVEL_INDEX_SIZE = 12;
const WAVEFORM_DIR = 'waveforms';

// Multi-resolution levels (samples per second)
export const WAVEFORM_LEVELS = [1000, 200, 50, 10] as const;

interface WaveformHeader {
  duration: number;
  channels: number;
  levelCount: number;
}

interface LevelIndex {
  sampleRate: number;
  sampleCount: number;
  offset: number;
}

export interface MultiResolutionWaveform {
  duration: number;
  channels: number;
  levels: {
    sampleRate: number;
    peaks: Float32Array;
  }[];
}

/**
 * Choose the best resolution level for a given pixelsPerSecond
 * Higher zoom (more pixels/sec) = higher resolution needed
 */
export function chooseLevelForZoom(pixelsPerSecond: number): number {
  // Bars are typically 2-3 pixels wide, so we want ~1 sample per 3 pixels
  const desiredSamplesPerSecond = pixelsPerSecond / 3;

  for (let i = 0; i < WAVEFORM_LEVELS.length; i++) {
    if (WAVEFORM_LEVELS[i]! <= desiredSamplesPerSecond * 2) {
      return i;
    }
  }
  return WAVEFORM_LEVELS.length - 1;
}

/**
 * OPFS Waveform Storage Service
 * Provides efficient multi-resolution binary storage with range-based access
 */
class WaveformOPFSStorage {
  private rootHandle: FileSystemDirectoryHandle | null = null;
  private dirHandle: FileSystemDirectoryHandle | null = null;
  private initPromise: Promise<FileSystemDirectoryHandle> | null = null;

  /**
   * Initialize OPFS directory (with migration)
   */
  private async ensureDirectory(): Promise<FileSystemDirectoryHandle> {
    // Return cached handle if ready
    if (this.dirHandle) return this.dirHandle;

    // Ensure only one initialization runs
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initializeWithMigration();
    return this.initPromise;
  }

  /**
   * Initialize directory and run migration if needed
   */
  private async initializeWithMigration(): Promise<FileSystemDirectoryHandle> {
    try {
      this.rootHandle = await navigator.storage.getDirectory();
      const dir = await this.rootHandle.getDirectoryHandle(WAVEFORM_DIR, {
        create: true,
      });

      // Run migration BEFORE setting dirHandle (blocks all access until complete)
      const migration = getCacheMigration('waveform');
      if (migration.needsMigration) {
        const entries: string[] = [];
        for await (const entry of dir.values()) {
          if (entry.kind === 'file') {
            entries.push(entry.name);
          }
        }

        for (const name of entries) {
          await dir.removeEntry(name).catch(() => {});
        }

        migration.markComplete();
        logger.info(`Waveform cache version updated: v${migration.oldVersion ?? 'none'} â†’ v${migration.newVersion}${entries.length > 0 ? ` (cleared ${entries.length} files)` : ''}`)
      }

      this.dirHandle = dir;
      return dir;
    } catch (error) {
      logger.error('Failed to initialize OPFS waveform directory:', error);
      throw error;
    }
  }

  /**
   * Write header to buffer
   */
  private writeHeader(view: DataView, header: WaveformHeader): void {
    let offset = 0;

    // Magic bytes
    for (let i = 0; i < MAGIC.length; i++) {
      view.setUint8(offset++, MAGIC.charCodeAt(i));
    }

    // Version
    view.setUint8(offset++, BINARY_VERSION);

    // Duration (float32)
    view.setFloat32(offset, header.duration, true);
    offset += 4;

    // Channels
    view.setUint8(offset++, header.channels);

    // Level count
    view.setUint8(offset++, header.levelCount);

    // Reserved bytes (remaining up to HEADER_SIZE)
  }

  /**
   * Read header from buffer
   */
  private readHeader(view: DataView): WaveformHeader | null {
    let offset = 0;

    // Verify magic
    let magic = '';
    for (let i = 0; i < MAGIC.length; i++) {
      magic += String.fromCharCode(view.getUint8(offset++));
    }
    if (magic !== MAGIC) {
      logger.warn('Invalid waveform magic bytes');
      return null;
    }

    // Check version
    const version = view.getUint8(offset++);
    if (version !== BINARY_VERSION) {
      // Old version - will be auto-cleared by migration
      return null;
    }

    // Duration
    const duration = view.getFloat32(offset, true);
    offset += 4;

    // Channels
    const channels = view.getUint8(offset++);

    // Level count
    const levelCount = view.getUint8(offset);

    return { duration, channels, levelCount };
  }

  /**
   * Write level index entry
   */
  private writeLevelIndex(
    view: DataView,
    index: number,
    entry: LevelIndex
  ): void {
    const offset = HEADER_SIZE + index * LEVEL_INDEX_SIZE;
    view.setUint16(offset, entry.sampleRate, true);
    view.setUint32(offset + 2, entry.sampleCount, true);
    view.setUint32(offset + 6, entry.offset, true);
    // 2 bytes reserved
  }

  /**
   * Read level index entry
   */
  private readLevelIndex(view: DataView, index: number): LevelIndex {
    const offset = HEADER_SIZE + index * LEVEL_INDEX_SIZE;
    return {
      sampleRate: view.getUint16(offset, true),
      sampleCount: view.getUint32(offset + 2, true),
      offset: view.getUint32(offset + 6, true),
    };
  }

  /**
   * Generate multi-resolution peaks from source peaks
   */
  generateMultiResolution(
    sourcePeaks: Float32Array,
    sourceSampleRate: number,
    duration: number
  ): { sampleRate: number; peaks: Float32Array }[] {
    const levels: { sampleRate: number; peaks: Float32Array }[] = [];

    for (const targetRate of WAVEFORM_LEVELS) {
      if (targetRate >= sourceSampleRate) {
        // Can't upsample, use source directly or skip
        if (levels.length === 0) {
          // First level - use source as-is
          levels.push({ sampleRate: sourceSampleRate, peaks: sourcePeaks });
        }
        continue;
      }

      // Downsample from source
      const numSamples = Math.ceil(duration * targetRate);
      const ratio = sourceSampleRate / targetRate;
      const downsampled = new Float32Array(numSamples);

      for (let i = 0; i < numSamples; i++) {
        const startIdx = Math.floor(i * ratio);
        const endIdx = Math.min(Math.floor((i + 1) * ratio), sourcePeaks.length);

        // Take max peak in the range
        let maxPeak = 0;
        for (let j = startIdx; j < endIdx; j++) {
          const val = sourcePeaks[j] ?? 0;
          if (val > maxPeak) maxPeak = val;
        }
        downsampled[i] = maxPeak;
      }

      levels.push({ sampleRate: targetRate, peaks: downsampled });
    }

    return levels;
  }

  /**
   * Save waveform to OPFS with multi-resolution levels
   */
  async save(
    mediaId: string,
    waveform: MultiResolutionWaveform
  ): Promise<void> {
    const dir = await this.ensureDirectory();
    const fileName = `${mediaId}.bin`;

    try {
      const levelCount = waveform.levels.length;
      const indexSize = levelCount * LEVEL_INDEX_SIZE;
      const headerAndIndexSize = HEADER_SIZE + indexSize;

      // Calculate total data size
      let totalDataSize = 0;
      for (const level of waveform.levels) {
        totalDataSize += level.peaks.byteLength;
      }

      // Create buffer
      const totalSize = headerAndIndexSize + totalDataSize;
      const buffer = new ArrayBuffer(totalSize);
      const view = new DataView(buffer);
      const uint8 = new Uint8Array(buffer);

      // Write header
      this.writeHeader(view, {
        duration: waveform.duration,
        channels: waveform.channels,
        levelCount,
      });

      // Write index and data
      let dataOffset = headerAndIndexSize;
      for (let i = 0; i < levelCount; i++) {
        const level = waveform.levels[i]!;

        // Write index entry
        this.writeLevelIndex(view, i, {
          sampleRate: level.sampleRate,
          sampleCount: level.peaks.length,
          offset: dataOffset,
        });

        // Write level data
        uint8.set(new Uint8Array(level.peaks.buffer), dataOffset);
        dataOffset += level.peaks.byteLength;
      }

      // Write to OPFS
      const fileHandle = await dir.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(buffer);
      await writable.close();

      logger.debug(
        `Saved waveform ${mediaId}: ${levelCount} levels, ${(totalSize / 1024).toFixed(1)}KB`
      );
    } catch (error) {
      logger.error(`Failed to save waveform ${mediaId}:`, error);
      throw error;
    }
  }

  /**
   * Check if waveform exists
   */
  async exists(mediaId: string): Promise<boolean> {
    try {
      const dir = await this.ensureDirectory();
      await dir.getFileHandle(`${mediaId}.bin`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get waveform metadata without loading data
   */
  async getMetadata(
    mediaId: string
  ): Promise<{ header: WaveformHeader; levels: LevelIndex[] } | null> {
    try {
      const dir = await this.ensureDirectory();
      const fileHandle = await dir.getFileHandle(`${mediaId}.bin`);
      const file = await fileHandle.getFile();

      // Read header
      const headerBuffer = await file.slice(0, HEADER_SIZE).arrayBuffer();
      const header = this.readHeader(new DataView(headerBuffer));
      if (!header) return null;

      // Read level index
      const indexSize = header.levelCount * LEVEL_INDEX_SIZE;
      const indexBuffer = await file
        .slice(HEADER_SIZE, HEADER_SIZE + indexSize)
        .arrayBuffer();
      const indexView = new DataView(indexBuffer);

      const levels: LevelIndex[] = [];
      for (let i = 0; i < header.levelCount; i++) {
        levels.push(this.readLevelIndex(indexView, i));
      }

      return { header, levels };
    } catch {
      return null;
    }
  }

  /**
   * Get a specific resolution level (full)
   */
  async getLevel(
    mediaId: string,
    levelIndex: number
  ): Promise<{ sampleRate: number; peaks: Float32Array } | null> {
    try {
      const dir = await this.ensureDirectory();
      let fileHandle;
      try {
        fileHandle = await dir.getFileHandle(`${mediaId}.bin`);
      } catch {
        return null;
      }

      const file = await fileHandle.getFile();

      // Read entire file at once to avoid OPFS concurrency issues with multiple slice() calls
      const buffer = await file.arrayBuffer();
      const view = new DataView(buffer);

      // Parse header
      const header = this.readHeader(view);
      if (!header || levelIndex >= header.levelCount) {
        return null;
      }

      // Read level index and extract data
      const level = this.readLevelIndex(view, levelIndex);
      const dataSize = level.sampleCount * 4; // Float32 = 4 bytes
      const peaks = new Float32Array(buffer.slice(level.offset, level.offset + dataSize));
      return {
        sampleRate: level.sampleRate,
        peaks,
      };
    } catch (error) {
      // NotFoundError is expected when cache doesn't exist - return null silently
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return null;
      }
      // RangeError means corrupted/old format data - silently delete so it regenerates
      if (error instanceof RangeError) {
        await this.delete(mediaId).catch(() => {});
        return null;
      }
      logger.error(`Failed to get waveform level ${levelIndex} for ${mediaId}:`, error);
      return null;
    }
  }

  /**
   * Get a range of samples from a specific level
   * For range-based loading of visible portion only
   */
  async getLevelRange(
    mediaId: string,
    levelIndex: number,
    startTime: number,
    endTime: number
  ): Promise<{ sampleRate: number; peaks: Float32Array; startSample: number } | null> {
    try {
      const dir = await this.ensureDirectory();
      let fileHandle;
      try {
        fileHandle = await dir.getFileHandle(`${mediaId}.bin`);
      } catch {
        return null;
      }
      const file = await fileHandle.getFile();

      // Read entire file at once to avoid OPFS concurrency issues
      const buffer = await file.arrayBuffer();
      const view = new DataView(buffer);

      // Parse header
      const header = this.readHeader(view);
      if (!header || levelIndex >= header.levelCount) return null;

      // Read level index
      const level = this.readLevelIndex(view, levelIndex);

      // Calculate sample range
      const startSample = Math.max(0, Math.floor(startTime * level.sampleRate));
      const endSample = Math.min(
        level.sampleCount,
        Math.ceil(endTime * level.sampleRate)
      );
      const sampleCount = endSample - startSample;

      if (sampleCount <= 0) return null;

      // Extract range from buffer
      const rangeOffset = level.offset + startSample * 4;
      const rangeSize = sampleCount * 4;
      const peaks = new Float32Array(buffer.slice(rangeOffset, rangeOffset + rangeSize));

      return {
        sampleRate: level.sampleRate,
        peaks,
        startSample,
      };
    } catch (error) {
      // RangeError means corrupted/old format data - silently delete so it regenerates
      if (error instanceof RangeError) {
        await this.delete(mediaId).catch(() => {});
        return null;
      }
      logger.error(`Failed to get waveform range for ${mediaId}:`, error);
      return null;
    }
  }

  /**
   * Load all levels (for full waveform load)
   */
  async getAllLevels(mediaId: string): Promise<MultiResolutionWaveform | null> {
    try {
      const dir = await this.ensureDirectory();
      const fileHandle = await dir.getFileHandle(`${mediaId}.bin`);
      const file = await fileHandle.getFile();

      // Read entire file
      const buffer = await file.arrayBuffer();
      const view = new DataView(buffer);

      // Parse header
      const header = this.readHeader(view);
      if (!header) return null;

      // Parse levels
      const levels: { sampleRate: number; peaks: Float32Array }[] = [];
      for (let i = 0; i < header.levelCount; i++) {
        const levelIndex = this.readLevelIndex(view, i);
        const dataSize = levelIndex.sampleCount * 4;
        const peaks = new Float32Array(
          buffer.slice(levelIndex.offset, levelIndex.offset + dataSize)
        );
        levels.push({
          sampleRate: levelIndex.sampleRate,
          peaks,
        });
      }

      return {
        duration: header.duration,
        channels: header.channels,
        levels,
      };
    } catch {
      return null;
    }
  }

  /**
   * Delete waveform
   */
  async delete(mediaId: string): Promise<void> {
    try {
      const dir = await this.ensureDirectory();
      await dir.removeEntry(`${mediaId}.bin`);
    } catch {
      // File may not exist, ignore
    }
  }

  /**
   * List all stored waveforms
   */
  async list(): Promise<string[]> {
    try {
      const dir = await this.ensureDirectory();
      const mediaIds: string[] = [];

      for await (const entry of dir.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.bin')) {
          mediaIds.push(entry.name.replace('.bin', ''));
        }
      }

      return mediaIds;
    } catch {
      return [];
    }
  }

  /**
   * Get storage usage
   */
  async getStorageUsage(): Promise<{ count: number; totalBytes: number }> {
    try {
      const dir = await this.ensureDirectory();
      let count = 0;
      let totalBytes = 0;

      for await (const entry of dir.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.bin')) {
          count++;
          const fileHandle = await dir.getFileHandle(entry.name);
          const file = await fileHandle.getFile();
          totalBytes += file.size;
        }
      }

      return { count, totalBytes };
    } catch {
      return { count: 0, totalBytes: 0 };
    }
  }

  /**
   * Clear all waveforms
   */
  async clearAll(): Promise<void> {
    try {
      const dir = await this.ensureDirectory();
      const entries: string[] = [];

      for await (const entry of dir.values()) {
        if (entry.kind === 'file') {
          entries.push(entry.name);
        }
      }

      for (const name of entries) {
        await dir.removeEntry(name);
      }

      logger.debug(`Cleared ${entries.length} waveforms from OPFS`);
    } catch (error) {
      logger.error('Failed to clear waveforms:', error);
    }
  }
}

// Singleton instance
export const waveformOPFSStorage = new WaveformOPFSStorage();

