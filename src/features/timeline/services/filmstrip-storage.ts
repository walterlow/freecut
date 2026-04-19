/**
 * Filmstrip Storage
 *
 * Filmstrip frames are persisted in the workspace under the owning media
 * cache directory:
 *   media/{mediaId}/cache/filmstrip/
 *     meta.json - { width, height, isComplete, frameCount }
 *     0.jpg, 1.jpg, 2.jpg, ... (legacy caches may still use .webp)
 *
 * Legacy OPFS filmstrips are read only as a fallback. When encountered,
 * they are hydrated into the workspace so subsequent reads stay unified.
 */

import { createLogger } from '@/shared/logging/logger';
import { getCacheMigration } from '@/infrastructure/storage/cache-version';
import {
  readBlob,
  readJson,
  writeBlob,
  writeJsonAtomic,
  removeEntry,
  listDirectory,
} from '@/infrastructure/storage/workspace-fs/fs-primitives';
import { requireWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root';
import {
  filmstripDir,
  filmstripFramePath,
  filmstripMetaPath,
} from '@/infrastructure/storage/workspace-fs/paths';

const logger = createLogger('FilmstripStorage');

const FILMSTRIP_DIR = 'filmstrips';
const FRAME_RATE = 1; // Must match worker - 1fps for filmstrip thumbnails
const PRIMARY_FRAME_EXT = 'jpg';
const LEGACY_FRAME_EXT = 'webp';
const FRAME_EXTENSIONS = new Set([PRIMARY_FRAME_EXT, LEGACY_FRAME_EXT]);

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
  return parseFrameFileNameParts(name)?.index ?? null;
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
  url: string;
  byteSize?: number;
  bitmap?: ImageBitmap;
}

interface LoadedFilmstrip {
  metadata: FilmstripMetadata;
  frames: FilmstripFrame[];
  existingIndices: number[];
}

class FilmstripStorage {
  private objectUrls = new Map<string, Map<number, string>>();
  private legacyInitPromise: Promise<FileSystemDirectoryHandle | null> | null = null;

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
    entries: Array<{ index: number; url: string }>,
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

  private async readMetadata(
    mediaId: string,
  ): Promise<FilmstripMetadata | null> {
    return await readJson<FilmstripMetadata>(requireWorkspaceRoot(), filmstripMetaPath(mediaId));
  }

  private async ensureWorkspaceFilmstrip(
    mediaId: string,
  ): Promise<FilmstripMetadata | null> {
    const existing = await this.readMetadata(mediaId);
    if (existing) return existing;

    const hydrated = await this.hydrateFromLegacyOpfs(mediaId);
    if (!hydrated) return null;
    return await this.readMetadata(mediaId);
  }

  private async getLegacyFilmstripRoot(): Promise<FileSystemDirectoryHandle | null> {
    if (this.legacyInitPromise) return this.legacyInitPromise;

    this.legacyInitPromise = (async () => {
      try {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle(FILMSTRIP_DIR, { create: true });

        const migration = getCacheMigration('filmstrip');
        if (migration.needsMigration) {
          const entries: string[] = [];
          for await (const entry of dir.values()) {
            entries.push(entry.name);
          }
          for (const name of entries) {
            await dir.removeEntry(name, { recursive: true }).catch(() => undefined);
          }
          migration.markComplete();
          logger.info(`Legacy filmstrip cache cleared for v${migration.newVersion}`);
        }

        return dir;
      } catch (error) {
        logger.warn('Failed to access legacy OPFS filmstrip root', error);
        return null;
      }
    })();

    return this.legacyInitPromise;
  }

  private async getLegacyMediaDir(mediaId: string): Promise<FileSystemDirectoryHandle | null> {
    try {
      const root = await this.getLegacyFilmstripRoot();
      if (!root) return null;
      return await root.getDirectoryHandle(mediaId);
    } catch {
      return null;
    }
  }

  private async deleteLegacyFilmstrip(mediaId: string): Promise<void> {
    try {
      const root = await this.getLegacyFilmstripRoot();
      if (!root) return;
      await root.removeEntry(mediaId, { recursive: true });
    } catch {
      // ignore missing legacy cache
    }
  }

