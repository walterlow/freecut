export interface ScrubThrottleState {
  lastPointerX: number;
  lastPointerTimeMs: number;
  lastCommittedFrame: number;
  lastCommittedTimeMs: number;
}

interface CreateScrubThrottleStateParams {
  pointerX?: number;
  frame?: number;
  nowMs?: number;
}

interface ShouldCommitScrubFrameParams {
  state: ScrubThrottleState;
  pointerX: number;
  targetFrame: number;
  pixelsPerSecond: number;
  nowMs: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getVelocityMsBucket(velocityPxPerMs: number): number {
  if (velocityPxPerMs >= 2.2) return 14;
  if (velocityPxPerMs >= 1.2) return 10;
  if (velocityPxPerMs >= 0.7) return 6;
  if (velocityPxPerMs >= 0.35) return 3;
  return 0;
}

function getZoomMsBucket(pixelsPerSecond: number): number {
  if (pixelsPerSecond <= 45) return 8;
  if (pixelsPerSecond <= 80) return 5;
  if (pixelsPerSecond <= 140) return 2;
  return 0;
}

function getBypassFrameDelta(velocityPxPerMs: number, pixelsPerSecond: number): number {
  const zoomPenalty = pixelsPerSecond <= 45 ? 2 : pixelsPerSecond <= 80 ? 1 : 0;
  if (velocityPxPerMs >= 2.2) return 6 + zoomPenalty;
  if (velocityPxPerMs >= 1.2) return 4 + zoomPenalty;
  if (velocityPxPerMs >= 0.7) return 3 + zoomPenalty;
  return 2 + zoomPenalty;
}

export function createScrubThrottleState(
  params: CreateScrubThrottleStateParams = {}
): ScrubThrottleState {
  const pointerX = params.pointerX ?? 0;
  const frame = Math.round(params.frame ?? 0);
  const nowMs = params.nowMs ?? 0;
  return {
    lastPointerX: pointerX,
    lastPointerTimeMs: nowMs,
    lastCommittedFrame: frame,
    lastCommittedTimeMs: nowMs,
  };
}

export function shouldCommitScrubFrame({
  state,
  pointerX,
  targetFrame,
  pixelsPerSecond,
  nowMs,
}: ShouldCommitScrubFrameParams): boolean {
  const nextFrame = Math.round(targetFrame);
  const pointerDt = Math.max(1, nowMs - state.lastPointerTimeMs);
  const velocityPxPerMs = Math.abs(pointerX - state.lastPointerX) / pointerDt;

  state.lastPointerX = pointerX;
  state.lastPointerTimeMs = nowMs;

  const frameDelta = Math.abs(nextFrame - state.lastCommittedFrame);
  if (frameDelta === 0) return false;

  const minIntervalMs = clamp(
    getVelocityMsBucket(velocityPxPerMs) + getZoomMsBucket(pixelsPerSecond),
    0,
    18
  );
  const elapsedSinceCommit = nowMs - state.lastCommittedTimeMs;
  const bypassFrameDelta = getBypassFrameDelta(velocityPxPerMs, pixelsPerSecond);

  if (elapsedSinceCommit < minIntervalMs && frameDelta < bypassFrameDelta) {
    return false;
  }

  state.lastCommittedFrame = nextFrame;
  state.lastCommittedTimeMs = nowMs;
  return true;
}
