import type { PlaybackState } from './types';

type FrameResolutionInput = Pick<
  PlaybackState,
  'currentFrame' | 'previewFrame' | 'displayedFrame' | 'isPlaying'
>;

/**
 * Resolve the frame that should drive preview-adjacent UI (gizmos, overlays, keyframe probes).
 *
 * Rules:
 * - Playing always follows currentFrame.
 * - When renderer surface is visible, follow displayedFrame to stay in sync
 *   with what is actually on screen.
 * - While paused without a visible renderer frame, follow previewFrame when present.
 * - Otherwise fall back to currentFrame.
 */
export function getResolvedPlaybackFrame(input: FrameResolutionInput): number {
  if (input.isPlaying) return input.currentFrame;
  if (input.displayedFrame !== null) return input.displayedFrame;
  if (input.previewFrame !== null) return input.previewFrame;
  return input.currentFrame;
}
