/**
 * One-shot migration from legacy `video-editor-db` IndexedDB into the
 * workspace folder.
 *
 * Reads from the consolidated legacy reader (./reader) and writes through
 * the workspace-fs write API so normal path computation and handle stashing
 * runs. The legacy IDB is left untouched unless the user explicitly invokes
 * `deleteLegacyIDB()` after a successful migration.
 *
 * Progress reporting:
 *   The migration can take a long time on large legacy databases, and the
 *   UI needs a live progress bar so users don't think it's stuck. We fetch
 *   all `readAll*` arrays upfront (one read each) to compute a real total
 *   work count, then call `onProgress` after every unit of work. "Work
 *   unit" is defined as one write attempt — successful, failed, or skipped
 *   (e.g. thumbnail not present for a given media). This keeps the bar
 *   smooth and monotonically increasing even when stores are sparse.
 */

import { createLogger, createOperationId } from '@/shared/logging/logger'
import { requireWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { readJson, writeJsonAtomic } from '@/infrastructure/storage/workspace-fs/fs-primitives'
import { MARKER_FILENAME } from '@/infrastructure/storage/workspace-fs/paths'
import type { WorkspaceMarker } from '@/infrastructure/storage/workspace-fs/bootstrap'
import type { Project } from '@/types/project'
import type {
  MediaMetadata,
  ProjectMediaAssociation,
  WaveformRecord,
  DecodedPreviewAudio,
} from '@/types/storage'

// Legacy readers — consolidated read-only access to `video-editor-db`.
import {
  closeAndDeleteLegacyDB,
  readAllDecodedPreviewAudio,
  readAllMedia,
  readAllProjectMedia,
  readAllProjects,
  readAllWaveforms,
  readGifFrames,
  readThumbnailByMediaId,
  readTranscript,
} from './reader'

// New writers — workspace-fs.
import { createProject } from '@/infrastructure/storage/workspace-fs/projects'
import { createMedia } from '@/infrastructure/storage/workspace-fs/media'
import { saveThumbnail } from '@/infrastructure/storage/workspace-fs/thumbnails'
import { associateMediaWithProject } from '@/infrastructure/storage/workspace-fs/project-media'
import { saveGifFrames } from '@/infrastructure/storage/workspace-fs/gif-frames'
import { saveWaveformRecord } from '@/infrastructure/storage/workspace-fs/waveforms'
import { saveDecodedPreviewAudio } from '@/infrastructure/storage/workspace-fs/decoded-preview-audio'
import { saveTranscript } from '@/infrastructure/storage/workspace-fs/transcripts'

const logger = createLogger('LegacyIDB:Migrate')

export interface MigrationReport {
  projects: number
  media: number
  thumbnails: number
  associations: number
  transcripts: number
  gifFrames: number
  waveformRecords: number
  decodedAudioRecords: number
  errors: Array<{ store: string; id: string; error: string }>
  durationMs: number
}

/**
 * Identifies the current step of the migration. `finalizing` covers the
 * post-write bookkeeping (error marker write + migrated marker write).
 */
export type MigrationPhase =
  | 'projects'
  | 'media'
  | 'thumbnails'
  | 'associations'
  | 'transcripts'
  | 'gifFrames'
  | 'waveforms'
  | 'decodedAudio'
  | 'finalizing'

export interface MigrationProgress {
  phase: MigrationPhase
  /** Human-readable phase label for display (e.g. "Migrating media"). */
  phaseLabel: string
  /** Units of work completed so far across all phases. */
  processed: number
  /** Total units of work planned for this run. */
  total: number
}

export interface MigrateOptions {
  /**
   * Called after every unit of work with cumulative progress. Also called
   * once with `processed: 0` at the start so the UI can render an accurate
   * "0 / N" before the first write completes.
   *
   * Exceptions thrown from the callback are caught and logged; they never
   * abort the migration.
   */
  onProgress?: (progress: MigrationProgress) => void
}

const PHASE_LABELS: Record<MigrationPhase, string> = {
  projects: 'Migrating projects',
  media: 'Migrating media',
  thumbnails: 'Migrating thumbnails',
  associations: 'Linking media to projects',
  transcripts: 'Migrating transcripts',
  gifFrames: 'Migrating GIF frames',
  waveforms: 'Migrating waveforms',
  decodedAudio: 'Migrating decoded audio',
  finalizing: 'Finalizing',
}

/**
 * Detect whether the legacy `video-editor-db` still has any projects.
 * Used by the UI to decide whether to show the migrate banner.
 */
export async function hasLegacyData(): Promise<boolean> {
  try {
    const projects = await readAllProjects()
    return projects.length > 0
  } catch (error) {
    logger.warn('hasLegacyData failed', error)
    return false
  }
}

/**
 * Migration marker read from `.freecut-workspace.json`.
 * Presence of `migratedFromLegacyAt` indicates migration has run.
 */
export async function getMigrationStatus(): Promise<{
  migrated: boolean
  at?: number
}> {
  try {
    const root = requireWorkspaceRoot()
    const marker = await readJson<WorkspaceMarker>(root, [MARKER_FILENAME])
    if (!marker?.migratedFromLegacyAt) return { migrated: false }
    return { migrated: true, at: marker.migratedFromLegacyAt }
  } catch {
    return { migrated: false }
  }
}

async function markMigrated(): Promise<void> {
  const root = requireWorkspaceRoot()
  const existing = await readJson<WorkspaceMarker>(root, [MARKER_FILENAME])
  const updated: WorkspaceMarker = {
    schemaVersion: existing?.schemaVersion ?? '1.0',
    createdAt: existing?.createdAt ?? Date.now(),
    migratedFromLegacyAt: Date.now(),
  }
  await writeJsonAtomic(root, [MARKER_FILENAME], updated)
}

/** Marker file kept alongside `.freecut-workspace.json` when migration had
 *  per-store errors. Its presence drives a "retry failed items" UI. Cleared
 *  by a successful re-run. */
const MIGRATION_ERRORS_FILENAME = '.freecut-migration-errors.json'

interface PersistedMigrationErrors {
  recordedAt: number
  errors: MigrationReport['errors']
}

async function writeMigrationErrors(errors: MigrationReport['errors']): Promise<void> {
  const root = requireWorkspaceRoot()
  if (errors.length === 0) {
    // Clear any previous error marker from an earlier failed run.
    try {
      const { removeEntry } = await import('@/infrastructure/storage/workspace-fs/fs-primitives')
      await removeEntry(root, [MIGRATION_ERRORS_FILENAME])
    } catch {
      // Best-effort cleanup.
    }
    return
  }
  const payload: PersistedMigrationErrors = {
    recordedAt: Date.now(),
    errors,
  }
  await writeJsonAtomic(root, [MIGRATION_ERRORS_FILENAME], payload)
}

/**
 * Read the persisted error list from the last migration run, if any.
 * UI can use this to show a "N items failed — retry" banner after a
 * partial success.
 */
export async function getMigrationErrors(): Promise<MigrationReport['errors']> {
  try {
    const root = requireWorkspaceRoot()
    const payload = await readJson<PersistedMigrationErrors>(root, [MIGRATION_ERRORS_FILENAME])
    return payload?.errors ?? []
  } catch {
    return []
  }
}

function pushError(report: MigrationReport, store: string, id: string, error: unknown): void {
  report.errors.push({
    store,
    id,
    error: error instanceof Error ? error.message : String(error),
  })
}

/**
 * Wraps the caller-supplied progress callback with a shared counter. Each
 * call advances `processed` by one and invokes `onProgress`. Exceptions
 * from the UI callback are swallowed so progress reporting can't break
 * the migration.
 */
function createProgressTracker(total: number, onProgress: MigrateOptions['onProgress']) {
  let processed = 0
  const emit = (phase: MigrationPhase) => {
    if (!onProgress) return
    try {
      onProgress({
        phase,
        phaseLabel: PHASE_LABELS[phase],
        processed,
        total,
      })
    } catch (error) {
      logger.warn('onProgress callback threw', error)
    }
  }
  return {
    tick(phase: MigrationPhase) {
      processed++
      emit(phase)
    },
    emitPhaseStart(phase: MigrationPhase) {
      emit(phase)
    },
  }
}

type Tick = (phase: MigrationPhase) => void

async function migrateProjects(
  report: MigrationReport,
  projects: Project[],
  tick: Tick,
): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const project of projects) {
    try {
      await createProject(project)
      report.projects++
      ids.add(project.id)
    } catch (error) {
      pushError(report, 'projects', project.id, error)
    }
    tick('projects')
  }
  return ids
}

