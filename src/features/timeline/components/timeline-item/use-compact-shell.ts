import { useMemo, type MutableRefObject } from 'react'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import type { DraggedTransitionDescriptor } from '@/shared/state/transition-drag'
import type { ActiveEdgeState } from './trim-constants'
import type { SmartTrimHoverHandle } from './use-smart-trim-hover'
import type { TransitionDropPreviewState } from './use-transition-drop-preview'
import type {
  AudioFadeCurveEditState,
  AudioFadeEditState,
  AudioVolumeEditState,
  VideoFadeEditState,
} from './use-fade-editors'

type ItemEdge = 'start' | 'end'

interface PointerHintSignal {
  x: number
  y: number
  message: string
  tone?: 'warning' | 'danger'
}

const SPEED_BADGE_EPSILON = 0.005

export interface CompactClipInteractionSignals {
  isCompactWidth: boolean
  isBeingDragged: boolean
  isPartOfDrag: boolean
  isTrimming: boolean
  isStretching: boolean
  isSlipSlideActive: boolean
  isTrackPushActive: boolean
  isEffectDropTarget: boolean
  videoFadeEdit: VideoFadeEditState | null
  audioFadeEdit: AudioFadeEditState | null
  audioFadeCurveEdit: AudioFadeCurveEditState | null
  audioVolumeEdit: AudioVolumeEditState | null
  transitionDropGhost: TransitionDropPreviewState['transitionDropGhost']
  draggedTransition: DraggedTransitionDescriptor | null
  pointerHint: PointerHintSignal | null
  hoveredEdge: ItemEdge | null
  smartTrimIntent: SmartTrimHoverHandle['smartTrimIntent']
  smartBodyIntent: SmartTrimHoverHandle['smartBodyIntent']
  rollHoverEdge: ItemEdge | null
  activeEdges: ActiveEdgeState | null
}

export interface CompactClipInteraction {
  hasActiveClipInteraction: boolean
  skipFadeComputation: boolean
}

/**
 * Hoisted before the fade memos so the compact guard can account for active
 * edits. Selection alone must not promote a narrow clip back to the rich shell:
 * a large marquee would otherwise restore every fade control and its math at
 * once. Active gestures still keep their controls alive while zoom changes.
 */
export function resolveCompactClipInteraction({
  isCompactWidth,
  isBeingDragged,
  isPartOfDrag,
  isTrimming,
  isStretching,
  isSlipSlideActive,
  isTrackPushActive,
  isEffectDropTarget,
  videoFadeEdit,
  audioFadeEdit,
  audioFadeCurveEdit,
  audioVolumeEdit,
  transitionDropGhost,
  draggedTransition,
  pointerHint,
  hoveredEdge,
  smartTrimIntent,
  smartBodyIntent,
  rollHoverEdge,
  activeEdges,
}: CompactClipInteractionSignals): CompactClipInteraction {
  const hasActiveClipInteraction = [
    isBeingDragged,
    isPartOfDrag,
    isTrimming,
    isStretching,
    isSlipSlideActive,
    isTrackPushActive,
    isEffectDropTarget,
    videoFadeEdit !== null,
    audioFadeEdit !== null,
    audioFadeCurveEdit !== null,
    audioVolumeEdit !== null,
    transitionDropGhost !== null,
    draggedTransition !== null,
    pointerHint !== null,
    hoveredEdge !== null,
    smartTrimIntent !== null,
    smartBodyIntent !== null,
    rollHoverEdge !== null,
    activeEdges !== null,
  ].some(Boolean)
  const skipFadeComputation = isCompactWidth && !hasActiveClipInteraction

  return { hasActiveClipInteraction, skipFadeComputation }
}

export interface CompactShellSignals {
  item: TimelineItemType
  isBroken: boolean
  hasKeyframes: boolean
  currentSpeed: number
  linkedSyncOffsetFrames: number | null
  activeTool: string
  isCompactWidth: boolean
  hasActiveClipInteraction: boolean
}

/**
 * A narrow clip drops to the compact shell unless it has detail worth showing:
 * badges, broken media, non-default speed or a linked sync ghost. Active
 * interactions and non-select tools keep the rich shell.
 */
export function shouldUseCompactClipShell({
  item,
  isBroken,
  hasKeyframes,
  currentSpeed,
  linkedSyncOffsetFrames,
  activeTool,
  isCompactWidth,
  hasActiveClipInteraction,
}: CompactShellSignals): boolean {
  const hasDetailBadges =
    hasKeyframes ||
    isBroken ||
    Math.abs(currentSpeed - 1) > SPEED_BADGE_EPSILON ||
    linkedSyncOffsetFrames !== null ||
    (item.type === 'shape' && (item.isMask ?? false))

  return activeTool === 'select' && isCompactWidth && !hasDetailBadges && !hasActiveClipInteraction
}

interface UseAudioVolumeEditLabelParams {
  skipFadeComputation: boolean
  audioVolumeEdit: AudioVolumeEditState | null
  audioVolumePreviewRef: MutableRefObject<number>
}

/**
 * Live volume readout. Reads the preview ref owned by the fade editors, so the
 * drag label tracks the pointer instead of the lagging store value.
 */
export function useAudioVolumeEditLabel({
  skipFadeComputation,
  audioVolumeEdit,
  audioVolumePreviewRef,
}: UseAudioVolumeEditLabelParams): string | null {
  return useMemo(() => {
    if (skipFadeComputation || !audioVolumeEdit) return null
    const previewVolume = audioVolumePreviewRef.current
    return `Volume ${previewVolume >= 0 ? '+' : ''}${previewVolume.toFixed(1)} dB`
  }, [skipFadeComputation, audioVolumeEdit, audioVolumePreviewRef])
}
