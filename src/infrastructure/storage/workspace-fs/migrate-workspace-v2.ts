/**
 * One-shot v1 → v2 workspace layout migrator.
 *
 * v1 (legacy): per-media caches scattered at the workspace root:
 *   filmstrips/<mediaId>/*.jpg
 *   waveform-bin/<mediaId>.bin
 *   preview-audio/<hex>/<hex>/<mediaId>.wav
 *   proxies/<proxyKey>/*
 *   media/<id>/thumbnail.meta.json                 (sidecar, unused by reads)
 *   media/<projectId>/thumbnail.jpg                (contamination — project cover)
 *
 * v2 (new): everything per-media lives under `media/<id>/cache/`, shared
 *          proxies under `content/proxies/`, project thumbnails under
 *          `projects/<id>/thumbnail.jpg`.
 *
 * Triggered from `bootstrapWorkspace` before any other workspace read. Reads
 * the marker's `schemaVersion` and no-ops when it already says `"2.0"`.
 *
 * All moves use copy-then-delete (bytes read into memory, written to target,
 * source removed) because `FileSystemDirectoryHandle.move()` across parent
 * directories is not yet supported across the browsers we target. Individual
 * media migrations are guarded by the per-key lock used elsewhere so a
 * concurrent write in another tab can't race a half-complete migration.
 */

import { createLogger } from '@/shared/logging/logger'
import {
  MARKER_FILENAME,
  MEDIA_DIR,
  PROJECTS_DIR,
  WORKSPACE_SCHEMA_VERSION,
  filmstripDir,
  mediaDir,
  previewAudioPath,
  projectThumbnailPath,
  proxiesRoot,
  waveformMultiResPath,
} from './paths'
import {
  exists,
  listDirectory,
  readBlob,
  readJson,
  removeEntry,
  writeBlob,
  writeJsonAtomic,
} from './fs-primitives'
import { withKeyLock } from './with-key-lock'
import type { WorkspaceMarker } from './bootstrap'

const logger = createLogger('WorkspaceV2Migrator')

const LEGACY_FILMSTRIPS_DIR = 'filmstrips'
const LEGACY_WAVEFORM_BIN_DIR = 'waveform-bin'
const LEGACY_PREVIEW_AUDIO_DIR = 'preview-audio'
const LEGACY_PROXIES_DIR = 'proxies'
const LEGACY_THUMBNAIL_META_FILENAME = 'thumbnail.meta.json'
const LEGACY_MEDIA_THUMBNAIL_FILENAME = 'thumbnail.jpg'

export interface MigrationReport {
  ran: boolean
  fromVersion: string | null
  toVersion: string
  filmstripMediaMoved: number
  waveformBinMoved: number
  previewAudioMoved: number
  proxiesMoved: number
  thumbnailMetaRemoved: number
  projectThumbnailsFixed: number
  errors: string[]
  durationMs: number
}

/**
 * Entry point. Safe to call on every bootstrap — returns early when the
 * marker already claims v2 or is missing (fresh workspace will get a v2
 * marker written by bootstrap).
 */
