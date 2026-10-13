/**
 * Adapter exports for timeline utility dependencies.
 * Editor modules should import timeline utility helpers from here.
 */

export { createClassicTrack, getTrackKind } from '@/features/timeline/utils/classic-tracks'
export {
  createDefaultAdjustmentItem,
  createDefaultGradientItem,
  createDefaultShapeItem,
  createDefaultSolidColorItem,
  createTextTemplateItem,
  getDefaultGeneratedLayerDurationInFrames,
} from '@/features/timeline/utils/generated-layer-items'
export { createOverlayLayerTrack } from '@/features/timeline/utils/new-track-zone-media'
export {
  createScrubThrottleState,
  shouldCommitScrubFrame,
} from '@/features/timeline/utils/scrub-throttle'
export { findCompatibleTrackForItemType } from '@/features/timeline/utils/track-item-compatibility'
export { findNearestAvailableSpace } from '@/features/timeline/utils/collision-utils'
export { resolveEffectiveTrackStates } from '@/features/timeline/utils/group-utils'
export { getMaxTransitionDurationForHandles } from '@/features/timeline/utils/transition-utils'
export { resolveTransitionTargetFromSelection } from '@/features/timeline/utils/transition-targets'
export { searchTimelineTranscript } from '@/features/timeline/utils/transcript-search'
export type { TranscriptSearchMatch } from '@/features/timeline/utils/transcript-search'
export {
  timelineToSourceFrames,
  sourceToTimelineFrames,
} from '@/features/timeline/utils/source-calculations'
export { linkItems } from '@/features/timeline/stores/actions/item-actions'
