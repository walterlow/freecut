/**
 * OPFS Filmstrip Storage
 *
 * Simple storage for filmstrip frames. Worker handles saving,
 * this service handles loading and providing object URLs.
 *
 * Storage structure:
 *   filmstrips/{mediaId}/
 *     meta.json - { width, height, isComplete, frameCount }
 *     0.jpg, 1.jpg, 2.jpg, ... (legacy caches may still use .webp)
 */

import { createLogger } from '@/shared/logging/logger';
import { getCacheMigration } from '@/infrastructure/storage/cache-version';
import { safeWrite } from '../utils/opfs-safe-write';

const logger = createLogger('FilmstripOPFS');

const FILMSTRIP_DIR = 'filmstrips';
const FRAME_RATE = 1; // Must match worker - 1fps for filmstrip thumbnails
const PRIMARY_FRAME_EXT = 'jpg';
const LEGACY_FRAME_EXT = 'webp';
const FRAME_EXTENSIONS = new Set([PRIMARY_FRAME_EXT, LEGACY_FRAME_EXT]);
const VALIDATION_TTL_MS = 10_000;

function parseFrameFileNameParts(name: string): { index: number; ext: string } | null {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex <= 0) return null;
  const ext = name.slice(dotIndex + 1).toLowerCase();
  if (!FRAME_EXTENSIONS.has(ext)) return null;
  const index = parseInt(name.slice(0, dotIndex), 10);
  if (Number.isNaN(index)) return null;
  return { index, ext };
}

function parseFrameFileName(name: string): number | null {
  const parsed = parseFrameFileNameParts(name);
  return parsed?.index ?? null;
}

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
  byteSize?: number;
}

interface LoadedFilmstrip {
  metadata: FilmstripMetadata;
  frames: FilmstripFrame[];
  existingIndices: number[];
}

interface MediaDirCacheEntry {
  handle: FileSystemDirectoryHandle;
  lastValidated: number;
}

/**
 * OPFS Filmstrip Storage Service
 */
class FilmstripOPFSStorage {
  private dirHandle: FileSystemDirectoryHandle | null = null;
  private initPromise: Promise<FileSystemDirectoryHandle> | null = null;
  private objectUrls = new Map<string, Map<number, string>>(); // mediaId -> frameIndex -> url
  private mediaDirCache = new Map<string, MediaDirCacheEntry>();

  private scheduleRevoke(urls: string[]): void {
    if (urls.length === 0) return;

    const revoke = () => {
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
    };

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(revoke, { timeout: 10_000 });
      return;
    }

