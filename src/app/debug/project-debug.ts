/**
 * Debug Utilities for Project Data
 *
 * Exposes debugging functions on window.__DEBUG__ in development mode.
 * Useful for testing, debugging, and inspecting project state.
 */

import type { Project } from '@/types/project'
import type {
  ProjectSnapshot,
  SnapshotExportOptions,
  SnapshotImportOptions,
} from '@/features/project-bundle/types/snapshot'
import type {
  FixtureType,
  FixtureOptions,
  FixtureResult,
} from '@/features/project-bundle/services/test-fixtures'
import {
  exportProjectJson,
  exportProjectJsonString,
  downloadProjectJson,
  copyProjectToClipboard,
  getSnapshotStats,
  createSnapshotFromProject,
} from '@/features/project-bundle/services/json-export-service'
import {
  importProjectFromJsonString,
  importProjectFromClipboard,
  validateSnapshotData,
  showImportFilePicker,
} from '@/features/project-bundle/services/json-import-service'
import {
  validateProject,
  formatValidationErrors,
} from '@/features/project-bundle/schemas/project-schema'
import {
  getAllProjects,
  getProject,
  getAllMedia,
  getProjectMediaIds,
  getDBStats,
  createProject,
  sweepWorkspaceOrphans,
  type OrphanSweepOptions,
  type OrphanSweepReport,
} from '@/infrastructure/storage'

/**
 * Debug API interface
 */
interface ProjectDebugAPI {
  // Export functions
  exportProject: (projectId: string, options?: SnapshotExportOptions) => Promise<ProjectSnapshot>
  exportProjectString: (projectId: string, options?: SnapshotExportOptions) => Promise<string>
  downloadProject: (projectId: string, options?: SnapshotExportOptions) => Promise<void>
  copyProjectToClipboard: (projectId: string, options?: SnapshotExportOptions) => Promise<void>

  // Import functions
  importFromJson: (json: string, options?: SnapshotImportOptions) => Promise<Project>
  importFromClipboard: (options?: SnapshotImportOptions) => Promise<Project>
  importFromFile: (options?: SnapshotImportOptions) => Promise<Project | null>

  // Validation functions
  validateProject: (data: unknown) => { valid: boolean; errors?: string[] }
  validateSnapshot: (
    data: unknown,
  ) => Promise<{ valid: boolean; errors?: string[]; warnings?: string[] }>

  // Inspection functions
  getProject: (projectId: string) => Promise<Project | undefined>
  getAllProjects: () => Promise<Project[]>
  getProjectMedia: (projectId: string) => Promise<string[]>
  getAllMedia: () => Promise<unknown[]>
  getDBStats: () => Promise<unknown>
  getSnapshotStats: (snapshot: ProjectSnapshot) => ReturnType<typeof getSnapshotStats>

  // Utility functions
  createSnapshot: (project: Project) => ProjectSnapshot
  parseJson: (json: string) => unknown

  // Fixture functions
  generateFixture: (type: FixtureType, options?: FixtureOptions) => Promise<FixtureResult>
  createFixtureProject: (type: FixtureType, options?: FixtureOptions) => Promise<Project>
  listFixtures: () => Promise<Array<{ type: FixtureType; name: string; description: string }>>

  // Playback control (for debugging)
  seekTo: (frame: number) => void
  play: () => void
  pause: () => void

  // Timeline inspection
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getItemsAtFrame: (frame: number) => Promise<any[]>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getUpcomingItems: (frame: number, lookahead: number) => Promise<any[]>

  // Live store inspection — always available, reads current state on demand
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stores: () => Promise<Record<string, any>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getTransitions: () => Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getTransitionWindows: () => Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getPlaybackState: () => Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getTracks: () => Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMediaLibrary: () => Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jitter: () => any

  // Timeline integrity
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  overlaps: () => Promise<any>

  // User Timing summary: aggregates `performance.measure` entries (default
  // `tl.*` prefix from timeline perf-marks) into a per-name stat row.
  perfSummary: (prefix?: string) => Array<{
    name: string
    count: number
    minMs: number
    maxMs: number
    avgMs: number
    p95Ms: number
    totalMs: number
  }>
  perfClear: () => void

