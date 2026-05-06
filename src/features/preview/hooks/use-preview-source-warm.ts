import { useEffect, type MutableRefObject } from 'react'
import { usePlaybackStore } from '@/shared/state/playback'
import { getGlobalVideoSourcePool } from '@/features/preview/deps/player-pool'
import { getPreviewRuntimeSnapshotFromPlaybackState } from '../utils/preview-state-coordinator'
import { getSourceWarmTarget } from '../utils/source-warm-target'
import {
  SOURCE_WARM_HARD_CAP_ELEMENTS,
  SOURCE_WARM_HARD_CAP_SOURCES,
  SOURCE_WARM_MAX_SOURCES,
  SOURCE_WARM_MIN_SOURCES,
  SOURCE_WARM_PLAYHEAD_WINDOW_SECONDS,
  SOURCE_WARM_SCRUB_WINDOW_SECONDS,
  SOURCE_WARM_STICKY_MS,
  SOURCE_WARM_TICK_MS,
  type VideoSourceSpan,
} from '../utils/preview-constants'

interface UsePreviewSourceWarmParams {
  resolvedUrlCount: number
  playbackVideoSourceSpans: VideoSourceSpan[]
  scrubVideoSourceSpans: VideoSourceSpan[]
  fps: number
  previewPerfRef: MutableRefObject<{
    sourceWarmTarget: number
    sourceWarmKeep: number
    sourceWarmEvictions: number
    sourcePoolSources: number
    sourcePoolElements: number
    sourcePoolActiveClips: number
  }>
  isGizmoInteractingRef: MutableRefObject<boolean>
}

