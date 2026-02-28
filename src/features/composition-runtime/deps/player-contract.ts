/**
 * Adapter exports for player-layer dependencies.
 * Composition runtime modules should import player hooks/components from here.
 */

export {
  AbsoluteFill,
  Sequence,
  interpolate,
  useSequenceContext,
} from '@/features/player/composition';
export { VideoConfigProvider } from '@/features/player/VideoConfigProvider';
export { useVideoConfig } from '@/features/player/video-config-context';
export { useBridgedCurrentFrame, useBridgedIsPlaying } from '@/features/player/clock';
export { useClock } from '@/features/player/clock/clock-hooks';
export { useVideoSourcePool } from '@/features/player/video/VideoSourcePoolContext';
export { isVideoPoolAbortError } from '@/features/player/video/VideoSourcePool';
