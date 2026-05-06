import type { PlaybackState } from '@/shared/state/playback/types'
import {
  FAST_SCRUB_BACKWARD_FORCE_JUMP_FRAMES,
  FAST_SCRUB_BACKWARD_RENDER_QUANTIZE_FRAMES,
  FAST_SCRUB_BACKWARD_RENDER_THROTTLE_MS,
  FAST_SCRUB_BOUNDARY_PREWARM_MAX_BOUNDARIES_PER_FRAME,
  FAST_SCRUB_BOUNDARY_PREWARM_WINDOW_SECONDS,
  FAST_SCRUB_BOUNDARY_SOURCE_PREWARM_MAX_ENTRIES_PER_FRAME,
  FAST_SCRUB_BOUNDARY_SOURCE_PREWARM_MAX_SOURCES_PER_FRAME,
  FAST_SCRUB_DISABLE_BACKGROUND_PREWARM_ON_BACKWARD,
  FAST_SCRUB_FALLBACK_TO_PLAYER_ON_BACKWARD,
  FAST_SCRUB_SOURCE_PREWARM_WINDOW_SECONDS,
  type FastScrubBoundarySource,
} from './preview-constants'

export type RenderPumpFrameState = Pick<
  PlaybackState,
  'currentFrame' | 'currentFrameEpoch' | 'previewFrame' | 'previewFrameEpoch'
>

type ScrubDirection = -1 | 0 | 1

interface ResolveRenderPumpTargetFrameParams {
  state: RenderPumpFrameState
  forceFastScrubOverlay: boolean
  isPausedInsideTransition: boolean
}

interface ResolveScrubDirectionPlanParams {
  state: RenderPumpFrameState
  prev: RenderPumpFrameState
  targetFrame: number | null
  prevTargetFrame: number | null
}

interface ResolveBackwardScrubFlagsParams {
  scrubDirection: ScrubDirection
  forceFastScrubOverlay: boolean
  isAtomicScrubTarget: boolean
  preserveHighFidelityBackwardPreview: boolean
}

interface ResolveBackwardScrubFramePlanParams {
  targetFrame: number
  scrubDirection: ScrubDirection
  isAtomicScrubTarget: boolean
  preserveHighFidelityBackwardPreview: boolean
  nowMs: number
  lastBackwardScrubRenderAt: number
  lastBackwardRequestedFrame: number | null
}

interface SelectBoundaryPrewarmFramesParams {
  boundaryFrames: number[]
  targetFrame: number
  direction: ScrubDirection
  fps: number
}

interface SelectBoundarySourcePrewarmSourcesParams {
  boundarySources: FastScrubBoundarySource[]
  targetFrame: number
  direction: ScrubDirection
  fps: number
}

export function resolveRenderPumpTargetFrame({
  state,
  forceFastScrubOverlay,
  isPausedInsideTransition,
}: ResolveRenderPumpTargetFrameParams): number | null {
  return (
    state.previewFrame ??
    (forceFastScrubOverlay || isPausedInsideTransition ? state.currentFrame : null)
  )
}

export function isAtomicPreviewTarget(state: RenderPumpFrameState): boolean {
  return (
    state.previewFrame !== null &&
    state.currentFrame === state.previewFrame &&
    state.currentFrameEpoch === state.previewFrameEpoch
  )
}

export function resolveScrubDirectionPlan({
  state,
  prev,
  targetFrame,
  prevTargetFrame,
}: ResolveScrubDirectionPlanParams): {
  direction: ScrubDirection
  scrubUpdates: number
  scrubDroppedFrames: number
} {
  if (state.previewFrame !== null && prev.previewFrame !== null) {
    const previewDelta = state.previewFrame - prev.previewFrame
    return {
      direction: previewDelta > 0 ? 1 : previewDelta < 0 ? -1 : 0,
      scrubUpdates: 1,
      scrubDroppedFrames: Math.max(0, Math.abs(previewDelta) - 1),
    }
  }

  if (targetFrame !== null && prevTargetFrame !== null) {
    const targetDelta = targetFrame - prevTargetFrame
    return {
      direction: targetDelta > 0 ? 1 : targetDelta < 0 ? -1 : 0,
      scrubUpdates: 0,
      scrubDroppedFrames: 0,
    }
  }

  if (targetFrame !== null) {
    return {
      direction: 0,
      scrubUpdates: 0,
      scrubDroppedFrames: 0,
    }
  }

  return {
    direction: 0,
    scrubUpdates: 0,
    scrubDroppedFrames: 0,
  }
}

export function resolveBackwardScrubFlags({
  scrubDirection,
  forceFastScrubOverlay,
  isAtomicScrubTarget,
  preserveHighFidelityBackwardPreview,
}: ResolveBackwardScrubFlagsParams): {
  suppressBackgroundPrewarm: boolean
  fallbackToPlayer: boolean
} {
  return {
    suppressBackgroundPrewarm:
      FAST_SCRUB_DISABLE_BACKGROUND_PREWARM_ON_BACKWARD && scrubDirection < 0,
    fallbackToPlayer:
      !forceFastScrubOverlay &&
      FAST_SCRUB_FALLBACK_TO_PLAYER_ON_BACKWARD &&
      scrubDirection < 0 &&
      !isAtomicScrubTarget &&
      !preserveHighFidelityBackwardPreview,
  }
}

