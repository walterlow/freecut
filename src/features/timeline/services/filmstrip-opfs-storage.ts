/**
 * OPFS Filmstrip Storage
 *
 * Simple storage for filmstrip frames. Worker handles saving,
 * this service handles loading and providing object URLs.
 *
 * Storage structure:
 *   filmstrips/{mediaId}/
 *     meta.json - { width, height, isComplete, frameCount }
 *     0.webp, 1.webp, 2.webp, ...
 */

import { createLogger } from '@/lib/logger';
import { getCacheMigration } from '@/lib/storage/cache-version';

const logger = createLogger('FilmstripOPFS');

const FILMSTRIP_DIR = 'filmstrips';
const FRAME_RATE = 1; // Must match worker - 1fps for filmstrip thumbnails

interface FilmstripMetadata {
  width: number;
  height: number;
  isComplete: boolean;
  frameCount: number;
}

export interface FilmstripFrame {
  index: number;
  timestamp: number;
  url: string; // Object URL for img src
}

interface LoadedFilmstrip {
  metadata: FilmstripMetadata;
  frames: FilmstripFrame[];
  existingIndices: number[];
}

/**
 * OPFS Filmstrip Storage Service
 */
class FilmstripOPFSStorage {
  private dirHandle: FileSystemDirectoryHandle | null = null;
  private initPromise: Promise<FileSystemDirectoryHandle> | null = null;
  private objectUrls = new Map<string, string[]>(); // mediaId -> urls for cleanup

  /**
   * Initialize OPFS directory
   */
  private async ensureDirectory(): Promise<FileSystemDirectoryHandle> {
    if (this.dirHandle) return this.dirHandle;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initialize();
    return this.initPromise;
  }