export function usePreviewSourceWarm({
  resolvedUrlCount,
  playbackVideoSourceSpans,
  scrubVideoSourceSpans,
  fps,
  previewPerfRef,
  isGizmoInteractingRef,
}: UsePreviewSourceWarmParams) {
  useEffect(() => {
    const pool = getGlobalVideoSourcePool()
    if (resolvedUrlCount === 0) {
      pool.pruneUnused(new Set())
      const poolStats = pool.getStats()
      previewPerfRef.current.sourceWarmTarget = 0
      previewPerfRef.current.sourceWarmKeep = 0
      previewPerfRef.current.sourcePoolSources = poolStats.sourceCount
      previewPerfRef.current.sourcePoolElements = poolStats.totalElements
      previewPerfRef.current.sourcePoolActiveClips = poolStats.activeClips
      return
    }

    const recentTouches = new Map<string, number>()
    let rafId: number | null = null

    const collectCandidates = (
      spans: VideoSourceSpan[],
      anchorFrame: number,
      windowFrames: number,
      baseScore: number,
      candidateScores: Map<string, number>,
    ) => {
      const minFrame = anchorFrame - windowFrames
      const maxFrame = anchorFrame + windowFrames

      for (const span of spans) {
        if (span.endFrame < minFrame || span.startFrame > maxFrame) continue

        const distance =
          anchorFrame < span.startFrame
            ? span.startFrame - anchorFrame
            : anchorFrame > span.endFrame
              ? anchorFrame - span.endFrame
              : 0

        const score = baseScore + distance
        const existing = candidateScores.get(span.src)
        if (existing === undefined || score < existing) {
          candidateScores.set(span.src, score)
        }
      }
    }

    const refreshWarmSet = () => {
      const now = performance.now()
      const playback = usePlaybackStore.getState()
      const runtimeSnapshot = getPreviewRuntimeSnapshotFromPlaybackState(
        playback,
        isGizmoInteractingRef.current,
      )
      const interactionMode = runtimeSnapshot.mode
      const poolStatsBefore = pool.getStats()
      const warmTarget = getSourceWarmTarget({
        mode: interactionMode,
        currentPoolSourceCount: poolStatsBefore.sourceCount,
        currentPoolElementCount: poolStatsBefore.totalElements,
        maxSources: SOURCE_WARM_MAX_SOURCES,
        minSources: SOURCE_WARM_MIN_SOURCES,
        hardCapSources: SOURCE_WARM_HARD_CAP_SOURCES,
        hardCapElements: SOURCE_WARM_HARD_CAP_ELEMENTS,
      })
      const candidateScores = new Map<string, number>()
      const playheadWindowFrames = Math.max(
        12,
        Math.round(fps * SOURCE_WARM_PLAYHEAD_WINDOW_SECONDS),
      )
      const scrubWindowFrames = Math.max(8, Math.round(fps * SOURCE_WARM_SCRUB_WINDOW_SECONDS))

      collectCandidates(
        playbackVideoSourceSpans,
        playback.currentFrame,
        playheadWindowFrames,
        100,
        candidateScores,
      )

      if (interactionMode === 'scrubbing' && playback.previewFrame !== null) {
        collectCandidates(
          scrubVideoSourceSpans,
          playback.previewFrame,
          scrubWindowFrames,
          0,
          candidateScores,
        )
      }

      const selectedSources = [...candidateScores.entries()]
        .sort((a, b) => a[1] - b[1])
        .slice(0, warmTarget)
        .map(([src]) => src)

      for (const src of selectedSources) {
        recentTouches.set(src, now)
        pool.preloadSource(src).catch(() => {})
      }

      const keepWarm = new Set<string>(selectedSources)
      const stickySources = [...recentTouches.entries()]
        .filter(
          ([src, touchedAt]) => !keepWarm.has(src) && now - touchedAt <= SOURCE_WARM_STICKY_MS,
        )
        .sort((a, b) => b[1] - a[1])

      for (const [src] of stickySources) {
        if (keepWarm.size >= warmTarget) break
        keepWarm.add(src)
      }

      let warmEvictionsThisTick = 0
      for (const [src, touchedAt] of recentTouches.entries()) {
        if (now - touchedAt > SOURCE_WARM_STICKY_MS) {
          recentTouches.delete(src)
          warmEvictionsThisTick += 1
        }
      }

      const touchOverflow = Math.max(0, recentTouches.size - SOURCE_WARM_HARD_CAP_SOURCES)
      if (touchOverflow > 0) {
        const evictionCandidates = [...recentTouches.entries()]
          .filter(([src]) => !keepWarm.has(src))
          .sort((a, b) => a[1] - b[1])
        for (let i = 0; i < evictionCandidates.length && i < touchOverflow; i++) {
          const [src] = evictionCandidates[i]!
          if (recentTouches.delete(src)) {
            warmEvictionsThisTick += 1
          }
        }
      }

      pool.pruneUnused(keepWarm)
      const poolStatsAfter = pool.getStats()
      previewPerfRef.current.sourceWarmTarget = warmTarget
      previewPerfRef.current.sourceWarmKeep = keepWarm.size
      previewPerfRef.current.sourceWarmEvictions += warmEvictionsThisTick
      previewPerfRef.current.sourcePoolSources = poolStatsAfter.sourceCount
      previewPerfRef.current.sourcePoolElements = poolStatsAfter.totalElements
      previewPerfRef.current.sourcePoolActiveClips = poolStatsAfter.activeClips
    }

    refreshWarmSet()
    const intervalId = setInterval(refreshWarmSet, SOURCE_WARM_TICK_MS)
    const unsubscribe = usePlaybackStore.subscribe((state, prev) => {
      if (
        state.currentFrame !== prev.currentFrame ||
        state.previewFrame !== prev.previewFrame ||
        state.isPlaying !== prev.isPlaying
      ) {
        if (state.isPlaying && !prev.isPlaying) {
          if (rafId !== null) {
            cancelAnimationFrame(rafId)
            rafId = null
          }
          refreshWarmSet()
        } else {
          if (rafId !== null) {
            cancelAnimationFrame(rafId)
          }
          rafId = requestAnimationFrame(() => {
            rafId = null
            refreshWarmSet()
          })
        }
      }
    })

    return () => {
      unsubscribe()
      clearInterval(intervalId)
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [
    fps,
    isGizmoInteractingRef,
    playbackVideoSourceSpans,
    previewPerfRef,
    resolvedUrlCount,
    scrubVideoSourceSpans,
  ])
}