export function resolveBackwardScrubFramePlan({
  targetFrame,
  scrubDirection,
  isAtomicScrubTarget,
  preserveHighFidelityBackwardPreview,
  nowMs,
  lastBackwardScrubRenderAt,
  lastBackwardRequestedFrame,
}: ResolveBackwardScrubFramePlanParams): {
  requestedFrame: number
  throttleRequest: boolean
  nextLastBackwardScrubRenderAt: number
  nextLastBackwardRequestedFrame: number | null
} {
  if (scrubDirection >= 0 || isAtomicScrubTarget || preserveHighFidelityBackwardPreview) {
    return {
      requestedFrame: targetFrame,
      throttleRequest: false,
      nextLastBackwardScrubRenderAt: 0,
      nextLastBackwardRequestedFrame: null,
    }
  }

  const quantizedFrame =
    Math.floor(targetFrame / FAST_SCRUB_BACKWARD_RENDER_QUANTIZE_FRAMES) *
    FAST_SCRUB_BACKWARD_RENDER_QUANTIZE_FRAMES
  const withinThrottle = nowMs - lastBackwardScrubRenderAt < FAST_SCRUB_BACKWARD_RENDER_THROTTLE_MS
  const jumpDistance =
    lastBackwardRequestedFrame === null
      ? Number.POSITIVE_INFINITY
      : Math.abs(quantizedFrame - lastBackwardRequestedFrame)

  return {
    requestedFrame: quantizedFrame,
    throttleRequest: withinThrottle && jumpDistance < FAST_SCRUB_BACKWARD_FORCE_JUMP_FRAMES,
    nextLastBackwardScrubRenderAt: nowMs,
    nextLastBackwardRequestedFrame: quantizedFrame,
  }
}

export function selectBoundaryPrewarmFrames({
  boundaryFrames,
  targetFrame,
  direction,
  fps,
}: SelectBoundaryPrewarmFramesParams): number[] {
  if (boundaryFrames.length === 0) return []

  const windowFrames = Math.max(4, Math.round(fps * FAST_SCRUB_BOUNDARY_PREWARM_WINDOW_SECONDS))
  const minFrame = targetFrame - windowFrames
  const maxFrame = targetFrame + windowFrames
  const directionalCandidates: number[] = []
  const fallbackCandidates: number[] = []

  for (const boundary of boundaryFrames) {
    if (boundary < minFrame) continue
    if (boundary > maxFrame) break
    fallbackCandidates.push(boundary)
    if (direction > 0 && boundary < targetFrame - 1) continue
    if (direction < 0 && boundary > targetFrame + 1) continue
    directionalCandidates.push(boundary)
  }

  const candidates = directionalCandidates.length > 0 ? directionalCandidates : fallbackCandidates
  const selectedBoundaries = [...candidates]
    .sort((a, b) => Math.abs(a - targetFrame) - Math.abs(b - targetFrame))
    .slice(0, FAST_SCRUB_BOUNDARY_PREWARM_MAX_BOUNDARIES_PER_FRAME)

  const frames: number[] = []
  const seen = new Set<number>()
  for (const boundary of selectedBoundaries) {
    for (const frame of [boundary - 1, boundary, boundary + 1]) {
      const clampedFrame = Math.max(0, frame)
      if (seen.has(clampedFrame)) continue
      seen.add(clampedFrame)
      frames.push(clampedFrame)
    }
  }

  return frames
}

export function selectBoundarySourcePrewarmSources({
  boundarySources,
  targetFrame,
  direction,
  fps,
}: SelectBoundarySourcePrewarmSourcesParams): string[] {
  if (boundarySources.length === 0) return []

  const windowFrames = Math.max(8, Math.round(fps * FAST_SCRUB_SOURCE_PREWARM_WINDOW_SECONDS))
  const minFrame = targetFrame - windowFrames
  const maxFrame = targetFrame + windowFrames
  const directionalEntries: FastScrubBoundarySource[] = []
  const fallbackEntries: FastScrubBoundarySource[] = []

  for (const entry of boundarySources) {
    if (entry.frame < minFrame) continue
    if (entry.frame > maxFrame) break
    fallbackEntries.push(entry)
    if (direction > 0 && entry.frame < targetFrame - 1) continue
    if (direction < 0 && entry.frame > targetFrame + 1) continue
    directionalEntries.push(entry)
  }

  const candidateEntries = directionalEntries.length > 0 ? directionalEntries : fallbackEntries
  const selectedEntries = [...candidateEntries]
    .sort((a, b) => Math.abs(a.frame - targetFrame) - Math.abs(b.frame - targetFrame))
    .slice(0, FAST_SCRUB_BOUNDARY_SOURCE_PREWARM_MAX_ENTRIES_PER_FRAME)

  const sources: string[] = []
  for (const entry of selectedEntries) {
    for (const src of entry.srcs) {
      if (sources.length >= FAST_SCRUB_BOUNDARY_SOURCE_PREWARM_MAX_SOURCES_PER_FRAME) {
        return sources
      }
      sources.push(src)
    }
  }

  return sources
}