async function migrateMedia(
  report: MigrationReport,
  media: MediaMetadata[],
  tick: Tick,
): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const item of media) {
    try {
      await createMedia(item)
      report.media++
      ids.add(item.id)
    } catch (error) {
      pushError(report, 'media', item.id, error)
    }
    tick('media')
  }
  return ids
}

async function migrateThumbnails(
  report: MigrationReport,
  mediaIds: Set<string>,
  tick: Tick,
): Promise<void> {
  for (const mediaId of mediaIds) {
    try {
      const thumb = await readThumbnailByMediaId(mediaId)
      if (thumb) {
        await saveThumbnail(thumb)
        report.thumbnails++
      }
    } catch (error) {
      pushError(report, 'thumbnails', mediaId, error)
    }
    tick('thumbnails')
  }
}

async function migrateProjectMedia(
  report: MigrationReport,
  associations: ProjectMediaAssociation[],
  projectIds: Set<string>,
  tick: Tick,
): Promise<void> {
  for (const assoc of associations) {
    if (projectIds.has(assoc.projectId)) {
      try {
        await associateMediaWithProject(assoc.projectId, assoc.mediaId)
        report.associations++
      } catch (error) {
        pushError(report, 'projectMedia', `${assoc.projectId}:${assoc.mediaId}`, error)
      }
    }
    // Tick even when the project isn't in scope — callers counted every
    // association toward `total`, so we must tick to match.
    tick('associations')
  }
}

