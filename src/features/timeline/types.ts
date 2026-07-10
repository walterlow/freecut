import type {
  TimelineTrack,
  TimelineItem,
  ProjectMarker,
  VideoItem,
  AudioItem,
} from '@/types/timeline'
import type { TransformProperties } from '@/types/transform'
import type { ItemEffect, VisualEffect } from '@/types/effects'
import type {
  Transition,
  TransitionType,
  TransitionPresentation,
  WipeDirection,
  SlideDirection,
  FlipDirection,
} from '@/types/transition'
import type {
  ItemKeyframes,
  AnimatableProperty,
  Keyframe,
  EasingType,
  EasingConfig,
} from '@/types/keyframe'
import type { MaskVertex } from '@/types/masks'
import type { AutoKeyframeOperation } from '@/features/timeline/deps/keyframes'

export type TransformHistoryOperation =
  | 'move'
  | 'resize'
  | 'rotate'
  | 'opacity'
  | 'corner_radius'
  | 'transform'

export interface TransformCommandOptions {
  operation?: TransformHistoryOperation
}

export interface LoadTimelineOptions {
  allowProjectUpgrade?: boolean
}

export interface TimelineState {
  tracks: TimelineTrack[]
  items: TimelineItem[]
  markers: ProjectMarker[]
  transitions: Transition[]
  keyframes: ItemKeyframes[]
  fps: number
  scrollPosition: number
  snapEnabled: boolean
  audioSkimmingEnabled: boolean
  inPoint: number | null
  outPoint: number | null
  isDirty: boolean // Track unsaved changes
}

export interface ImageAudioMatchResult {
  status: 'matched' | 'no-images' | 'no-audio'
  imageCount: number
  audioStartFrame?: number
  audioEndFrame?: number
}

export interface AudioDuckingResult {
  status: 'ducked' | 'no-targets' | 'no-dialogue'
  targetCount: number
  dialogueCount: number
  keyframeCount: number
}

export interface CinematicImageMotionResult {
  status: 'applied' | 'no-images' | 'no-project' | 'blocked'
  imageCount: number
  keyframeCount: number
}

export interface CinematicDepthLayerAsset {
  mediaId: string
  src: string
  label: string
  sourceWidth?: number
  sourceHeight?: number
  thumbnailUrl?: string | null
}

export interface CinematicDepthLayerPlacement {
  sourceItemId: string
  depthSourceId?: string
  depthQuality?: number
  backgroundAsset?: CinematicDepthLayerAsset
  subjectAsset?: CinematicDepthLayerAsset
  depthMapAsset?: CinematicDepthLayerAsset
}

export interface InsertCinematicDepthLayersResult {
  status: 'inserted' | 'empty' | 'no-images'
  sourceImageCount: number
  layerCount: number
  trackCount: number
  itemIds: string[]
  sourceItemIds: string[]
  visibleItemIds: string[]
}

export interface AudiobookSoundEffectPlacement {
  mediaId: string
  src: string
  label: string
  audiobookSfxRole?: AudioItem['audiobookSfxRole']
  startFrame: number
  durationInFrames: number
  sourceDurationFrames?: number
  sourceFps?: number
  volume?: number
}

export interface AudiobookMusicBedPlacement {
  mediaId: string
  src: string
  label: string
  startFrame: number
  durationInFrames: number
  sourceDurationFrames: number
  sourceFps?: number
  volume?: number
}

export interface InsertAudiobookSoundEffectsResult {
  status: 'inserted' | 'empty'
  itemCount: number
  trackCount: number
}

export interface InsertAudiobookMusicBedResult {
  status: 'inserted' | 'empty'
  itemCount: number
  trackCount: number
  itemIds: string[]
}

