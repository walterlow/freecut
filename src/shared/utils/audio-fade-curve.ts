export const AUDIO_FADE_CURVE_MIN = -1
export const AUDIO_FADE_CURVE_MAX = 1
export const AUDIO_FADE_CURVE_X_MIN = 0.04
export const AUDIO_FADE_CURVE_X_MAX = 0.96
export const AUDIO_FADE_CURVE_X_DEFAULT = 0.52

const AUDIO_FADE_CURVE_SOLVE_EPSILON = 0.0001
const AUDIO_FADE_CURVE_MAX_EXPONENT = 12

export interface AudioClipFadeSpan {
  startFrame: number
  durationInFrames: number
  fadeInFrames?: number
  fadeOutFrames?: number
  fadeInCurve?: number
  fadeOutCurve?: number
  fadeInCurveX?: number
  fadeOutCurveX?: number
}

export function clampAudioFadeCurve(curve: number | undefined): number {
  const value = typeof curve === 'number' && Number.isFinite(curve) ? curve : 0
  return Math.max(
    AUDIO_FADE_CURVE_MIN,
    Math.min(AUDIO_FADE_CURVE_MAX, Math.round(value * 100) / 100),
  )
}

export function clampAudioFadeCurveX(curveX: number | undefined): number {
  const value =
    typeof curveX === 'number' && Number.isFinite(curveX) ? curveX : AUDIO_FADE_CURVE_X_DEFAULT
  return Math.max(
    AUDIO_FADE_CURVE_X_MIN,
    Math.min(AUDIO_FADE_CURVE_X_MAX, Math.round(value * 1000) / 1000),
  )
}

function getFadeInControlY(curve: number | undefined, curveX: number | undefined): number {
  const normalizedX = clampAudioFadeCurveX(curveX)
  const normalizedCurve = clampAudioFadeCurve(curve)
  const linearY = normalizedX
  const upwardRange = 1 - linearY
  const downwardRange = linearY
  return normalizedCurve >= 0
    ? linearY + normalizedCurve * upwardRange
    : linearY + normalizedCurve * downwardRange
}

