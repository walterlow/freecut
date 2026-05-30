/**
 * Render queue runner.
 *
 * Drains the render queue one job at a time (serial — the WebGPU device is a
 * tab-wide singleton, so concurrent renders would contend and gain nothing).
 * Mount this once near the editor root via <RenderQueueRunner/>; it keeps
 * processing even when the queue panel is closed.
 *
 * The heavy render engine is imported lazily inside the job loop so the
 * always-mounted runner adds (almost) nothing to the editor's main bundle —
 * the engine chunk loads only when the first job starts.
 */

import { useEffect } from 'react'
import { createLogger, createOperationId } from '@/shared/logging/logger'
import { getNextQueuedJob, useRenderQueueStore } from '../stores/render-queue-store'
import type { RenderJob } from '../stores/render-queue-store'
import { registerJobController, unregisterJobController } from '../utils/render-queue-control'

const log = createLogger('RenderQueue')

// Module-level so React StrictMode's double-mount can't start two drains.
let running = false

async function renderQueuedJob(job: RenderJob): Promise<void> {
  const store = useRenderQueueStore.getState()
  const opId = createOperationId()
  const event = log.startEvent('render-queue-job', opId)
  event.merge({
    jobId: job.id,
    projectId: job.projectId,
    mode: job.exportMode,
    codec: job.clientSettings.codec,
    container: job.clientSettings.container,
    resolution: `${job.clientSettings.resolution.width}x${job.clientSettings.resolution.height}`,
    inPoint: job.inPoint,
    outPoint: job.outPoint,
    durationFrames: job.durationFrames,
  })

  const controller = new AbortController()
  registerJobController(job.id, controller)
  store.markRendering(job.id)

  try {
    // Lazy-load the render engine + deps only when a job actually runs.
    const [
      { runRender },
      { convertTimelineToComposition },
      { resolveMediaUrls },
      { saveExportFile },
    ] = await Promise.all([
      import('../utils/render-pipeline'),
      import('../utils/timeline-to-composition'),
      import('@/features/export/deps/media-library'),
      import('@/infrastructure/storage'),
    ])

    const { snapshot } = job
    const composition = convertTimelineToComposition(
      snapshot.tracks,
      snapshot.items,
      snapshot.transitions,
      snapshot.fps,
      snapshot.width,
      snapshot.height,
      job.inPoint,
      job.outPoint,
      snapshot.keyframes,
      snapshot.backgroundColor,
      snapshot.busAudioEq,
      snapshot.masterBusDb,
    )

    // Resolve mediaIds → blob URLs fresh at render time (export never proxies).
    composition.tracks = await resolveMediaUrls(composition.tracks, { useProxy: false })

    const { result, renderPath, fallbackReason } = await runRender({
      clientSettings: job.clientSettings,
      exportMode: job.exportMode,
      composition,
      signal: controller.signal,
      onProgress: (progress) => useRenderQueueStore.getState().updateJobProgress(job.id, progress),
    })
    if (fallbackReason) event.set('workerFallbackReason', fallbackReason)

    const saved = await saveExportFile(job.projectId, job.fileName, result.blob)
    useRenderQueueStore.getState().markCompleted(job.id, {
      savedPath: saved.relPath,
      fileSize: result.fileSize,
    })

    event.set('renderPath', renderPath)
    event.success({
      savedPath: saved.relPath,
      fileSize: result.fileSize,
      duration: result.duration,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      useRenderQueueStore.getState().markCancelled(job.id)
      event.set('outcome', 'cancelled')
      log.event('render-queue-job', { opId, jobId: job.id, outcome: 'cancelled' })
    } else {
      const message = err instanceof Error ? err.message : String(err)
      useRenderQueueStore.getState().markFailed(job.id, message)
      event.failure(err)
    }
  } finally {
    unregisterJobController(job.id)
  }
}

async function drain(): Promise<void> {
  if (running) return
  const state = useRenderQueueStore.getState()
  if (state.isPaused) return
  const job = getNextQueuedJob(state.jobs)
  if (!job) return

  running = true
  try {
    await renderQueuedJob(job)
  } finally {
    running = false
    // A slot just freed and the store changed — pick up the next queued job.
    queueMicrotask(() => void drain())
  }
}

export function useRenderQueueRunner(): void {
  useEffect(() => {
    const unsubscribe = useRenderQueueStore.subscribe(() => {
      void drain()
    })
    void drain()
    return unsubscribe
  }, [])
}
