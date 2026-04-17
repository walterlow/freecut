/**
 * One-shot migration from legacy `video-editor-db` IndexedDB into the
 * workspace folder.
 *
 * Reads from the consolidated legacy reader (./reader) and writes through
 * the workspace-fs write API so normal path computation and handle stashing
 * runs. The legacy IDB is left untouched unless the user explicitly invokes
 * `deleteLegacyIDB()` after a successful migration.
 */

import { createLogger, createOperationId } from '@/shared/logging/logger';
import { requireWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root';
import {
  readJson,
  writeJsonAtomic,
} from '@/infrastructure/storage/workspace-fs/fs-primitives';
import { MARKER_FILENAME } from '@/infrastructure/storage/workspace-fs/paths';
import type { WorkspaceMarker } from '@/infrastructure/storage/workspace-fs/bootstrap';

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
} from './reader';

// New writers — workspace-fs.
import { createProject } from '@/infrastructure/storage/workspace-fs/projects';
import { createMedia } from '@/infrastructure/storage/workspace-fs/media';
import { saveThumbnail } from '@/infrastructure/storage/workspace-fs/thumbnails';
import { associateMediaWithProject } from '@/infrastructure/storage/workspace-fs/project-media';
import { saveGifFrames } from '@/infrastructure/storage/workspace-fs/gif-frames';
import { saveWaveformRecord } from '@/infrastructure/storage/workspace-fs/waveforms';
import { saveDecodedPreviewAudio } from '@/infrastructure/storage/workspace-fs/decoded-preview-audio';
import { saveTranscript } from '@/infrastructure/storage/workspace-fs/transcripts';

const logger = createLogger('LegacyIDB:Migrate');

export interface MigrationReport {
  projects: number;
  media: number;
  thumbnails: number;
  associations: number;
  transcripts: number;
  gifFrames: number;
  waveformRecords: number;
  decodedAudioRecords: number;
  errors: Array<{ store: string; id: string; error: string }>;
  durationMs: number;
}

/**
 * Detect whether the legacy `video-editor-db` still has any projects.
 * Used by the UI to decide whether to show the migrate banner.
 */
export async function hasLegacyData(): Promise<boolean> {
  try {
    const projects = await readAllProjects();
    return projects.length > 0;
  } catch (error) {
    logger.warn('hasLegacyData failed', error);
    return false;
  }
}

/**
 * Migration marker read from `.freecut-workspace.json`.
 * Presence of `migratedFromLegacyAt` indicates migration has run.
 */
export async function getMigrationStatus(): Promise<{
  migrated: boolean;
  at?: number;
}> {
  try {
    const root = requireWorkspaceRoot();
    const marker = await readJson<WorkspaceMarker>(root, [MARKER_FILENAME]);
    if (!marker?.migratedFromLegacyAt) return { migrated: false };
    return { migrated: true, at: marker.migratedFromLegacyAt };
  } catch {
    return { migrated: false };
  }
}

async function markMigrated(): Promise<void> {
  const root = requireWorkspaceRoot();
  const existing = await readJson<WorkspaceMarker>(root, [MARKER_FILENAME]);
  const updated: WorkspaceMarker = {
    schemaVersion: existing?.schemaVersion ?? '1.0',
    createdAt: existing?.createdAt ?? Date.now(),
    migratedFromLegacyAt: Date.now(),
  };
  await writeJsonAtomic(root, [MARKER_FILENAME], updated);
}

function pushError(
  report: MigrationReport,
  store: string,
  id: string,
  error: unknown,
): void {
  report.errors.push({
    store,
    id,
    error: error instanceof Error ? error.message : String(error),
  });
}

async function migrateProjects(report: MigrationReport): Promise<Set<string>> {
  const ids = new Set<string>();
  const projects = await readAllProjects();
  for (const project of projects) {
    try {
      await createProject(project);
      report.projects++;
      ids.add(project.id);
    } catch (error) {
      pushError(report, 'projects', project.id, error);
    }
  }
  return ids;
}

