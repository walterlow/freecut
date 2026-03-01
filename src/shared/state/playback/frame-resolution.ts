import type { PlaybackState } from './types';

type FrameResolutionInput = Pick<
  PlaybackState,
  'currentFrame' | 'previewFrame' | 'isPlaying' | 'currentFrameEpoch' | 'previewFrameEpoch'
>;

/**
 * Resolve the frame that should drive preview-adjacent UI (gizmos, overlays, keyframe probes).
 *
 * Rules:
 * - Playing always follows currentFrame.
 * - If previewFrame is null, follow currentFrame.
 * - While paused, follow whichever source was updated most recently.
 */
export function getResolvedPlaybackFrame(input: FrameResolutionInput): number {
  if (input.isPlaying) return input.currentFrame;
  if (input.previewFrame === null) return input.currentFrame;
  return input.previewFrameEpoch >= input.currentFrameEpoch
    ? input.previewFrame
    : input.currentFrame;
}

