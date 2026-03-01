/**
 * Adapter exports for timeline dependencies.
 * Export modules should import timeline stores/services/utilities from here.
 */

export { useTimelineStore } from '@/features/timeline/stores/timeline-store';
export { useCompositionsStore } from '@/features/timeline/stores/compositions-store';
export { resolveEffectiveTrackStates } from '@/features/timeline/utils/group-utils';
export { timelineToSourceFrames } from '@/features/timeline/utils/source-calculations';
export { gifFrameCache, type CachedGifFrames } from '@/features/timeline/services/gif-frame-cache';
