/**
 * Media metadata store backed by the workspace folder.
 *
 * Each media gets `media/{id}/metadata.json`. The non-serializable
 * `FileSystemFileHandle` (present when `storageType === 'handle'`) is
 * stashed in the handles-db under kind='media', id=mediaId and
 * re-attached on read.
 */

import type { MediaMetadata } from '@/types/storage';
import { createLogger } from '@/shared/logging/logger';
import {
  deleteHandle,
  getHandle,
  saveHandle,
} from '@/infrastructure/storage/handles-db';

import { requireWorkspaceRoot } from './root';
import {
  listDirectory,
  readJson,
  removeEntry,
  writeJsonAtomic,
} from './fs-primitives';
import {
  MEDIA_DIR,
  mediaDir,
  mediaMetadataPath,
} from './paths';

const logger = createLogger('WorkspaceFS:Media');

type SerializedMedia = Omit<MediaMetadata, 'fileHandle'>;

async function stashFileHandle(media: MediaMetadata): Promise<SerializedMedia> {
  const { fileHandle, ...rest } = media;
  if (fileHandle) {
    await saveHandle({
      kind: 'media',
      id: media.id,
      handle: fileHandle,
      name: fileHandle.name,
      pickedAt: Date.now(),
      lastSeenSize: media.fileSize,
      lastSeenMtime: media.fileLastModified,
    });
  } else {
    await deleteHandle('media', media.id).catch(() => {});
  }
  return rest;
}

async function restoreFileHandle(serialized: SerializedMedia): Promise<MediaMetadata> {
  const record = await getHandle('media', serialized.id);
  if (record) {
    return {
      ...serialized,
      fileHandle: record.handle as FileSystemFileHandle,
    };
  }
  return serialized as MediaMetadata;
}

/**
 * Outcome of validating a stored `FileSystemFileHandle` against the
 * `lastSeenSize` / `lastSeenMtime` captured at import time.
 *
 * - `ok`           — handle resolves to a file with matching size+mtime.
 * - `no-handle`    — this media doesn't use a handle (OPFS or content-
 *                    addressable storage); nothing to validate.
 * - `permission`   — the browser rejected the handle with NotAllowedError
 *                    (user revoked access at the OS/picker level).
 * - `missing`      — handle can't resolve to a file (renamed, moved, or
 *                    deleted on disk).
 * - `changed`      — handle resolves but size or mtime differ from what
 *                    we recorded. Callers should offer a relink flow
 *                    because downstream caches (thumbnails, waveforms)
 *                    may no longer match the current file bytes.
 */
export type MediaHandleValidation =
  | { kind: 'ok' }
  | { kind: 'no-handle' }
  | { kind: 'permission' }
  | { kind: 'missing' }
  | { kind: 'changed'; currentSize: number; currentMtime: number };

/**
 * Validate a stored media file handle against its last-seen stats.
 *
 * Calls `handle.getFile()` which forces the browser to resolve the
 * underlying file on disk. If the user renamed/moved/deleted the file
 * externally, this throws NotFoundError. If the file exists but size or
 * mtime changed, we flag `changed` so callers can rebuild caches.
 *
 * Cheap enough to call on project open for every handle-backed media
 * (one stat per file). Do NOT call in hot paths.
 */
export async function validateMediaHandle(mediaId: string): Promise<MediaHandleValidation> {
  const record = await getHandle('media', mediaId);
  if (!record) return { kind: 'no-handle' };

  const handle = record.handle as FileSystemFileHandle;
  try {
    const file = await handle.getFile();
    const expectedSize = record.lastSeenSize;
    const expectedMtime = record.lastSeenMtime;
    if (
      typeof expectedSize === 'number' &&
      typeof expectedMtime === 'number' &&
      (file.size !== expectedSize || file.lastModified !== expectedMtime)
    ) {
      return {
        kind: 'changed',
        currentSize: file.size,
        currentMtime: file.lastModified,
      };
    }
    return { kind: 'ok' };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      return { kind: 'permission' };
    }
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      return { kind: 'missing' };
    }
    logger.warn(`validateMediaHandle(${mediaId}) unexpected error`, error);
    return { kind: 'missing' };
  }
}

/* ────────────────────────────── Public API ───────────────────────────── */

export async function getAllMedia(): Promise<MediaMetadata[]> {
  const root = requireWorkspaceRoot();
  try {
    const dirs = await listDirectory(root, [MEDIA_DIR]);
    const media: MediaMetadata[] = [];
    for (const entry of dirs) {
      if (entry.kind !== 'directory') continue;
      const serialized = await readJson<SerializedMedia>(root, mediaMetadataPath(entry.name));
      if (!serialized) continue;
      media.push(await restoreFileHandle(serialized));
    }
    return media;
  } catch (error) {
    logger.error('getAllMedia failed', error);
    throw new Error('Failed to load media from workspace');
  }
}

export async function getMedia(id: string): Promise<MediaMetadata | undefined> {
  const root = requireWorkspaceRoot();
  try {
    const serialized = await readJson<SerializedMedia>(root, mediaMetadataPath(id));
    if (!serialized) return undefined;
    return restoreFileHandle(serialized);
  } catch (error) {
    logger.error(`getMedia(${id}) failed`, error);
    throw new Error(`Failed to load media: ${id}`);
  }
}

export async function createMedia(media: MediaMetadata): Promise<MediaMetadata> {
  const root = requireWorkspaceRoot();
  try {
    const existing = await readJson<SerializedMedia>(root, mediaMetadataPath(media.id));
    if (existing) {
      throw new Error(`Media already exists: ${media.id}`);
    }
    const serialized = await stashFileHandle(media);
    await writeJsonAtomic(root, mediaMetadataPath(media.id), serialized);
    return media;
  } catch (error) {
    logger.error('createMedia failed', error);
    throw error;
  }
}

export async function updateMedia(
  id: string,
  updates: Partial<MediaMetadata>,
): Promise<MediaMetadata> {
  const root = requireWorkspaceRoot();
  try {
    const existingSerialized = await readJson<SerializedMedia>(root, mediaMetadataPath(id));
    if (!existingSerialized) {
      throw new Error(`Media not found: ${id}`);
    }
    const existing = await restoreFileHandle(existingSerialized);
    const updated: MediaMetadata = {
      ...existing,
      ...updates,
      id,
    };
    const nextSerialized = await stashFileHandle(updated);
    await writeJsonAtomic(root, mediaMetadataPath(id), nextSerialized);
    return updated;
  } catch (error) {
    logger.error(`updateMedia(${id}) failed`, error);
    throw error;
  }
}

export async function deleteMedia(id: string): Promise<void> {
  const root = requireWorkspaceRoot();
  try {
    await removeEntry(root, mediaDir(id), { recursive: true });
    await deleteHandle('media', id).catch(() => {});
  } catch (error) {
    logger.error(`deleteMedia(${id}) failed`, error);
    throw new Error(`Failed to delete media: ${id}`);
  }
}
