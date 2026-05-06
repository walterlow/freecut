export interface AudioPitchFieldSource {
  audioPitchSemitones?: number
  audioPitchCents?: number
}

export const AUDIO_PITCH_SEMITONES_MIN = -12
export const AUDIO_PITCH_SEMITONES_MAX = 12
export const AUDIO_PITCH_CENTS_MIN = -100
export const AUDIO_PITCH_CENTS_MAX = 100

const AUDIO_PITCH_ACTIVE_EPSILON = 0.0001

function normalizeAdditionalPitchShiftSemitones(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0
  return value ?? 0
}

export function clampAudioPitchSemitones(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(AUDIO_PITCH_SEMITONES_MIN, Math.min(AUDIO_PITCH_SEMITONES_MAX, Math.round(value)))
}

export function clampAudioPitchCents(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(AUDIO_PITCH_CENTS_MIN, Math.min(AUDIO_PITCH_CENTS_MAX, Math.round(value)))
}

export function hasAudioPitchOverride(source?: AudioPitchFieldSource | null): boolean {
  return source?.audioPitchSemitones !== undefined || source?.audioPitchCents !== undefined
}

export function getAudioPitchShiftSemitones(source?: AudioPitchFieldSource | null): number {
  if (!source) return 0
  return (
    clampAudioPitchSemitones(source.audioPitchSemitones ?? 0) +
    clampAudioPitchCents(source.audioPitchCents ?? 0) / 100
  )
}

export function resolvePreviewAudioPitchShiftSemitones(params: {
  base?: AudioPitchFieldSource | null
  preview?: AudioPitchFieldSource | null
  additionalSemitones?: number
}): number {
  const { base, preview, additionalSemitones } = params
  const resolvedLocalSemitones = hasAudioPitchOverride(preview)
    ? getAudioPitchShiftSemitones({
        audioPitchSemitones: preview?.audioPitchSemitones ?? base?.audioPitchSemitones,
        audioPitchCents: preview?.audioPitchCents ?? base?.audioPitchCents,
      })
    : getAudioPitchShiftSemitones(base)

  return normalizeAdditionalPitchShiftSemitones(additionalSemitones) + resolvedLocalSemitones
}

export function isAudioPitchShiftActive(semitones: number | undefined): boolean {
  return Math.abs(semitones ?? 0) > AUDIO_PITCH_ACTIVE_EPSILON
}

export function getAudioPitchRatioFromSemitones(semitones: number | undefined): number {
  const safeSemitones = normalizeAdditionalPitchShiftSemitones(semitones)
  return Math.pow(2, safeSemitones / 12)
}
