import { useEffect, useState } from 'react'
import {
  useCompositionsStore,
  useItemsStore,
  useTransitionsStore,
  type SubComposition,
} from '@/features/preview/deps/timeline-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useGizmoStore } from '@/features/preview/stores/gizmo-store'
import type { ItemEffect } from '@/types/effects'
import type { TimelineItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import {
  resolveTransitionWindows,
  type ResolvedTransitionWindow,
} from '@/shared/timeline/transitions/transition-planner'
import { hasCornerPin } from '@/features/preview/deps/composition-runtime'
import { isTextMotionActive } from '@/shared/typography/text-motion'

function hasEnabledGpuEffect(effects: ItemEffect[] | undefined): boolean {
  return effects?.some((e) => e.enabled && e.effect.type === 'gpu-effect') ?? false
}

function hasRenderableBlendMode(item: TimelineItem): boolean {
  if (item.type === 'shape' && item.isMask) return false
  return item.blendMode !== undefined && item.blendMode !== 'normal'
}

/**
 * Motion text (per-glyph animation) can only render through the canvas/GPU
 * path, never the DOM Player — so any text item carrying a `textMotion` slot
 * must keep the continuous overlay on. Frame-independent (presence-based):
 * used for sub-composition items where mapping the outer frame to the inner
 * timeline is non-trivial; the top-level scan below refines this to the active
 * motion window via {@link isTextMotionActive}.
 */
function hasTextMotionSpec(item: TimelineItem): boolean {
  return (
    item.type === 'text' &&
    item.textMotion !== undefined &&
    (item.textMotion.in !== undefined ||
      item.textMotion.out !== undefined ||
      item.textMotion.loop !== undefined)
  )
}

function needsRenderedOverlayPath(item: TimelineItem): boolean {
  return (
    hasEnabledGpuEffect(item.effects) ||
    hasRenderableBlendMode(item) ||
    hasCornerPin(item.cornerPin) ||
    hasTextMotionSpec(item)
  )
}

function subCompositionNeedsRenderedOverlayPath(
  subComp: SubComposition,
  compositionById?: Record<string, SubComposition>,
  visited: Set<string> = new Set(),
): boolean {
  if (visited.has(subComp.id)) return false
  visited.add(subComp.id)
  return subComp.items.some((subItem) => {
    if (needsRenderedOverlayPath(subItem)) return true
    if (subItem.type === 'composition' && compositionById) {
      const nested = compositionById[subItem.compositionId]
      if (nested && subCompositionNeedsRenderedOverlayPath(nested, compositionById, visited)) {
        return true
      }
    }
    return false
  })
}

const PLAYBACK_OVERLAY_LOOKAHEAD_SECONDS = 0.25
const PLAYBACK_OVERLAY_HOLD_SECONDS = 0.1
const SCRUB_OVERLAY_RADIUS_SECONDS = 0.08

export interface ContinuousPreviewOverlayFrameWindow {
  startFrame: number
  endFrameExclusive: number
}

interface ContinuousPreviewOverlayWindowOptions {
  forceTransitionFrames?: boolean
  checkTransitions?: boolean
}

export interface ContinuousPreviewOverlayIndex {
  candidateItems: TimelineItem[]
  transitionWindows: ResolvedTransitionWindow[]
}

interface ContinuousPreviewOverlayFrameWindowInput {
  frame: number
  fps: number
  isPlaying: boolean
  isPreviewing: boolean
  playbackRate: number
}

export function getContinuousPreviewOverlayFrameWindow({
  frame,
  fps,
  isPlaying,
  isPreviewing,
  playbackRate,
}: ContinuousPreviewOverlayFrameWindowInput): ContinuousPreviewOverlayFrameWindow {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30
  const lookaheadFrames = isPlaying
    ? Math.max(1, Math.ceil(safeFps * PLAYBACK_OVERLAY_LOOKAHEAD_SECONDS))
    : isPreviewing
      ? Math.max(1, Math.ceil(safeFps * SCRUB_OVERLAY_RADIUS_SECONDS))
      : 0
  const holdFrames = isPlaying
    ? Math.max(1, Math.ceil(safeFps * PLAYBACK_OVERLAY_HOLD_SECONDS))
    : isPreviewing
      ? lookaheadFrames
      : 0
  const isReversePlayback = isPlaying && playbackRate < 0

  return {
    startFrame: frame - (isReversePlayback ? lookaheadFrames : holdFrames),
    endFrameExclusive: frame + (isReversePlayback ? holdFrames : lookaheadFrames) + 1,
  }
}

function rangesOverlap(
  startFrame: number,
  endFrameExclusive: number,
  otherStartFrame: number,
  otherEndFrameExclusive: number,
): boolean {
  return startFrame < otherEndFrameExclusive && endFrameExclusive > otherStartFrame
}

function isTextMotionActiveInWindow(
  item: Extract<TimelineItem, { type: 'text' }>,
  startFrame: number,
  endFrameExclusive: number,
): boolean {
  const textMotion = item.textMotion
  if (!textMotion) return false
  const firstFrame = Math.max(item.from, Math.ceil(startFrame))
  const lastFrameExclusive = Math.min(
    item.from + item.durationInFrames,
    Math.ceil(endFrameExclusive),
  )
  for (let frame = firstFrame; frame < lastFrameExclusive; frame += 1) {
    if (isTextMotionActive(textMotion, frame - item.from, 0, item.durationInFrames)) {
      return true
    }
  }
  return false
}

export function buildContinuousPreviewOverlayIndex(
  items: TimelineItem[],
  transitions: Transition[],
  previewEffectsByItemId?: ReadonlyMap<string, ItemEffect[]>,
  compositionById?: Record<string, SubComposition>,
): ContinuousPreviewOverlayIndex {
  const candidateItems = items.filter((item) => {
    const effectiveEffects = previewEffectsByItemId?.get(item.id) ?? item.effects
    if (hasEnabledGpuEffect(effectiveEffects)) return true
    if (hasRenderableBlendMode(item)) return true
    if (hasCornerPin(item.cornerPin)) return true
    if (hasTextMotionSpec(item)) return true
    if (item.type === 'composition' && compositionById) {
      const subComp = compositionById[item.compositionId]
      return Boolean(subComp && subCompositionNeedsRenderedOverlayPath(subComp, compositionById))
    }
    return false
  })
  const clipsById = new Map(items.map((item) => [item.id, item]))

  return {
    candidateItems,
    transitionWindows: resolveTransitionWindows(transitions, clipsById),
  }
}

export function shouldForceContinuousPreviewOverlayFromIndex(
  index: ContinuousPreviewOverlayIndex,
  window: ContinuousPreviewOverlayFrameWindow,
  previewEffectsByItemId?: ReadonlyMap<string, ItemEffect[]>,
  compositionById?: Record<string, SubComposition>,
  options: ContinuousPreviewOverlayWindowOptions = {},
): boolean {
  const { startFrame, endFrameExclusive } = window
  if (
    !Number.isFinite(startFrame) ||
    !Number.isFinite(endFrameExclusive) ||
    endFrameExclusive <= startFrame
  ) {
    return false
  }

  if (options.checkTransitions !== false) {
    for (const transitionWindow of index.transitionWindows) {
      if (
        !rangesOverlap(
          startFrame,
          endFrameExclusive,
          transitionWindow.startFrame,
          transitionWindow.endFrame,
        )
      ) {
        continue
      }
      if (options.forceTransitionFrames) return true
      if (
        transitionWindow.leftClip.type === 'composition' ||
        transitionWindow.rightClip.type === 'composition' ||
        hasCornerPin(transitionWindow.leftClip.cornerPin) ||
        hasCornerPin(transitionWindow.rightClip.cornerPin)
      ) {
        return true
      }
    }
  }

  return index.candidateItems.some((item) => {
    if (
      !rangesOverlap(startFrame, endFrameExclusive, item.from, item.from + item.durationInFrames)
    ) {
      return false
    }
    const effectiveEffects = previewEffectsByItemId?.get(item.id) ?? item.effects
    if (hasEnabledGpuEffect(effectiveEffects)) return true
    if (hasRenderableBlendMode(item)) return true
    if (hasCornerPin(item.cornerPin)) return true
    if (
      item.type === 'text' &&
      item.textMotion !== undefined &&
      isTextMotionActiveInWindow(item, startFrame, endFrameExclusive)
    ) {
      return true
    }
    if (item.type === 'composition' && compositionById) {
      const subComp = compositionById[item.compositionId]
      return Boolean(subComp && subCompositionNeedsRenderedOverlayPath(subComp, compositionById))
    }
    return false
  })
}

/**
 * Frame-independent scan: does the timeline contain ANY content that can only
 * be shown through the GPU overlay (enabled GPU effects, non-normal blend modes,
 * corner pin, text motion) — anywhere, on any clip, at any time?
 *
 * This is an inventory helper only. Presentation routing must remain bounded to
 * the playhead so one effected clip cannot force the expensive renderer across
 * an otherwise ordinary long timeline.
 */
export function timelineHasContinuousOverlayContent(
  items: TimelineItem[],
  compositionById?: Record<string, SubComposition>,
): boolean {
  return items.some((item) => {
    if (needsRenderedOverlayPath(item)) return true
    if (item.type === 'composition' && compositionById) {
      const subComp = compositionById[item.compositionId]
      if (subComp && subCompositionNeedsRenderedOverlayPath(subComp, compositionById)) return true
    }
    return false
  })
}

/**
 * Detects whether the composition renderer overlay should stay active
 * outside of scrub-driven updates.
 *
 * Returns true when any of these conditions exist:
 * - GPU effects enabled on any item
 * - Non-normal blend modes
 * - An active compound clip whose sub-composition contains GPU effects,
 *   adjustment-layer GPU effects, or non-normal blend modes
 */
export function shouldForceContinuousPreviewOverlay(
  items: TimelineItem[],
  transitionsOrCount: Transition[] | number,
  frame: number,
  previewEffectsByItemId?: ReadonlyMap<string, ItemEffect[]>,
  compositionById?: Record<string, SubComposition>,
  options: { forceTransitionFrames?: boolean } = {},
): boolean {
  return shouldForceContinuousPreviewOverlayInWindow(
    items,
    transitionsOrCount,
    { startFrame: frame, endFrameExclusive: frame + 1 },
    previewEffectsByItemId,
    compositionById,
    options,
  )
}

export function shouldForceContinuousPreviewOverlayInWindow(
  items: TimelineItem[],
  transitionsOrCount: Transition[] | number,
  window: ContinuousPreviewOverlayFrameWindow,
  previewEffectsByItemId?: ReadonlyMap<string, ItemEffect[]>,
  compositionById?: Record<string, SubComposition>,
  options: ContinuousPreviewOverlayWindowOptions = {},
): boolean {
  const { startFrame, endFrameExclusive } = window
  if (
    !Number.isFinite(startFrame) ||
    !Number.isFinite(endFrameExclusive) ||
    endFrameExclusive <= startFrame
  ) {
    return false
  }

  if (Array.isArray(transitionsOrCount) && transitionsOrCount.length > 0) {
    const clipMap = new Map<string, TimelineItem>()
    for (const item of items) {
      clipMap.set(item.id, item)
    }

    for (const transitionWindow of resolveTransitionWindows(transitionsOrCount, clipMap)) {
      if (
        rangesOverlap(
          startFrame,
          endFrameExclusive,
          transitionWindow.startFrame,
          transitionWindow.endFrame,
        )
      ) {
        if (options.forceTransitionFrames) {
          return true
        }
        if (
          transitionWindow.leftClip.type === 'composition' ||
          transitionWindow.rightClip.type === 'composition'
        ) {
          return true
        }
        if (
          hasCornerPin(transitionWindow.leftClip.cornerPin) ||
          hasCornerPin(transitionWindow.rightClip.cornerPin)
        ) {
          return true
        }
        // Multiple transitions on different tracks can cover the same
        // frame; keep checking later windows so a corner-pinned or
        // composition participant on a sibling track still wins.
        continue
      }
    }
  }

  return items.some((item) => {
    if (
      !rangesOverlap(startFrame, endFrameExclusive, item.from, item.from + item.durationInFrames)
    ) {
      return false
    }
    const effectiveEffects = previewEffectsByItemId?.get(item.id) ?? item.effects
    if (hasEnabledGpuEffect(effectiveEffects)) return true
    if (hasRenderableBlendMode(item)) return true
    if (hasCornerPin(item.cornerPin)) return true
    // Keep the continuous GPU overlay on while a text clip's motion window is
    // active — otherwise playback falls to the DOM Player, which cannot render
    // per-glyph motion (fps is unused by isTextMotionActive).
    if (
      item.type === 'text' &&
      item.textMotion !== undefined &&
      isTextMotionActiveInWindow(item, startFrame, endFrameExclusive)
    ) {
      return true
    }
    if (item.type === 'composition' && compositionById) {
      const subComp = compositionById[item.compositionId]
      if (subComp && subCompositionNeedsRenderedOverlayPath(subComp, compositionById)) return true
    }
    return false
  })
}

export function useGpuEffectsOverlay(fps: number) {
  const [needsOverlay, setNeedsOverlay] = useState(false)
  const [shouldWarmRenderer, setShouldWarmRenderer] = useState(false)

  useEffect(() => {
    const checkInventory = () => {
      const items = useItemsStore.getState().items
      const compositionById = useCompositionsStore.getState().compositionById
      const next = timelineHasContinuousOverlayContent(items, compositionById)
      setShouldWarmRenderer((prev) => (prev === next ? prev : next))
    }

    checkInventory()
    const unsubItems = useItemsStore.subscribe(checkInventory)
    const unsubCompositions = useCompositionsStore.subscribe(checkInventory)
    return () => {
      unsubItems()
      unsubCompositions()
    }
  }, [])

  useEffect(() => {
    let indexedItems: TimelineItem[] | null = null
    let indexedTransitions: Transition[] | null = null
    let indexedCompositions: Record<string, SubComposition> | null = null
    let indexedPreview: ReturnType<typeof useGizmoStore.getState>['preview'] | undefined
    let previewEffectsByItemId: ReadonlyMap<string, ItemEffect[]> | undefined
    let overlayIndex: ContinuousPreviewOverlayIndex | null = null

    const getOverlayIndex = () => {
      const items = useItemsStore.getState().items
      const transitions = useTransitionsStore.getState().transitions
      const compositionById = useCompositionsStore.getState().compositionById
      const preview = useGizmoStore.getState().preview
      if (
        overlayIndex &&
        indexedItems === items &&
        indexedTransitions === transitions &&
        indexedCompositions === compositionById &&
        indexedPreview === preview
      ) {
        return { compositionById, overlayIndex, previewEffectsByItemId }
      }

      previewEffectsByItemId = preview
        ? new Map(
            Object.entries(preview)
              .filter(([, itemPreview]) => Array.isArray(itemPreview.effects))
              .map(([itemId, itemPreview]) => [itemId, itemPreview.effects!]),
          )
        : undefined
      overlayIndex = buildContinuousPreviewOverlayIndex(
        items,
        transitions,
        previewEffectsByItemId,
        compositionById,
      )
      indexedItems = items
      indexedTransitions = transitions
      indexedCompositions = compositionById
      indexedPreview = preview
      return { compositionById, overlayIndex, previewEffectsByItemId }
    }

    const check = () => {
      const playback = usePlaybackStore.getState()
      const isPreviewing = playback.previewFrame !== null
      const frame = playback.previewFrame ?? playback.currentFrame
      const frameWindow = getContinuousPreviewOverlayFrameWindow({
        frame,
        fps,
        isPlaying: playback.isPlaying,
        isPreviewing,
        playbackRate: playback.playbackRate,
      })
      const { compositionById, overlayIndex, previewEffectsByItemId } = getOverlayIndex()

      setNeedsOverlay((prev) => {
        // Pre-arm shortly before rendered-only content and retain it briefly
        // after the boundary. Ordinary frames outside this bounded window stay
        // on the browser Player instead of paying the continuous render-pump cost.
        const next =
          shouldForceContinuousPreviewOverlayFromIndex(
            overlayIndex,
            frameWindow,
            previewEffectsByItemId,
            compositionById,
            { checkTransitions: false },
          ) ||
          // Transition pre-rendering has its own runway and buffer ownership.
          // Only route an actual transition frame here so effect lookahead does
          // not turn the pre-render runway itself into presented overlay frames.
          shouldForceContinuousPreviewOverlayFromIndex(
            overlayIndex,
            { startFrame: frame, endFrameExclusive: frame + 1 },
            previewEffectsByItemId,
            compositionById,
            { forceTransitionFrames: isPreviewing || playback.isPlaying },
          )
        return prev === next ? prev : next
      })
    }
    check()
    const unsubItems = useItemsStore.subscribe(check)
    const unsubTransitions = useTransitionsStore.subscribe(check)
    const unsubCompositions = useCompositionsStore.subscribe(check)
    const unsubGizmo = useGizmoStore.subscribe((state, prev) => {
      if (
        state.preview === prev.preview &&
        state.colorGradeBypassed === prev.colorGradeBypassed &&
        state.colorGradeComparisonMode === prev.colorGradeComparisonMode
      ) {
        return
      }
      check()
    })
    const unsubPlayback = usePlaybackStore.subscribe((state, prev) => {
      if (
        state.currentFrame === prev.currentFrame &&
        state.previewFrame === prev.previewFrame &&
        state.isPlaying === prev.isPlaying &&
        state.playbackRate === prev.playbackRate
      ) {
        return
      }
      check()
    })
    return () => {
      unsubItems()
      unsubTransitions()
      unsubCompositions()
      unsubGizmo()
      unsubPlayback()
    }
  }, [fps])

  return { needsOverlay, shouldWarmRenderer }
}