  private async clearLegacyFilmstrips(): Promise<void> {
    try {
      const root = await this.getLegacyFilmstripRoot();
      if (!root) return;
      const entries: string[] = [];
      for await (const entry of root.values()) {
        entries.push(entry.name);
      }
      for (const name of entries) {
        await root.removeEntry(name, { recursive: true }).catch(() => undefined);
      }
    } catch (error) {
      logger.warn('Failed to clear legacy OPFS filmstrips', error);
    }
  }

  private async hydrateFromLegacyOpfs(mediaId: string): Promise<boolean> {
    try {
      const mediaDir = await this.getLegacyMediaDir(mediaId);
      if (!mediaDir) return false;

      const metaHandle = await mediaDir.getFileHandle('meta.json');
      const metaFile = await metaHandle.getFile();
      const metadata = JSON.parse(await metaFile.text()) as FilmstripMetadata;
      await writeJsonAtomic(requireWorkspaceRoot(), filmstripMetaPath(mediaId), metadata);

      for await (const entry of mediaDir.values()) {
        if (entry.kind !== 'file') continue;
        const parsed = parseFrameFileNameParts(entry.name);
        if (!parsed) continue;
        const file = await (entry as FileSystemFileHandle).getFile();
        if (file.size <= 0) continue;
        await writeBlob(
          requireWorkspaceRoot(),
          filmstripFramePath(mediaId, parsed.index, parsed.ext),
          file,
        );
      }

      logger.debug(`Hydrated filmstrip ${mediaId} from legacy OPFS`);
      return true;
    } catch (error) {
      logger.warn(`hydrateFromLegacyOpfs(${mediaId}) failed`, error);
      return false;
    }
  }

  async saveMetadata(
    mediaId: string,
    metadata: { width: number; height: number; isComplete: boolean; frameCount: number },
  ): Promise<void> {
    await writeJsonAtomic(requireWorkspaceRoot(), filmstripMetaPath(mediaId), metadata);
  }

  async saveFrameBlob(mediaId: string, index: number, blob: Blob): Promise<void> {
    await writeBlob(
      requireWorkspaceRoot(),
      filmstripFramePath(mediaId, index, PRIMARY_FRAME_EXT),
      blob,
    );
  }

