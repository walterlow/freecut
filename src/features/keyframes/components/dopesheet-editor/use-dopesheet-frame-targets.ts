/**
 * Dopesheet frame targets and guards.
 * Owns which frames a drag may snap to, and which frames reject a new keyframe
 * because they sit inside a transition. Both read the same playhead and the
 * same flattened keyframe list, and both are consulted from event handlers
 * (per drag move and per add), so they stay callbacks rather than state.
 */

import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import type { AnimatableProperty, Keyframe } from '@/types/keyframe'
import { SNAP_THRESHOLD_PX } from './dopesheet-constants'
import type { DopesheetEditorProps } from './dopesheet-editor-props'

export interface UseDopesheetFrameTargetsOptions {
  visibleKeyframes: Array<{ property: AnimatableProperty; keyframe: Keyframe }>
  selectedKeyframeIds: Set<string>
  additionalSnapFrames: readonly number[]
  currentFrame: number
  effectiveTimelineWidth: number
  frameRange: number
  transitionBlockedRanges: NonNullable<DopesheetEditorProps['transitionBlockedRanges']>
}

export interface UseDopesheetFrameTargetsReturn {
  /** Snaps a frame to the nearest target within the threshold. */
  snapFrame: (frame: number) => number
  isCurrentFrameBlocked: boolean
  notifyKeyframeBlocked: () => void
}

/** Derives the drag snap targets and the transition-blocked frame guard. */
export function useDopesheetFrameTargets({
  visibleKeyframes,
  selectedKeyframeIds,
  additionalSnapFrames,
  currentFrame,
  effectiveTimelineWidth,
  frameRange,
  transitionBlockedRanges,
}: UseDopesheetFrameTargetsOptions): UseDopesheetFrameTargetsReturn {
  const { t } = useTranslation()
  const isCurrentFrameBlocked = useMemo(
    () =>
      transitionBlockedRanges.some(
        (range) => currentFrame >= range.start && currentFrame < range.end,
      ),
    [transitionBlockedRanges, currentFrame],
  )

  // Adds inside a transition region are rejected by the action layer; surface
  // that instead of failing silently. A fixed toast id prevents stacking on
  // repeated clicks.
  const notifyKeyframeBlocked = useCallback(() => {
    toast.warning(t('timeline.keyframeEditor.transitionBlocked'), {
      id: 'keyframe-transition-blocked',
    })
  }, [t])

  const snapFrameTargets = useMemo(() => {
    const targets: number[] = [0, currentFrame, ...additionalSnapFrames]
    for (const { keyframe } of visibleKeyframes) {
      if (!selectedKeyframeIds.has(keyframe.id)) {
        targets.push(keyframe.frame)
      }
    }
    return [...new Set(targets)]
  }, [additionalSnapFrames, visibleKeyframes, selectedKeyframeIds, currentFrame])

  const snapThresholdFrames = useMemo(
    () => (SNAP_THRESHOLD_PX / effectiveTimelineWidth) * frameRange,
    [effectiveTimelineWidth, frameRange],
  )

  const snapFrame = useCallback(
    (frame: number) => {
      let closest = frame
      let minDistance = Infinity
      for (const target of snapFrameTargets) {
        const distance = Math.abs(frame - target)
        if (distance <= snapThresholdFrames && distance < minDistance) {
          minDistance = distance
          closest = target
        }
      }
      return closest
    },
    [snapFrameTargets, snapThresholdFrames],
  )

  return { snapFrame, isCurrentFrameBlocked, notifyKeyframeBlocked }
}
