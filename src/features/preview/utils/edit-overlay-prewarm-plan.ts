import { getDirectionalPrewarmOffsets } from './fast-scrub-prewarm'

export interface CollectEditOverlayPrewarmTimesInput {
  targetTime: number
  duration: number
  fps: number
  previousAnchorFrame: number | null
  quantumSeconds: number
  maxTimestamps: number
  isCached?: (time: number) => boolean
}

export interface CollectEditOverlayPrewarmTimesResult {
  direction: -1 | 0 | 1
  targetFrame: number
  times: number[]
}

function quantizeTime(time: number, quantumSeconds: number): number {
  return Math.round(time / quantumSeconds) * quantumSeconds
}

export function collectEditOverlayDirectionalPrewarmTimes(
  input: CollectEditOverlayPrewarmTimesInput,
): CollectEditOverlayPrewarmTimesResult {
  const targetFrame = Math.max(0, Math.round(input.targetTime * input.fps))
  const direction: -1 | 0 | 1 =
    input.previousAnchorFrame === null || input.previousAnchorFrame === targetFrame
      ? 0
      : targetFrame > input.previousAnchorFrame
        ? 1
        : -1

  if (!Number.isFinite(input.duration) || input.duration <= 0 || input.fps <= 0) {
    return { direction, targetFrame, times: [] }
  }

  const maxFrame = Math.max(0, Math.floor(input.duration * input.fps) - 1)
  const offsets = getDirectionalPrewarmOffsets(direction)
  const times: number[] = []
  const seen = new Set<number>()
  const quantizedTargetTime = quantizeTime(input.targetTime, input.quantumSeconds)

  for (const offset of offsets) {
    const prewarmFrame = targetFrame + offset
    if (prewarmFrame < 0 || prewarmFrame > maxFrame) continue

    const prewarmTime = quantizeTime(prewarmFrame / input.fps, input.quantumSeconds)
    if (prewarmTime === quantizedTargetTime || seen.has(prewarmTime)) continue
    if (input.isCached?.(prewarmTime)) continue

    seen.add(prewarmTime)
    times.push(prewarmTime)

    if (times.length >= input.maxTimestamps) {
      break
    }
  }

  return {
    direction,
    targetFrame,
    times,
  }
}