export async function migrateWorkspaceV2(
  root: FileSystemDirectoryHandle,
): Promise<MigrationReport> {
  const start = performance.now()
  const report: MigrationReport = {
    ran: false,
    fromVersion: null,
    toVersion: WORKSPACE_SCHEMA_VERSION,
    filmstripMediaMoved: 0,
    waveformBinMoved: 0,
    previewAudioMoved: 0,
    proxiesMoved: 0,
    thumbnailMetaRemoved: 0,
    projectThumbnailsFixed: 0,
    errors: [],
    durationMs: 0,
  }

  const marker = await readJson<WorkspaceMarker>(root, [MARKER_FILENAME])
  if (!marker) {
    // Fresh workspace — bootstrap will write a v2 marker.
    report.durationMs = performance.now() - start
    return report
  }

  report.fromVersion = marker.schemaVersion
  if (marker.schemaVersion === WORKSPACE_SCHEMA_VERSION) {
    report.durationMs = performance.now() - start
    return report
  }

  report.ran = true
  logger.info(`Migrating workspace ${marker.schemaVersion} → ${WORKSPACE_SCHEMA_VERSION}`)

  const knownProjectIds = await collectProjectIds(root)

  try {
    report.filmstripMediaMoved = await migrateFilmstrips(root, report.errors)
  } catch (error) {
    report.errors.push(`filmstrips: ${describe(error)}`)
  }
  try {
    report.waveformBinMoved = await migrateWaveformBins(root, report.errors)
  } catch (error) {
    report.errors.push(`waveform-bin: ${describe(error)}`)
  }
  try {
    report.previewAudioMoved = await migratePreviewAudio(root, report.errors)
  } catch (error) {
    report.errors.push(`preview-audio: ${describe(error)}`)
  }
  try {
    report.proxiesMoved = await migrateProxies(root, report.errors)
  } catch (error) {
    report.errors.push(`proxies: ${describe(error)}`)
  }
  try {
    report.thumbnailMetaRemoved = await dropThumbnailMetaSidecars(root, report.errors)
  } catch (error) {
    report.errors.push(`thumbnail-meta: ${describe(error)}`)
  }
  try {
    report.projectThumbnailsFixed = await fixProjectThumbnailContamination(
      root,
      knownProjectIds,
      report.errors,
    )
  } catch (error) {
    report.errors.push(`project-thumbnails: ${describe(error)}`)
  }

  if (report.errors.length === 0) {
    const next: WorkspaceMarker = {
      ...marker,
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
    }
    await writeJsonAtomic(root, [MARKER_FILENAME], next)
    logger.info('Workspace migrated to v2', report)
  } else {
    logger.warn('Workspace migration completed with errors; marker left at v1 for retry', {
      errorCount: report.errors.length,
    })
  }

  report.durationMs = performance.now() - start
  return report
}

async function collectProjectIds(root: FileSystemDirectoryHandle): Promise<Set<string>> {
  const entries = await listDirectory(root, [PROJECTS_DIR])
  const ids = new Set<string>()
  for (const entry of entries) {
    if (entry.kind === 'directory') ids.add(entry.name)
  }
  return ids
}

/* ──────────────────────────── filmstrips ─────────────────────────────── */

async function migrateFilmstrips(
  root: FileSystemDirectoryHandle,
  errors: string[],
): Promise<number> {
  const entries = await listDirectory(root, [LEGACY_FILMSTRIPS_DIR])
  let migrated = 0
  for (const entry of entries) {
    if (entry.kind !== 'directory') continue
    const mediaId = entry.name
    try {
      await withKeyLock(`migrate-v2:filmstrip:${mediaId}`, async () => {
        const files = await listDirectory(root, [LEGACY_FILMSTRIPS_DIR, mediaId])
        for (const file of files) {
          if (file.kind !== 'file') continue
          const blob = await readBlob(root, [LEGACY_FILMSTRIPS_DIR, mediaId, file.name])
          if (!blob) continue
          await writeBlob(root, [...filmstripDir(mediaId), file.name], blob)
        }
        await removeEntry(root, [LEGACY_FILMSTRIPS_DIR, mediaId], { recursive: true })
      })
      migrated++
    } catch (error) {
      errors.push(`filmstrip ${mediaId}: ${describe(error)}`)
    }
  }
  if (migrated > 0) {
    await removeTopLevelDirIfEmpty(root, LEGACY_FILMSTRIPS_DIR)
  }
  return migrated
}

/* ──────────────────────────── waveform-bin ───────────────────────────── */

