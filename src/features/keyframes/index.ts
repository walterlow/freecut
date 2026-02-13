// Keyframes feature — public API
// Keyframe animation system with easing, interpolation, and graph editor

export {
  resolveAnimatedTransform,
  hasKeyframeAnimation,
} from './utils/animated-transform-resolver';
export { autoKeyframeProperty } from './utils/auto-keyframe';
export { getTransitionBlockedRanges, isFrameInTransitionRegion } from './utils/transition-region';
export { interpolatePropertyValue } from './utils/interpolation';
export {
  springEasing,
  cubicBezier,
} from './utils/easing';
