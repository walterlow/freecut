/**
 * Adapter exports for timeline utility dependencies.
 * Editor modules should import timeline utility helpers from here.
 */

export {
  findNearestAvailableSpace,
  areFramesAligned,
  getMaxTransitionDurationForHandles,
  resolveTransitionTargetFromSelection,
  timelineToSourceFrames,
  sourceToTimelineFrames,
} from './timeline-contract';
