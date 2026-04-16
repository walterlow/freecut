/**
 * Media source bytes in the workspace folder.
 *
 * Stored at `media/{id}/source.{ext}` — the extension is determined from the
 * media's fileName on write, and discovered by directory scan on read.
 *
 * This is the bridge that makes media visible across origins: OPFS and
 * `FileSystemFileHandle` are both origin-scoped, but files inside the
 * user-picked workspace folder are shared by every origin that picks the
 * same physical folder. The lazy-mirror in `getMediaFile` populates this
 * on first read, so existing media converges naturally.
 */

import { createLogger } from '@/shared/logging/logger';

import { requireWorkspaceRoot } from './root';
import {
  exists,
  listDirectory,
  readBlob,
  writeBlob,
} from './fs-primitives';
import { mediaDir, mediaSourcePath } from './paths';

const logger = createLogger('WorkspaceFS:MediaSource');

/** Reserved media/{id}/* filenames that are NOT the source blob. */
const NON_SOURCE_NAMES = new Set([
  'metadata.json',
  'thumbnail.jpg',
  'thumbnail.meta.json',
  'source.link.json',
  'cache',
]);

function extractExtension(fileName: string | undefined): string {
  if (!fileName) return 'bin';
  const dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot === fileName.length - 1) return 'bin';
  return fileName.slice(dot + 1).toLowerCase();
}

/**
 * Locate the source.* file for a media entry by scanning the media dir.
 * Returns the segments of the first match, or null.
 */
async function findSourceSegments(
  root: FileSystemDirectoryHandle,
  mediaId: string,
): Promise<string[] | null> {
  const entries = await listDirectory(root, mediaDir(mediaId));
  for (const entry of entries) {
    if (entry.kind !== 'file') continue;
    if (NON_SOURCE_NAMES.has(entry.name)) continue;
    if (!entry.name.startsWith('source.')) continue;
    return [...mediaDir(mediaId), entry.name];
  }
  return null;
}

/**
 * Read media source bytes from the workspace folder.
 * Returns null when the source file doesn't exist yet (e.g. a media record
 * imported on another origin that hasn't been mirrored yet).
 */
export async function readMediaSource(mediaId: string): Promise<Blob | null> {
  const root = requireWorkspaceRoot();
  try {
    const segments = await findSourceSegments(root, mediaId);
    if (!segments) return null;
    return await readBlob(root, segments);
  } catch (error) {
    logger.warn(`readMediaSource(${mediaId}) failed`, error);
    return null;
  }
}

export async function hasMediaSource(mediaId: string): Promise<boolean> {
  const root = requireWorkspaceRoot();
  const segments = await findSourceSegments(root, mediaId);
  return segments !== null;
}

/**
 * Write media source bytes to the workspace folder.
 * Derives the file extension from the fileName (falls back to 'bin').
 */
export async function writeMediaSource(
  mediaId: string,
  blob: Blob,
  fileName: string | undefined,
): Promise<void> {
  const root = requireWorkspaceRoot();
  try {
    const ext = extractExtension(fileName);
    const path = mediaSourcePath(mediaId, ext);
    if (await exists(root, path)) return; // idempotent
    const bytes = new Uint8Array(await blobToArrayBuffer(blob));
    await writeBlob(root, path, bytes);
    logger.info(`Mirrored media source to workspace: ${mediaId} (.${ext}, ${bytes.byteLength} bytes)`);
  } catch (error) {
    logger.warn(`writeMediaSource(${mediaId}) failed`, error);
  }
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Response(blob).arrayBuffer();
}
