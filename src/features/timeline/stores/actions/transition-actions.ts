/**
 * Transition Actions - cut-centered handle-based transitions.
 *
 * Transitions stay attached to the cut between adjacent clips. Adding,
 * updating, or removing a transition never moves clip timeline positions.
 */

import type {
  Transition,
  TransitionType,
  TransitionPresentation,
  WipeDirection,
  SlideDirection,
  FlipDirection,
} from '@/types/transition'
import { TRANSITION_CONFIGS } from '@/types/transition'
import { useItemsStore } from '../items-store'
import { useTransitionsStore } from '../transitions-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import {
  canAddTransition,
  areFramesAligned,
  getMaxTransitionDurationForHandles,
} from '../../utils/transition-utils'
import { execute, getLogger } from './shared'

export function addTransition(
  leftClipId: string,
  rightClipId: string,
  type: TransitionType = 'crossfade',
  durationInFrames?: number,
  presentation?: TransitionPresentation,
  direction?: WipeDirection | SlideDirection | FlipDirection,
): boolean {
  return execute(
    'ADD_TRANSITION',
    () => {
      const items = useItemsStore.getState().items
      const transitions = useTransitionsStore.getState().transitions
      // Find the clips
      const leftClip = items.find((i) => i.id === leftClipId)
      const rightClip = items.find((i) => i.id === rightClipId)

      if (!leftClip || !rightClip) {
        getLogger().warn('[addTransition] Clips not found')
        return false
      }

      const maxByClipDuration = Math.floor(
        Math.min(leftClip.durationInFrames, rightClip.durationInFrames) - 1,
      )
      if (maxByClipDuration < 1) {
        getLogger().warn('[addTransition] Cannot add transition: clips are too short')
        return false
      }

      const config = TRANSITION_CONFIGS[type]
      const requestedDuration = durationInFrames ?? config.defaultDuration
      let duration = Math.max(1, Math.min(Math.round(requestedDuration), maxByClipDuration))

      const leftEnd = leftClip.from + leftClip.durationInFrames
      const isAdjacent = areFramesAligned(leftEnd, rightClip.from)
      if (isAdjacent) {
        const maxHandleDuration = getMaxTransitionDurationForHandles(leftClip, rightClip, 0.5)
        if (maxHandleDuration < 1) {
          getLogger().warn(
            '[addTransition] Cannot add transition: insufficient source handle at cut',
          )
          return false
        }
        duration = Math.min(duration, maxHandleDuration)
      }

      // Validate that transition can be added (includes handle check)
      const validation = canAddTransition(leftClip, rightClip, duration, 0.5)
      if (!validation.canAdd) {
        getLogger().warn('[addTransition] Cannot add transition:', validation.reason)
        return false
      }

      // Check if transition already exists
      const existingTransition = transitions.find(
        (t) => t.leftClipId === leftClipId && t.rightClipId === rightClipId,
      )
      if (existingTransition) {
        getLogger().warn('[addTransition] Transition already exists between these clips')
        return false
      }

      // Create transition record
      useTransitionsStore
        .getState()
        ._addTransition(
          leftClipId,
          rightClipId,
          leftClip.trackId,
          type,
          duration,
          presentation,
          direction,
        )

      useTimelineSettingsStore.getState().markDirty()
      return true
    },
    { leftClipId, rightClipId, type },
  )
}

export function updateTransition(
  id: string,
  updates: Partial<
    Pick<
      Transition,
      | 'durationInFrames'
      | 'type'
      | 'presentation'
      | 'direction'
      | 'timing'
      | 'alignment'
      | 'bezierPoints'
      | 'presetId'
      | 'properties'
    >
  >,
): void {
  execute(
    'UPDATE_TRANSITION',
    () => {
      const transitions = useTransitionsStore.getState().transitions
      const transition = transitions.find((t) => t.id === id)
      if (!transition) return
      const items = useItemsStore.getState().items
      const leftClip = items.find((i) => i.id === transition.leftClipId)
      const rightClip = items.find((i) => i.id === transition.rightClipId)
      const nextTransition = { ...transition, ...updates }

      if (leftClip && rightClip) {
        const validation = canAddTransition(
          leftClip,
          rightClip,
          nextTransition.durationInFrames,
          nextTransition.alignment,
        )
        if (!validation.canAdd) {
          getLogger().warn('[updateTransition] Cannot update transition:', validation.reason)
          return
        }
      }

      useTransitionsStore.getState()._updateTransition(id, updates)
      useTimelineSettingsStore.getState().markDirty()
    },
    { id, updates },
  )
}

export function updateTransitions(
  updates: Array<{
    id: string
    updates: Partial<
      Pick<
        Transition,
        | 'durationInFrames'
        | 'type'
        | 'presentation'
        | 'direction'
        | 'timing'
        | 'alignment'
        | 'bezierPoints'
        | 'presetId'
        | 'properties'
      >
    >
  }>,
): void {
  if (updates.length === 0) return
  execute(
    'UPDATE_TRANSITIONS',
    () => {
      // For batch updates that don't change duration, apply directly
      // Duration changes require individual processing via updateTransition
      const store = useTransitionsStore.getState()
      for (const { id, updates: u } of updates) {
        if (u.durationInFrames !== undefined) {
          // Delegate to single update for proper clip adjustment
          const transitions = store.transitions
          const transition = transitions.find((t) => t.id === id)
          if (transition && u.durationInFrames !== transition.durationInFrames) {
            // This will be handled in its own execute, but since we're already
            // in an execute block, call the logic directly
            updateTransition(id, u)
            continue
          }
        }
        store._updateTransition(id, u)
      }
      useTimelineSettingsStore.getState().markDirty()
    },
    { updates },
  )
}

export function removeTransition(id: string): void {
  execute(
    'REMOVE_TRANSITION',
    () => {
      useTransitionsStore.getState()._removeTransition(id)
      useTimelineSettingsStore.getState().markDirty()
    },
    { id },
  )
}
