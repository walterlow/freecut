/**
 * Projects store backed by the workspace folder.
 *
 * Preserves the exact function signatures the legacy indexeddb/projects.ts
 * exported so consumers don't change. Each project lives at
 * `projects/{id}/project.json` with an entry in `index.json`.
 *
 * FileSystemDirectoryHandle-typed `rootFolderHandle` is stripped on write
 * and re-attached on read via the handles-db registry so the JSON stays
 * pure.
 */

import type { Project } from '@/types/project'
import { createLogger } from '@/shared/logging/logger'
import { getHandle, saveHandle, deleteHandle } from '@/infrastructure/storage/handles-db'

import { requireWorkspaceRoot } from './root'
import {
  exists,
  listDirectory,
  readJson,
  removeEntry,
  writeJsonAtomic,
  WorkspaceFileCorruptError,
  type WorkspaceRootInput,
} from './fs-primitives'
import { PROJECTS_DIR, projectDir, projectJsonPath, projectTrashedMarkerPath } from './paths'
import { describeStorageEnvironment } from './storage-environment'
import {
  readWorkspaceIndex,
  sortIndexEntries,
  writeWorkspaceIndex,
  type WorkspaceIndexEntry,
} from './workspace-index'
import { withKeyLock } from './with-key-lock'

/**
 * Single key for every `index.json` mutation.
 *
 * The index file is rebuilt from a directory scan then written. Without
 * serialization, two concurrent creates can both read the directory
 * before the other's project.json has landed, producing a stale index
 * that drops the other tab's entry. File is self-healing (the missing
 * entry re-appears on the next rebuild) but serializing removes the
 * window entirely within one tab.
 */
const INDEX_LOCK_KEY = 'projects:index'

const logger = createLogger('WorkspaceFS:Projects')

/** Shape stored in project.json — no FileSystem*Handle fields. */
type SerializedProject = Omit<Project, 'rootFolderHandle'>

async function stashRootFolderHandle(project: Project): Promise<SerializedProject> {
  const { rootFolderHandle, ...rest } = project
  if (rootFolderHandle) {
    await saveHandle({
      kind: 'project-folder',
      id: project.id,
      handle: rootFolderHandle,
      name: rootFolderHandle.name,
      pickedAt: Date.now(),
    })
  } else {
    // Ensure stale registry entries are cleaned when the project drops its folder.
    await deleteHandle('project-folder', project.id).catch((error) => {
      logger.warn(`Failed to clean project-folder handle for ${project.id}`, error)
    })
  }
  return rest
}

async function restoreRootFolderHandle(serialized: SerializedProject): Promise<Project> {
  const record = await getHandle('project-folder', serialized.id)
  if (record) {
    return {
      ...serialized,
      rootFolderHandle: record.handle as FileSystemDirectoryHandle,
      rootFolderName: record.name,
    }
  }
  return serialized as Project
}

async function isTrashed(root: WorkspaceRootInput, id: string): Promise<boolean> {
  return exists(root, projectTrashedMarkerPath(id))
}

async function rebuildIndex(root: WorkspaceRootInput): Promise<WorkspaceIndexEntry[]> {
  const entries = await listDirectory(root, [PROJECTS_DIR])
  const indexEntries: WorkspaceIndexEntry[] = []
  for (const entry of entries) {
    if (entry.kind !== 'directory') continue
    // Trashed projects are invisible to `getAllProjects` and must not
    // appear in the index either.
    if (await isTrashed(root, entry.name)) continue
    let project: SerializedProject | null = null
    try {
      project = await readJson<SerializedProject>(root, projectJsonPath(entry.name))
    } catch (error) {
      if (!(error instanceof WorkspaceFileCorruptError)) throw error
      logger.warn(`rebuildIndex: skipping corrupt project.json for ${entry.name}`, error)
      continue
    }
    if (!project) continue
    indexEntries.push({
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
    })
  }
  return indexEntries
}

