/**
 * Reference tracking for AI outputs stored in the content-addressable tree.
 *
 * Parallel to `content.ts` (which tracks source-blob refs) — this one tracks
 * which `mediaId`s reference the shared AI cache at `content/{shard}/{hash}/ai/`.
 * Separate lifecycle so a media item with `handle` storage (no source blob in
 * the content tree) still benefits from caption dedup.
 *
 * The refs file is a `Set<mediaId>` serialized as a sorted array. Adding /
 * removing is idempotent. When the set empties, the caller is responsible
 * for tearing down the `ai/` subtree (see `captions.ts:deleteCaptionsCache`).
 */

import { createLogger } from '@/shared/logging/logger';

import { readJson, removeEntry, writeJsonAtomic } from './fs-primitives';
import { contentAiDir, contentAiRefsPath } from './paths';
import { requireWorkspaceRoot } from './root';
import { withKeyLock } from './with-key-lock';

const logger = createLogger('WorkspaceFS:AiContentRefs');

interface AiContentRefs {
  /** Schema version for this refs file. Bump when the shape changes. */
  schemaVersion: 1;
  /** Sorted list of mediaIds that reference the cached AI outputs. */
  mediaIds: string[];
  createdAt: number;
  updatedAt: number;
}

function lockKey(hash: string): string {
  return `ai-content-refs:${hash}`;
}

export async function getAiContentRefs(hash: string): Promise<AiContentRefs | null> {
  const root = requireWorkspaceRoot();
  try {
    return await readJson<AiContentRefs>(root, contentAiRefsPath(hash));
  } catch (error) {
    logger.warn(`getAiContentRefs(${hash}) failed`, error);
    return null;
  }
}

/**
 * Add `mediaId` to the reference set for `hash`, creating the file when it
 * doesn't exist. Returns the post-add reference count. Idempotent — calling
 * twice with the same mediaId is a no-op.
 */
export async function addAiContentRef(hash: string, mediaId: string): Promise<number> {
  const root = requireWorkspaceRoot();
  try {
    return await withKeyLock(lockKey(hash), async () => {
      const existing = await readJson<AiContentRefs>(root, contentAiRefsPath(hash));
      const now = Date.now();
      const set = new Set(existing?.mediaIds ?? []);
      set.add(mediaId);
      const updated: AiContentRefs = {
        schemaVersion: 1,
        mediaIds: [...set].sort(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await writeJsonAtomic(root, contentAiRefsPath(hash), updated);
      return updated.mediaIds.length;
    });
  } catch (error) {
    logger.error(`addAiContentRef(${hash}, ${mediaId}) failed`, error);
    throw error;
  }
}

/**
 * Drop `mediaId` from the reference set. Returns the post-remove count.
 * Idempotent — removing a mediaId that isn't in the set is a no-op that
 * returns the unchanged count. Missing refs file also returns 0.
 */
export async function removeAiContentRef(hash: string, mediaId: string): Promise<number> {
  const root = requireWorkspaceRoot();
  try {
    return await withKeyLock(lockKey(hash), async () => {
      const existing = await readJson<AiContentRefs>(root, contentAiRefsPath(hash));
      if (!existing) return 0;
      const remaining = existing.mediaIds.filter((id) => id !== mediaId);
      if (remaining.length === existing.mediaIds.length) {
        return remaining.length;
      }
      const updated: AiContentRefs = {
        ...existing,
        mediaIds: remaining,
        updatedAt: Date.now(),
      };
      await writeJsonAtomic(root, contentAiRefsPath(hash), updated);
      return remaining.length;
    });
  } catch (error) {
    logger.error(`removeAiContentRef(${hash}, ${mediaId}) failed`, error);
    throw error;
  }
}

/**
 * Remove the `content/{shard}/{hash}/ai/` subtree. Caller is expected to do
 * this only after {@link removeAiContentRef} returns 0 — this is the GC step
 * for the shared cache.
 */
export async function deleteAiContent(hash: string): Promise<void> {
  const root = requireWorkspaceRoot();
  try {
    await withKeyLock(lockKey(hash), async () => {
      await removeEntry(root, contentAiDir(hash), { recursive: true });
    });
  } catch (error) {
    logger.warn(`deleteAiContent(${hash}) failed`, error);
  }
}
