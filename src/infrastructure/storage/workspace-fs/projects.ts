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
import { exists, listDirectory, readJson, removeEntry, writeJsonAtomic } from './fs-primitives'
import { PROJECTS_DIR, projectDir, projectJsonPath, projectTrashedMarkerPath } from './paths'
import {
  readWorkspaceIndex,
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
    await deleteHandle('project-folder', project.id).catch(() => {})
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

async function isTrashed(root: FileSystemDirectoryHandle, id: string): Promise<boolean> {
  return exists(root, projectTrashedMarkerPath(id))
}

async function rebuildIndex(root: FileSystemDirectoryHandle): Promise<WorkspaceIndexEntry[]> {
  const entries = await listDirectory(root, [PROJECTS_DIR])
  const indexEntries: WorkspaceIndexEntry[] = []
  for (const entry of entries) {
    if (entry.kind !== 'directory') continue
    // Trashed projects are invisible to `getAllProjects` and must not
    // appear in the index either.
    if (await isTrashed(root, entry.name)) continue
    const project = await readJson<SerializedProject>(root, projectJsonPath(entry.name))
    if (!project) continue
    indexEntries.push({
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
    })
  }
  return indexEntries
}

async function refreshIndex(root: FileSystemDirectoryHandle): Promise<void> {
  await withKeyLock(INDEX_LOCK_KEY, async () => {
    const entries = await rebuildIndex(root)
    await writeWorkspaceIndex(root, entries)
  })
}

/* ────────────────────────────── Public API ───────────────────────────── */

export async function getAllProjects(): Promise<Project[]> {
  const root = requireWorkspaceRoot()
  try {
    const index = await readWorkspaceIndex(root)
    const projects: Project[] = []
    for (const entry of index.projects) {
      // Defensive: the index should never contain trashed projects, but
      // if it drifted (e.g. marker written by another tab after index
      // was last rebuilt), skip them so they don't surface in the UI.
      if (await isTrashed(root, entry.id)) continue
      const serialized = await readJson<SerializedProject>(root, projectJsonPath(entry.id))
      if (!serialized) continue
      projects.push(await restoreRootFolderHandle(serialized))
    }
    return projects
  } catch (error) {
    logger.error('getAllProjects failed', error)
    throw new Error('Failed to load projects from workspace')
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
    throw new Error(`Failed to load project: ${id}`)
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
    await refreshIndex(root)
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
    const existing = await restoreRootFolderHandle(existingSerialized)
    const updated: Project = {
      ...existing,
      ...updates,
      id,
      updatedAt: Date.now(),
    }
    const nextSerialized = await stashRootFolderHandle(updated)
    await writeJsonAtomic(root, projectJsonPath(id), nextSerialized)
    await refreshIndex(root)
    return updated
  } catch (error) {
    logger.error(`updateProject(${id}) failed`, error)
    throw error
  }
}

export async function deleteProject(id: string): Promise<void> {
  const root = requireWorkspaceRoot()
  try {
    await removeEntry(root, projectDir(id), { recursive: true })
    await deleteHandle('project-folder', id).catch(() => {})
    await refreshIndex(root)
  } catch (error) {
    logger.error(`deleteProject(${id}) failed`, error)
    throw new Error(`Failed to delete project: ${id}`)
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
