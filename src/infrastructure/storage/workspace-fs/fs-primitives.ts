/**
 * Filesystem primitives over FileSystemDirectoryHandle.
 *
 * Every higher-level storage module in workspace-fs calls these. They:
 *  - resolve path segments via nested getDirectoryHandle({ create: true })
 *  - read/write JSON and binary blobs
 *  - write JSON atomically (tmp-file + replace) so index.json / project.json
 *    don't tear on crash
 *  - convert NotFoundError to typed null returns so callers don't have to
 *    do try/catch everywhere
 *  - detect NotAllowedError (permission revoked) and emit a signal so UI
 *    can prompt re-grant
 *
 * Path inputs are arrays of segments — consistent with paths.ts.
 */

import { createLogger } from '@/shared/logging/logger'
import { notifyPermissionLost } from './root'
import { withKeyLock } from './with-key-lock'

const logger = createLogger('WorkspaceFS')

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError'
}

function isNotAllowed(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotAllowedError'
}

function wrap<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  return fn().catch((error) => {
    if (isNotAllowed(error)) {
      notifyPermissionLost()
    }
    logger.warn(`${operation} failed`, error)
    throw error
  })
}

/**
 * Walk a path of directory segments, creating each if missing.
 * Last segment is returned as the directory handle.
 */
async function resolveDir(
  root: FileSystemDirectoryHandle,
  segments: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let dir = root
  for (const segment of segments) {
    dir = await dir.getDirectoryHandle(segment, { create })
  }
  return dir
}

/**
 * Resolve segments to (parent dir, file name). Segments must have length >= 1.
 */
async function resolveFileParent(
  root: FileSystemDirectoryHandle,
  segments: string[],
  create: boolean,
): Promise<{ parent: FileSystemDirectoryHandle; fileName: string }> {
  if (segments.length === 0) {
    throw new Error('fs-primitives: empty path segments')
  }
  const parentSegments = segments.slice(0, -1)
  const fileName = segments[segments.length - 1]!
  const parent = await resolveDir(root, parentSegments, create)
  return { parent, fileName }
}

/* ────────────────────────────── Read helpers ─────────────────────────── */

export async function readJson<T>(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<T | null> {
  return wrap('readJson', async () => {
    try {
      const { parent, fileName } = await resolveFileParent(root, segments, false)
      const file = await parent.getFileHandle(fileName, { create: false })
      const blob = await file.getFile()
      const text = await blob.text()
      if (text.length === 0) return null
      return JSON.parse(text) as T
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  })
}

export async function readBlob(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<Blob | null> {
  return wrap('readBlob', async () => {
    try {
      const { parent, fileName } = await resolveFileParent(root, segments, false)
      const file = await parent.getFileHandle(fileName, { create: false })
      return await file.getFile()
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  })
}

export async function readArrayBuffer(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<ArrayBuffer | null> {
  const blob = await readBlob(root, segments)
  if (!blob) return null
  return blob.arrayBuffer()
}

/* ────────────────────────────── Write helpers ────────────────────────── */

/**
 * Atomic JSON write: writes to `{name}.tmp`, then replaces the target.
 * Protects against torn writes on crash. Uses FileSystemFileHandle.move
 * (Chromium) when available, falls back to write-then-remove-tmp.
 *
 * Serialized per-path by an in-memory lock. Without this, two concurrent
 * callers racing on the same path can deadlock each other's move():
 *   - A: open tmp writable, write, close → begin .move()
 *   - B: open tmp writable (A has closed, so B succeeds) → write
 *   - A: .move() throws NoModificationAllowedError — "cannot move while
 *     the handle is locked" (B's writable is open on the same tmp)
 * The lock scope is one tab; cross-tab races on the same path are still
 * last-write-wins but can't produce the locked-handle error because each
 * tab has its own tmp writable lifecycle.
 */
function writeJsonAtomicLockKey(segments: string[]): string {
  return `writeJsonAtomic:${segments.join('/')}`
}

export async function writeJsonAtomic(
  root: FileSystemDirectoryHandle,
  segments: string[],
  data: unknown,
): Promise<number> {
  return wrap('writeJsonAtomic', () =>
    withKeyLock(writeJsonAtomicLockKey(segments), async () => {
      const { parent, fileName } = await resolveFileParent(root, segments, true)
      const tmpName = `${fileName}.tmp`
      const json = JSON.stringify(data, null, 2)

      const tmpHandle = await parent.getFileHandle(tmpName, { create: true })
      const writable = await tmpHandle.createWritable()
      await writable.write(json)
      await writable.close()

      type MovableHandle = FileSystemFileHandle & {
        move?: (parent: FileSystemDirectoryHandle, newName: string) => Promise<void>
      }
      const movable = tmpHandle as MovableHandle
      if (typeof movable.move === 'function') {
        await movable.move(parent, fileName)
      } else {
        // Fallback: copy tmp → target, then remove tmp.
        const targetHandle = await parent.getFileHandle(fileName, { create: true })
        const targetWritable = await targetHandle.createWritable()
        await targetWritable.write(json)
        await targetWritable.close()
        try {
          await parent.removeEntry(tmpName)
        } catch (error) {
          if (!isNotFound(error)) throw error
        }
      }

      return json.length
    }),
  )
}

export async function writeBlob(
  root: FileSystemDirectoryHandle,
  segments: string[],
  data: Blob | ArrayBuffer | Uint8Array | string,
): Promise<void> {
  // Serialized per-path for the same reason as writeJsonAtomic: two
  // concurrent writers on the same file race on the writable lock. In
  // writeBlob's case the loser fails at createWritable with
  // NoModificationAllowedError rather than at move(), but the fix is
  // identical. Different paths use different lock keys, so this does
  // not constrain parallelism of unrelated writes.
  return wrap('writeBlob', () =>
    withKeyLock(`writeBlob:${segments.join('/')}`, async () => {
      const { parent, fileName } = await resolveFileParent(root, segments, true)
      const fh = await parent.getFileHandle(fileName, { create: true })
      const writable = await fh.createWritable()
      await writable.write(data as FileSystemWriteChunkType)
      await writable.close()
    }),
  )
}

/* ────────────────────────────── Delete helpers ───────────────────────── */

/**
 * Remove a file or a whole subtree. No-op when missing.
 */
export async function removeEntry(
  root: FileSystemDirectoryHandle,
  segments: string[],
  options: { recursive?: boolean } = {},
): Promise<void> {
  if (segments.length === 0) {
    throw new Error('fs-primitives: refusing to remove empty path')
  }
  return wrap('removeEntry', async () => {
    try {
      const { parent, fileName } = await resolveFileParent(root, segments, false)
      await parent.removeEntry(fileName, { recursive: options.recursive ?? false })
    } catch (error) {
      if (isNotFound(error)) return
      throw error
    }
  })
}

/* ────────────────────────────── Enumeration ──────────────────────────── */

export interface DirectoryEntry {
  name: string
  kind: 'file' | 'directory'
}

export async function listDirectory(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<DirectoryEntry[]> {
  return wrap('listDirectory', async () => {
    try {
      const dir = await resolveDir(root, segments, false)
      const entries: DirectoryEntry[] = []
      for await (const entry of dir.values()) {
        entries.push({ name: entry.name, kind: entry.kind })
      }
      return entries
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
  })
}

export async function exists(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<boolean> {
  try {
    const { parent, fileName } = await resolveFileParent(root, segments, false)
    try {
      await parent.getFileHandle(fileName, { create: false })
      return true
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
    try {
      await parent.getDirectoryHandle(fileName, { create: false })
      return true
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
    return false
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}
