import type { ReactNode } from 'react'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import type { AudioEqSettings } from '@/types/audio'
import type { ResolvedTransitionWindow } from '@/shared/timeline/transitions/transition-planner'
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

type StableVideoRenderBaseSignature = {
  id: string
  speed: number | undefined
  sourceStart: number | undefined
  sourceEnd: number | undefined
  from: number
  durationInFrames: number
  trackVisible: boolean
  muted: boolean
  cropLeft: number
  cropRight: number
  cropTop: number
  cropBottom: number
  cropSoftness: number
  cornerPin: StableVideoSequenceComparatorItem['cornerPin']
  blendMode: StableVideoSequenceComparatorItem['blendMode']
  src: string | undefined
  audioSrc: string | undefined
  reverseConformSrc: string | undefined
  reverseConformPreviewSrc: string | undefined
  reverseConformStatus: StableVideoSequenceComparatorItem['reverseConformStatus']
  audioPitchSemitones: number
  audioPitchCents: number
}

type StableVideoRenderSignature = StableVideoRenderBaseSignature & {
  audioEqStages: ReturnType<typeof appendResolvedAudioEqSources>
}

function getStableVideoRenderBaseSignature(
  item: StableVideoSequenceComparatorItem,
): StableVideoRenderBaseSignature {
  return {
    id: item.id,
    speed: item.speed,
    sourceStart: item.sourceStart,
    sourceEnd: item.sourceEnd,
    from: item.from,
    durationInFrames: item.durationInFrames,
    trackVisible: item.trackVisible,
    muted: item.muted,
    cropLeft: item.crop?.left ?? 0,
    cropRight: item.crop?.right ?? 0,
    cropTop: item.crop?.top ?? 0,
    cropBottom: item.crop?.bottom ?? 0,
    cropSoftness: item.crop?.softness ?? 0,
    cornerPin: item.cornerPin,
    blendMode: item.blendMode,
    src: item.src,
    audioSrc: item.audioSrc,
    reverseConformSrc: item.reverseConformSrc,
    reverseConformPreviewSrc: item.reverseConformPreviewSrc,
    reverseConformStatus: item.reverseConformStatus,
    audioPitchSemitones: item.audioPitchSemitones ?? 0,
    audioPitchCents: item.audioPitchCents ?? 0,
  }
}

function getStableVideoAudioEqStages(item: StableVideoSequenceComparatorItem) {
  return appendResolvedAudioEqSources(undefined, item.trackAudioEq, getAudioEqSettings(item))
}

export function getStableVideoRenderSignature(
  item: StableVideoSequenceComparatorItem,
): StableVideoRenderSignature {
  return {
    ...getStableVideoRenderBaseSignature(item),
    audioEqStages: getStableVideoAudioEqStages(item),
  }
}

function areStableVideoRenderBaseSignaturesEqual(
  prevSignature: StableVideoRenderBaseSignature,
  nextSignature: StableVideoRenderBaseSignature,
): boolean {
  return (
    prevSignature.id === nextSignature.id &&
    prevSignature.speed === nextSignature.speed &&
    prevSignature.sourceStart === nextSignature.sourceStart &&
    prevSignature.sourceEnd === nextSignature.sourceEnd &&
    prevSignature.from === nextSignature.from &&
    prevSignature.durationInFrames === nextSignature.durationInFrames &&
    prevSignature.trackVisible === nextSignature.trackVisible &&
    prevSignature.muted === nextSignature.muted &&
    prevSignature.cropLeft === nextSignature.cropLeft &&
    prevSignature.cropRight === nextSignature.cropRight &&
    prevSignature.cropTop === nextSignature.cropTop &&
    prevSignature.cropBottom === nextSignature.cropBottom &&
    prevSignature.cropSoftness === nextSignature.cropSoftness &&
    prevSignature.cornerPin === nextSignature.cornerPin &&
    prevSignature.blendMode === nextSignature.blendMode &&
    prevSignature.src === nextSignature.src &&
    prevSignature.audioSrc === nextSignature.audioSrc &&
    prevSignature.reverseConformSrc === nextSignature.reverseConformSrc &&
    prevSignature.reverseConformPreviewSrc === nextSignature.reverseConformPreviewSrc &&
    prevSignature.reverseConformStatus === nextSignature.reverseConformStatus &&
    prevSignature.audioPitchSemitones === nextSignature.audioPitchSemitones &&
    prevSignature.audioPitchCents === nextSignature.audioPitchCents
  )
}

function areStableVideoItemsRenderEqual(
  prevItem: StableVideoSequenceComparatorItem,
  nextItem: StableVideoSequenceComparatorItem,
): boolean {
  if (
    !areStableVideoRenderBaseSignaturesEqual(
      getStableVideoRenderBaseSignature(prevItem),
      getStableVideoRenderBaseSignature(nextItem),
    )
  ) {
    return false
  }

  return areAudioEqStagesEqual(
    getStableVideoAudioEqStages(prevItem),
    getStableVideoAudioEqStages(nextItem),
  )
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
    if (!areStableVideoItemsRenderEqual(prevItem, nextItem)) {
      return false
    }
  }

  return true
}