  private async initialize(): Promise<FileSystemDirectoryHandle> {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(FILMSTRIP_DIR, { create: true });

      // Run migration if needed
      const migration = getCacheMigration('filmstrip');
      if (migration.needsMigration) {
        const entries: string[] = [];
        for await (const entry of dir.values()) {
          entries.push(entry.name);
        }
        for (const name of entries) {
          await dir.removeEntry(name, { recursive: true }).catch(() => {});
        }
        migration.markComplete();
        logger.info(`Filmstrip cache cleared for v${migration.newVersion}`);
      }

      this.dirHandle = dir;
      return dir;
    } catch (error) {
      logger.error('Failed to initialize OPFS:', error);
      throw error;
    }
  }

  /**
   * Get media directory handle
   */
  private async getMediaDir(mediaId: string): Promise<FileSystemDirectoryHandle | null> {
    const dir = await this.ensureDirectory();
    try {
      return await dir.getDirectoryHandle(mediaId);
    } catch {
      return null;
    }
  }

  /**
   * Get or create media directory handle
   */
  private async getOrCreateMediaDir(mediaId: string): Promise<FileSystemDirectoryHandle> {
    const dir = await this.ensureDirectory();
    return dir.getDirectoryHandle(mediaId, { create: true });
  }

  /**
   * Save metadata file (used by worker and fallback extraction)
   */
  async saveMetadata(
    mediaId: string,
    metadata: { width: number; height: number; isComplete: boolean; frameCount: number }
  ): Promise<void> {
    const mediaDir = await this.getOrCreateMediaDir(mediaId);
    const fileHandle = await mediaDir.getFileHandle('meta.json', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(metadata));
    await writable.close();
  }

  /**
   * Save a frame blob at a specific index
   */
  async saveFrameBlob(mediaId: string, index: number, blob: Blob): Promise<void> {
    const mediaDir = await this.getOrCreateMediaDir(mediaId);
    const fileHandle = await mediaDir.getFileHandle(`${index}.webp`, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  /**
   * Load filmstrip - returns object URLs for img src
   */
  async load(mediaId: string): Promise<LoadedFilmstrip | null> {
    try {
      const mediaDir = await this.getMediaDir(mediaId);
      if (!mediaDir) return null;

      // Load metadata
      let metadata: FilmstripMetadata;
      try {
        const metaHandle = await mediaDir.getFileHandle('meta.json');
        const metaFile = await metaHandle.getFile();
        metadata = JSON.parse(await metaFile.text());
      } catch {
        return null;
      }

      // Collect frame files
      const frameFiles: { index: number; file: File }[] = [];
      for await (const entry of mediaDir.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.webp')) {
          const index = parseInt(entry.name.replace('.webp', ''), 10);
          if (!isNaN(index)) {
            try {
              const fileHandle = await mediaDir.getFileHandle(entry.name);
              const file = await fileHandle.getFile();
              if (file.size > 0) {
                frameFiles.push({ index, file });
              }
            } catch {
              // Skip unreadable files
            }
          }
        }
      }

      // Sort by index
      frameFiles.sort((a, b) => a.index - b.index);

      // Don't revoke URLs here - they may still be in use by displayed components.
      // URLs are only cleaned up when filmstrip is explicitly deleted or cleared.

      // Create object URLs
      const urls: string[] = [];
      const frames: FilmstripFrame[] = frameFiles.map(({ index, file }) => {
        const url = URL.createObjectURL(file);
        urls.push(url);
        return {
          index,
          timestamp: index / FRAME_RATE,
          url,
        };
      });

      // Store URLs for cleanup
      this.objectUrls.set(mediaId, urls);

      const existingIndices = frameFiles.map(f => f.index);

      // Sanity check: if marked complete but no frames, treat as incomplete
      if (metadata.isComplete && frames.length === 0) {
        logger.warn(`Filmstrip ${mediaId} marked complete but has 0 frames - resetting`);
        metadata.isComplete = false;
        metadata.frameCount = 0;
      }

      logger.debug(`Loaded filmstrip ${mediaId}: ${frames.length} frames, complete: ${metadata.isComplete}`);

      return { metadata, frames, existingIndices };
    } catch (error) {
      logger.warn('Failed to load filmstrip:', error);
      return null;
    }
  }

  /**
   * Get existing frame indices (for resume)
   */
  async getExistingIndices(mediaId: string): Promise<number[]> {
    try {
      const mediaDir = await this.getMediaDir(mediaId);
      if (!mediaDir) return [];

      const indices: number[] = [];
      for await (const entry of mediaDir.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.webp')) {
          const index = parseInt(entry.name.replace('.webp', ''), 10);
          if (!isNaN(index)) {
            try {
              const fileHandle = await mediaDir.getFileHandle(entry.name);
              const file = await fileHandle.getFile();
              if (file.size > 0) {
                indices.push(index);
              }
            } catch {
              // Skip
            }
          }
        }
      }

      return indices.sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  /**
   * Load a single frame by index - for incremental updates during extraction
   */
  async loadSingleFrame(mediaId: string, index: number): Promise<FilmstripFrame | null> {
    try {
      const mediaDir = await this.getMediaDir(mediaId);
      if (!mediaDir) return null;

      const fileHandle = await mediaDir.getFileHandle(`${index}.webp`);
      const file = await fileHandle.getFile();
      if (file.size === 0) return null;

      const url = URL.createObjectURL(file);

      // Track this URL for cleanup
      const urls = this.objectUrls.get(mediaId) || [];
      urls.push(url);
      this.objectUrls.set(mediaId, urls);

      return {
        index,
        timestamp: index / FRAME_RATE,
        url,
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if filmstrip is complete
   */
  async isComplete(mediaId: string): Promise<boolean> {
    try {
      const mediaDir = await this.getMediaDir(mediaId);
      if (!mediaDir) return false;

      const metaHandle = await mediaDir.getFileHandle('meta.json');
      const metaFile = await metaHandle.getFile();
      const metadata: FilmstripMetadata = JSON.parse(await metaFile.text());
      return metadata.isComplete;
    } catch {
      return false;
    }
  }

  /**
   * Delete filmstrip
   */
  async delete(mediaId: string): Promise<void> {
    this.revokeUrls(mediaId);
    try {
      const dir = await this.ensureDirectory();
      await dir.removeEntry(mediaId, { recursive: true });
      logger.debug(`Deleted filmstrip ${mediaId}`);
    } catch {
      // May not exist
    }
  }

  /**
   * Revoke object URLs for a media
   */
  revokeUrls(mediaId: string): void {
    const urls = this.objectUrls.get(mediaId);
    if (urls) {
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
      this.objectUrls.delete(mediaId);
    }
  }

  /**
   * Clear all filmstrips
   */
  async clearAll(): Promise<void> {
    // Revoke all URLs
    for (const mediaId of this.objectUrls.keys()) {
      this.revokeUrls(mediaId);
    }

    try {
      const dir = await this.ensureDirectory();
      const entries: string[] = [];
      for await (const entry of dir.values()) {
        entries.push(entry.name);
      }
      for (const name of entries) {
        await dir.removeEntry(name, { recursive: true });
      }
      logger.debug(`Cleared ${entries.length} filmstrips`);
    } catch (error) {
      logger.error('Failed to clear filmstrips:', error);
    }
  }

  /**
   * List all stored filmstrips
   */
  async list(): Promise<string[]> {
    try {
      const dir = await this.ensureDirectory();
      const ids: string[] = [];
      for await (const entry of dir.values()) {
        if (entry.kind === 'directory') {
          ids.push(entry.name);
        }
      }
      return ids;
    } catch {
      return [];
    }
  }
}

// Singleton
export const filmstripOPFSStorage = new FilmstripOPFSStorage();
