export { deterministicIds, randomIds } from './ids.js';
export type { IdGenerator } from './ids.js';
export type {
  AdjustmentItem,
  AudioItem,
  Crop,
  FontStyle,
  FontWeight,
  GpuEffect,
  ImageItem,
  ItemEffect,
  ItemType,
  Marker,
  MediaReference,
  Project,
  ProjectResolution,
  ShapeItem,
  ShapeType,
  TextAlign,
  TextItem,
  TextShadow,
  TextStroke,
  Timeline,
  TimelineItemBase,
  TimelineItem,
  Track,
  Transform,
  Transition,
  VerticalAlign,
  VideoItem,
} from './project.js';
export {
  assertRenderMediaSources,
  collectMediaUsageFromItems,
  collectMediaUsageFromTracks,
  collectProjectMediaUsage,
  normalizeRenderMediaSources,
  planRenderMediaSources,
} from './media-plan.js';
export type {
  MediaItemLike,
  MediaTrackLike,
  MediaUsage,
  MediaUsageItem,
  MediaUsageOptions,
  RenderMediaSource,
  RenderMediaSourceInput,
  RenderMediaSourcePlan,
  RenderMediaSourcesInput,
} from './media-plan.js';
export { resolveRangeFrames, validateRangeFrames } from './range.js';
export type { FrameRange, RenderRangeInput } from './range.js';
export { planProjectRender, resolveProjectRenderRange } from './render-plan.js';
export type { ProjectRenderPlan, ProjectRenderPlanOptions } from './render-plan.js';
export {
  CORE_VERSION,
  SNAPSHOT_VERSION,
  SnapshotParseError,
  parseSnapshot,
  serializeSnapshot,
  toSnapshot,
} from './snapshot.js';
export type {
  MediaReferenceLike,
  ProjectLike,
  ProjectMetadataLike,
  ProjectSnapshot,
  ProjectTimelineLike,
  SnapshotEnvelope,
  SnapshotLike,
  SnapshotOptions,
  SnapshotSource,
} from './snapshot.js';
export { framesToSeconds, secondsToFrames } from './time.js';
export { calculateTransitionPortions, resolveTransitionWindows } from './transition-plan.js';
export type {
  ResolvedTransitionWindow,
  TimelineClipLike,
  TransitionLike,
  TransitionPortions,
} from './transition-plan.js';
export { lintSnapshot, validateSnapshot } from './validation.js';