async function migrateWaveformBins(
  root: FileSystemDirectoryHandle,
  errors: string[],
): Promise<number> {
  const entries = await listDirectory(root, [LEGACY_WAVEFORM_BIN_DIR])
  let migrated = 0
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.bin')) continue
    const mediaId = entry.name.slice(0, -'.bin'.length)
    try {
      await withKeyLock(`migrate-v2:waveform-bin:${mediaId}`, async () => {
        const blob = await readBlob(root, [LEGACY_WAVEFORM_BIN_DIR, entry.name])
        if (!blob) return
        await writeBlob(root, waveformMultiResPath(mediaId), blob)
        await removeEntry(root, [LEGACY_WAVEFORM_BIN_DIR, entry.name])
      })
      migrated++
    } catch (error) {
      errors.push(`waveform-bin ${mediaId}: ${describe(error)}`)
    }
  }
  if (migrated > 0) {
    await removeTopLevelDirIfEmpty(root, LEGACY_WAVEFORM_BIN_DIR)
  }
  return migrated
}

/* ──────────────────────────── preview-audio ──────────────────────────── */

/**
 * Legacy layout is two-level sharded: `preview-audio/<hex2>/<hex2>/<mediaId>.wav`.
 * Walk the shards and pull every `.wav` up to `media/<id>/cache/preview-audio.wav`.
 */
async function migratePreviewAudio(
  root: FileSystemDirectoryHandle,
  errors: string[],
): Promise<number> {
  const shard1Entries = await listDirectory(root, [LEGACY_PREVIEW_AUDIO_DIR])
  let migrated = 0
  for (const shard1 of shard1Entries) {
    if (shard1.kind !== 'directory') continue
    const shard2Entries = await listDirectory(root, [LEGACY_PREVIEW_AUDIO_DIR, shard1.name])
    for (const shard2 of shard2Entries) {
      if (shard2.kind !== 'directory') continue
      const files = await listDirectory(root, [LEGACY_PREVIEW_AUDIO_DIR, shard1.name, shard2.name])
      for (const file of files) {
        if (file.kind !== 'file' || !file.name.endsWith('.wav')) continue
        const mediaId = file.name.slice(0, -'.wav'.length)
        try {
          await withKeyLock(`migrate-v2:preview-audio:${mediaId}`, async () => {
            const blob = await readBlob(root, [
              LEGACY_PREVIEW_AUDIO_DIR,
              shard1.name,
              shard2.name,
              file.name,
            ])
            if (!blob) return
            await writeBlob(root, previewAudioPath(mediaId), blob)
            await removeEntry(root, [LEGACY_PREVIEW_AUDIO_DIR, shard1.name, shard2.name, file.name])
          })
          migrated++
        } catch (error) {
          errors.push(`preview-audio ${mediaId}: ${describe(error)}`)
        }
      }
      await removeDirIfEmpty(root, [LEGACY_PREVIEW_AUDIO_DIR, shard1.name, shard2.name])
    }
    await removeDirIfEmpty(root, [LEGACY_PREVIEW_AUDIO_DIR, shard1.name])
  }
  if (migrated > 0) {
    await removeTopLevelDirIfEmpty(root, LEGACY_PREVIEW_AUDIO_DIR)
  }
  return migrated
}

/* ──────────────────────────── proxies ────────────────────────────────── */

async function migrateProxies(root: FileSystemDirectoryHandle, errors: string[]): Promise<number> {
  const entries = await listDirectory(root, [LEGACY_PROXIES_DIR])
  let migrated = 0
  for (const entry of entries) {
    if (entry.kind !== 'directory') continue
    const proxyKey = entry.name
    try {
      await withKeyLock(`migrate-v2:proxy:${proxyKey}`, async () => {
        const files = await listDirectory(root, [LEGACY_PROXIES_DIR, proxyKey])
        for (const file of files) {
          if (file.kind !== 'file') continue
          const blob = await readBlob(root, [LEGACY_PROXIES_DIR, proxyKey, file.name])
          if (!blob) continue
          await writeBlob(root, [...proxiesRoot(), proxyKey, file.name], blob)
        }
        await removeEntry(root, [LEGACY_PROXIES_DIR, proxyKey], { recursive: true })
      })
      migrated++
    } catch (error) {
      errors.push(`proxy ${proxyKey}: ${describe(error)}`)
    }
  }
  if (migrated > 0) {
    await removeTopLevelDirIfEmpty(root, LEGACY_PROXIES_DIR)
  }
  return migrated
}

