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
import { resolveTransitionWindows } from '@/core/timeline/transitions/transition-planner'

function hasEnabledGpuEffect(effects: ItemEffect[] | undefined): boolean {
  return effects?.some((e) => e.enabled && e.effect.type === 'gpu-effect') ?? false
}

function hasRenderableBlendMode(item: TimelineItem): boolean {
  if (item.type === 'shape' && item.isMask) return false
  return item.blendMode !== undefined && item.blendMode !== 'normal'
}

function subCompositionHasGpuEffectsOrBlend(
  subComp: SubComposition,
  compositionById?: Record<string, SubComposition>,
  visited: Set<string> = new Set(),
): boolean {
  if (visited.has(subComp.id)) return false
  visited.add(subComp.id)
  return subComp.items.some((subItem) => {
    if (hasEnabledGpuEffect(subItem.effects)) return true
    if (hasRenderableBlendMode(subItem)) return true
    if (subItem.type === 'composition' && compositionById) {
      const nested = compositionById[subItem.compositionId]
      if (nested && subCompositionHasGpuEffectsOrBlend(nested, compositionById, visited)) {
        return true
      }
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
  if (!Number.isFinite(frame)) {
    return false
  }

  if (
    options.forceTransitionFrames &&
    Array.isArray(transitionsOrCount) &&
    transitionsOrCount.length > 0
  ) {
    const clipMap = new Map<string, TimelineItem>()
    for (const item of items) {
      clipMap.set(item.id, item)
    }

    for (const window of resolveTransitionWindows(transitionsOrCount, clipMap)) {
      if (frame >= window.startFrame && frame < window.endFrame) {
        return true
      }
    }
  }

  return items.some((item) => {
    if (frame < item.from || frame >= item.from + item.durationInFrames) {
      return false
    }
    const effectiveEffects = previewEffectsByItemId?.get(item.id) ?? item.effects
    if (hasEnabledGpuEffect(effectiveEffects)) return true
    if (hasRenderableBlendMode(item)) return true
    if (item.type === 'composition' && compositionById) {
      const subComp = compositionById[item.compositionId]
      if (subComp && subCompositionHasGpuEffectsOrBlend(subComp, compositionById)) return true
    }
    return false
  })
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useGpuEffectsOverlay(..._args: unknown[]) {
  const [needsOverlay, setNeedsOverlay] = useState(false)

  useEffect(() => {
    const check = () => {
      const items = useItemsStore.getState().items
      const transitions = useTransitionsStore.getState().transitions
      const compositionById = useCompositionsStore.getState().compositionById
      const playback = usePlaybackStore.getState()
      const frame = playback.previewFrame ?? playback.currentFrame
      const preview = useGizmoStore.getState().preview
      const previewEffectsByItemId = preview
        ? new Map(
            Object.entries(preview)
              .filter(([, itemPreview]) => Array.isArray(itemPreview.effects))
              .map(([itemId, itemPreview]) => [itemId, itemPreview.effects!]),
          )
        : undefined

      setNeedsOverlay((prev) => {
        const next = shouldForceContinuousPreviewOverlay(
          items,
          transitions,
          frame,
          previewEffectsByItemId,
          compositionById,
          { forceTransitionFrames: playback.previewFrame !== null },
        )
        return prev === next ? prev : next
      })
    }
    check()
    const unsubItems = useItemsStore.subscribe(check)
    const unsubTransitions = useTransitionsStore.subscribe(check)
    const unsubCompositions = useCompositionsStore.subscribe(check)
    const unsubGizmo = useGizmoStore.subscribe((state, prev) => {
      if (state.preview === prev.preview) {
        return
      }
      check()
    })
    const unsubPlayback = usePlaybackStore.subscribe((state, prev) => {
      if (state.currentFrame === prev.currentFrame && state.previewFrame === prev.previewFrame) {
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
  }, [])

  return needsOverlay
}
