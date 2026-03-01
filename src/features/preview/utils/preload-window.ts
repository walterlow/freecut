import type { PreviewInteractionMode } from './preview-interaction-mode';

export interface PreloadWindowInput {
  mode: PreviewInteractionMode;
  anchorFrame: number;
  scrubDirection: -1 | 0 | 1;
  fps: number;
  aheadSeconds: number;
}

export interface PreloadWindowRange {
  startFrame: number;
  endFrame: number;
}

export function getPreloadWindowRange(input: PreloadWindowInput): PreloadWindowRange {
  const spanFrames = Math.max(1, Math.round(input.fps * input.aheadSeconds));

  if (input.mode !== 'scrubbing') {
    return {
      startFrame: input.anchorFrame,
      endFrame: input.anchorFrame + spanFrames,
    };
  }

  if (input.scrubDirection > 0) {
    return {
      startFrame: input.anchorFrame,
      endFrame: input.anchorFrame + spanFrames,
    };
  }

  if (input.scrubDirection < 0) {
    return {
      startFrame: input.anchorFrame - spanFrames,
      endFrame: input.anchorFrame,
    };
  }

  // Direction is unknown/steady: keep the scan centered on anchor.
  const halfSpan = Math.floor(spanFrames / 2);
  return {
    startFrame: input.anchorFrame - halfSpan,
    endFrame: input.anchorFrame + (spanFrames - halfSpan),
  };
}
