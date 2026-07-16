/**
 * Filesystem primitives over a LocalDirectoryBackend.
 *
 * Higher-level FreeCut storage modules remain unaware of whether the directory
 * came from showDirectoryPicker() or Electron's local-directory bridge.
 */

import { createLogger } from '@/shared/logging/logger'
import { FileSystemAccessDirectoryBackend } from '@/infrastructure/storage/local-directory/file-system-access-backend'
import type {
  LocalDirectoryBackend,
  LocalDirectoryEntry,
} from '@/infrastructure/storage/local-directory/types'
import { notifyPermissionLost } from './root'
import { withKeyLock } from './with-key-lock'

const logger = createLogger('WorkspaceFS')

export class WorkspaceFileCorruptError extends Error {
  constructor(
    public readonly path: string,
    cause: unknown,
  ) {
    super(`Corrupt JSON at ${path}`)
    this.name = 'WorkspaceFileCorruptError'
    this.cause = cause
  }
}

export type WorkspaceRootInput = LocalDirectoryBackend | FileSystemDirectoryHandle
export type DirectoryEntry = LocalDirectoryEntry

const backendByHandle = new WeakMap<FileSystemDirectoryHandle, FileSystemAccessDirectoryBackend>()

function backendOf(root: WorkspaceRootInput): LocalDirectoryBackend {
  if (isLocalDirectoryBackend(root)) {
    return root
  }
  let backend = backendByHandle.get(root)
  if (!backend) {
    backend = new FileSystemAccessDirectoryBackend(root)
    backendByHandle.set(root, backend)
  }
  return backend
}

function isLocalDirectoryBackend(root: WorkspaceRootInput): root is LocalDirectoryBackend {
  const kind = (root as { kind?: unknown }).kind
  return kind === 'file-system-access' || kind === 'electron-directory'
}

function wrap<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  return fn().catch((error) => {
    if (isPermissionLostError(error)) {
      notifyPermissionLost()
    }
    logger.warn(`${operation} failed`, error)
    throw error
  })
}

function isPermissionLostError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { name?: unknown; code?: unknown; message?: unknown }
  if (value.name === 'NotAllowedError' || value.name === 'SecurityError') return true
  if (
    value.code === 'EACCES' ||
    value.code === 'EPERM' ||
    value.code === 'ERR_ACCESS_DENIED' ||
    value.code === 'LOCAL_DIRECTORY_GRANT_REVOKED' ||
    value.code === 'LOCAL_DIRECTORY_PERMISSION_DENIED'
  ) {
    return true
  }
  return (
    typeof value.message === 'string' &&
    /(?:grant|permission).*(?:denied|revoked)|(?:denied|revoked).*(?:grant|permission)/i.test(
      value.message,
    )
  )
}

export async function readJson<T>(root: WorkspaceRootInput, segments: string[]): Promise<T | null> {
  return wrap('readJson', async () => {
    const blob = await backendOf(root).readFile(segments)
    if (!blob) return null
    const text = await blob.text()
    if (text.length === 0) return null
    try {
      return JSON.parse(text) as T
    } catch (error) {
      throw new WorkspaceFileCorruptError(segments.join('/'), error)
    }
  })
}

export function readBlob(root: WorkspaceRootInput, segments: string[]): Promise<Blob | null> {
  return wrap('readBlob', () => backendOf(root).readFile(segments))
}

export async function readArrayBuffer(
  root: WorkspaceRootInput,
  segments: string[],
): Promise<ArrayBuffer | null> {
  const blob = await readBlob(root, segments)
  return blob ? blob.arrayBuffer() : null
}

export function writeJsonAtomic(
  root: WorkspaceRootInput,
  segments: string[],
  data: unknown,
): Promise<number> {
  return wrap('writeJsonAtomic', () =>
    withKeyLock(`writeJsonAtomic:${segments.join('/')}`, async () => {
      const json = JSON.stringify(data, null, 2)
      await backendOf(root).writeFileAtomic(segments, json)
      return json.length
    }),
  )
}

export function writeBlob(
  root: WorkspaceRootInput,
  segments: string[],
  data: Blob | ArrayBuffer | Uint8Array | string,
): Promise<void> {
  return wrap('writeBlob', () =>
    withKeyLock(`writeBlob:${segments.join('/')}`, async () => {
      await backendOf(root).writeFile(segments, data)
    }),
  )
}

export function removeEntry(
  root: WorkspaceRootInput,
  segments: string[],
  options: { recursive?: boolean } = {},
): Promise<void> {
  if (segments.length === 0) {
    throw new Error('fs-primitives: refusing to remove empty path')
  }
  return wrap('removeEntry', () => backendOf(root).remove(segments, options))
}

export function listDirectory(
  root: WorkspaceRootInput,
  segments: string[],
): Promise<DirectoryEntry[]> {
  return wrap('listDirectory', () => backendOf(root).listDirectory(segments))
}

export async function readDirectoryFiles(
  root: WorkspaceRootInput,
  segments: string[],
  filter?: (entry: DirectoryEntry) => boolean,
): Promise<Array<{ name: string; blob: Blob }>> {
  return wrap('readDirectoryFiles', async () => {
    const backend = backendOf(root)
    const entries = await backend.listDirectory(segments)
    const files = entries.filter((entry) => entry.kind === 'file' && (!filter || filter(entry)))
    const results = await Promise.all(
      files.map(async (entry) => {
        const blob = await backend.readFile([...segments, entry.name])
        return blob ? { name: entry.name, blob } : null
      }),
    )
    return results.filter((result): result is { name: string; blob: Blob } => result !== null)
  })
}

export function exists(root: WorkspaceRootInput, segments: string[]): Promise<boolean> {
  return wrap('exists', () => backendOf(root).exists(segments))
}