    setTimeout(revoke, 0);
  }

  private setFrameUrl(mediaId: string, index: number, url: string): void {
    const urlsByIndex = this.objectUrls.get(mediaId) ?? new Map<number, string>();
    const previous = urlsByIndex.get(index);
    urlsByIndex.set(index, url);
    this.objectUrls.set(mediaId, urlsByIndex);

    if (previous && previous !== url) {
      this.scheduleRevoke([previous]);
    }
  }

  private replaceAllFrameUrls(
    mediaId: string,
    entries: Array<{ index: number; url: string }>
  ): void {
    const previous = this.objectUrls.get(mediaId);
    const next = new Map<number, string>();
    for (const entry of entries) {
      next.set(entry.index, entry.url);
    }
    this.objectUrls.set(mediaId, next);

    if (!previous) return;

    const toRevoke: string[] = [];
    for (const [index, url] of previous) {
      const nextUrl = next.get(index);
      if (nextUrl !== url) {
        toRevoke.push(url);
      }
    }
    this.scheduleRevoke(toRevoke);
  }

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
    const cached = this.mediaDirCache.get(mediaId);
    const dir = await this.ensureDirectory();

    if (cached) {
      if (Date.now() - cached.lastValidated <= VALIDATION_TTL_MS) {
        return cached.handle;
      }

      try {
        // Probe the cached handle. If the underlying directory was removed,
        // OPFS access will throw and we'll invalidate + recover below.
        const iterator = cached.handle.values();
        await iterator.next();
        this.mediaDirCache.set(mediaId, {
          handle: cached.handle,
          lastValidated: Date.now(),
        });
        return cached.handle;
      } catch {
        this.mediaDirCache.delete(mediaId);
        try {
          const reopened = await dir.getDirectoryHandle(mediaId);
          this.mediaDirCache.set(mediaId, {
            handle: reopened,
            lastValidated: Date.now(),
          });
          return reopened;
        } catch {
          return null;
        }
      }
    }

    try {
      const mediaDir = await dir.getDirectoryHandle(mediaId);
      this.mediaDirCache.set(mediaId, {
        handle: mediaDir,
        lastValidated: Date.now(),
      });
      return mediaDir;
    } catch {
      return null;
    }
  }

  /**
   * Get or create media directory handle
   */
  private async getOrCreateMediaDir(mediaId: string): Promise<FileSystemDirectoryHandle> {
    const cached = this.mediaDirCache.get(mediaId);
    if (cached && Date.now() - cached.lastValidated <= VALIDATION_TTL_MS) {
      return cached.handle;
    }

    const dir = await this.ensureDirectory();
    const mediaDir = await dir.getDirectoryHandle(mediaId, { create: true });
    this.mediaDirCache.set(mediaId, {
      handle: mediaDir,
      lastValidated: Date.now(),
    });
    return mediaDir;
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
    await safeWrite(writable, JSON.stringify(metadata));
  }

  /**
   * Save a frame blob at a specific index
   */
  async saveFrameBlob(mediaId: string, index: number, blob: Blob): Promise<void> {
    const mediaDir = await this.getOrCreateMediaDir(mediaId);
    const fileHandle = await mediaDir.getFileHandle(`${index}.${PRIMARY_FRAME_EXT}`, { create: true });
    const writable = await fileHandle.createWritable();
    await safeWrite(writable, blob);
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

      // Collect frame files (dedupe by frame index, prefer primary extension).
      const frameFilesByIndex = new Map<number, { file: File; ext: string }>();
      for await (const entry of mediaDir.values()) {
        if (entry.kind !== 'file') continue;
        const parsed = parseFrameFileNameParts(entry.name);
        if (!parsed) continue;
        try {
          const fileHandle = entry as FileSystemFileHandle;
          const file = await fileHandle.getFile();
          if (file.size <= 0) continue;

          const existing = frameFilesByIndex.get(parsed.index);
          const shouldReplace = !existing
            || (parsed.ext === PRIMARY_FRAME_EXT && existing.ext !== PRIMARY_FRAME_EXT);
          if (shouldReplace) {
            frameFilesByIndex.set(parsed.index, { file, ext: parsed.ext });
          }
        } catch {
          // Skip unreadable files
        }
      }

      const frameFiles = Array.from(frameFilesByIndex.entries())
        .map(([index, value]) => ({ index, file: value.file }))
        .sort((a, b) => a.index - b.index);

      // Create object URLs
      const nextUrls: Array<{ index: number; url: string }> = [];
      const frames: FilmstripFrame[] = frameFiles.map(({ index, file }) => {
        const url = URL.createObjectURL(file);
        nextUrls.push({ index, url });
        return {
          index,
          timestamp: index / FRAME_RATE,
          url,
          byteSize: file.size,
        };
      });
      this.replaceAllFrameUrls(mediaId, nextUrls);

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
  async getExistingIndices(
    mediaId: string,
    startIndex?: number,
    endIndex?: number
  ): Promise<number[]> {
    try {
      const mediaDir = await this.getMediaDir(mediaId);
      if (!mediaDir) return [];

      const indices = new Set<number>();
      for await (const entry of mediaDir.values()) {
        if (entry.kind !== 'file') continue;
        const index = parseFrameFileName(entry.name);
        if (index !== null) {
          if (typeof startIndex === 'number' && index < startIndex) {
            continue;
          }
          if (typeof endIndex === 'number' && index >= endIndex) {
            continue;
          }
          try {
            const fileHandle = entry as FileSystemFileHandle;
            const file = await fileHandle.getFile();
            if (file.size > 0) {
              indices.add(index);
            }
          } catch {
            // Skip
          }
        }
      }

      return Array.from(indices).sort((a, b) => a - b);
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

      let file: File | null = null;
      try {
        const primaryHandle = await mediaDir.getFileHandle(`${index}.${PRIMARY_FRAME_EXT}`);
        file = await primaryHandle.getFile();
      } catch {
        try {
          const legacyHandle = await mediaDir.getFileHandle(`${index}.${LEGACY_FRAME_EXT}`);
          file = await legacyHandle.getFile();
        } catch {
          return null;
        }
      }
      if (!file || file.size === 0) return null;

      const url = URL.createObjectURL(file);
      this.setFrameUrl(mediaId, index, url);

      return {
        index,
        timestamp: index / FRAME_RATE,
        url,
        byteSize: file.size,
      };
    } catch {
      return null;
    }
  }

  /**
   * Create an in-memory frame URL from a worker-provided blob.
   * Used for progressive UI updates to avoid immediate OPFS read-after-write.
   */
  createFrameFromBlob(mediaId: string, index: number, blob: Blob): FilmstripFrame | null {
    if (!blob || blob.size === 0) {
      return null;
    }

    const url = URL.createObjectURL(blob);
    this.setFrameUrl(mediaId, index, url);

    return {
      index,
      timestamp: index / FRAME_RATE,
      url,
      byteSize: blob.size,
    };
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
    this.mediaDirCache.delete(mediaId);
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
    const urlsByIndex = this.objectUrls.get(mediaId);
    if (urlsByIndex) {
      for (const url of urlsByIndex.values()) {
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
    this.mediaDirCache.clear();

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

