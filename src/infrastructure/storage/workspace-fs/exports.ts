/**
 * Final render outputs from the export queue.
 *
 * Saves to the project's own `projects/{id}/exports/` folder so outputs are
 * grouped with the project and removed with it. `listExportFiles` also surfaces
 * any loose files in the legacy top-level `exports/` folder so older renders
 * (made before per-project exports) stay visible. Read/delete are addressed by
 * full path, so they work for both locations. Filenames are de-duplicated
 * (` (2)`, ` (3)`, …) so re-rendering a segment doesn't overwrite a result.
 */

import { getWorkspaceRoot, requireWorkspaceRoot } from './root'
import { exists, readBlob, readDirectoryFiles, removeEntry, writeBlob } from './fs-primitives'
import {
  EXPORTS_DIR,
  PROJECTS_DIR,
  exportFilePath,
  exportsDir,
  projectExportFilePath,
  projectExportsDir,
  sanitizeWorkspaceFileName,
} from './paths'

export interface SavedExport {
  /** The on-disk filename actually used (after de-duplication). */
  fileName: string
  /** Workspace-root-relative path, forward-slash separated (for display). */
  relPath: string
}

export interface ExportFileEntry {
  name: string
  size: number
  /** Epoch ms of the file's last modification (0 when unavailable). */
  lastModified: number
  /** Workspace-relative path segments — used to read/delete the file. */
  path: string[]
  /** True for loose files in the top-level `exports/` folder (no project). */
  legacy: boolean
}

/** Insert a ` (n)` suffix before the extension: `clip.mp4` → `clip (2).mp4`. */
function suffixFileName(fileName: string, n: number): string {
  const dot = fileName.lastIndexOf('.')
  const hasExt = dot > 0
  const stem = hasExt ? fileName.slice(0, dot) : fileName
  const ext = hasExt ? fileName.slice(dot) : ''
  return `${stem} (${n})${ext}`
}

async function uniqueFileName(
  root: FileSystemDirectoryHandle,
  pathOf: (name: string) => string[],
  fileName: string,
): Promise<string> {
  const safe = sanitizeWorkspaceFileName(fileName)
  if (!(await exists(root, pathOf(safe)))) return safe
  for (let n = 2; n < 1000; n++) {
    const candidate = suffixFileName(safe, n)
    if (!(await exists(root, pathOf(candidate)))) return candidate
  }
  // Pathological fallback — guaranteed unique enough.
  return suffixFileName(safe, Date.now())
}

/**
 * Save a rendered blob to the project's `exports/` folder, returning the final
 * filename and workspace-relative path. Falls back to a top-level `exports/`
 * only when no project id is given. Throws if no workspace root is set.
 */
export async function saveExportFile(
  projectId: string | undefined,
  fileName: string,
  data: Blob,
): Promise<SavedExport> {
  const root = requireWorkspaceRoot()
  const pathOf = projectId
    ? (name: string) => projectExportFilePath(projectId, name)
    : (name: string) => exportFilePath(name)
  const relBase = projectId ? `${PROJECTS_DIR}/${projectId}/${EXPORTS_DIR}` : EXPORTS_DIR

  const name = await uniqueFileName(root, pathOf, fileName)
  await writeBlob(root, pathOf(name), data)
  return { fileName: name, relPath: `${relBase}/${name}` }
}

async function listDir(
  root: FileSystemDirectoryHandle,
  dir: string[],
  pathOf: (name: string) => string[],
  legacy: boolean,
): Promise<ExportFileEntry[]> {
  const files = await readDirectoryFiles(root, dir)
  return files.map(({ name, blob }) => ({
    name,
    size: blob.size,
    // readDirectoryFiles hands back File handles, so lastModified is available
    // without reading the bytes.
    lastModified: (blob as File).lastModified ?? 0,
    path: pathOf(name),
    legacy,
  }))
}

/**
 * List a project's saved exports plus any loose files in the legacy top-level
 * `exports/` folder, newest first.
 */
export async function listExportFiles(projectId: string): Promise<ExportFileEntry[]> {
  const root = requireWorkspaceRoot()
  const [projectFiles, legacyFiles] = await Promise.all([
    listDir(
      root,
      projectExportsDir(projectId),
      (name) => projectExportFilePath(projectId, name),
      false,
    ),
    listDir(root, exportsDir(), (name) => exportFilePath(name), true),
  ])
  return [...projectFiles, ...legacyFiles].sort((a, b) => b.lastModified - a.lastModified)
}

/** Read an export's bytes (for download). Null when missing. */
export function readExportFile(path: string[]): Promise<Blob | null> {
  return readBlob(requireWorkspaceRoot(), path)
}

/** Delete an export by path. No-op when missing. */
export function deleteExportFile(path: string[]): Promise<void> {
  return removeEntry(requireWorkspaceRoot(), path)
}

/** The user-picked workspace folder's name (for telling users where files land). */
export function workspaceFolderName(): string | null {
  return getWorkspaceRoot()?.name ?? null
}
