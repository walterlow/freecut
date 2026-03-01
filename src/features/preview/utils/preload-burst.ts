import type { PreviewInteractionMode } from './preview-interaction-mode';

export type PreloadBurstTrigger = 'none' | 'scrub_enter' | 'paused_short_seek';

export const PRELOAD_SHORT_SEEK_THRESHOLD_SECONDS = 1.5;

export function isShortSeekFrameDelta(
  frameDelta: number,
  fps: number,
  thresholdSeconds = PRELOAD_SHORT_SEEK_THRESHOLD_SECONDS
): boolean {
  if (frameDelta <= 0) return false;
  const thresholdFrames = Math.max(8, Math.round(fps * thresholdSeconds));
  return frameDelta <= thresholdFrames;
}

export function getPreloadBurstTrigger(input: {
  interactionMode: PreviewInteractionMode;
  prevInteractionMode: PreviewInteractionMode;
  currentFrame: number;
  prevCurrentFrame: number;
  fps: number;
}): PreloadBurstTrigger {
  if (
    input.interactionMode === 'scrubbing'
    && input.prevInteractionMode !== 'scrubbing'
  ) {
    return 'scrub_enter';
  }

  if (
    input.interactionMode !== 'playing'
    && input.interactionMode !== 'scrubbing'
    && input.currentFrame !== input.prevCurrentFrame
    && isShortSeekFrameDelta(
      Math.abs(input.currentFrame - input.prevCurrentFrame),
      input.fps
    )
  ) {
    return 'paused_short_seek';
  }

  return 'none';
}
