/**
 * Adapter exports for composition-runtime dependencies.
 * Preview modules should import composition-runtime modules from here.
 */

export { MainComposition } from '@/features/composition-runtime/compositions/main-composition';
export {
  resolveTransform,
  getSourceDimensions,
} from '@/features/composition-runtime/utils/transform-resolver';
export {
  applyTransformOverride,
  resolveItemTransformAtFrame,
  resolveItemTransformAtRelativeFrame,
  resolveActiveShapeMasksAtFrame,
} from '@/features/composition-runtime/utils/frame-scene';
export { expandTextTransformToFitContent } from '@/features/composition-runtime/utils/text-layout';
export { getBestDomVideoElementForItem } from '@/features/composition-runtime/utils/dom-video-element-registry';
export { getVideoTargetTimeSeconds } from '@/features/composition-runtime/utils/video-timing';
export {
  transitionSafePlay,
  muteTransitionElement,
  unmuteTransitionElement,
  ensureAudioContextResumed,
} from '@/features/composition-runtime/components/video-audio-context';
export { ensureBufferedAudioContextResumed } from '@/features/composition-runtime/components/custom-decoder-audio-context';
export { ensurePitchCorrectedAudioContextResumed } from '@/features/composition-runtime/components/pitch-corrected-audio-context';