/**
 * Rebuild `index.json` from a directory scan, persist it, and return the
 * entries — so callers need not re-read the file they just wrote.
 *
 * `persist` decides what a failed write means:
 *  - `'required'` (default): rethrow. Mutating callers (delete) must surface a
 *    workspace that won't accept writes.
 *  - `'best-effort'`: warn and serve the scanned entries anyway. `index.json`
 *    is a derived cache — `projects/` on disk is the source of truth — so a
 *    workspace we can read but not write (read-only mount, or a browser whose
 *    `FileSystemFileHandle.move()` rejects) must still list its projects
 *    instead of failing the whole load.
 */
async function refreshIndex(
  root: WorkspaceRootInput,
  persist: 'required' | 'best-effort' = 'required',
): Promise<WorkspaceIndexEntry[]> {
  return withKeyLock(INDEX_LOCK_KEY, async () => {
    const entries = sortIndexEntries(await rebuildIndex(root))
    try {
      await writeWorkspaceIndex(root, entries)
    } catch (error) {
      if (persist === 'required') throw error
      logger.warn('refreshIndex: could not persist index.json — serving from scan', error)
    }
    return entries
  })
}

/**
 * Incrementally add/update a single entry in `index.json` without re-reading
 * every other project's `project.json`.
 *
 * This is the hot path for saves: a full {@link rebuildIndex} scan reads every
 * project file on disk on every autosave, so its cost grows with the number of
 * projects in the workspace. The index only carries `{id, name, updatedAt}`, so
 * a targeted upsert is sufficient — the authoritative name/data are re-read from
 * each `project.json` in `getAllProjects` anyway, and a full rebuild still runs
 * as the self-heal path when the index is empty/corrupt (see `getAllProjects`)
 * or on delete.
 *
 * When the on-disk index is empty (cold start or a corrupt read fell back to an
 * empty index), a bare upsert would leave every other project hidden until the
 * next rebuild — so we do one full scan in that case to re-materialize all
 * entries. On the common warm path the index is non-empty and this stays O(1).
 */
async function upsertIndexEntry(
  root: WorkspaceRootInput,
  entry: WorkspaceIndexEntry,
): Promise<void> {
  await withKeyLock(INDEX_LOCK_KEY, async () => {
    const index = await readWorkspaceIndex(root)
    const baseEntries = index.projects.length > 0 ? index.projects : await rebuildIndex(root)
    const next = baseEntries.some((existing) => existing.id === entry.id)
      ? baseEntries.map((existing) => (existing.id === entry.id ? entry : existing))
      : [...baseEntries, entry]
    await writeWorkspaceIndex(root, next)
  })
}

/* ────────────────────────────── Public API ───────────────────────────── */

export async function getAllProjects(): Promise<Project[]> {
  const root = requireWorkspaceRoot()
  try {
    let entries = (await readWorkspaceIndex(root)).projects
    // If the index is empty (missing or was corrupt), rebuild it from a
    // directory scan so healthy projects are not hidden. This is a no-op for
    // genuinely empty workspaces (scan of an absent/empty projects/ dir
    // returns []). Reading must not depend on the rebuilt index landing on
    // disk, so the persist is best-effort and we use the scan's own entries.
    if (entries.length === 0) {
      entries = await refreshIndex(root, 'best-effort')
    }
    const projects: Project[] = []
    for (const entry of entries) {
      // Defensive: the index should never contain trashed projects, but
      // if it drifted (e.g. marker written by another tab after index
      // was last rebuilt), skip them so they don't surface in the UI.
      if (await isTrashed(root, entry.id)) continue
      let serialized: SerializedProject | null = null
      try {
        serialized = await readJson<SerializedProject>(root, projectJsonPath(entry.id))
      } catch (error) {
        if (!(error instanceof WorkspaceFileCorruptError)) throw error
        logger.warn(`getAllProjects: skipping corrupt project.json for ${entry.id}`, error)
        continue
      }
      if (!serialized) continue
      projects.push(await restoreRootFolderHandle(serialized))
    }
    return projects
  } catch (error) {
    // This is the app's first fatal: it rejects a route beforeLoad, so the user
    // gets a bare error page. Keep the underlying DOMException reachable via
    // `cause` — its `name` is the whole diagnosis — and record the environment,
    // which the error itself cannot tell us.
    logger.error('getAllProjects failed', { environment: describeStorageEnvironment() }, error)
    throw new Error('Failed to load projects from workspace', { cause: error })
  }
}

