/**
 * Media thumbnails backed by the workspace folder.
 *
 * One thumbnail per media, stored as:
 *   `media/{mediaId}/thumbnail.jpg`            (binary blob)
 *   `media/{mediaId}/thumbnail.meta.json`      (ThumbnailData minus blob)
 *
 * The legacy IDB supported multiple thumbnails per media but in practice
 * getThumbnailByMediaId always returned the first — so we collapse to one
 * per media. If a caller saves a new thumbnail it overwrites the existing.
 *
 * `getThumbnail(id)` (lookup by thumbnail id, rarely used) scans media
 * dirs and matches on sidecar meta.
 */

import type { ThumbnailData } from '@/types/storage';
import { createLogger } from '@/shared/logging/logger';

import { requireWorkspaceRoot } from './root';
import {
  listDirectory,
  readBlob,
  readJson,
  removeEntry,
  writeBlob,
  writeJsonAtomic,
} from './fs-primitives';
import {
  MEDIA_DIR,
  mediaDir,
  mediaThumbnailPath,
} from './paths';
import { blobToArrayBuffer } from './blob-utils';

const logger = createLogger('WorkspaceFS:Thumbnails');

const THUMBNAIL_META_FILENAME = 'thumbnail.meta.json';

interface ThumbnailMeta {
  id: string;
  mediaId: string;
  timestamp: number;
  width: number;
  height: number;
}

function thumbnailMetaPath(mediaId: string): string[] {
  return [...mediaDir(mediaId), THUMBNAIL_META_FILENAME];
}


/* ────────────────────────────── Public API ───────────────────────────── */

export async function saveThumbnail(thumbnail: ThumbnailData): Promise<void> {
  const root = requireWorkspaceRoot();
  try {
    const bytes = new Uint8Array(await blobToArrayBuffer(thumbnail.blob));
    await writeBlob(root, mediaThumbnailPath(thumbnail.mediaId), bytes);
    const meta: ThumbnailMeta = {
      id: thumbnail.id,
      mediaId: thumbnail.mediaId,
      timestamp: thumbnail.timestamp,
      width: thumbnail.width,
      height: thumbnail.height,
    };
    await writeJsonAtomic(root, thumbnailMetaPath(thumbnail.mediaId), meta);
  } catch (error) {
    logger.error('saveThumbnail failed', error);
    throw new Error('Failed to save thumbnail', { cause: error });
  }
}

export async function getThumbnail(id: string): Promise<ThumbnailData | undefined> {
  const root = requireWorkspaceRoot();
  try {
    const dirs = await listDirectory(root, [MEDIA_DIR]);
    for (const entry of dirs) {
      if (entry.kind !== 'directory') continue;
      const meta = await readJson<ThumbnailMeta>(root, thumbnailMetaPath(entry.name));
      if (!meta || meta.id !== id) continue;
      const blob = await readBlob(root, mediaThumbnailPath(meta.mediaId));
      if (!blob) return undefined;
      return { id: meta.id, mediaId: meta.mediaId, blob, timestamp: meta.timestamp, width: meta.width, height: meta.height };
    }
    return undefined;
  } catch (error) {
    logger.error(`getThumbnail(${id}) failed`, error);
    throw new Error(`Failed to load thumbnail: ${id}`);
  }
}

export async function getThumbnailByMediaId(
  mediaId: string,
): Promise<ThumbnailData | undefined> {
  const root = requireWorkspaceRoot();
  try {
    const meta = await readJson<ThumbnailMeta>(root, thumbnailMetaPath(mediaId));
    if (!meta) return undefined;
    const blob = await readBlob(root, mediaThumbnailPath(mediaId));
    if (!blob) return undefined;
    return { id: meta.id, mediaId: meta.mediaId, blob, timestamp: meta.timestamp, width: meta.width, height: meta.height };
  } catch (error) {
    logger.error(`getThumbnailByMediaId(${mediaId}) failed`, error);
    return undefined;
  }
}

export async function deleteThumbnailsByMediaId(mediaId: string): Promise<void> {
  const root = requireWorkspaceRoot();
  try {
    await removeEntry(root, mediaThumbnailPath(mediaId));
    await removeEntry(root, thumbnailMetaPath(mediaId));
  } catch (error) {
    logger.error(`deleteThumbnailsByMediaId(${mediaId}) failed`, error);
    throw new Error('Failed to delete thumbnails');
  }
}
