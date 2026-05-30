/**
 * Per-project render-queue persistence.
 *
 * Loads `projects/{id}/render-queue.json` on mount and writes it back when the
 * queue changes, so a refresh (or reopening the project) restores the queue.
 *
 *  - In-flight jobs are reset to `queued` on load (the worker is gone after a
 *    reload), and a restored queue with pending work stays PAUSED until the
 *    user resumes — a refresh never silently kicks off renders.
 *  - Saves fire immediately (coalesced to one per microtask) and are keyed on a
 *    status signature, so per-frame progress updates don't thrash the disk —
 *    only add/remove/status/pause changes write, and a job's terminal state is
 *    on disk before a refresh can lose it.
 *  - Snapshots are de-duplicated by reference, so the many segments of one
 *    "split" share a single stored timeline copy instead of N copies.
 */

import { useEffect } from 'react'
import { createLogger } from '@/shared/logging/logger'
import { loadRenderQueue, saveRenderQueue } from '@/infrastructure/storage'
import {
  useRenderQueueStore,
  type RenderJob,
  type RenderJobSnapshot,
} from '../stores/render-queue-store'

const log = createLogger('RenderQueue')

const SCHEMA_VERSION = 1

type PersistedJob = Omit<RenderJob, 'snapshot'> & { snapshotId: string }

interface PersistedRenderQueue {
  version: number
  isPaused: boolean
  snapshots: Record<string, RenderJobSnapshot>
  jobs: PersistedJob[]
}

/** De-duplicate snapshots by reference: segments of one split share one copy. */
function serialize(jobs: RenderJob[], isPaused: boolean): PersistedRenderQueue {
  const idBySnapshot = new Map<RenderJobSnapshot, string>()
  const snapshots: Record<string, RenderJobSnapshot> = {}
  const persistedJobs = jobs.map((job) => {
    let snapshotId = idBySnapshot.get(job.snapshot)
    if (!snapshotId) {
      snapshotId = `s${idBySnapshot.size}`
      idBySnapshot.set(job.snapshot, snapshotId)
      snapshots[snapshotId] = job.snapshot
    }
    const { snapshot: _snapshot, ...rest } = job
    return { ...rest, snapshotId }
  })
  return { version: SCHEMA_VERSION, isPaused, snapshots, jobs: persistedJobs }
}

function deserialize(file: PersistedRenderQueue | null): { jobs: RenderJob[]; isPaused: boolean } {
  if (!file || file.version !== SCHEMA_VERSION || !Array.isArray(file.jobs)) {
    return { jobs: [], isPaused: false }
  }
  const jobs = file.jobs
    .map((persisted): RenderJob | null => {
      const snapshot = file.snapshots?.[persisted.snapshotId]
      if (!snapshot) return null
      const { snapshotId: _snapshotId, ...rest } = persisted
      // A render in progress can't survive a reload — requeue it.
      const status = rest.status === 'rendering' ? 'queued' : rest.status
      const requeued = status === 'queued'
      return {
        ...rest,
        status,
        snapshot,
        progress: requeued ? 0 : rest.progress,
        phase: requeued ? undefined : rest.phase,
        renderedFrames: requeued ? undefined : rest.renderedFrames,
        totalFrames: requeued ? undefined : rest.totalFrames,
        startedAt: requeued ? undefined : rest.startedAt,
      }
    })
    .filter((job): job is RenderJob => job !== null)
  // Hold a restored queue until the user resumes; nothing to pause when there
  // is no pending work (so jobs added after a refresh still run normally).
  const hasQueued = jobs.some((job) => job.status === 'queued')
  return { jobs, isPaused: hasQueued }
}

/** A signature that changes on add/remove/status/pause — but NOT on progress. */
function queueSignature(): string {
  const { jobs, isPaused } = useRenderQueueStore.getState()
  return `${isPaused ? 'p' : ''}|${jobs.map((j) => `${j.id}:${j.status}`).join('|')}`
}

export function useRenderQueuePersistence(projectId: string): void {
  useEffect(() => {
    let cancelled = false
    let hydrated = false
    let unsubscribe = () => {}
    let saveQueued = false
    let lastSignature = ''

    const save = () => {
      const { jobs, isPaused } = useRenderQueueStore.getState()
      void saveRenderQueue(projectId, serialize(jobs, isPaused)).catch((err) =>
        log.warn('Failed to persist render queue', err),
      )
    }

    // Coalesce same-tick changes into one write, but flush on the next
    // microtask — so a job's terminal status lands on disk right away.
    const scheduleSave = () => {
      if (saveQueued) return
      saveQueued = true
      queueMicrotask(() => {
        saveQueued = false
        if (!cancelled) save()
      })
    }

    // Clear synchronously before the async load so a project switch can't leave
    // the previous project's jobs in the (singleton) store for the runner to
    // pick up. The cleanup below already flushed the previous project's state.
    useRenderQueueStore.getState().hydrate([], false)

    void (async () => {
      let restored: { jobs: RenderJob[]; isPaused: boolean } = { jobs: [], isPaused: false }
      try {
        restored = deserialize(await loadRenderQueue<PersistedRenderQueue>(projectId))
      } catch (err) {
        log.warn('Failed to load render queue', err)
      }
      if (cancelled) return

      useRenderQueueStore.getState().hydrate(restored.jobs, restored.isPaused)
      hydrated = true
      lastSignature = queueSignature()

      unsubscribe = useRenderQueueStore.subscribe(() => {
        const signature = queueSignature()
        if (signature === lastSignature) return
        lastSignature = signature
        scheduleSave()
      })
    })()

    return () => {
      cancelled = true
      unsubscribe()
      // Flush the final state for THIS project before the effect re-runs for
      // another project (only if we actually loaded — avoids clobbering on a
      // StrictMode double-mount that never hydrated).
      if (hydrated) save()
    }
  }, [projectId])
}
