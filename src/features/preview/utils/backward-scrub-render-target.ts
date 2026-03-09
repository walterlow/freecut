export interface BackwardScrubRenderTargetInput {
  targetFrame: number;
  nowMs: number;
  lastRequestedFrame: number | null;
  lastRenderAtMs: number;
  quantizeFrames: number;
  throttleMs: number;
  forceJumpFrames: number;
  requireExactFrame: boolean;
}

export interface BackwardScrubRenderTargetResult {
  nextRequestedFrame: number | null;
  nextLastRequestedFrame: number | null;
  nextLastRenderAtMs: number;
}

export function resolveBackwardScrubRenderTarget(
  input: BackwardScrubRenderTargetInput,
): BackwardScrubRenderTargetResult {
  if (input.requireExactFrame) {
    return {
      nextRequestedFrame: input.targetFrame,
      nextLastRequestedFrame: null,
      nextLastRenderAtMs: 0,
    };
  }

  const quantizedFrame = Math.floor(
    input.targetFrame / input.quantizeFrames
  ) * input.quantizeFrames;
  const withinThrottle = (
    (input.nowMs - input.lastRenderAtMs) < input.throttleMs
  );
  const jumpDistance = input.lastRequestedFrame === null
    ? Number.POSITIVE_INFINITY
    : Math.abs(quantizedFrame - input.lastRequestedFrame);

  if (withinThrottle && jumpDistance < input.forceJumpFrames) {
    return {
      nextRequestedFrame: null,
      nextLastRequestedFrame: input.lastRequestedFrame,
      nextLastRenderAtMs: input.lastRenderAtMs,
    };
  }

  return {
    nextRequestedFrame: quantizedFrame,
    nextLastRequestedFrame: quantizedFrame,
    nextLastRenderAtMs: input.nowMs,
  };
}