export async function getProject(id: string): Promise<Project | undefined> {
  const root = requireWorkspaceRoot()
  try {
    // Trashed projects are invisible to normal consumers. The trash UI
    // uses `listTrashedProjects` from `./trash.ts` to see them.
    if (await isTrashed(root, id)) return undefined
    const serialized = await readJson<SerializedProject>(root, projectJsonPath(id))
    if (!serialized) return undefined
    return restoreRootFolderHandle(serialized)
  } catch (error) {
    logger.error(`getProject(${id}) failed`, error)
    throw new Error(`Failed to load project: ${id}`, { cause: error })
  }
}

export async function createProject(project: Project): Promise<Project> {
  const root = requireWorkspaceRoot()
  try {
    const existing = await readJson<SerializedProject>(root, projectJsonPath(project.id))
    if (existing) {
      throw new Error(`Project already exists: ${project.id}`)
    }
    const serialized = await stashRootFolderHandle(project)
    await writeJsonAtomic(root, projectJsonPath(project.id), serialized)
    await upsertIndexEntry(root, {
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
    })
    return project
  } catch (error) {
    logger.error('createProject failed', error)
    throw error
  }
}

export async function updateProject(id: string, updates: Partial<Project>): Promise<Project> {
  const root = requireWorkspaceRoot()
  try {
    const existingSerialized = await readJson<SerializedProject>(root, projectJsonPath(id))
    if (!existingSerialized) {
      throw new Error(`Project not found: ${id}`)
    }

    // Merge at the serialized layer — `rootFolderHandle` never lives in
    // project.json. Only touch the handle registry when the caller actually
    // changes the handle; a normal timeline autosave leaves it untouched, so
    // this avoids one IndexedDB write (or delete) on every save.
    const handleChanging = 'rootFolderHandle' in updates
    const { rootFolderHandle, ...serializableUpdates } = updates
    const updatedAt = Date.now()
    const nextSerialized: SerializedProject = {
      ...existingSerialized,
      ...serializableUpdates,
      id,
      updatedAt,
    }

    if (handleChanging) {
      if (rootFolderHandle) {
        await saveHandle({
          kind: 'project-folder',
          id,
          handle: rootFolderHandle,
          name: rootFolderHandle.name,
          pickedAt: Date.now(),
        })
      } else {
        await deleteHandle('project-folder', id).catch((error) => {
          logger.warn(`Failed to clean project-folder handle for ${id}`, error)
        })
      }
    }

    await writeJsonAtomic(root, projectJsonPath(id), nextSerialized)
    await upsertIndexEntry(root, { id, name: nextSerialized.name, updatedAt })
    return restoreRootFolderHandle(nextSerialized)
  } catch (error) {
    logger.error(`updateProject(${id}) failed`, error)
    throw error
  }
}

export async function deleteProject(id: string): Promise<void> {
  const root = requireWorkspaceRoot()
  try {
    await removeEntry(root, projectDir(id), { recursive: true })
    await deleteHandle('project-folder', id).catch((error) => {
      logger.warn(`Failed to clean project-folder handle for ${id}`, error)
    })
    await refreshIndex(root)
  } catch (error) {
    logger.error(`deleteProject(${id}) failed`, error)
    throw new Error(`Failed to delete project: ${id}`, { cause: error })
  }
}

export async function getDBStats(): Promise<{
  projectCount: number
  storageUsed: number
  storageQuota: number
}> {
  try {
    const root = requireWorkspaceRoot()
    const index = await readWorkspaceIndex(root)
    let usage = 0
    let quota = 0
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate()
      usage = estimate.usage ?? 0
      quota = estimate.quota ?? 0
    }
    return {
      projectCount: index.projects.length,
      storageUsed: usage,
      storageQuota: quota,
    }
  } catch (error) {
    logger.error('getDBStats failed', error)
    return { projectCount: 0, storageUsed: 0, storageQuota: 0 }
  }
}
