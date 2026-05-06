/**
 * Adapter layer: run the auto-purge sweep of trashed projects.
 *
 * The workspace-gate owns app bootstrap; it shouldn't reach into the
 * projects feature directly. This adapter wires `sweepTrashOlderThan`
 * (infrastructure) with `permanentlyDeleteProject` (projects feature)
 * behind a single entry point the gate imports.
 *
 * Schedule: fires once per app activation (after workspace handle is
 * granted and bootstrap completes). Cheap when trash is empty — one
 * `listDirectory` call on `projects/` and one marker read per project.
 */

import { createLogger } from '@/shared/logging/logger'
import { DEFAULT_TRASH_TTL_MS, sweepTrashOlderThan } from '@/infrastructure/storage'
import { useProjectStore } from './projects-contract'

const logger = createLogger('TrashAutoPurge')

export async function autoPurgeExpiredTrash(ttlMs: number = DEFAULT_TRASH_TTL_MS): Promise<void> {
  try {
    const { permanentlyDeleteProject } = useProjectStore.getState()
    const purged = await sweepTrashOlderThan(ttlMs, async (id) => {
      await permanentlyDeleteProject(id)
    })
    if (purged.length > 0) {
      logger.info(`Auto-purge removed ${purged.length} trashed project(s) past TTL`)
      // Refresh the store's visible list in case any purge affected it.
      // (It shouldn't — purged projects were already hidden — but this
      // keeps things tidy if state drifted.)
      await useProjectStore.getState().loadProjects()
    }
  } catch (error) {
    logger.warn('autoPurgeExpiredTrash failed', error)
  }
}
