/**
 * Generic workspace-folder mirror for OPFS-backed caches.
 *
 * Each legacy cache (proxies, filmstrips, preview-audio-conform) keeps
 * writing to OPFS for speed, but now ALSO mirrors to the workspace
 * folder so cross-origin reads work without regenerating expensive
 * derived data (transcodes, 1fps frame extraction, codec conforms).
 *
 * Reads fall back to the workspace copy when OPFS is empty (which
 * happens on any origin that didn't produce the cache). Optionally,
 * a workspace-read also back-fills OPFS so the next local read is
 * fast.
 *
 * This module speaks the same `string[]` path-segment language as
 * `fs-primitives.ts` and treats any path as namespace-agnostic —
 * callers pick the convention (`['proxies', key, 'proxy.mp4']`,
 * `['media', id, 'cache', 'filmstrip', '3.jpg']`, etc).
 */

import { createLogger } from '@/shared/logging/logger'

import { getWorkspaceRoot } from './root'
import { exists, readBlob, removeEntry, writeBlob, writeJsonAtomic } from './fs-primitives'
import { blobToArrayBuffer } from './blob-utils'

const logger = createLogger('WorkspaceFS:CacheMirror')

/**
 * Write a blob to the workspace at the given path. Safe to call on every
 * origin: if no workspace root is set (edge cases before WorkspaceGate
 * fully hydrates), it's a no-op instead of a throw — cache writes are
 * never critical-path.
 */
export async function mirrorBlobToWorkspace(segments: string[], blob: Blob): Promise<void> {
  const root = getWorkspaceRoot()
  if (!root) return
  try {
    if (await exists(root, segments)) return // idempotent
    const bytes = new Uint8Array(await blobToArrayBuffer(blob))
    await writeBlob(root, segments, bytes)
  } catch (error) {
    logger.warn(`mirrorBlobToWorkspace(${segments.join('/')}) failed`, error)
  }
}

/**
 * Same as mirrorBlobToWorkspace, but for pre-existing ArrayBuffer/Uint8Array
 * inputs (avoids round-tripping through Blob).
 */
export async function mirrorBytesToWorkspace(
  segments: string[],
  bytes: ArrayBuffer | Uint8Array,
): Promise<void> {
  const root = getWorkspaceRoot()
  if (!root) return
  try {
    if (await exists(root, segments)) return
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    await writeBlob(root, segments, u8)
  } catch (error) {
    logger.warn(`mirrorBytesToWorkspace(${segments.join('/')}) failed`, error)
  }
}

/**
 * Mirror a JSON value atomically.
 */
export async function mirrorJsonToWorkspace(segments: string[], data: unknown): Promise<void> {
  const root = getWorkspaceRoot()
  if (!root) return
  try {
    await writeJsonAtomic(root, segments, data)
  } catch (error) {
    logger.warn(`mirrorJsonToWorkspace(${segments.join('/')}) failed`, error)
  }
}

/**
 * Read a blob from the workspace at the given path.
 * Returns null when not present (including when there's no active
 * workspace root, which the caller can treat as a miss).
 */
export async function readWorkspaceBlob(segments: string[]): Promise<Blob | null> {
  const root = getWorkspaceRoot()
  if (!root) return null
  try {
    return await readBlob(root, segments)
  } catch (error) {
    logger.warn(`readWorkspaceBlob(${segments.join('/')}) failed`, error)
    return null
  }
}

/**
 * Check whether a path exists in the workspace without reading it.
 */
export async function workspaceCacheExists(segments: string[]): Promise<boolean> {
  const root = getWorkspaceRoot()
  if (!root) return false
  try {
    return await exists(root, segments)
  } catch {
    return false
  }
}

/**
 * Remove a file or subtree from the workspace cache. No-op when absent.
 */
export async function removeWorkspaceCacheEntry(
  segments: string[],
  options: { recursive?: boolean } = {},
): Promise<void> {
  const root = getWorkspaceRoot()
  if (!root) return
  try {
    await removeEntry(root, segments, options)
  } catch (error) {
    logger.warn(`removeWorkspaceCacheEntry(${segments.join('/')}) failed`, error)
  }
}
