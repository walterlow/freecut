/**
 * Workspace folder bootstrap: run once after the user picks (or re-grants) a
 * workspace. Writes the marker file + README if they're missing.
 */

import { createLogger } from '@/shared/logging/logger'
import {
  CONTENT_DIR,
  INDEX_FILENAME,
  MARKER_FILENAME,
  MEDIA_DIR,
  PROJECTS_DIR,
  README_FILENAME,
  WORKSPACE_SCHEMA_VERSION,
  proxiesRoot,
} from './paths'
import {
  exists,
  listDirectory,
  readBlob,
  removeEntry,
  writeBlob,
  writeJsonAtomic,
} from './fs-primitives'
import { migrateWorkspaceV2 } from './migrate-workspace-v2'
import readmeTemplate from './README.template.md?raw'
import type { LocalDirectoryBackend } from '@/infrastructure/storage/local-directory/types'

const logger = createLogger('WorkspaceBootstrap')

export interface WorkspaceMarker {
  schemaVersion: string
  createdAt: number
  migratedFromLegacyAt?: number
}

/**
 * Recover stranded `*.tmp` atomic-write journals.
 *
 * `writeJsonAtomic` creates `{name}.tmp` and then `.move()`s it (or writes
 * the target from the completed tmp bytes). A crash during the fallback copy
 * can leave a partial target, while the tmp remains the complete intended
 * replacement. Replaying the tmp before any workspace reads makes that
 * fallback crash-recoverable.
 *
 * We only inspect FreeCut's root metadata and owned directories.
 * Anything else in the workspace (user's own files) is left alone.
 */
async function recoverStrandedTmpFiles(
  root: LocalDirectoryBackend | FileSystemDirectoryHandle,
  dirNames: string[],
): Promise<number> {
  let recovered = 0

  async function recover(tmpPath: string[]): Promise<void> {
    const staged = await readBlob(root, tmpPath)
    if (!staged) return
    const targetPath = [...tmpPath]
    targetPath[targetPath.length - 1] = targetPath.at(-1)!.slice(0, -'.tmp'.length)
    await writeBlob(root, targetPath, staged)
    await removeEntry(root, tmpPath)
    recovered++
  }

  async function recurse(segments: string[]): Promise<void> {
    const entries = await listDirectory(root, segments)
    for (const entry of entries) {
      if (entry.kind === 'directory') {
        try {
          await recurse([...segments, entry.name])
        } catch (error) {
          logger.debug('sweepStrandedTmpFiles: subdir skipped', { name: entry.name, error })
        }
        continue
      }
      if (entry.name.endsWith('.tmp')) {
        try {
          await recover([...segments, entry.name])
        } catch (error) {
          logger.debug('recoverStrandedTmpFiles: recovery failed', { name: entry.name, error })
        }
      }
    }
  }

  for (const name of [MARKER_FILENAME, INDEX_FILENAME]) {
    try {
      await recover([`${name}.tmp`])
    } catch (error) {
      logger.debug('recoverStrandedTmpFiles: root recovery failed', { name, error })
    }
  }

  for (const name of dirNames) {
    try {
      await recurse([name])
    } catch {
      // Directory missing (fresh workspace) — nothing to sweep.
    }
  }
  return recovered
}

const PROXY_KEY_TAG_PATTERN = /^[hof]-/

/**
 * Rename any `content/proxies/{h|o|f}-*` folders to their un-tagged form.
 * Safe to call every bootstrap: returns 0 when nothing matches.
 *
 * Moves via copy-then-delete because FileSystemDirectoryHandle doesn't yet
 * expose a cross-browser rename. If both old and new names exist (e.g. a
 * partial prior run), the new name wins and the prefixed one is removed.
 */
