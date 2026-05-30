/**
 * Per-project render-queue persistence.
 *
 * The render queue is stored as `projects/{id}/render-queue.json` so a page
 * refresh (or reopening the project later) restores the queued/finished jobs.
 * The schema is owned by the export feature; this layer just reads/writes the
 * JSON keyed by project id.
 */

import { requireWorkspaceRoot } from './root'
import { readJson, writeJsonAtomic } from './fs-primitives'
import { projectRenderQueuePath } from './paths'

export function loadRenderQueue<T>(projectId: string): Promise<T | null> {
  return readJson<T>(requireWorkspaceRoot(), projectRenderQueuePath(projectId))
}

export async function saveRenderQueue(projectId: string, data: unknown): Promise<void> {
  await writeJsonAtomic(requireWorkspaceRoot(), projectRenderQueuePath(projectId), data)
}
