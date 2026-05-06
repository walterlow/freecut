/**
 * Content-addressable reference counting store backed by the workspace.
 *
 * Each content record lives at:
 *   `content/{hash[0:2]}/{hash}/refs.json`
 *
 * The actual data blob (when present) is `data.{ext}` in the same dir —
 * managed by the content import pipeline, not these functions.
 *
 * Sharding by the first two hex chars keeps `content/` shallow with
 * many thousands of entries.
 */

import type { ContentRecord } from '@/types/storage'
import { createLogger } from '@/shared/logging/logger'

import { requireWorkspaceRoot } from './root'
import { readJson, removeEntry, writeJsonAtomic } from './fs-primitives'
import { contentDir, contentRefsPath } from './paths'
import { withKeyLock } from './with-key-lock'

const logger = createLogger('WorkspaceFS:Content')

/**
 * Per-hash serialization for refcount mutations.
 *
 * The increment / decrement operations are read-modify-write on `refs.json`.
 * Without this lock, two concurrent increments for the same hash would both
 * read the old value, both write the same +1 — one increment lost. That
 * manifests later as content deleted while still referenced (lost increment)
 * or as content kept forever (lost decrement).
 *
 * The lock scope is one tab. Cross-tab races still exist but are rare (two
 * tabs importing the same file simultaneously) and self-heal on next app
 * load because hashes are stable.
 */
function refLockKey(hash: string): string {
  return `content-refs:${hash}`
}

export async function incrementContentRef(hash: string): Promise<number> {
  const root = requireWorkspaceRoot()
  try {
    return await withKeyLock(refLockKey(hash), async () => {
      const existing = await readJson<ContentRecord>(root, contentRefsPath(hash))
      if (!existing) {
        throw new Error(`Content not found: ${hash}`)
      }
      const updated: ContentRecord = {
        ...existing,
        referenceCount: existing.referenceCount + 1,
      }
      await writeJsonAtomic(root, contentRefsPath(hash), updated)
      return updated.referenceCount
    })
  } catch (error) {
    logger.error(`incrementContentRef(${hash}) failed`, error)
    throw error
  }
}

export async function decrementContentRef(hash: string): Promise<number> {
  const root = requireWorkspaceRoot()
  try {
    return await withKeyLock(refLockKey(hash), async () => {
      const existing = await readJson<ContentRecord>(root, contentRefsPath(hash))
      if (!existing) {
        throw new Error(`Content not found: ${hash}`)
      }
      const updated: ContentRecord = {
        ...existing,
        referenceCount: Math.max(0, existing.referenceCount - 1),
      }
      await writeJsonAtomic(root, contentRefsPath(hash), updated)
      return updated.referenceCount
    })
  } catch (error) {
    logger.error(`decrementContentRef(${hash}) failed`, error)
    throw error
  }
}

export async function deleteContent(hash: string): Promise<void> {
  const root = requireWorkspaceRoot()
  try {
    // Serialized under the same key as increment/decrement so a delete
    // cannot interleave with a concurrent refcount mutation.
    await withKeyLock(refLockKey(hash), async () => {
      await removeEntry(root, contentDir(hash), { recursive: true })
    })
  } catch (error) {
    logger.error(`deleteContent(${hash}) failed`, error)
    throw new Error(`Failed to delete content: ${hash}`)
  }
}
