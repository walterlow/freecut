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

import type { ContentRecord } from '@/types/storage';
import { createLogger } from '@/shared/logging/logger';

import { requireWorkspaceRoot } from './root';
import {
  readJson,
  removeEntry,
  writeJsonAtomic,
} from './fs-primitives';
import { contentDir, contentRefsPath } from './paths';

const logger = createLogger('WorkspaceFS:Content');

export async function incrementContentRef(hash: string): Promise<number> {
  const root = requireWorkspaceRoot();
  try {
    const existing = await readJson<ContentRecord>(root, contentRefsPath(hash));
    if (!existing) {
      throw new Error(`Content not found: ${hash}`);
    }
    const updated: ContentRecord = {
      ...existing,
      referenceCount: existing.referenceCount + 1,
    };
    await writeJsonAtomic(root, contentRefsPath(hash), updated);
    return updated.referenceCount;
  } catch (error) {
    logger.error(`incrementContentRef(${hash}) failed`, error);
    throw error;
  }
}

export async function decrementContentRef(hash: string): Promise<number> {
  const root = requireWorkspaceRoot();
  try {
    const existing = await readJson<ContentRecord>(root, contentRefsPath(hash));
    if (!existing) {
      throw new Error(`Content not found: ${hash}`);
    }
    const updated: ContentRecord = {
      ...existing,
      referenceCount: Math.max(0, existing.referenceCount - 1),
    };
    await writeJsonAtomic(root, contentRefsPath(hash), updated);
    return updated.referenceCount;
  } catch (error) {
    logger.error(`decrementContentRef(${hash}) failed`, error);
    throw error;
  }
}

export async function deleteContent(hash: string): Promise<void> {
  const root = requireWorkspaceRoot();
  try {
    await removeEntry(root, contentDir(hash), { recursive: true });
  } catch (error) {
    logger.error(`deleteContent(${hash}) failed`, error);
    throw new Error(`Failed to delete content: ${hash}`);
  }
}
