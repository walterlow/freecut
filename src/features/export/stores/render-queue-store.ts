/**
 * Render queue store.
 *
 * Holds the list of queued/rendering/finished export jobs. Jobs are processed
 * serially by `useRenderQueueRunner` (one at a time — the WebGPU device is a
 * tab-wide singleton, so concurrent renders would contend). Each job carries a
 * frozen snapshot of the timeline taken at enqueue time, so continuing to edit
 * the project doesn't change what an already-queued job renders.
 */

import { create } from 'zustand'
import type { TimelineTrack, TimelineItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import type { ItemKeyframes } from '@/types/keyframe'
import type { AudioEqSettings } from '@/types/audio'
import type { ClientExportSettings, RenderProgress } from '../utils/client-renderer'
import { abortJob } from '../utils/render-queue-control'

export type RenderJobStatus = 'queued' | 'rendering' | 'completed' | 'failed' | 'cancelled'

/** Frozen timeline data captured when a job is enqueued. */
export interface RenderJobSnapshot {
  tracks: TimelineTrack[]
  items: TimelineItem[]
  transitions: Transition[]
  keyframes: ItemKeyframes[]
  fps: number
  width: number
  height: number
  backgroundColor?: string
  busAudioEq?: AudioEqSettings
  masterBusDb?: number
}

export interface RenderJob {
  id: string
  /** Human-readable label shown in the queue panel. */
  name: string
  projectId?: string
  status: RenderJobStatus
  progress: number
  phase?: RenderProgress['phase']
  renderedFrames?: number
  totalFrames?: number
  /** Render range in project frames; null = whole project. */
  inPoint: number | null
  outPoint: number | null
  durationFrames: number
  exportMode: 'video' | 'audio'
  clientSettings: ClientExportSettings
  snapshot: RenderJobSnapshot
  /** Suggested on-disk filename (incl. extension). */
  fileName: string
  /** Workspace-relative path once saved. */
  savedPath?: string
  fileSize?: number
  error?: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
}

interface RenderQueueState {
  jobs: RenderJob[]
  isPaused: boolean
  activeJobId: string | null
}

interface RenderQueueActions {
  enqueueJobs: (jobs: RenderJob[]) => void
  removeJob: (id: string) => void
  /** Cancel a job: aborts it if rendering, otherwise marks it cancelled. */
  cancelJob: (id: string) => void
  /** Requeue a finished/failed/cancelled job to render again. */
  retryJob: (id: string) => void
  clearFinished: () => void
  clearAll: () => void
  /** Reorder a job up (-1) or down (+1) in the list. */
  moveJob: (id: string, direction: -1 | 1) => void
  setPaused: (paused: boolean) => void
  /** Replace the whole queue (used when restoring a project's persisted jobs). */
  hydrate: (jobs: RenderJob[], isPaused: boolean) => void

  // Runner-internal mutators
  markRendering: (id: string) => void
  updateJobProgress: (id: string, progress: RenderProgress) => void
  markCompleted: (id: string, info: { savedPath: string; fileSize: number }) => void
  markFailed: (id: string, error: string) => void
  markCancelled: (id: string) => void
}

const isFinished = (s: RenderJobStatus): boolean =>
  s === 'completed' || s === 'failed' || s === 'cancelled'

function patchJob(
  jobs: RenderJob[],
  id: string,
  patch: (job: RenderJob) => RenderJob,
): RenderJob[] {
  return jobs.map((job) => (job.id === id ? patch(job) : job))
}

export const useRenderQueueStore = create<RenderQueueState & RenderQueueActions>()((set, get) => ({
  jobs: [],
  isPaused: false,
  activeJobId: null,

  enqueueJobs: (newJobs) => set((state) => ({ jobs: [...state.jobs, ...newJobs] })),

  removeJob: (id) =>
    set((state) => {
      // Removing the active job: abort it first so the runner stops.
      if (state.activeJobId === id) abortJob(id)
      return {
        jobs: state.jobs.filter((job) => job.id !== id),
        activeJobId: state.activeJobId === id ? null : state.activeJobId,
      }
    }),

  cancelJob: (id) => {
    const job = get().jobs.find((j) => j.id === id)
    if (!job) return
    if (job.status === 'rendering') {
      // The runner's catch will mark it cancelled when the abort propagates.
      abortJob(id)
      return
    }
    if (job.status === 'queued') {
      set((state) => ({
        jobs: patchJob(state.jobs, id, (j) => ({
          ...j,
          status: 'cancelled',
          finishedAt: Date.now(),
        })),
      }))
    }
  },

  retryJob: (id) =>
    set((state) => ({
      jobs: patchJob(state.jobs, id, (job) =>
        isFinished(job.status)
          ? {
              ...job,
              status: 'queued',
              progress: 0,
              phase: undefined,
              renderedFrames: undefined,
              totalFrames: undefined,
              error: undefined,
              savedPath: undefined,
              fileSize: undefined,
              startedAt: undefined,
              finishedAt: undefined,
            }
          : job,
      ),
    })),

  clearFinished: () =>
    set((state) => ({ jobs: state.jobs.filter((job) => !isFinished(job.status)) })),

  clearAll: () =>
    set((state) => {
      if (state.activeJobId) abortJob(state.activeJobId)
      return { jobs: [], activeJobId: null }
    }),

  moveJob: (id, direction) =>
    set((state) => {
      const index = state.jobs.findIndex((job) => job.id === id)
      if (index === -1) return state
      const target = index + direction
      if (target < 0 || target >= state.jobs.length) return state
      const jobs = [...state.jobs]
      const [moved] = jobs.splice(index, 1)
      jobs.splice(target, 0, moved!)
      return { jobs }
    }),

  setPaused: (paused) => set({ isPaused: paused }),

  hydrate: (jobs, isPaused) => set({ jobs, isPaused, activeJobId: null }),

  markRendering: (id) =>
    set((state) => ({
      activeJobId: id,
      jobs: patchJob(state.jobs, id, (job) => ({
        ...job,
        status: 'rendering',
        progress: 0,
        phase: 'preparing',
        startedAt: Date.now(),
        error: undefined,
      })),
    })),

  updateJobProgress: (id, progress) =>
    set((state) => ({
      jobs: patchJob(state.jobs, id, (job) =>
        job.status === 'rendering'
          ? {
              ...job,
              progress: progress.progress,
              phase: progress.phase,
              renderedFrames: progress.currentFrame,
              totalFrames: progress.totalFrames,
            }
          : job,
      ),
    })),

  markCompleted: (id, info) =>
    set((state) => ({
      activeJobId: state.activeJobId === id ? null : state.activeJobId,
      jobs: patchJob(state.jobs, id, (job) => ({
        ...job,
        status: 'completed',
        progress: 100,
        savedPath: info.savedPath,
        fileSize: info.fileSize,
        finishedAt: Date.now(),
      })),
    })),

  markFailed: (id, error) =>
    set((state) => ({
      activeJobId: state.activeJobId === id ? null : state.activeJobId,
      jobs: patchJob(state.jobs, id, (job) => ({
        ...job,
        status: 'failed',
        error,
        finishedAt: Date.now(),
      })),
    })),

  markCancelled: (id) =>
    set((state) => ({
      activeJobId: state.activeJobId === id ? null : state.activeJobId,
      jobs: patchJob(state.jobs, id, (job) => ({
        ...job,
        status: 'cancelled',
        finishedAt: Date.now(),
      })),
    })),
}))

/** The next job waiting to render (FIFO), or undefined. */
export function getNextQueuedJob(jobs: RenderJob[]): RenderJob | undefined {
  return jobs.find((job) => job.status === 'queued')
}
