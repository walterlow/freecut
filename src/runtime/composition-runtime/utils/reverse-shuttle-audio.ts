export const REVERSE_SHUTTLE_GRAIN_OUTPUT_SECONDS = 0.08
export const REVERSE_SHUTTLE_LOOKAHEAD_SECONDS = 0.16
export const REVERSE_SHUTTLE_GRAIN_FADE_SECONDS = 0.008

export interface ReverseShuttleGrainPlan {
  sourceStartSeconds: number
  sourceDurationSeconds: number
  playbackRate: number
  reverseSamples: boolean
  nextSourceCursorSeconds: number
}

export function resolveReverseShuttleGrainPlan(params: {
  sourceCursorSeconds: number
  authoredPlaybackRate: number
  transportPlaybackRate: number
  authoredReversed: boolean
  bufferStartSeconds: number
  bufferDurationSeconds: number
  outputDurationSeconds?: number
}): ReverseShuttleGrainPlan | null {
  const outputDuration = params.outputDurationSeconds ?? REVERSE_SHUTTLE_GRAIN_OUTPUT_SECONDS
  const playbackRate = Math.max(
    0.0625,
    Math.min(16, Math.abs(params.authoredPlaybackRate * params.transportPlaybackRate)),
  )
  const sourceDuration = outputDuration * playbackRate
  const bufferEnd = params.bufferStartSeconds + params.bufferDurationSeconds
  const sourceDirection = params.authoredReversed ? 1 : -1
  const sourceStart =
    sourceDirection < 0 ? params.sourceCursorSeconds - sourceDuration : params.sourceCursorSeconds
  const sourceEnd = sourceStart + sourceDuration

  if (
    !Number.isFinite(sourceStart) ||
    sourceStart < params.bufferStartSeconds ||
    sourceEnd > bufferEnd ||
    sourceDuration <= 0
  ) {
    return null
  }

  return {
    sourceStartSeconds: sourceStart,
    sourceDurationSeconds: sourceDuration,
    playbackRate,
    reverseSamples: sourceDirection < 0,
    nextSourceCursorSeconds: params.sourceCursorSeconds + sourceDirection * sourceDuration,
  }
}

export function copyShuttleGrainSamples(
  source: Float32Array,
  target: Float32Array,
  sourceStartSample: number,
  reverseSamples: boolean,
): void {
  const maxSourceIndex = source.length - 1
  for (let index = 0; index < target.length; index += 1) {
    const sourceIndex = reverseSamples
      ? sourceStartSample + target.length - 1 - index
      : sourceStartSample + index
    target[index] = source[Math.max(0, Math.min(maxSourceIndex, sourceIndex))] ?? 0
  }
}
