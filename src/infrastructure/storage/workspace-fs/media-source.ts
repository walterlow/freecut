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
import { listDirectory, readBlob, writeBlob, type WorkspaceRootInput } from './fs-primitives'
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
  root: WorkspaceRootInput,
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
 * Return a range-capable URL for Electron-backed workspace media.
 * Standard File System Access callers keep using lazy File blobs.
 */
export async function getMediaSourceReadUrl(mediaId: string): Promise<string | null> {
  const root = requireWorkspaceRoot()
  if (root.kind !== 'electron-directory') return null
  const segments = await findSourceSegments(root, mediaId)
  if (!segments) return null
  return (await root.getReadUrl(segments)).url
}

export async function getCopiedMediaReadUrl(stagedPath: readonly string[]): Promise<string> {
  return (await requireWorkspaceRoot().getReadUrl(stagedPath)).url
}

/**
 * Move a file that the Electron bridge already copied into this workspace
 * into its final media directory. The bytes never cross the renderer process.
 */
export async function adoptCopiedMediaSource(
  stagedPath: readonly string[],
  mediaId: string,
  fileName: string,
): Promise<void> {
  const root = requireWorkspaceRoot()
  const targetPath = mediaSourceByFileName(mediaId, fileName)
  await root.createDirectory(mediaDir(mediaId))
  await root.move(stagedPath, targetPath)
}

/**
 * Write media source bytes to the workspace folder using the original
 * filename (sanitized for cross-fs safety). Idempotent: re-calling for a
 * media that already has any source file in its dir — including a legacy
 * `source.{ext}` file from earlier versions — is a no-op.
 *
 * The blob is streamed straight to disk via `createWritable` (see writeBlob),
 * so this does not buffer the whole file into JS memory — safe for large
 * copy-mode imports.
 *
 * By default a failure is swallowed and logged (background-mirror semantics
 * used by the lazy mirror-on-read). Pass `{ strict: true }` when this write is
 * the durable primary store for the media so the caller can roll the import
 * back on failure.
 */
export async function writeMediaSource(
  mediaId: string,
  blob: Blob,
  fileName: string | undefined,
  options?: { strict?: boolean },
): Promise<void> {
  const root = requireWorkspaceRoot()
  try {
    // Already have a source file here (new layout or legacy) — don't write a
    // second one under a different name.
    if (await findSourceSegments(root, mediaId)) return

    const path = mediaSourceByFileName(mediaId, fileName ?? 'source.bin')
    await writeBlob(root, path, blob)
    logger.info(
      `Wrote media source to workspace: ${mediaId} (${path[path.length - 1]}, ${blob.size} bytes)`,
    )
  } catch (error) {
    logger.warn(`writeMediaSource(${mediaId}) failed`, error)
    if (options?.strict) throw error
  }
}
