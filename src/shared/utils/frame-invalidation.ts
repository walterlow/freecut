export interface FrameRange {
  startFrame: number;
  endFrame: number;
}

export interface FrameInvalidationRequest {
  frames?: number[];
  ranges?: FrameRange[];
}

export function hasFrameInvalidation(request?: FrameInvalidationRequest): boolean {
  if (!request) return false;
  return (request.frames?.length ?? 0) > 0 || (request.ranges?.length ?? 0) > 0;
}

export function isFrameInRange(frame: number, range: FrameRange): boolean {
  return frame >= range.startFrame && frame < range.endFrame;
}

export function isFrameInRanges(frame: number, ranges: FrameRange[]): boolean {
  return ranges.some((range) => isFrameInRange(frame, range));
}

export function normalizeFrameRanges(ranges: FrameRange[]): FrameRange[] {
  const normalized = ranges
    .filter((range) => Number.isFinite(range.startFrame) && Number.isFinite(range.endFrame))
    .map((range) => ({
      startFrame: Math.trunc(range.startFrame),
      endFrame: Math.trunc(range.endFrame),
    }))
    .filter((range) => range.endFrame > range.startFrame)
    .sort((a, b) => a.startFrame - b.startFrame);

  if (normalized.length <= 1) return normalized;

  const merged: FrameRange[] = [normalized[0]!];
  for (let index = 1; index < normalized.length; index += 1) {
    const current = normalized[index]!;
    const previous = merged[merged.length - 1]!;
    if (current.startFrame <= previous.endFrame) {
      previous.endFrame = Math.max(previous.endFrame, current.endFrame);
      continue;
    }
    merged.push({ ...current });
  }

  return merged;
}
