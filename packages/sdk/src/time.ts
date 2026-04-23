/**
 * Time helpers. FreeCut stores positions in project-fps *frames* — agents
 * usually think in seconds. These helpers do the conversion safely.
 */

export function secondsToFrames(seconds: number, fps: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(`seconds must be a non-negative finite number, got ${seconds}`);
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError(`fps must be a positive finite number, got ${fps}`);
  }
  return Math.round(seconds * fps);
}

export function framesToSeconds(frames: number, fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError(`fps must be a positive finite number, got ${fps}`);
  }
  return frames / fps;
}
