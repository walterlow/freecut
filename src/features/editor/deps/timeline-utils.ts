/**
 * Adapter exports for timeline utility dependencies.
 * Editor modules should import timeline utility helpers from here.
 */

export {
  createDefaultAdjustmentItem,
  createDefaultShapeItem,
  createDefaultTextItem,
  createTextTemplateItem,
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
  getDefaultGeneratedLayerDurationInFrames,
  getTrackKind,
  resolveEffectiveTrackStates,
  areFramesAligned,
  getMaxTransitionDurationForHandles,
  resolveTransitionTargetFromSelection,
  timelineToSourceFrames,
  sourceToTimelineFrames,
  linkItems,
} from './timeline-contract'
