/**
 * Workspace-level index.json — fast project list.
 *
 * Kept in sync by create/update/delete operations in `projects.ts`.
 * Stored as:
 *   { version: "1.0", updatedAt: number, projects: [{id, name, updatedAt}] }
 */

import { INDEX_FILENAME } from './paths'
import { readJson, writeJsonAtomic } from './fs-primitives'

export const INDEX_VERSION = '1.0'

export interface WorkspaceIndexEntry {
  id: string
  name: string
  updatedAt: number
}

export interface WorkspaceIndex {
  version: string
  updatedAt: number
  projects: WorkspaceIndexEntry[]
}

export async function readWorkspaceIndex(root: FileSystemDirectoryHandle): Promise<WorkspaceIndex> {
  const existing = await readJson<WorkspaceIndex>(root, [INDEX_FILENAME])
  if (existing) return existing
  return { version: INDEX_VERSION, updatedAt: 0, projects: [] }
}

export async function writeWorkspaceIndex(
  root: FileSystemDirectoryHandle,
  entries: WorkspaceIndexEntry[],
): Promise<void> {
  const sorted = [...entries].sort((a, b) => b.updatedAt - a.updatedAt)
  const index: WorkspaceIndex = {
    version: INDEX_VERSION,
    updatedAt: Date.now(),
    projects: sorted,
  }
  await writeJsonAtomic(root, [INDEX_FILENAME], index)
}