async function migrateTranscripts(
  report: MigrationReport,
  mediaIds: Set<string>,
  tick: Tick,
): Promise<void> {
  for (const mediaId of mediaIds) {
    try {
      const transcript = await readTranscript(mediaId)
      if (transcript) {
        await saveTranscript(transcript)
        report.transcripts++
      }
    } catch (error) {
      pushError(report, 'transcripts', mediaId, error)
    }
    tick('transcripts')
  }
}

async function migrateGifFrames(
  report: MigrationReport,
  mediaIds: Set<string>,
  tick: Tick,
): Promise<void> {
  for (const mediaId of mediaIds) {
    try {
      const frames = await readGifFrames(mediaId)
      if (frames) {
        await saveGifFrames(frames)
        report.gifFrames++
      }
    } catch (error) {
      pushError(report, 'gifFrames', mediaId, error)
    }
    tick('gifFrames')
  }
}

async function migrateWaveforms(
  report: MigrationReport,
  waveforms: WaveformRecord[],
  tick: Tick,
): Promise<void> {
  for (const record of waveforms) {
    try {
      await saveWaveformRecord(record)
      report.waveformRecords++
    } catch (error) {
      pushError(report, 'waveforms', record.id, error)
    }
    tick('waveforms')
  }
}

async function migrateDecodedAudio(
  report: MigrationReport,
  decoded: DecodedPreviewAudio[],
  tick: Tick,
): Promise<void> {
  for (const record of decoded) {
    try {
      await saveDecodedPreviewAudio(record)
      report.decodedAudioRecords++
    } catch (error) {
      pushError(report, 'decodedPreviewAudio', record.id, error)
    }
    tick('decodedAudio')
  }
}