/* ──────────────────────────── thumbnail.meta sidecars ────────────────── */

async function dropThumbnailMetaSidecars(
  root: FileSystemDirectoryHandle,
  errors: string[],
): Promise<number> {
  const entries = await listDirectory(root, [MEDIA_DIR])
  let removed = 0
  for (const entry of entries) {
    if (entry.kind !== 'directory') continue
    const mediaId = entry.name
    const sidecarPath = [...mediaDir(mediaId), LEGACY_THUMBNAIL_META_FILENAME]
    try {
      if (!(await exists(root, sidecarPath))) continue
      await removeEntry(root, sidecarPath)
      removed++
    } catch (error) {
      errors.push(`thumbnail.meta ${mediaId}: ${describe(error)}`)
    }
  }
  return removed
}

/* ──────────────────────────── project-thumbnail contamination ────────── */

/**
 * Move any `media/<projectId>/thumbnail.jpg` back to `projects/<id>/thumbnail.jpg`.
 *
 * Identified by folder-name collision with a known project id. The legacy
 * contamination only ever wrote `thumbnail.jpg` (and the now-dropped
 * `thumbnail.meta.json`) — the stray media dir has no `metadata.json`, which
 * is what distinguishes it from a real media entry that happens to collide
 * with a project id.
 */
async function fixProjectThumbnailContamination(
  root: FileSystemDirectoryHandle,
  knownProjectIds: Set<string>,
  errors: string[],
): Promise<number> {
  const mediaEntries = await listDirectory(root, [MEDIA_DIR])
  let fixed = 0
  for (const entry of mediaEntries) {
    if (entry.kind !== 'directory') continue
    if (!knownProjectIds.has(entry.name)) continue

    const id = entry.name
    try {
      const contents = await listDirectory(root, mediaDir(id))
      const hasMetadata = contents.some((e) => e.kind === 'file' && e.name === 'metadata.json')
      if (hasMetadata) {
        // Real media that happens to share an id with a project — leave it
        // alone. Extremely unlikely but the ids are UUID-ish, not guaranteed
        // disjoint across namespaces.
        continue
      }

      const thumbnailBlob = await readBlob(root, [...mediaDir(id), LEGACY_MEDIA_THUMBNAIL_FILENAME])
      if (!thumbnailBlob) {
        // Nothing usable to recover; don't drop the directory because we
        // can't confirm this is actually contaminated state.
        continue
      }
      await writeBlob(root, projectThumbnailPath(id), thumbnailBlob)

      // Only delete the directory when its contents match the expected
      // contamination shape (just the legacy thumbnail file). Anything else
      // is unknown state we don't want to silently discard.
      const unexpectedContents = contents.some(
        (e) => !(e.kind === 'file' && e.name === LEGACY_MEDIA_THUMBNAIL_FILENAME),
      )
      if (unexpectedContents) {
        continue
      }
      await removeEntry(root, mediaDir(id), { recursive: true })
      fixed++
    } catch (error) {
      errors.push(`project-thumbnail ${id}: ${describe(error)}`)
    }
  }
  return fixed
}

/* ──────────────────────────── helpers ────────────────────────────────── */

async function removeTopLevelDirIfEmpty(
  root: FileSystemDirectoryHandle,
  dir: string,
): Promise<void> {
  await removeDirIfEmpty(root, [dir])
}

async function removeDirIfEmpty(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<void> {
  const entries = await listDirectory(root, segments)
  if (entries.length > 0) return
  try {
    await removeEntry(root, segments)
  } catch (error) {
    // Non-fatal: the dir may have been removed concurrently or was never
    // created. Callers don't care either way.
    logger.debug('removeDirIfEmpty skipped', { segments, error })
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
