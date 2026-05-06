import type { ReactNode } from 'react'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import type { AudioEqSettings } from '@/types/audio'
import type { ResolvedTransitionWindow } from '@/core/timeline/transitions/transition-planner'
import {
  appendResolvedAudioEqSources,
  areAudioEqStagesEqual,
  getAudioEqSettings,
} from '@/shared/utils/audio-eq'
import type { StableVideoGroup } from '../utils/video-scene'
export type StableVideoSequenceComparatorItem = VideoItem & {
  zIndex: number
  muted: boolean
  trackAudioEq?: AudioEqSettings
  trackOrder: number
  trackVisible: boolean
  _sequenceFrameOffset?: number
  _poolClipId?: string
  _sharedTransitionSync?: boolean
}

/**
 * Custom comparison for GroupRenderer to ensure re-render when item properties change.
 * Default React.memo shallow comparison only checks reference equality, which may miss
 * cases where group.items contains items with changed properties (like speed after rate stretch).
 */
export function areGroupPropsEqual(
  prevProps: {
    group: StableVideoGroup<StableVideoSequenceComparatorItem>
    renderItem: (item: StableVideoSequenceComparatorItem) => ReactNode
    transitionWindows?: ResolvedTransitionWindow<TimelineItem>[]
  },
  nextProps: {
    group: StableVideoGroup<StableVideoSequenceComparatorItem>
    renderItem: (item: StableVideoSequenceComparatorItem) => ReactNode
    transitionWindows?: ResolvedTransitionWindow<TimelineItem>[]
  },
): boolean {
  // Quick reference check first
  if (
    prevProps.group === nextProps.group &&
    prevProps.renderItem === nextProps.renderItem &&
    prevProps.transitionWindows === nextProps.transitionWindows
  ) {
    return true
  }

  // If renderItem changed, need to re-render
  if (prevProps.renderItem !== nextProps.renderItem) {
    return false
  }

  if (prevProps.transitionWindows !== nextProps.transitionWindows) {
    return false
  }

  // Check if group structure changed
  if (
    prevProps.group.originKey !== nextProps.group.originKey ||
    prevProps.group.minFrom !== nextProps.group.minFrom ||
    prevProps.group.maxEnd !== nextProps.group.maxEnd ||
    prevProps.group.items.length !== nextProps.group.items.length
  ) {
    return false
  }

  // Deep check: compare item properties that affect rendering
  for (let i = 0; i < prevProps.group.items.length; i++) {
    const prevItem = prevProps.group.items[i]!
    const nextItem = nextProps.group.items[i]!
    if (
      prevItem.id !== nextItem.id ||
      prevItem.speed !== nextItem.speed ||
      prevItem.sourceStart !== nextItem.sourceStart ||
      prevItem.sourceEnd !== nextItem.sourceEnd ||
      prevItem.from !== nextItem.from ||
      prevItem.durationInFrames !== nextItem.durationInFrames ||
      prevItem.trackVisible !== nextItem.trackVisible ||
      prevItem.muted !== nextItem.muted ||
      (prevItem.crop?.left ?? 0) !== (nextItem.crop?.left ?? 0) ||
      (prevItem.crop?.right ?? 0) !== (nextItem.crop?.right ?? 0) ||
      (prevItem.crop?.top ?? 0) !== (nextItem.crop?.top ?? 0) ||
      (prevItem.crop?.bottom ?? 0) !== (nextItem.crop?.bottom ?? 0) ||
      (prevItem.crop?.softness ?? 0) !== (nextItem.crop?.softness ?? 0) ||
      prevItem.cornerPin !== nextItem.cornerPin ||
      prevItem.blendMode !== nextItem.blendMode ||
      prevItem.src !== nextItem.src ||
      prevItem.audioSrc !== nextItem.audioSrc ||
      prevItem.reverseConformSrc !== nextItem.reverseConformSrc ||
      prevItem.reverseConformPreviewSrc !== nextItem.reverseConformPreviewSrc ||
      prevItem.reverseConformStatus !== nextItem.reverseConformStatus ||
      (prevItem.audioPitchSemitones ?? 0) !== (nextItem.audioPitchSemitones ?? 0) ||
      (prevItem.audioPitchCents ?? 0) !== (nextItem.audioPitchCents ?? 0) ||
      !areAudioEqStagesEqual(
        appendResolvedAudioEqSources(
          undefined,
          prevItem.trackAudioEq,
          getAudioEqSettings(prevItem),
        ),
        appendResolvedAudioEqSources(
          undefined,
          nextItem.trackAudioEq,
          getAudioEqSettings(nextItem),
        ),
      )
    ) {
      return false
    }
  }

  return true
}