/**
 * Migrate every store in the legacy `video-editor-db` to the workspace
 * folder. Idempotent: re-running skips duplicates (create* throw on
 * existing; caught as errors and ignored).
 */
export async function migrateFromLegacyIDB(options: MigrateOptions = {}): Promise<MigrationReport> {
  const opId = createOperationId()
  const event = logger.startEvent('workspace.migrate', opId)
  const started = Date.now()
  const report: MigrationReport = {
    projects: 0,
    media: 0,
    thumbnails: 0,
    associations: 0,
    transcripts: 0,
    gifFrames: 0,
    waveformRecords: 0,
    decodedAudioRecords: 0,
    errors: [],
    durationMs: 0,
  }

  try {
    // Pre-fetch every `readAll*` store so we know the real total-work
    // count before writing anything. The per-id readers (thumbnails,
    // transcripts, gifFrames) are counted as one tick per media id —
    // matches what we actually loop over below.
    const [projects, media, associations, waveforms, decodedAudio] = await Promise.all([
      readAllProjects(),
      readAllMedia(),
      readAllProjectMedia(),
      readAllWaveforms(),
      readAllDecodedPreviewAudio(),
    ])

    const total =
      projects.length +
      media.length +
      media.length + // thumbnails (one tick per media id)
      associations.length +
      media.length + // transcripts
      media.length + // gifFrames
      waveforms.length +
      decodedAudio.length

    const tracker = createProgressTracker(total, options.onProgress)
    // Emit an initial 0% tick so the UI can render an accurate total
    // before any writes land.
    tracker.emitPhaseStart('projects')

    const projectIds = await migrateProjects(report, projects, tracker.tick)
    const mediaIds = await migrateMedia(report, media, tracker.tick)
    await migrateThumbnails(report, mediaIds, tracker.tick)
    await migrateProjectMedia(report, associations, projectIds, tracker.tick)
    await migrateTranscripts(report, mediaIds, tracker.tick)
    await migrateGifFrames(report, mediaIds, tracker.tick)
    await migrateWaveforms(report, waveforms, tracker.tick)
    await migrateDecodedAudio(report, decodedAudio, tracker.tick)

    tracker.emitPhaseStart('finalizing')

    // Persist per-store errors so the UI can surface a retry banner on
    // next launch. A clean run clears the error marker.
    await writeMigrationErrors(report.errors)

    // Set the "migration ran" marker only on a fully clean run. A run with
    // any errors leaves the marker unset so re-running retries the whole
    // migration — `create*` throws "already exists" for items that landed
    // the first time, which gets caught as an error and is the right
    // behavior (noise, but no data loss). Once every store succeeds, the
    // marker is set and future launches skip the migration entirely.
    if (report.errors.length === 0) {
      await markMigrated()
    } else {
      logger.warn(
        `Migration completed with ${report.errors.length} errors; marker not set to allow retry.`,
      )
    }
    report.durationMs = Date.now() - started

    event.merge({
      projects: report.projects,
      media: report.media,
      thumbnails: report.thumbnails,
      associations: report.associations,
      transcripts: report.transcripts,
      gifFrames: report.gifFrames,
      waveformRecords: report.waveformRecords,
      decodedAudioRecords: report.decodedAudioRecords,
      errorCount: report.errors.length,
      durationMs: report.durationMs,
      markedMigrated: report.errors.length === 0,
      totalUnits: total,
    })
    event.success()
    return report
  } catch (error) {
    report.durationMs = Date.now() - started
    event.failure(error, { errorCount: report.errors.length })
    throw error
  }
}

/**
 * Destructive: delete the entire legacy `video-editor-db`.
 * Only invoke from a user-confirmed action after a successful migration.
 */
export async function deleteLegacyIDB(): Promise<void> {
  await closeAndDeleteLegacyDB()
}
