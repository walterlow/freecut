/**
 * Media source bytes in the workspace folder.
 *
 * Stored at `media/{id}/{originalFileName}` (sanitized for cross-fs safety),
 * preserving the user-visible filename so the workspace folder is
 * intelligible when browsed on disk. Legacy `media/{id}/source.{ext}`
 * files written before this change are still picked up by read, so existing
 * workspaces keep working without migration.
 *
 * This is the bridge that makes media visible across origins: OPFS and
 * `FileSystemFileHandle` are both origin-scoped, but files inside the
 * user-picked workspace folder are shared by every origin that picks the
 * same physical folder. The lazy-mirror in `getMediaFile` populates this
 * on first read, so existing media converges naturally.
 */

import { createLogger } from '@/shared/logging/logger'

import { requireWorkspaceRoot } from './root'
import { listDirectory, readBlob, writeBlob } from './fs-primitives'
import { mediaDir, mediaSourceByFileName } from './paths'

const logger = createLogger('WorkspaceFS:MediaSource')

/** Reserved media/{id}/* filenames that are NOT the source blob. */
const NON_SOURCE_NAMES = new Set([
  'metadata.json',
  'thumbnail.jpg',
  'thumbnail.meta.json',
  'source.link.json',
  'cache',
])

/**
 * Locate the source file for a media entry by scanning the media dir.
 * Returns the segments of the first file that isn't a reserved sibling
 * (metadata, thumbnail, cache dir, or a link descriptor). Works for both
 * the new real-filename layout and the legacy `source.{ext}` layout.
 */
async function findSourceSegments(
  root: FileSystemDirectoryHandle,
  mediaId: string,
): Promise<string[] | null> {
  const entries = await listDirectory(root, mediaDir(mediaId))
  for (const entry of entries) {
    if (entry.kind !== 'file') continue
    if (NON_SOURCE_NAMES.has(entry.name)) continue
    return [...mediaDir(mediaId), entry.name]
  }
  return null
}

/**
 * Read media source bytes from the workspace folder.
 * Returns null when the source file doesn't exist yet (e.g. a media record
 * imported on another origin that hasn't been mirrored yet).
 */
export async function readMediaSource(mediaId: string): Promise<Blob | null> {
  const root = requireWorkspaceRoot()
  try {
    const segments = await findSourceSegments(root, mediaId)
    if (!segments) return null
    return await readBlob(root, segments)
  } catch (error) {
    logger.warn(`readMediaSource(${mediaId}) failed`, error)
    return null
  }
}

export async function hasMediaSource(mediaId: string): Promise<boolean> {
  const root = requireWorkspaceRoot()
  const segments = await findSourceSegments(root, mediaId)
  return segments !== null
}

/**
 * Write media source bytes to the workspace folder using the original
 * filename (sanitized for cross-fs safety). Idempotent: re-calling for a
 * media that already has any source file in its dir — including a legacy
 * `source.{ext}` file from earlier versions — is a no-op.
 */
export async function writeMediaSource(
  mediaId: string,
  blob: Blob,
  fileName: string | undefined,
): Promise<void> {
  const root = requireWorkspaceRoot()
  try {
    // Already have a source file here (new layout or legacy) — don't write a
    // second one under a different name.
    if (await findSourceSegments(root, mediaId)) return

    const path = mediaSourceByFileName(mediaId, fileName ?? 'source.bin')
    const bytes = new Uint8Array(await blobToArrayBuffer(blob))
    await writeBlob(root, path, bytes)
    logger.info(
      `Mirrored media source to workspace: ${mediaId} (${path[path.length - 1]}, ${bytes.byteLength} bytes)`,
    )
  } catch (error) {
    logger.warn(`writeMediaSource(${mediaId}) failed`, error)
  }
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Response(blob).arrayBuffer()
}
