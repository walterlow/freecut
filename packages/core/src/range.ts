export interface RenderRangeInput {
  inFrame?: number;
  outFrame?: number;
  startFrame?: number;
  endFrame?: number;
  durationInFrames?: number;
  startSeconds?: number;
  endSeconds?: number;
  durationSeconds?: number;
}

export interface FrameRange {
  inFrame: number;
  outFrame: number;
}

export function resolveRangeFrames(range: RenderRangeInput, fps: number): FrameRange {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError(`fps must be a positive number, got ${fps}`);
  }

  const startFrame = firstDefined(
    range.inFrame,
    range.startFrame,
    range.startSeconds === undefined ? undefined : Math.round(range.startSeconds * fps),
  ) ?? 0;
  const outFrame = firstDefined(
    range.outFrame,
    range.endFrame,
    range.endSeconds === undefined ? undefined : Math.round(range.endSeconds * fps),
    range.durationInFrames === undefined ? undefined : startFrame + range.durationInFrames,
    range.durationSeconds === undefined ? undefined : startFrame + Math.round(range.durationSeconds * fps),
  );

  if (outFrame === undefined) {
    throw new Error('render range requires outFrame, endFrame, endSeconds, durationInFrames, or durationSeconds');
  }

  return validateRangeFrames(startFrame, outFrame);
}

export function validateRangeFrames(inFrame: number, outFrame: number): FrameRange {
  if (!Number.isInteger(inFrame) || inFrame < 0) {
    throw new RangeError(`inFrame must be a non-negative integer, got ${inFrame}`);
  }
  if (!Number.isInteger(outFrame) || outFrame <= 0) {
    throw new RangeError(`outFrame must be a positive integer, got ${outFrame}`);
  }
  if (inFrame >= outFrame) {
    throw new RangeError(`inFrame must be before outFrame, got ${inFrame} >= ${outFrame}`);
  }
  return { inFrame, outFrame };
}

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined);
}