  async load(mediaId: string): Promise<LoadedFilmstrip | null> {
    try {
      const metadata = await this.ensureWorkspaceFilmstrip(mediaId);
      if (!metadata) return null;

      const entries = await listDirectory(requireWorkspaceRoot(), filmstripDir(mediaId));
      const frameFilesByIndex = new Map<number, { blob: Blob; ext: string }>();

      for (const entry of entries) {
        if (entry.kind !== 'file') continue;
        const parsed = parseFrameFileNameParts(entry.name);
        if (!parsed) continue;

        const blob = await readBlob(
          requireWorkspaceRoot(),
          filmstripFramePath(mediaId, parsed.index, parsed.ext),
        );
        if (!blob || blob.size <= 0) continue;

        const existing = frameFilesByIndex.get(parsed.index);
        const shouldReplace = !existing
          || (parsed.ext === PRIMARY_FRAME_EXT && existing.ext !== PRIMARY_FRAME_EXT);
        if (shouldReplace) {
          frameFilesByIndex.set(parsed.index, { blob, ext: parsed.ext });
        }
      }

      const frameFiles = Array.from(frameFilesByIndex.entries())
        .map(([index, value]) => ({ index, blob: value.blob }))
        .sort((a, b) => a.index - b.index);

      const nextUrls: Array<{ index: number; url: string }> = [];
      const frames: FilmstripFrame[] = frameFiles.map(({ index, blob }) => {
        const url = URL.createObjectURL(blob);
        nextUrls.push({ index, url });
        return {
          index,
          timestamp: index / FRAME_RATE,
          url,
          byteSize: blob.size,
        };
      });
      this.replaceAllFrameUrls(mediaId, nextUrls);

      const existingIndices = frameFiles.map((frame) => frame.index);

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

  async getExistingIndices(
    mediaId: string,
    startIndex?: number,
    endIndex?: number,
  ): Promise<number[]> {
    const metadata = await this.ensureWorkspaceFilmstrip(mediaId);
    if (!metadata) return [];

    const entries = await listDirectory(requireWorkspaceRoot(), filmstripDir(mediaId));
    const indices = new Set<number>();

    for (const entry of entries) {
      if (entry.kind !== 'file') continue;
      const index = parseFrameFileName(entry.name);
      if (index === null) continue;
      if (typeof startIndex === 'number' && index < startIndex) continue;
      if (typeof endIndex === 'number' && index >= endIndex) continue;

      const parsed = parseFrameFileNameParts(entry.name);
      if (!parsed) continue;
      const blob = await readBlob(
        requireWorkspaceRoot(),
        filmstripFramePath(mediaId, parsed.index, parsed.ext),
      );
      if (blob && blob.size > 0) {
        indices.add(index);
      }
    }

    return Array.from(indices).sort((a, b) => a - b);
  }

  async loadSingleFrame(mediaId: string, index: number): Promise<FilmstripFrame | null> {
    const metadata = await this.ensureWorkspaceFilmstrip(mediaId);
    if (!metadata) return null;

    let blob = await readBlob(
      requireWorkspaceRoot(),
      filmstripFramePath(mediaId, index, PRIMARY_FRAME_EXT),
    );
    if (!blob || blob.size === 0) {
      blob = await readBlob(
        requireWorkspaceRoot(),
        filmstripFramePath(mediaId, index, LEGACY_FRAME_EXT),
      );
    }
    if (!blob || blob.size === 0) return null;

    const url = URL.createObjectURL(blob);
    this.setFrameUrl(mediaId, index, url);

    return {
      index,
      timestamp: index / FRAME_RATE,
      url,
      byteSize: blob.size,
    };
  }

  createFrameFromBlob(mediaId: string, index: number, blob: Blob): FilmstripFrame | null {
    if (!blob || blob.size === 0) return null;

    const url = URL.createObjectURL(blob);
    this.setFrameUrl(mediaId, index, url);

    return {
      index,
      timestamp: index / FRAME_RATE,
      url,
      byteSize: blob.size,
    };
  }

  createFrameFromBitmap(_mediaId: string, index: number, bitmap: ImageBitmap): FilmstripFrame | null {
    if (!bitmap || bitmap.width === 0) return null;

    return {
      index,
      timestamp: index / FRAME_RATE,
      url: '',
      byteSize: bitmap.width * bitmap.height * 4,
      bitmap,
    };
  }

  async isComplete(mediaId: string): Promise<boolean> {
    const metadata = await this.ensureWorkspaceFilmstrip(mediaId);
    return metadata?.isComplete ?? false;
  }

  async delete(mediaId: string): Promise<void> {
    this.revokeUrls(mediaId);
    await removeEntry(requireWorkspaceRoot(), filmstripDir(mediaId), {
      recursive: true,
    });
    await this.deleteLegacyFilmstrip(mediaId);
    logger.debug(`Deleted filmstrip ${mediaId}`);
  }

  revokeUrls(mediaId: string): void {
    const urlsByIndex = this.objectUrls.get(mediaId);
    if (!urlsByIndex) return;

    for (const url of urlsByIndex.values()) {
      URL.revokeObjectURL(url);
    }
    this.objectUrls.delete(mediaId);
  }

  async clearAll(): Promise<void> {
    for (const mediaId of this.objectUrls.keys()) {
      this.revokeUrls(mediaId);
    }

    // In v2, filmstrips live per-media under `media/<id>/cache/filmstrip/`.
    // Enumerate media dirs and prune each one's filmstrip subtree.
    try {
      const mediaEntries = await listDirectory(requireWorkspaceRoot(), ['media']);
      for (const entry of mediaEntries) {
        if (entry.kind !== 'directory') continue;
        await removeEntry(requireWorkspaceRoot(), filmstripDir(entry.name), {
          recursive: true,
        }).catch(() => undefined);
      }
    } catch {
      // media dir may not exist yet — nothing to clear
    }

    await this.clearLegacyFilmstrips();
  }
}

export const filmstripStorage = new FilmstripStorage();