async function stripProxyKeyPrefixes(
  root: LocalDirectoryBackend | FileSystemDirectoryHandle,
): Promise<number> {
  const entries = await listDirectory(root, proxiesRoot())
  let renamed = 0
  for (const entry of entries) {
    if (entry.kind !== 'directory') continue
    if (!PROXY_KEY_TAG_PATTERN.test(entry.name)) continue

    const oldName = entry.name
    const newName = oldName.slice(2)
    const oldDir = [...proxiesRoot(), oldName]
    const newDir = [...proxiesRoot(), newName]

    try {
      if (await exists(root, newDir)) {
        // New name already present — drop the prefixed copy and move on.
        await removeEntry(root, oldDir, { recursive: true })
        renamed++
        continue
      }

      // Read every file up front. Aborting on the first unreadable file
      // avoids a destructive half-move: we only delete oldDir once every
      // expected file has been successfully copied to newDir.
      const files = await listDirectory(root, oldDir)
      const filePayloads: Array<{ name: string; blob: Blob }> = []
      let allReadable = true
      for (const file of files) {
        if (file.kind !== 'file') continue
        const blob = await readBlob(root, [...oldDir, file.name]).catch(() => null)
        if (!blob) {
          allReadable = false
          break
        }
        filePayloads.push({ name: file.name, blob })
      }
      if (!allReadable) {
        logger.warn(
          `stripProxyKeyPrefixes: aborting ${oldName} — unreadable file, leaving source intact`,
        )
        continue
      }

      let allWritten = true
      const written: string[] = []
      for (const payload of filePayloads) {
        try {
          await writeBlob(root, [...newDir, payload.name], payload.blob)
          written.push(payload.name)
        } catch (error) {
          logger.warn(`stripProxyKeyPrefixes: write failed for ${oldName}/${payload.name}`, error)
          allWritten = false
          break
        }
      }
      if (!allWritten) {
        // Roll back partial writes so we leave the new location empty and the
        // old directory untouched for a retry on next bootstrap.
        for (const name of written) {
          await removeEntry(root, [...newDir, name], { recursive: false }).catch(() => undefined)
        }
        continue
      }

      await removeEntry(root, oldDir, { recursive: true })
      renamed++
    } catch (error) {
      logger.warn(`stripProxyKeyPrefixes: failed to rename ${oldName}`, error)
    }
  }
  return renamed
}

export async function bootstrapWorkspace(
  root: LocalDirectoryBackend | FileSystemDirectoryHandle,
): Promise<void> {
  // Recover interrupted fallback commits before reading the marker, index, or
  // project metadata. The tmp file is the complete intended replacement.
  try {
    const recovered = await recoverStrandedTmpFiles(root, [PROJECTS_DIR, MEDIA_DIR, CONTENT_DIR])
    if (recovered > 0) {
      logger.info(`Recovered ${recovered} stranded atomic write(s) from a prior crash`)
    }
  } catch (error) {
    logger.warn('recoverStrandedTmpFiles failed', error)
  }

  // README: only write when missing — never overwrite user edits.
  if (!(await exists(root, [README_FILENAME]))) {
    try {
      await writeBlob(root, [README_FILENAME], readmeTemplate)
    } catch (error) {
      logger.warn('Failed to write README.md', error)
    }
  }

  // Marker: write on first bootstrap so we can detect "this is a real
  // FreeCut workspace" and attach a schema version for future migrations.
  if (!(await exists(root, [MARKER_FILENAME]))) {
    const marker: WorkspaceMarker = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      createdAt: Date.now(),
    }
    try {
      await writeJsonAtomic(root, [MARKER_FILENAME], marker)
    } catch (error) {
      logger.warn('Failed to write workspace marker', error)
    }
  } else {
    // Marker present — may need migration. Must run before any other
    // workspace read path in consumer code that would otherwise fail on
    // the old layout.
    try {
      const report = await migrateWorkspaceV2(root)
      if (report.ran) {
        logger.info('Workspace migration finished', {
          from: report.fromVersion,
          to: report.toVersion,
          filmstrips: report.filmstripMediaMoved,
          waveforms: report.waveformBinMoved,
          previewAudio: report.previewAudioMoved,
          proxies: report.proxiesMoved,
          thumbnailMetaRemoved: report.thumbnailMetaRemoved,
          projectThumbnailsFixed: report.projectThumbnailsFixed,
          errors: report.errors.length,
          durationMs: Math.round(report.durationMs),
        })
      }
    } catch (error) {
      logger.warn('Workspace migration failed', error)
    }
  }

  // One-off cleanup: proxy folders historically carried an `h-`/`o-`/`f-`
  // source-type tag. The tag carries no information the format's shape
  // doesn't already convey, so we strip it in place. Idempotent — runs
  // every bootstrap but is O(0) once no prefixed names remain.
  try {
    const renamed = await stripProxyKeyPrefixes(root)
    if (renamed > 0) {
      logger.info(`Stripped source-type prefix from ${renamed} proxy folder(s)`)
    }
  } catch (error) {
    logger.warn('stripProxyKeyPrefixes failed', error)
  }
}