function getFadeOutControlY(curve: number | undefined, curveX: number | undefined): number {
  const normalizedX = clampAudioFadeCurveX(curveX)
  const normalizedCurve = clampAudioFadeCurve(curve)
  const linearY = 1 - normalizedX
  const upwardRange = 1 - linearY
  const downwardRange = linearY
  return normalizedCurve >= 0
    ? linearY + normalizedCurve * upwardRange
    : linearY + normalizedCurve * downwardRange
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function clampUnitForSolve(value: number): number {
  return Math.max(
    AUDIO_FADE_CURVE_SOLVE_EPSILON,
    Math.min(1 - AUDIO_FADE_CURVE_SOLVE_EPSILON, value),
  )
}

function solvePowerExponent(base: number, target: number): number {
  const exponent = Math.log(clampUnitForSolve(target)) / Math.log(clampUnitForSolve(base))

  if (!Number.isFinite(exponent)) {
    return AUDIO_FADE_CURVE_MAX_EXPONENT
  }

  return Math.max(1, Math.min(AUDIO_FADE_CURVE_MAX_EXPONENT, exponent))
}

function evaluatePowerCurve(progress: number, exponent: number): number {
  return Math.pow(clampUnit(progress), exponent)
}

export function evaluateAudioFadeInCurve(
  progress: number,
  curve: number | undefined,
  curveX?: number,
): number {
  const normalizedProgress = clampUnit(progress)
  const pointX = clampAudioFadeCurveX(curveX)
  const pointY = getFadeInControlY(curve, curveX)

  if (Math.abs(pointY - pointX) <= AUDIO_FADE_CURVE_SOLVE_EPSILON) {
    return normalizedProgress
  }

  if (pointY > pointX) {
    const exponent = solvePowerExponent(1 - pointX, 1 - pointY)
    return 1 - evaluatePowerCurve(1 - normalizedProgress, exponent)
  }

  const exponent = solvePowerExponent(pointX, pointY)
  return evaluatePowerCurve(normalizedProgress, exponent)
}

export function evaluateAudioFadeOutCurve(
  progress: number,
  curve: number | undefined,
  curveX?: number,
): number {
  const normalizedProgress = clampUnit(progress)
  const pointX = clampAudioFadeCurveX(curveX)
  const pointY = getFadeOutControlY(curve, curveX)
  const linearY = 1 - pointX

  if (Math.abs(pointY - linearY) <= AUDIO_FADE_CURVE_SOLVE_EPSILON) {
    return 1 - normalizedProgress
  }

  if (pointY > linearY) {
    const exponent = solvePowerExponent(pointX, 1 - pointY)
    return 1 - evaluatePowerCurve(normalizedProgress, exponent)
  }

  const exponent = solvePowerExponent(1 - pointX, pointY)
  return evaluatePowerCurve(1 - normalizedProgress, exponent)
}

interface AudioFadeMultiplierOptions {
  frame: number
  durationInFrames: number
  fadeInFrames?: number
  fadeOutFrames?: number
  contentStartOffsetFrames?: number
  contentEndOffsetFrames?: number
  fadeInDelayFrames?: number
  fadeOutLeadFrames?: number
  fadeInCurve?: number
  fadeOutCurve?: number
  fadeInCurveX?: number
  fadeOutCurveX?: number
  useEqualPower?: boolean
}

export function getAudioFadeMultiplier({
  frame,
  durationInFrames,
  fadeInFrames = 0,
  fadeOutFrames = 0,
  contentStartOffsetFrames = 0,
  contentEndOffsetFrames = 0,
  fadeInDelayFrames = 0,
  fadeOutLeadFrames = 0,
  fadeInCurve = 0,
  fadeOutCurve = 0,
  fadeInCurveX = AUDIO_FADE_CURVE_X_DEFAULT,
  fadeOutCurveX = AUDIO_FADE_CURVE_X_DEFAULT,
  useEqualPower = false,
}: AudioFadeMultiplierOptions): number {
  const clampedFadeInFrames = Math.min(Math.max(0, fadeInFrames), durationInFrames)
  const clampedFadeOutFrames = Math.min(Math.max(0, fadeOutFrames), durationInFrames)
  const baseContentStart = Math.max(0, Math.min(contentStartOffsetFrames, durationInFrames))
  const baseContentEnd = Math.max(
    0,
    Math.min(contentEndOffsetFrames, durationInFrames - baseContentStart),
  )
  const clampedFadeInDelay = Math.max(0, fadeInDelayFrames)
  const clampedFadeOutLead = Math.max(0, fadeOutLeadFrames)
  const clampedContentStart = Math.max(
    0,
    Math.min(baseContentStart + clampedFadeInDelay, durationInFrames),
  )
  const clampedContentEnd = Math.max(
    0,
    Math.min(baseContentEnd + clampedFadeOutLead, durationInFrames - clampedContentStart),
  )
  const contentDuration = Math.max(0, durationInFrames - clampedContentStart - clampedContentEnd)
  const contentFrame = frame - clampedContentStart
  const hasFadeIn = clampedFadeInFrames > 0
  const hasFadeOut = clampedFadeOutFrames > 0

  if (!hasFadeIn && !hasFadeOut) {
    return 1
  }

  const fadeOutStart = contentDuration - clampedFadeOutFrames

  if (useEqualPower) {
    if (hasFadeIn && frame < clampedFadeInFrames) {
      const progress = frame / Math.max(clampedFadeInFrames, 1)
      return Math.sin((progress * Math.PI) / 2)
    }

    if (hasFadeOut && frame >= durationInFrames - clampedFadeOutFrames) {
      const progress =
        (frame - (durationInFrames - clampedFadeOutFrames)) / Math.max(clampedFadeOutFrames, 1)
      return Math.cos((progress * Math.PI) / 2)
    }

    return 1
  }

  if (hasFadeIn && hasFadeOut) {
    if (contentFrame < 0 || contentFrame > contentDuration) return 0

    if (clampedFadeInFrames >= fadeOutStart) {
      const midPoint = contentDuration / 2
      const peakVolume = Math.min(1, midPoint / Math.max(clampedFadeInFrames, 1))
      if (contentFrame <= midPoint) {
        return (contentFrame / Math.max(midPoint, 1)) * peakVolume
      }
      return (
        ((contentDuration - contentFrame) / Math.max(contentDuration - midPoint, 1)) * peakVolume
      )
    }

    if (contentFrame < clampedFadeInFrames) {
      return evaluateAudioFadeInCurve(contentFrame / clampedFadeInFrames, fadeInCurve, fadeInCurveX)
    }

    if (contentFrame >= fadeOutStart) {
      return evaluateAudioFadeOutCurve(
        (contentFrame - fadeOutStart) / clampedFadeOutFrames,
        fadeOutCurve,
        fadeOutCurveX,
      )
    }

    return 1
  }

  if (hasFadeIn) {
    if (contentFrame < 0) return 0
    if (contentFrame >= clampedFadeInFrames) return 1
    return evaluateAudioFadeInCurve(contentFrame / clampedFadeInFrames, fadeInCurve, fadeInCurveX)
  }

  if (contentFrame <= fadeOutStart) return 1
  if (contentFrame > contentDuration) return 0
  return evaluateAudioFadeOutCurve(
    (contentFrame - fadeOutStart) / clampedFadeOutFrames,
    fadeOutCurve,
    fadeOutCurveX,
  )
}

export function getAudioClipFadeMultiplier(
  frame: number,
  fadeSpans: AudioClipFadeSpan[] | undefined,
): number {
  if (!fadeSpans || fadeSpans.length === 0) {
    return 1
  }

  const activeSpan = fadeSpans.find(
    (span) => frame >= span.startFrame && frame < span.startFrame + span.durationInFrames,
  )
  if (!activeSpan) {
    return 1
  }

  return getAudioFadeMultiplier({
    frame: frame - activeSpan.startFrame,
    durationInFrames: activeSpan.durationInFrames,
    fadeInFrames: activeSpan.fadeInFrames,
    fadeOutFrames: activeSpan.fadeOutFrames,
    fadeInCurve: activeSpan.fadeInCurve,
    fadeOutCurve: activeSpan.fadeOutCurve,
    fadeInCurveX: activeSpan.fadeInCurveX,
    fadeOutCurveX: activeSpan.fadeOutCurveX,
  })
}