  // Render pipeline diagnostics — delegates to existing ad-hoc window globals
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  previewPerf: () => any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transitionTrace: () => any
  /**
   * Capture and analyze the live preview render path through a transition.
   * One call: seeks ahead of the transition, plays through it while recording
   * which overlay path the pump chose and which participants composited per
   * frame, then returns a per-half analysis with a plain-language verdict.
   * Pass a frame near the transition; omit to use the nearest at/after the
   * current playhead. Requires a foreground tab (playback needs rAF).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  captureTransition: (targetFrame?: number) => Promise<any>
  /** Low-level preview-trace controls (start/stop/dump the raw event buffer). */
  previewTrace: {
    start: () => void
    stop: () => void
    clear: () => void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    events: () => readonly any[]
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prewarmCache: () => any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gifCache: () => any
  clearGifCache: () => Promise<void>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filmstripCache: () => any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filmstripMetrics: () => any
  clearFilmstripCache: () => void

  /**
   * Scan workspace-folder mirror caches for entries whose mediaId is no
   * longer in `media/` and remove them. Pass `{ dryRun: true }` to get
   * a report without touching disk.
   */
  cleanOrphans: (options?: OrphanSweepOptions) => Promise<OrphanSweepReport>

  // Version info
  version: string
}

/**
 * Create the debug API object
 */
function createDebugAPI(): ProjectDebugAPI {
  return {
    // Export functions
    exportProject: async (projectId, options) => {
      return exportProjectJson(projectId, options)
    },

    exportProjectString: async (projectId, options) => {
      return exportProjectJsonString(projectId, options)
    },

    downloadProject: async (projectId, options) => {
      await downloadProjectJson(projectId, options)
    },

    copyProjectToClipboard: async (projectId, options) => {
      await copyProjectToClipboard(projectId, options)
    },

    // Import functions
    importFromJson: async (json, options) => {
      const result = await importProjectFromJsonString(json, options)
      return result.project
    },

    importFromClipboard: async (options) => {
      const result = await importProjectFromClipboard(options)
      return result.project
    },

    importFromFile: async (options) => {
      const result = await showImportFilePicker(options)
      return result?.project ?? null
    },

    // Validation functions
    validateProject: (data) => {
      const result = validateProject(data)
      if (result.success) {
        return { valid: true }
      }
      return {
        valid: false,
        errors: result.errors ? formatValidationErrors(result.errors) : [],
      }
    },

    validateSnapshot: async (data) => {
      const result = await validateSnapshotData(data)
      return {
        valid: result.valid,
        errors: result.errors.map((e) => e.message),
        warnings: result.warnings.map((w) => w.message),
      }
    },

    // Inspection functions
    getProject: async (projectId) => {
      return getProject(projectId)
    },

    getAllProjects: async () => {
      return getAllProjects()
    },

    getProjectMedia: async (projectId) => {
      return getProjectMediaIds(projectId)
    },

    getAllMedia: async () => {
      return getAllMedia()
    },

    getDBStats: async () => {
      return getDBStats()
    },

    getSnapshotStats: (snapshot) => {
      return getSnapshotStats(snapshot)
    },

    // Utility functions
    createSnapshot: (project) => {
      return createSnapshotFromProject(project)
    },

    parseJson: (json) => {
      return JSON.parse(json)
    },

    // Fixture functions
    generateFixture: async (type, options) => {
      const { generateFixture } = await import('@/features/project-bundle/services/test-fixtures')
      return generateFixture(type, options)
    },

    createFixtureProject: async (type, options) => {
      const { generateFixture } = await import('@/features/project-bundle/services/test-fixtures')
      const { project } = generateFixture(type, options)
      await createProject(project)
      return project
    },

    listFixtures: async () => {
      const { getAvailableFixtures } =
        await import('@/features/project-bundle/services/test-fixtures')
      return getAvailableFixtures()
    },

    // Playback control (for debugging)
    seekTo: async (frame) => {
      const { usePlaybackStore } = await import('@/shared/state/playback')
      usePlaybackStore.getState().setCurrentFrame(frame)
    },
    play: async () => {
      const { usePlaybackStore } = await import('@/shared/state/playback')
      usePlaybackStore.getState().play()
    },
    pause: async () => {
      const { usePlaybackStore } = await import('@/shared/state/playback')
      usePlaybackStore.getState().pause()
    },

    // Timeline item inspection
    getItemsAtFrame: async (frame: number) => {
      const { useItemsStore } = await import('@/features/timeline/stores/items-store')
      const state = useItemsStore.getState()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results: any[] = []
      for (const [trackId, trackItems] of Object.entries(state.itemsByTrackId)) {
        if (!trackItems) continue
        for (const item of trackItems) {
          const end = item.from + item.durationInFrames
          if (frame >= item.from && frame < end) {
            results.push({
              id: item.id.substring(0, 8),
              type: item.type,
              from: item.from,
              dur: item.durationInFrames,
              end,
              speed: item.speed ?? 1,
              trackId: trackId.substring(0, 8),
              label: 'label' in item ? item.label : undefined,
            })
          }
        }
      }
      return results
    },
    getUpcomingItems: async (frame: number, lookahead: number) => {
      const { useItemsStore } = await import('@/features/timeline/stores/items-store')
      const state = useItemsStore.getState()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results: any[] = []
      for (const [trackId, trackItems] of Object.entries(state.itemsByTrackId)) {
        if (!trackItems) continue
        for (const item of trackItems) {
          if (item.from > frame && item.from <= frame + lookahead) {
            results.push({
              id: item.id.substring(0, 8),
              type: item.type,
              from: item.from,
              dur: item.durationInFrames,
              speed: item.speed ?? 1,
              trackId: trackId.substring(0, 8),
              label: 'label' in item ? item.label : undefined,
            })
          }
        }
      }
      return results
    },

    // Live store inspection
    stores: async () => {
      const [
        { usePlaybackStore },
        { useItemsStore },
        { useTransitionsStore },
        { useTimelineStore },
        { useMediaLibraryStore },
      ] = await Promise.all([
        import('@/shared/state/playback'),
        import('@/features/timeline/stores/items-store'),
        import('@/features/timeline/stores/transitions-store'),
        import('@/features/timeline/stores/timeline-store'),
        import('@/features/media-library/stores/media-library-store'),
      ])
      return {
        playback: usePlaybackStore.getState(),
        items: useItemsStore.getState(),
        transitions: useTransitionsStore.getState(),
        timeline: useTimelineStore.getState(),
        mediaLibrary: useMediaLibraryStore.getState(),
      }
    },

    getTransitions: async () => {
      const { useTransitionsStore } = await import('@/features/timeline/stores/transitions-store')
      const state = useTransitionsStore.getState()
      return {
        count: state.transitions.length,
        transitions: state.transitions.map((t) => ({
          id: t.id.substring(0, 8),
          type: t.type,
          presentation: t.presentation,
          durationInFrames: t.durationInFrames,
          leftClipId: t.leftClipId.substring(0, 8),
          rightClipId: t.rightClipId.substring(0, 8),
          trackId: t.trackId.substring(0, 8),
        })),
        byTrackId: state.transitionsByTrackId,
      }
    },

    getTransitionWindows: async () => {
      const [{ useTransitionsStore }, { useItemsStore }, { useTimelineStore }] = await Promise.all([
        import('@/features/timeline/stores/transitions-store'),
        import('@/features/timeline/stores/items-store'),
        import('@/features/timeline/stores/timeline-store'),
      ])
      const { resolveTransitionWindows } =
        await import('@/shared/timeline/transitions/transition-planner')
      const transitions = useTransitionsStore.getState().transitions
      const itemsByTrackId = useItemsStore.getState().itemsByTrackId
      const tracks = useTimelineStore.getState().tracks
      const clipMap = new Map<string, unknown>()
      for (const track of tracks) {
        const items = itemsByTrackId[track.id]
        if (!items) continue
        for (const item of items) {
          clipMap.set(item.id, item)
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const windows = resolveTransitionWindows(transitions, clipMap as any)
      return windows.map((w) => ({
        startFrame: w.startFrame,
        endFrame: w.endFrame,
        durationFrames: w.endFrame - w.startFrame,
        presentation: w.transition.presentation,
        leftClipId: w.leftClip.id.substring(0, 8),
        rightClipId: w.rightClip.id.substring(0, 8),
      }))
    },

    getPlaybackState: async () => {
      const [{ usePlaybackStore }, { usePreviewBridgeStore }] = await Promise.all([
        import('@/shared/state/playback'),
        import('@/shared/state/preview-bridge'),
      ])
      const s = usePlaybackStore.getState()
      const bridge = usePreviewBridgeStore.getState()
      return {
        currentFrame: s.currentFrame,
        isPlaying: s.isPlaying,
        playbackRate: s.playbackRate,
        loop: s.loop,
        previewFrame: s.previewFrame,
        displayedFrame: bridge.displayedFrame,
        zoom: s.zoom,
        useProxy: s.useProxy,
      }
    },

    getTracks: async () => {
      const [{ useTimelineStore }, { useItemsStore }] = await Promise.all([
        import('@/features/timeline/stores/timeline-store'),
        import('@/features/timeline/stores/items-store'),
      ])
      const tracks = useTimelineStore.getState().tracks
      const itemsByTrackId = useItemsStore.getState().itemsByTrackId
      return tracks.map((t) => ({
        id: t.id.substring(0, 8),
        name: t.name,
        order: t.order,
        isGroup: t.isGroup,
        itemCount: (itemsByTrackId[t.id] ?? []).length,
        items: (itemsByTrackId[t.id] ?? []).map((item) => ({
          id: item.id.substring(0, 8),
          type: item.type,
          from: item.from,
          dur: item.durationInFrames,
          end: item.from + item.durationInFrames,
          speed: item.speed ?? 1,
          label: 'label' in item ? item.label : undefined,
        })),
      }))
    },

    getMediaLibrary: async () => {
      const { useMediaLibraryStore } =
        await import('@/features/media-library/stores/media-library-store')
      const s = useMediaLibraryStore.getState()
      const entries = Object.entries(s.mediaById).map(([id, m]) => {
        const media = m as unknown as Record<string, unknown>
        return {
          id: id.substring(0, 8),
          fileName: media.fileName,
          mimeType: media.mimeType,
          width: media.width,
          height: media.height,
          fps: media.fps,
          duration: media.duration,
        }
      })
      return { count: entries.length, media: entries }
    },

    jitter: () => {
      return (window as unknown as Record<string, unknown>).__FRAME_JITTER__ ?? null
    },

    overlaps: async () => {
      const [{ useItemsStore }, { useTransitionsStore }, { detectOverlappingItems }] =
        await Promise.all([
          import('@/features/timeline/stores/items-store'),
          import('@/features/timeline/stores/transitions-store'),
          import('@/features/timeline/utils/collision-utils'),
        ])
      const items = useItemsStore.getState().items
      const transitions = useTransitionsStore.getState().transitions
      const overlaps = detectOverlappingItems(items, transitions)
      if (overlaps.length === 0) return { clean: true, count: 0 }
      return {
        clean: false,
        count: overlaps.length,
        overlaps: overlaps.map((o) => ({
          itemA: o.itemA.substring(0, 8),
          itemB: o.itemB.substring(0, 8),
          trackId: o.trackId.substring(0, 8),
          overlapFrames: o.overlapFrames,
        })),
      }
    },

    perfSummary: (prefix = 'tl.') => {
      if (
        typeof performance === 'undefined' ||
        typeof performance.getEntriesByType !== 'function'
      ) {
        return []
      }
      const entries = performance.getEntriesByType('measure') as PerformanceMeasure[]
      const byName = new Map<string, number[]>()
      for (const entry of entries) {
        if (!entry.name.startsWith(prefix)) continue
        let durations = byName.get(entry.name)
        if (!durations) {
          durations = []
          byName.set(entry.name, durations)
        }
        durations.push(entry.duration)
      }
      const rows: Array<{
        name: string
        count: number
        minMs: number
        maxMs: number
        avgMs: number
        p95Ms: number
        totalMs: number
      }> = []
      for (const [name, durations] of byName) {
        const sorted = [...durations].sort((a, b) => a - b)
        const count = sorted.length
        const total = durations.reduce((sum, value) => sum + value, 0)
        const p95Index = Math.min(count - 1, Math.floor(count * 0.95))
        rows.push({
          name,
          count,
          minMs: Number((sorted[0] ?? 0).toFixed(3)),
          maxMs: Number((sorted[count - 1] ?? 0).toFixed(3)),
          avgMs: Number((total / count).toFixed(3)),
          p95Ms: Number((sorted[p95Index] ?? 0).toFixed(3)),
          totalMs: Number(total.toFixed(2)),
        })
      }
      rows.sort((a, b) => b.totalMs - a.totalMs)
      return rows
    },

    perfClear: () => {
      if (typeof performance !== 'undefined' && typeof performance.clearMeasures === 'function') {
        performance.clearMeasures()
      }
    },

    // Render pipeline diagnostics — thin delegates to existing window globals
    // so we never need to add/remove ad-hoc globals in components again.
    previewPerf: () => {
      return (window as unknown as Record<string, unknown>).__PREVIEW_PERF__ ?? null
    },

    transitionTrace: () => {
      return (window as unknown as Record<string, unknown>).__PREVIEW_TRANSITIONS__ ?? []
    },

    previewTrace: {
      start: () => {
        void import('@/shared/logging/preview-trace').then((m) => m.startPreviewTrace())
      },
      stop: () => {
        void import('@/shared/logging/preview-trace').then((m) => m.stopPreviewTrace())
      },
      clear: () => {
        void import('@/shared/logging/preview-trace').then((m) => m.clearPreviewTrace())
      },
      events: () => {
        const buf = (window as unknown as { __PREVIEW_TRACE_LAST__?: readonly unknown[] })
          .__PREVIEW_TRACE_LAST__
        return buf ?? []
      },
    },

    captureTransition: async (targetFrame?: number) => {
      const [
        { usePlaybackStore },
        { useTransitionsStore },
        { useItemsStore },
        { useTimelineStore },
        { resolveTransitionWindows },
        trace,
      ] = await Promise.all([
        import('@/shared/state/playback'),
        import('@/features/timeline/stores/transitions-store'),
        import('@/features/timeline/stores/items-store'),
        import('@/features/timeline/stores/timeline-store'),
        import('@/shared/timeline/transitions/transition-planner'),
        import('@/shared/logging/preview-trace'),
      ])

      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return {
          error:
            'Tab must be foreground for playback (requestAnimationFrame is throttled in background tabs). Focus the editor tab and retry.',
        }
      }

      const transitions = useTransitionsStore.getState().transitions
      const itemsByTrackId = useItemsStore.getState().itemsByTrackId
      const tracks = useTimelineStore.getState().tracks
      const clipMap = new Map<string, unknown>()
      for (const track of tracks) {
        for (const item of itemsByTrackId[track.id] ?? []) clipMap.set(item.id, item)
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const windows = resolveTransitionWindows(transitions, clipMap as any)
      if (windows.length === 0) return { error: 'No transitions in this project.' }

      const playback = usePlaybackStore.getState()
      const ref = targetFrame ?? playback.currentFrame
      // Prefer a window containing the reference frame, else the nearest by start.
      const containing = windows.find((w) => ref >= w.startFrame && ref < w.endFrame)
      const win =
        containing ??
        windows
          .slice()
          .sort((a, b) => Math.abs(a.startFrame - ref) - Math.abs(b.startFrame - ref))[0]!

      const fps = useTimelineStore.getState().fps || 30
      const runUpFrames = Math.round(fps * 1.5)
      const startFrame = Math.max(0, win.startFrame - runUpFrames)
      const endTarget = win.endFrame + Math.round(fps * 0.5)

      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

      usePlaybackStore.getState().pause()
      usePlaybackStore.getState().setCurrentFrame(startFrame)
      await sleep(400)

      trace.startPreviewTrace()
      usePlaybackStore.getState().play()

      // Play until past the window end, with a hard timeout.
      const deadline = Date.now() + 12000
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await sleep(80)
        const cur = usePlaybackStore.getState().currentFrame
        if (cur >= endTarget || !usePlaybackStore.getState().isPlaying) break
        if (Date.now() > deadline) break
      }
      usePlaybackStore.getState().pause()
      await sleep(150)
      trace.stopPreviewTrace()

      const events = trace.getPreviewTraceEvents()
      // Stash raw events so previewTrace.events() can return them post-capture.
      ;(window as unknown as { __PREVIEW_TRACE_LAST__?: unknown }).__PREVIEW_TRACE_LAST__ = [
        ...events,
      ]

      const analysis = trace.analyzePreviewTrace(events, {
        startFrame: win.startFrame,
        cutPoint: win.cutPoint,
        endFrame: win.endFrame,
        leftClipId: win.leftClip.id.slice(0, 8),
        rightClipId: win.rightClip.id.slice(0, 8),
      })
      return {
        transition: {
          presentation: win.transition.presentation,
          startFrame: win.startFrame,
          cutPoint: win.cutPoint,
          endFrame: win.endFrame,
          leftClipId: win.leftClip.id.slice(0, 8),
          leftReversed: win.leftClip.type === 'video' && win.leftClip.isReversed === true,
          rightClipId: win.rightClip.id.slice(0, 8),
          rightReversed: win.rightClip.type === 'video' && win.rightClip.isReversed === true,
        },
        ...analysis,
      }
    },

    prewarmCache: () => {
      const cache = (window as unknown as Record<string, unknown>).__PREWARM_CACHE__
      if (!cache || !(cache instanceof Map)) return null
      const entries: Array<{ src: string; bitmaps: number }> = []
      for (const [src, arr] of (cache as Map<string, unknown[]>).entries()) {
        entries.push({ src: src.substring(0, 40), bitmaps: arr.length })
      }
      return { sourceCount: entries.length, entries }
    },

    gifCache: () => {
      return (window as unknown as Record<string, unknown>).__gifFrameCache__ ?? null
    },

    clearGifCache: async () => {
      const clearFn = (window as unknown as Record<string, unknown>).__clearAllGifCache
      if (typeof clearFn === 'function') {
        await (clearFn as () => Promise<void>)()
      }
    },

    filmstripCache: () => {
      return (window as unknown as Record<string, unknown>).__filmstripCache__ ?? null
    },

    filmstripMetrics: () => {
      const cache = (window as unknown as Record<string, unknown>).__filmstripMetrics__
      if (
        cache &&
        typeof (cache as { getMetricsSnapshot?: () => unknown }).getMetricsSnapshot === 'function'
      ) {
        return (cache as { getMetricsSnapshot: () => unknown }).getMetricsSnapshot()
      }
      return cache ?? null
    },

    clearFilmstripCache: () => {
      const cache = (window as unknown as Record<string, unknown>).__filmstripCache__
      if (cache && typeof (cache as { clear?: () => void }).clear === 'function') {
        ;(cache as { clear: () => void }).clear()
      }
    },

    cleanOrphans: async (options) => {
      return sweepWorkspaceOrphans(options)
    },

    // Version info
    version: '1.0.0',
  }
}

/**
 * Initialize debug utilities in development mode
 */
export function initializeDebugUtils(): void {
  if (import.meta.env.DEV) {
    const api = createDebugAPI()
    // Extend window type
    ;(window as unknown as { __DEBUG__: ProjectDebugAPI }).__DEBUG__ = api
  }
}

// Type declaration for global window object
declare global {
  interface Window {
    __DEBUG__?: ProjectDebugAPI
  }
}
