/**
 * Adapter exports for timeline utility dependencies.
 * Editor modules should import timeline utility helpers from here.
 */

export {
  createDefaultAdjustmentItem,
  createDefaultShapeItem,
  createDefaultTextItem,
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
  getDefaultGeneratedLayerDurationInFrames,
  getTrackKind,
  resolveEffectiveTrackStates,
  areFramesAligned,
  getMaxTransitionDurationForHandles,
  getTransitionAlignmentMode,
  getTransitionAlignmentOptions,
  resolveTransitionTargetFromSelection,
  timelineToSourceFrames,
  sourceToTimelineFrames,
  linkItems,
} from './timeline-contract';
export type { TransitionAlignmentMode } from './timeline-contract';
