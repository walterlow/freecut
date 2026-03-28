/**
 * Adapter exports for keyframes dependencies.
 * Timeline modules should import keyframe components/utilities from here.
 */

export type { AutoKeyframeOperation } from '@/features/keyframes/utils/auto-keyframe';
export { resolveAnimatedTransform } from '@/features/keyframes/utils/animated-transform-resolver';
export { interpolatePropertyValue } from '@/features/keyframes/utils/interpolation';
export { getAnimatablePropertiesForItem } from '@/features/keyframes/utils/animatable-properties';
export {
  isFrameInTransitionRegion,
  getTransitionBlockedRanges,
} from '@/features/keyframes/utils/transition-region';
export { ValueGraphEditor } from '@/features/keyframes/components/value-graph-editor';
export { DopesheetEditor } from '@/features/keyframes/components/dopesheet-editor';
