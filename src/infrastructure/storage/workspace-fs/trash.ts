/**
 * Soft-delete ("trash") for projects.
 *
 * A soft-deleted project keeps its directory intact under `projects/{id}/`
 * with an added marker file `.freecut-trashed.json`. The marker is the
 * source of truth: its presence hides the project from the projects list
 * and from the workspace index. Its absence restores visibility.
 *
 * Why marker-in-place instead of directory-move:
 *   - File System Access API lacks reliable directory move across
 *     Chromium versions; would require a recursive copy+delete fallback
 *     that can leave half-moved trees on crash.
 *   - Atomic state change (marker exists or doesn't) via `writeJsonAtomic`.
 *   - Browsing the workspace externally makes the trashed state visible
 *     as a file named `.freecut-trashed.json` — self-explanatory to any
 *     agent or human poking around.
 *
 * Permanent deletion is not done here. Callers (typically
 * `project-store.permanentlyDeleteProject`) read the trashed project's
 * media-links, delegate media cleanup to `mediaLibraryService`, then call
 * the regular `deleteProject` to wipe the directory.
 *
 * A periodic sweep (`sweepTrashOlderThan`) auto-purges trashed projects
 * whose `deletedAt` is older than a configured TTL (default 30 days),
 * invoked via a caller-supplied purge callback so the workspace-fs
 * layer stays free of media-library dependencies.
 */

import { createLogger } from '@/shared/logging/logger';
import { requireWorkspaceRoot } from './root';
import {
  exists,
  listDirectory,
  readJson,
  writeJsonAtomic,
} from './fs-primitives';
import {
  PROJECTS_DIR,
  projectJsonPath,
  projectTrashedMarkerPath,
} from './paths';
import {
  writeWorkspaceIndex,
  type WorkspaceIndexEntry,
} from './workspace-index';
import { withKeyLock } from './with-key-lock';

const logger = createLogger('WorkspaceFS:Trash');

/** Default TTL for auto-purge: 30 days. */
export const DEFAULT_TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Lock key shared with projects.refreshIndex so trash ops don't race with it. */
const INDEX_LOCK_KEY = 'projects:index';

/* ────────────────────────────── Types ──────────────────────────────── */

export interface TrashMarker {
  /** ms since epoch when the project was soft-deleted. */
  deletedAt: number;
  /** Project name at the time of deletion — survives if project.json is
   *  changed before restore. */
  originalName: string;
}

export interface TrashedProjectEntry {
  id: string;
  marker: TrashMarker;
}

/* ────────────────────────────── Helpers ────────────────────────────── */

async function readMarker(
  root: FileSystemDirectoryHandle,
  id: string,
): Promise<TrashMarker | null> {
  return readJson<TrashMarker>(root, projectTrashedMarkerPath(id));
}

async function markerExists(
  root: FileSystemDirectoryHandle,
  id: string,
): Promise<boolean> {
  return exists(root, projectTrashedMarkerPath(id));
}

/**
 * Rebuild `index.json` from every live (non-trashed) project directory.
 * Used by soft-delete and restore to keep the index in sync without
 * touching live-project code paths.
 */
async function rebuildAndWriteIndex(
  root: FileSystemDirectoryHandle,
): Promise<void> {
  const entries = await listDirectory(root, [PROJECTS_DIR]);
  const indexEntries: WorkspaceIndexEntry[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'directory') continue;
    if (await markerExists(root, entry.name)) continue;
    const project = await readJson<{ id: string; name: string; updatedAt: number }>(
      root,
      projectJsonPath(entry.name),
    );
    if (!project) continue;
    indexEntries.push({
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
    });
  }
  await writeWorkspaceIndex(root, indexEntries);
}

/* ────────────────────────────── Public API ─────────────────────────── */

/**
 * Soft-delete a project. The directory is preserved; a marker file hides
 * it from the projects list. Idempotent — re-trashing an already-trashed
 * project is a no-op that returns the original marker.
 */
