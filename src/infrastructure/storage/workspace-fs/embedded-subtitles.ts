/**
 * Per-media cache of embedded subtitle tracks parsed from the source file.
 *
 * Persisted at `media/{mediaId}/cache/embedded-subtitles.json`. The picker
 * dialog reads this on open so we don't re-walk a multi-GB MKV every time
 * the user changes their mind about which language track they want. The
 * underlying source-bytes parse is the expensive step (20–30s on a 3 GB
 * Netflix-style episode); the cache makes subsequent picks instant.
 *
 * Cache invalidation is by `fileSize` (and `fileMTime` when available). A
 * mismatch on either is treated as a miss — the file was relinked or
 * regenerated and the previous track list may not apply.
 */

import { createLogger } from '@/shared/logging/logger'
import type { EmbeddedSubtitleTrack } from '@/shared/utils/matroska-subtitles'

import { mediaCacheDir } from './paths'
import { requireWorkspaceRoot } from './root'
import { readJson, removeEntry, writeJsonAtomic } from './fs-primitives'

const logger = createLogger('WorkspaceFS:EmbeddedSubtitles')

const SIDECAR_FILENAME = 'embedded-subtitles.json'
const CURRENT_SIDECAR_VERSION = 1 as const

export interface EmbeddedSubtitleSidecar {
  schemaVersion: typeof CURRENT_SIDECAR_VERSION
  mediaId: string
  scannedAt: number
  fileSize: number
  fileLastModified?: number
  tracks: EmbeddedSubtitleTrack[]
}

function sidecarPath(mediaId: string): string[] {
  return [...mediaCacheDir(mediaId), SIDECAR_FILENAME]
}

/**
 * Returns the cached sidecar when it exists and matches the current source
 * fingerprint, or `null` on miss / stale / read failure.
 *
 * `fileLastModified` is treated as advisory: when both the saved and queried
 * value are present they must agree, but a missing query value (some
 * back-ends don't carry mtime) doesn't invalidate the cache by itself.
 */
export async function getEmbeddedSubtitleSidecar(
  mediaId: string,
  fingerprint: { fileSize: number; fileLastModified?: number },
): Promise<EmbeddedSubtitleSidecar | null> {
  try {
    const root = requireWorkspaceRoot()
    const saved = await readJson<EmbeddedSubtitleSidecar>(root, sidecarPath(mediaId))
    if (!saved) return null
    if (saved.schemaVersion !== CURRENT_SIDECAR_VERSION) return null
    if (saved.fileSize !== fingerprint.fileSize) return null
    if (
      saved.fileLastModified !== undefined &&
      fingerprint.fileLastModified !== undefined &&
      saved.fileLastModified !== fingerprint.fileLastModified
    ) {
      return null
    }
    return saved
  } catch (error) {
    logger.warn(`getEmbeddedSubtitleSidecar(${mediaId}) failed`, error)
    return null
  }
}

export async function saveEmbeddedSubtitleSidecar(
  mediaId: string,
  fingerprint: { fileSize: number; fileLastModified?: number },
  tracks: readonly EmbeddedSubtitleTrack[],
): Promise<EmbeddedSubtitleSidecar> {
  const sidecar: EmbeddedSubtitleSidecar = {
    schemaVersion: CURRENT_SIDECAR_VERSION,
    mediaId,
    scannedAt: Date.now(),
    fileSize: fingerprint.fileSize,
    fileLastModified: fingerprint.fileLastModified,
    tracks: [...tracks],
  }
  try {
    const root = requireWorkspaceRoot()
    await writeJsonAtomic(root, sidecarPath(mediaId), sidecar)
    return sidecar
  } catch (error) {
    logger.warn(`saveEmbeddedSubtitleSidecar(${mediaId}) failed`, error)
    throw new Error(`Failed to cache embedded subtitle tracks for ${mediaId}`)
  }
}

export async function deleteEmbeddedSubtitleSidecar(mediaId: string): Promise<void> {
  try {
    const root = requireWorkspaceRoot()
    await removeEntry(root, sidecarPath(mediaId))
  } catch (error) {
    logger.warn(`deleteEmbeddedSubtitleSidecar(${mediaId}) failed`, error)
  }
}
