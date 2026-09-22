import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import type { AnimatableProperty, PropertyKeyframes } from '@/types/keyframe'
import type { SceneDetectionMethod, VerificationModel } from '@/features/timeline/deps/analysis'
import { usePlaybackStore } from '@/shared/state/playback'
import type { CaptionDialogState } from './use-caption-dialog-state'
import type { ItemContextMenuProps } from './item-context-menu'

export type TimelineItemContextMenuProps = Omit<ItemContextMenuProps, 'children'>

export interface TimelineItemContextMenuParams {
  item: TimelineItemType
  trackLocked: boolean
  isBroken: boolean
  isSelected: boolean
  hasSpeakableText: boolean
  hasGeneratedCaptions: boolean
  keyframedProperties: PropertyKeyframes[]
  closerEdge: 'left' | 'right' | null
  hasJoinableLeft: boolean
  hasJoinableRight: boolean
  reverseMenuShowsUnreverse: boolean
  isRemovingFillers: boolean
  isCompositionItem: boolean
  isSceneDetectionActive: boolean
  caption: CaptionDialogState
  getCanJoinSelected: () => boolean
  getCanLinkSelected: () => boolean
  getCanUnlinkSelected: () => boolean
  handleJoinSelected: () => void
  handleJoinLeft: () => void
  handleJoinRight: () => void
  handleLinkSelected: () => void
  handleUnlinkSelected: () => void
  handleClearAllKeyframes: () => void
  handleClearPropertyKeyframes: (property: AnimatableProperty) => void
  handleBentoLayout: () => void
  handleReverseSelected: () => void
  handleFreezeFrame: () => void
  handleGenerateAudioFromText: () => void
  handleRemoveSilence: () => void
  handleRemoveFillers: () => void
  handleCreatePreComp: () => void
  handleEnterComposition: () => void
  handleDissolveComposition: () => void
  handleDetectScenes: (method: SceneDetectionMethod, verificationModel?: VerificationModel) => void
  handleRippleDelete: () => void
  handleDelete: () => void
}

/**
 * Every capability flag the item context menu needs, derived from the item
 * type, media state, selection and the item's action callbacks.
 */
export function buildTimelineItemContextMenuProps({
  item,
  trackLocked,
  isBroken,
  isSelected,
  hasSpeakableText,
  hasGeneratedCaptions,
  keyframedProperties,
  closerEdge,
  hasJoinableLeft,
  hasJoinableRight,
  reverseMenuShowsUnreverse,
  isRemovingFillers,
  isCompositionItem,
  isSceneDetectionActive,
  caption,
  getCanJoinSelected,
  getCanLinkSelected,
  getCanUnlinkSelected,
  handleJoinSelected,
  handleJoinLeft,
  handleJoinRight,
  handleLinkSelected,
  handleUnlinkSelected,
  handleClearAllKeyframes,
  handleClearPropertyKeyframes,
  handleBentoLayout,
  handleReverseSelected,
  handleFreezeFrame,
  handleGenerateAudioFromText,
  handleRemoveSilence,
  handleRemoveFillers,
  handleCreatePreComp,
  handleEnterComposition,
  handleDissolveComposition,
  handleDetectScenes,
  handleRippleDelete,
  handleDelete,
}: TimelineItemContextMenuParams): TimelineItemContextMenuProps {
  return {
    trackLocked,
    joinActions: {
      canJoinSelected: getCanJoinSelected(),
      hasJoinableLeft,
      hasJoinableRight,
      closerEdge,
      onJoinSelected: handleJoinSelected,
      onJoinLeft: handleJoinLeft,
      onJoinRight: handleJoinRight,
    },
    linkActions: {
      canLinkSelected: getCanLinkSelected(),
      canUnlinkSelected: getCanUnlinkSelected(),
      onLinkSelected: handleLinkSelected,
      onUnlinkSelected: handleUnlinkSelected,
    },
    keyframeActions: {
      keyframedProperties,
      onClearAllKeyframes: handleClearAllKeyframes,
      onClearPropertyKeyframes: handleClearPropertyKeyframes,
    },
    layoutActions: {
      onBentoLayout: handleBentoLayout,
    },
    mediaActions: {
      canReverse: item.type === 'video' || item.type === 'audio',
      isReversed: reverseMenuShowsUnreverse,
      onReverse: handleReverseSelected,
      isVideoItem: item.type === 'video',
      // Deliberate render-time, non-reactive read: the menu only opens on a
      // user gesture, so subscribing here would re-render every item on scrub.
      playheadInBounds: (() => {
        const frame = usePlaybackStore.getState().currentFrame
        return frame > item.from && frame < item.from + item.durationInFrames
      })(),
      onFreezeFrame: handleFreezeFrame,
      isTextItem: item.type === 'text' && hasSpeakableText,
      onGenerateAudioFromText: handleGenerateAudioFromText,
      canRemoveSilence:
        (item.type === 'video' || item.type === 'audio') && !!item.mediaId && !isBroken,
      onRemoveSilence: handleRemoveSilence,
      canRemoveFillers:
        (item.type === 'video' || item.type === 'audio') && !!item.mediaId && !isBroken,
      isRemovingFillers,
      onRemoveFillers: handleRemoveFillers,
    },
    captionActions: {
      canManageCaptions: caption.canManageCaptions,
      hasCaptions: hasGeneratedCaptions,
      isGeneratingCaptions:
        caption.transcriptStatus === 'queued' || caption.transcriptStatus === 'transcribing',
      onOpenCaptionDialog: caption.openDialog,
      canExtractEmbeddedSubtitles: caption.canExtractEmbeddedSubtitles,
      onExtractEmbeddedSubtitles: caption.handleExtractEmbeddedSubtitles,
      canConsolidateCaptionsToSegment: caption.hasConsolidatablePerCueCaptions,
      onConsolidateCaptionsToSegment: caption.handleConsolidateCaptionsToSegment,
    },
    compositionActions: {
      isCompositionItem,
      onEnterComposition: handleEnterComposition,
      onDissolveComposition: handleDissolveComposition,
      canCreatePreComp: isSelected,
      onCreatePreComp: handleCreatePreComp,
    },
    sceneDetectionActions: {
      canDetectScenes: item.type === 'video' && !!item.mediaId && !isBroken,
      isDetectingScenes: isSceneDetectionActive,
      onDetectScenes: handleDetectScenes,
    },
    destructiveActions: {
      isSelected,
      onRippleDelete: handleRippleDelete,
      onDelete: handleDelete,
    },
  }
}