export async function softDeleteProject(
  id: string,
): Promise<TrashMarker> {
  const root = requireWorkspaceRoot();
  // Read project name before anything else; if the project doesn't exist
  // there's nothing to trash.
  const project = await readJson<{ name?: string }>(root, projectJsonPath(id));
  if (!project) {
    throw new Error(`Project not found: ${id}`);
  }

  const existingMarker = await readMarker(root, id);
  if (existingMarker) {
    logger.debug(`softDeleteProject(${id}): already trashed`);
    return existingMarker;
  }

  const marker: TrashMarker = {
    deletedAt: Date.now(),
    originalName: project.name ?? id,
  };

  await writeJsonAtomic(root, projectTrashedMarkerPath(id), marker);
  await withKeyLock(INDEX_LOCK_KEY, () => rebuildAndWriteIndex(root));
  logger.info(`Soft-deleted project ${id} ("${marker.originalName}")`);
  return marker;
}

/**
 * Restore a trashed project by removing its marker and refreshing the
 * workspace index. Idempotent — restoring a live project is a no-op.
 * Throws if the project directory no longer exists (e.g. already purged).
 */
export async function restoreProject(id: string): Promise<void> {
  const root = requireWorkspaceRoot();
  const project = await readJson<{ id: string }>(root, projectJsonPath(id));
  if (!project) {
    throw new Error(`Project not found (may have been purged): ${id}`);
  }

  if (!(await markerExists(root, id))) {
    logger.debug(`restoreProject(${id}): not trashed`);
    return;
  }

  const { removeEntry } = await import('./fs-primitives');
  await removeEntry(root, projectTrashedMarkerPath(id));
  await withKeyLock(INDEX_LOCK_KEY, () => rebuildAndWriteIndex(root));
  logger.info(`Restored project ${id}`);
}

/**
 * Return whether a project is currently in the trash. Cheap (single
 * exists() check).
 */
export async function isProjectTrashed(id: string): Promise<boolean> {
  const root = requireWorkspaceRoot();
  return markerExists(root, id);
}

/**
 * List every trashed project with its marker, sorted most-recently-deleted
 * first. Used by the Trash UI and by `sweepTrashOlderThan`.
 */
export async function listTrashedProjects(): Promise<TrashedProjectEntry[]> {
  const root = requireWorkspaceRoot();
  const entries = await listDirectory(root, [PROJECTS_DIR]);
  const trashed: TrashedProjectEntry[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'directory') continue;
    const marker = await readMarker(root, entry.name);
    if (marker) {
      trashed.push({ id: entry.name, marker });
    }
  }
  trashed.sort((a, b) => b.marker.deletedAt - a.marker.deletedAt);
  return trashed;
}

/**
 * Get the list of media ids that were associated with a trashed project
 * at delete time. Callers use this to decide which media to clean up
 * during permanent deletion.
 *
 * Trashed projects still have their `media-links.json` intact, so this
 * is just a direct read.
 */
export async function getTrashedProjectMediaIds(id: string): Promise<string[]> {
  const root = requireWorkspaceRoot();
  if (!(await markerExists(root, id))) {
    return [];
  }
  const { projectMediaLinksPath } = await import('./paths');
  const links = await readJson<{ mediaIds?: Array<{ id: string }> }>(
    root,
    projectMediaLinksPath(id),
  );
  return links?.mediaIds?.map((m) => m.id) ?? [];
}

/**
 * Sweep trashed projects whose `deletedAt` is older than `ttlMs`.
 * For each expired project, invoke `onPurge(id)` — callers typically
 * wire this to a function that runs media cleanup and then calls
 * `deleteProject(id)`. Errors in `onPurge` are logged per-id and do
 * NOT stop the sweep.
 *
 * Returns the list of ids that were fully purged.
 */
export async function sweepTrashOlderThan(
  ttlMs: number,
  onPurge: (id: string) => Promise<void>,
): Promise<string[]> {
  const cutoff = Date.now() - ttlMs;
  const trashed = await listTrashedProjects();
  const expired = trashed.filter((e) => e.marker.deletedAt < cutoff);
  const purged: string[] = [];
  for (const entry of expired) {
    try {
      await onPurge(entry.id);
      purged.push(entry.id);
    } catch (error) {
      logger.warn(`sweepTrashOlderThan: onPurge(${entry.id}) failed`, error);
    }
  }
  if (purged.length > 0) {
    logger.info(
      `Auto-purged ${purged.length} expired trashed project(s) (TTL=${ttlMs}ms)`,
    );
  }
  return purged;
}