async function migrateMedia(
  report: MigrationReport,
): Promise<Set<string>> {
  const ids = new Set<string>();
  const media = await readAllMedia();
  for (const item of media) {
    try {
      await createMedia(item);
      report.media++;
      ids.add(item.id);
    } catch (error) {
      pushError(report, 'media', item.id, error);
    }
  }
  return ids;
}

async function migrateThumbnails(
  report: MigrationReport,
  mediaIds: Set<string>,
): Promise<void> {
  for (const mediaId of mediaIds) {
    try {
      const thumb = await readThumbnailByMediaId(mediaId);
      if (!thumb) continue;
      await saveThumbnail(thumb);
      report.thumbnails++;
    } catch (error) {
      pushError(report, 'thumbnails', mediaId, error);
    }
  }
}

async function migrateProjectMedia(
  report: MigrationReport,
  projectIds: Set<string>,
): Promise<void> {
  const all = await readAllProjectMedia();
  for (const assoc of all) {
    if (!projectIds.has(assoc.projectId)) continue;
    try {
      await associateMediaWithProject(assoc.projectId, assoc.mediaId);
      report.associations++;
    } catch (error) {
      pushError(report, 'projectMedia', `${assoc.projectId}:${assoc.mediaId}`, error);
    }
  }
}

async function migrateTranscripts(
  report: MigrationReport,
  mediaIds: Set<string>,
): Promise<void> {
  for (const mediaId of mediaIds) {
    try {
      const transcript = await readTranscript(mediaId);
      if (!transcript) continue;
      await saveTranscript(transcript);
      report.transcripts++;
    } catch (error) {
      pushError(report, 'transcripts', mediaId, error);
    }
  }
}

async function migrateGifFrames(
  report: MigrationReport,
  mediaIds: Set<string>,
): Promise<void> {
  for (const mediaId of mediaIds) {
    try {
      const frames = await readGifFrames(mediaId);
      if (!frames) continue;
      await saveGifFrames(frames);
      report.gifFrames++;
    } catch (error) {
      pushError(report, 'gifFrames', mediaId, error);
    }
  }
}

async function migrateWaveforms(report: MigrationReport): Promise<void> {
  const all = await readAllWaveforms();
  for (const record of all) {
    try {
      await saveWaveformRecord(record);
      report.waveformRecords++;
    } catch (error) {
      pushError(report, 'waveforms', record.id, error);
    }
  }
}

async function migrateDecodedAudio(report: MigrationReport): Promise<void> {
  const all = await readAllDecodedPreviewAudio();
  for (const record of all) {
    try {
      await saveDecodedPreviewAudio(record);
      report.decodedAudioRecords++;
    } catch (error) {
      pushError(report, 'decodedPreviewAudio', record.id, error);
    }
  }
}

/**
 * Migrate every store in the legacy `video-editor-db` to the workspace
 * folder. Idempotent: re-running skips duplicates (create* throw on
 * existing; caught as errors and ignored).
 */
export async function migrateFromLegacyIDB(): Promise<MigrationReport> {
  const opId = createOperationId();
  const event = logger.startEvent('workspace.migrate', opId);
  const started = Date.now();
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
  };

  try {
    const projectIds = await migrateProjects(report);
    const mediaIds = await migrateMedia(report);
    await migrateThumbnails(report, mediaIds);
    await migrateProjectMedia(report, projectIds);
    await migrateTranscripts(report, mediaIds);
    await migrateGifFrames(report, mediaIds);
    await migrateWaveforms(report);
    await migrateDecodedAudio(report);

    await markMigrated();
    report.durationMs = Date.now() - started;

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
    });
    event.success();
    return report;
  } catch (error) {
    report.durationMs = Date.now() - started;
    event.failure(error, { errorCount: report.errors.length });
    throw error;
  }
}

/**
 * Destructive: delete the entire legacy `video-editor-db`.
 * Only invoke from a user-confirmed action after a successful migration.
 */
export async function deleteLegacyIDB(): Promise<void> {
  await closeAndDeleteLegacyDB();
}