export interface TimelineActions {
  setTracks: (tracks: TimelineTrack[]) => void
  addItem: (item: TimelineItem) => void
  addItems: (items: TimelineItem[]) => void
  addItemWithLinkedAudio: (video: VideoItem) => void
  addItemOnNewTrack: (item: TimelineItem, tracks: TimelineTrack[]) => void
  insertAudiobookSoundEffects: (
    placements: AudiobookSoundEffectPlacement[],
  ) => InsertAudiobookSoundEffectsResult
  insertAudiobookMusicBed: (placement: AudiobookMusicBedPlacement) => InsertAudiobookMusicBedResult
  insertCinematicDepthLayers: (
    placements: CinematicDepthLayerPlacement[],
  ) => InsertCinematicDepthLayersResult
  matchSelectedImagesToAudio: (selectedItemIds?: string[]) => ImageAudioMatchResult
  applySelectedAudioDucking: (
    selectedItemIds?: string[],
    options?: { duckDb?: number; attackSeconds?: number; releaseSeconds?: number },
  ) => AudioDuckingResult
  updateItem: (id: string, updates: Partial<TimelineItem>) => void
  removeItems: (ids: string[]) => void
  rippleDeleteItems: (ids: string[]) => void
  reverseItems: (ids: string[]) => void
  closeGapAtPosition: (trackId: string, frame: number) => void
  closeAllGapsOnTrack: (trackId: string) => void
  toggleSnap: () => void
  toggleAudioSkimming: () => void
  setScrollPosition: (position: number) => void
  moveItem: (id: string, newFrom: number, newTrackId?: string) => void
  moveItems: (updates: Array<{ id: string; from: number; trackId?: string }>) => void
  moveItemsWithTrackChanges: (
    tracks: TimelineTrack[],
    updates: Array<{ id: string; from: number; trackId?: string }>,
  ) => void
  duplicateItems: (itemIds: string[], positions: Array<{ from: number; trackId: string }>) => void
  duplicateItemsWithTrackChanges: (
    tracks: TimelineTrack[],
    itemIds: string[],
    positions: Array<{ from: number; trackId: string }>,
  ) => TimelineItem[]
  trimItemStart: (id: string, trimAmount: number) => void
  trimItemEnd: (id: string, trimAmount: number) => void
  rollingTrimItems: (leftId: string, rightId: string, editPointDelta: number) => void
  rippleTrimItem: (id: string, handle: 'start' | 'end', trimDelta: number) => void
  splitItem: (id: string, splitFrame: number) => void
  splitItemAtFrames: (id: string, splitFrames: number[]) => number
  removeSilenceFromItems: (
    itemIds: string[],
    silenceRangesByMediaId: Record<string, Array<{ start: number; end: number }>>,
  ) => { analyzedItemCount: number; removedItemCount: number; splitCount: number }
  removeFillerWordsFromItems: (
    itemIds: string[],
    fillerRangesByMediaId: Record<string, Array<{ start: number; end: number }>>,
  ) => { analyzedItemCount: number; removedItemCount: number; splitCount: number }
  removeTranscriptRangesFromItems: (
    itemIds: string[],
    rangesByMediaId: Record<string, Array<{ start: number; end: number }>>,
  ) => { analyzedItemCount: number; removedItemCount: number; splitCount: number }
  joinItems: (itemIds: string[]) => void
  rateStretchItem: (id: string, newFrom: number, newDuration: number, newSpeed: number) => void
  resetSpeedWithRipple: (itemIds: string[]) => void
  setInPoint: (frame: number) => void
  setOutPoint: (frame: number) => void
  clearInOutPoints: () => void
  // Marker actions
  addMarker: (frame: number, color?: string, label?: string) => void
  updateMarker: (id: string, updates: Partial<Omit<ProjectMarker, 'id'>>) => void
  removeMarker: (id: string) => void
  clearAllMarkers: () => void
  // Transform actions
  updateItemTransform: (
    id: string,
    transform: Partial<TransformProperties>,
    options?: TransformCommandOptions,
  ) => void
  resetItemTransform: (id: string) => void
  updateItemsTransform: (
    ids: string[],
    transform: Partial<TransformProperties>,
    options?: TransformCommandOptions,
  ) => void
  updateItemsTransformMap: (
    transformsMap: Map<string, Partial<TransformProperties>>,
    options?: TransformCommandOptions,
  ) => void
  commitMaskEdit: (
    id: string,
    commit: {
      pathVertices?: MaskVertex[]
      transform?: Partial<TransformProperties>
      autoKeyframeOperations?: AutoKeyframeOperation[]
    },
    options?: TransformCommandOptions,
  ) => void
  // Effect actions
  addEffect: (itemId: string, effect: VisualEffect) => void
  addEffects: (updates: Array<{ itemId: string; effects: VisualEffect[] }>) => void
  updateEffect: (
    itemId: string,
    effectId: string,
    updates: Partial<{ effect: VisualEffect; enabled: boolean }>,
  ) => void
  removeEffect: (itemId: string, effectId: string) => void
  toggleEffect: (itemId: string, effectId: string) => void
  setItemEffects: (updates: Array<{ itemId: string; effects: ItemEffect[] }>) => void
  // Transition actions
  addTransition: (
    leftClipId: string,
    rightClipId: string,
    type?: TransitionType,
    durationInFrames?: number,
    presentation?: TransitionPresentation,
    direction?: WipeDirection | SlideDirection | FlipDirection,
    alignment?: number,
  ) => boolean
  updateTransition: (
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
        | 'properties'
      >
    >,
  ) => void
  updateTransitions: (
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
          | 'properties'
        >
      >
    }>,
  ) => void
  removeTransition: (id: string) => void
  // Keyframe actions
  addKeyframe: (
    itemId: string,
    property: AnimatableProperty,
    frame: number,
    value: number,
    easing?: EasingType,
  ) => string
  addKeyframes: (
    payloads: Array<{
      itemId: string
      property: AnimatableProperty
      frame: number
      value: number
      easing?: EasingType
      easingConfig?: EasingConfig
    }>,
  ) => string[]
  updateKeyframe: (
    itemId: string,
    property: AnimatableProperty,
    keyframeId: string,
    updates: Partial<Omit<Keyframe, 'id'>>,
  ) => void
  applyAutoKeyframeOperations: (operations: AutoKeyframeOperation[]) => void
  removeKeyframe: (itemId: string, property: AnimatableProperty, keyframeId: string) => void
  removeKeyframesForItem: (itemId: string) => void
  removeKeyframesForProperty: (itemId: string, property: AnimatableProperty) => void
  getKeyframesForItem: (itemId: string) => ItemKeyframes | undefined
  hasKeyframesAtFrame: (itemId: string, property: AnimatableProperty, frame: number) => boolean
  repairLegacyAvTracks: () => Promise<boolean>
  saveTimeline: (projectId: string) => Promise<void>
  loadTimeline: (projectId: string, options?: LoadTimelineOptions) => Promise<void>
  clearTimeline: () => void
  markDirty: () => void
  markClean: () => void
}
