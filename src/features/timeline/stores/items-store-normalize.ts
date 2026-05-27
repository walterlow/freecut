import type { SubtitleSegmentItem, TimelineItem, TimelineTrack } from '@/types/timeline'
import { clampAudioFadeCurve, clampAudioFadeCurveX } from '@/shared/utils/audio-fade-curve'
import {
  AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_MIN_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_Q,
  AUDIO_EQ_HIGH_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_Q,
  AUDIO_EQ_LOW_MIN_FREQUENCY_HZ,
  clampAudioEqCutSlopeDbPerOct,
  clampAudioEqFrequencyHz,
  clampAudioEqGainDb,
  clampAudioEqQ,
  normalizeAudioEqSettings,
} from '@/shared/utils/audio-eq'
import { normalizeCropSettings } from '@/shared/utils/media-crop'
import { clampAudioPitchCents, clampAudioPitchSemitones } from '@/shared/utils/audio-pitch'
import { resolveCornerPinTargetRect } from '@/features/timeline/deps/composition-runtime'

export function roundFrame(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.round(value))
}

export function roundDuration(value: number, fallback = 1): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.round(value))
}

export function roundOptionalFrame(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  return roundFrame(value)
}

export function normalizeOptionalFps(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined
  return Math.round(value * 1000) / 1000
}

export function normalizeFrameFields<T extends TimelineItem>(item: T): T {
  const normalized = {
    ...item,
    from: roundFrame(item.from),
    durationInFrames: roundDuration(item.durationInFrames),
    trimStart: roundOptionalFrame(item.trimStart),
    trimEnd: roundOptionalFrame(item.trimEnd),
    sourceStart: roundOptionalFrame(item.sourceStart),
    sourceEnd: roundOptionalFrame(item.sourceEnd),
    sourceDuration: roundOptionalFrame(item.sourceDuration),
    sourceFps: normalizeOptionalFps(item.sourceFps),
    crop: normalizeCropSettings(item.crop),
    audioFadeInCurve:
      item.audioFadeInCurve === undefined ? undefined : clampAudioFadeCurve(item.audioFadeInCurve),
    audioFadeOutCurve:
      item.audioFadeOutCurve === undefined
        ? undefined
        : clampAudioFadeCurve(item.audioFadeOutCurve),
    audioFadeInCurveX:
      item.audioFadeInCurveX === undefined
        ? undefined
        : clampAudioFadeCurveX(item.audioFadeInCurveX),
    audioFadeOutCurveX:
      item.audioFadeOutCurveX === undefined
        ? undefined
        : clampAudioFadeCurveX(item.audioFadeOutCurveX),
    audioPitchSemitones:
      item.audioPitchSemitones === undefined
        ? undefined
        : clampAudioPitchSemitones(item.audioPitchSemitones),
    audioPitchCents:
      item.audioPitchCents === undefined ? undefined : clampAudioPitchCents(item.audioPitchCents),
    audioEqOutputGainDb:
      item.audioEqOutputGainDb === undefined
        ? undefined
        : clampAudioEqGainDb(item.audioEqOutputGainDb),
    audioEqBand1Enabled:
      item.audioEqBand1Enabled === undefined ? undefined : !!item.audioEqBand1Enabled,
    audioEqBand1Type: item.audioEqBand1Type,
    audioEqBand1FrequencyHz:
      item.audioEqBand1FrequencyHz === undefined
        ? undefined
        : clampAudioEqFrequencyHz(
            item.audioEqBand1FrequencyHz,
            AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
            AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
            AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
          ),
    audioEqBand1GainDb:
      item.audioEqBand1GainDb === undefined
        ? undefined
        : clampAudioEqGainDb(item.audioEqBand1GainDb),
    audioEqBand1Q:
      item.audioEqBand1Q === undefined
        ? undefined
        : clampAudioEqQ(item.audioEqBand1Q, AUDIO_EQ_LOW_MID_Q),
    audioEqBand1SlopeDbPerOct:
      item.audioEqBand1SlopeDbPerOct === undefined
        ? undefined
        : clampAudioEqCutSlopeDbPerOct(item.audioEqBand1SlopeDbPerOct),
    audioEqLowCutEnabled:
      item.audioEqLowCutEnabled === undefined ? undefined : !!item.audioEqLowCutEnabled,
    audioEqLowCutFrequencyHz:
      item.audioEqLowCutFrequencyHz === undefined
        ? undefined
        : clampAudioEqFrequencyHz(
            item.audioEqLowCutFrequencyHz,
            AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
            AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
            AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
          ),
    audioEqLowCutSlopeDbPerOct:
      item.audioEqLowCutSlopeDbPerOct === undefined
        ? undefined
        : clampAudioEqCutSlopeDbPerOct(item.audioEqLowCutSlopeDbPerOct),
    audioEqLowEnabled: item.audioEqLowEnabled === undefined ? undefined : !!item.audioEqLowEnabled,
    audioEqLowType: item.audioEqLowType,
    audioEqLowGainDb:
      item.audioEqLowGainDb === undefined ? undefined : clampAudioEqGainDb(item.audioEqLowGainDb),
    audioEqLowFrequencyHz:
      item.audioEqLowFrequencyHz === undefined
        ? undefined
        : clampAudioEqFrequencyHz(
            item.audioEqLowFrequencyHz,
            AUDIO_EQ_LOW_MIN_FREQUENCY_HZ,
            AUDIO_EQ_LOW_MAX_FREQUENCY_HZ,
            AUDIO_EQ_LOW_FREQUENCY_HZ,
          ),
    audioEqLowQ:
      item.audioEqLowQ === undefined
        ? undefined
        : clampAudioEqQ(item.audioEqLowQ, AUDIO_EQ_LOW_MID_Q),
    audioEqLowMidEnabled:
      item.audioEqLowMidEnabled === undefined ? undefined : !!item.audioEqLowMidEnabled,
    audioEqLowMidType: item.audioEqLowMidType,
    audioEqLowMidGainDb:
      item.audioEqLowMidGainDb === undefined
        ? undefined
        : clampAudioEqGainDb(item.audioEqLowMidGainDb),
    audioEqLowMidFrequencyHz:
      item.audioEqLowMidFrequencyHz === undefined
        ? undefined
        : clampAudioEqFrequencyHz(
            item.audioEqLowMidFrequencyHz,
            AUDIO_EQ_LOW_MID_MIN_FREQUENCY_HZ,
            AUDIO_EQ_LOW_MID_MAX_FREQUENCY_HZ,
            AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
          ),
    audioEqLowMidQ:
      item.audioEqLowMidQ === undefined
        ? undefined
        : clampAudioEqQ(item.audioEqLowMidQ, AUDIO_EQ_LOW_MID_Q),
    audioEqMidGainDb:
      item.audioEqMidGainDb === undefined ? undefined : clampAudioEqGainDb(item.audioEqMidGainDb),
    audioEqHighMidEnabled:
      item.audioEqHighMidEnabled === undefined ? undefined : !!item.audioEqHighMidEnabled,
    audioEqHighMidType: item.audioEqHighMidType,
    audioEqHighMidGainDb:
      item.audioEqHighMidGainDb === undefined
        ? undefined
        : clampAudioEqGainDb(item.audioEqHighMidGainDb),
    audioEqHighMidFrequencyHz:
      item.audioEqHighMidFrequencyHz === undefined
        ? undefined
        : clampAudioEqFrequencyHz(
            item.audioEqHighMidFrequencyHz,
            AUDIO_EQ_HIGH_MID_MIN_FREQUENCY_HZ,
            AUDIO_EQ_HIGH_MID_MAX_FREQUENCY_HZ,
            AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
          ),
    audioEqHighMidQ:
      item.audioEqHighMidQ === undefined
        ? undefined
        : clampAudioEqQ(item.audioEqHighMidQ, AUDIO_EQ_HIGH_MID_Q),
    audioEqHighEnabled:
      item.audioEqHighEnabled === undefined ? undefined : !!item.audioEqHighEnabled,
    audioEqHighType: item.audioEqHighType,
    audioEqHighGainDb:
      item.audioEqHighGainDb === undefined ? undefined : clampAudioEqGainDb(item.audioEqHighGainDb),
    audioEqHighFrequencyHz:
      item.audioEqHighFrequencyHz === undefined
        ? undefined
        : clampAudioEqFrequencyHz(
            item.audioEqHighFrequencyHz,
            AUDIO_EQ_HIGH_MIN_FREQUENCY_HZ,
            AUDIO_EQ_HIGH_MAX_FREQUENCY_HZ,
            AUDIO_EQ_HIGH_FREQUENCY_HZ,
          ),
    audioEqHighQ:
      item.audioEqHighQ === undefined
        ? undefined
        : clampAudioEqQ(item.audioEqHighQ, AUDIO_EQ_HIGH_MID_Q),
    audioEqBand6Enabled:
      item.audioEqBand6Enabled === undefined ? undefined : !!item.audioEqBand6Enabled,
    audioEqBand6Type: item.audioEqBand6Type,
    audioEqBand6FrequencyHz:
      item.audioEqBand6FrequencyHz === undefined
        ? undefined
        : clampAudioEqFrequencyHz(
            item.audioEqBand6FrequencyHz,
            AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
            AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
            AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
          ),
    audioEqBand6GainDb:
      item.audioEqBand6GainDb === undefined
        ? undefined
        : clampAudioEqGainDb(item.audioEqBand6GainDb),
    audioEqBand6Q:
      item.audioEqBand6Q === undefined
        ? undefined
        : clampAudioEqQ(item.audioEqBand6Q, AUDIO_EQ_HIGH_MID_Q),
    audioEqBand6SlopeDbPerOct:
      item.audioEqBand6SlopeDbPerOct === undefined
        ? undefined
        : clampAudioEqCutSlopeDbPerOct(item.audioEqBand6SlopeDbPerOct),
    audioEqHighCutEnabled:
      item.audioEqHighCutEnabled === undefined ? undefined : !!item.audioEqHighCutEnabled,
    audioEqHighCutFrequencyHz:
      item.audioEqHighCutFrequencyHz === undefined
        ? undefined
        : clampAudioEqFrequencyHz(
            item.audioEqHighCutFrequencyHz,
            AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
            AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
            AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
          ),
    audioEqHighCutSlopeDbPerOct:
      item.audioEqHighCutSlopeDbPerOct === undefined
        ? undefined
        : clampAudioEqCutSlopeDbPerOct(item.audioEqHighCutSlopeDbPerOct),
  }

  if (normalized.cornerPin) {
    const cornerPinTargetRect = resolveCornerPinTargetRect(
      normalized.transform?.width ?? 0,
      normalized.transform?.height ?? 0,
      normalized.type === 'video' || normalized.type === 'image'
        ? {
            sourceWidth: normalized.sourceWidth,
            sourceHeight: normalized.sourceHeight,
            crop: normalized.crop,
          }
        : undefined,
    )
    normalized.cornerPin = {
      ...normalized.cornerPin,
      referenceWidth:
        normalized.cornerPin.referenceWidth ??
        (cornerPinTargetRect.width > 0 ? cornerPinTargetRect.width : undefined),
      referenceHeight:
        normalized.cornerPin.referenceHeight ??
        (cornerPinTargetRect.height > 0 ? cornerPinTargetRect.height : undefined),
    }
  }

  if (normalized.type === 'shape' && normalized.isMask) {
    normalized.blendMode = 'normal'
  }

  // Legacy split clips can have sourceEnd without sourceStart.
  // Treat them as explicitly bounded from 0 to sourceEnd so rate stretch
  // operates on the split segment rather than the full media duration.
  if (
    (normalized.type === 'video' || normalized.type === 'audio') &&
    normalized.sourceEnd !== undefined &&
    normalized.sourceStart === undefined
  ) {
    normalized.sourceStart = 0
  }

  return normalized as T
}

export function normalizeItemUpdates(updates: Partial<TimelineItem>): Partial<TimelineItem> {
  const normalized = { ...updates } as Partial<TimelineItem>

  if (normalized.from !== undefined) normalized.from = roundFrame(normalized.from)
  if (normalized.durationInFrames !== undefined)
    normalized.durationInFrames = roundDuration(normalized.durationInFrames)
  if (normalized.trimStart !== undefined) normalized.trimStart = roundFrame(normalized.trimStart)
  if (normalized.trimEnd !== undefined) normalized.trimEnd = roundFrame(normalized.trimEnd)
  if (normalized.sourceStart !== undefined)
    normalized.sourceStart = roundFrame(normalized.sourceStart)
  if (normalized.sourceEnd !== undefined) normalized.sourceEnd = roundFrame(normalized.sourceEnd)
  if (normalized.sourceDuration !== undefined)
    normalized.sourceDuration = roundFrame(normalized.sourceDuration)
  if (normalized.sourceFps !== undefined)
    normalized.sourceFps = normalizeOptionalFps(normalized.sourceFps)
  if (normalized.crop !== undefined) normalized.crop = normalizeCropSettings(normalized.crop)

  // Keep legacy end-only bounds explicit and stable.
  if (normalized.sourceEnd !== undefined && normalized.sourceStart === undefined) {
    normalized.sourceStart = 0
  }

  if (normalized.audioFadeInCurve !== undefined) {
    normalized.audioFadeInCurve = clampAudioFadeCurve(normalized.audioFadeInCurve)
  }
  if (normalized.audioFadeOutCurve !== undefined) {
    normalized.audioFadeOutCurve = clampAudioFadeCurve(normalized.audioFadeOutCurve)
  }
  if (normalized.audioFadeInCurveX !== undefined) {
    normalized.audioFadeInCurveX = clampAudioFadeCurveX(normalized.audioFadeInCurveX)
  }
  if (normalized.audioFadeOutCurveX !== undefined) {
    normalized.audioFadeOutCurveX = clampAudioFadeCurveX(normalized.audioFadeOutCurveX)
  }
  if (normalized.audioPitchSemitones !== undefined) {
    normalized.audioPitchSemitones = clampAudioPitchSemitones(normalized.audioPitchSemitones)
  }
  if (normalized.audioPitchCents !== undefined) {
    normalized.audioPitchCents = clampAudioPitchCents(normalized.audioPitchCents)
  }
  if (normalized.audioEqOutputGainDb !== undefined) {
    normalized.audioEqOutputGainDb = clampAudioEqGainDb(normalized.audioEqOutputGainDb)
  }
  if (normalized.audioEqBand1Enabled !== undefined) {
    normalized.audioEqBand1Enabled = !!normalized.audioEqBand1Enabled
  }
  if (normalized.audioEqBand1FrequencyHz !== undefined) {
    normalized.audioEqBand1FrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqBand1FrequencyHz,
      AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
      AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
      AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
    )
  }
  if (normalized.audioEqBand1GainDb !== undefined) {
    normalized.audioEqBand1GainDb = clampAudioEqGainDb(normalized.audioEqBand1GainDb)
  }
  if (normalized.audioEqBand1Q !== undefined) {
    normalized.audioEqBand1Q = clampAudioEqQ(normalized.audioEqBand1Q, AUDIO_EQ_LOW_MID_Q)
  }
  if (normalized.audioEqBand1SlopeDbPerOct !== undefined) {
    normalized.audioEqBand1SlopeDbPerOct = clampAudioEqCutSlopeDbPerOct(
      normalized.audioEqBand1SlopeDbPerOct,
    )
  }
  if (normalized.audioEqLowCutEnabled !== undefined) {
    normalized.audioEqLowCutEnabled = !!normalized.audioEqLowCutEnabled
  }
  if (normalized.audioEqLowCutFrequencyHz !== undefined) {
    normalized.audioEqLowCutFrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqLowCutFrequencyHz,
      AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
      AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
      AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
    )
  }
  if (normalized.audioEqLowCutSlopeDbPerOct !== undefined) {
    normalized.audioEqLowCutSlopeDbPerOct = clampAudioEqCutSlopeDbPerOct(
      normalized.audioEqLowCutSlopeDbPerOct,
    )
  }
  if (normalized.audioEqLowEnabled !== undefined) {
    normalized.audioEqLowEnabled = !!normalized.audioEqLowEnabled
  }
  if (normalized.audioEqLowGainDb !== undefined) {
    normalized.audioEqLowGainDb = clampAudioEqGainDb(normalized.audioEqLowGainDb)
  }
  if (normalized.audioEqLowFrequencyHz !== undefined) {
    normalized.audioEqLowFrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqLowFrequencyHz,
      AUDIO_EQ_LOW_MIN_FREQUENCY_HZ,
      AUDIO_EQ_LOW_MAX_FREQUENCY_HZ,
      AUDIO_EQ_LOW_FREQUENCY_HZ,
    )
  }
  if (normalized.audioEqLowQ !== undefined) {
    normalized.audioEqLowQ = clampAudioEqQ(normalized.audioEqLowQ, AUDIO_EQ_LOW_MID_Q)
  }
  if (normalized.audioEqLowMidEnabled !== undefined) {
    normalized.audioEqLowMidEnabled = !!normalized.audioEqLowMidEnabled
  }
  if (normalized.audioEqLowMidGainDb !== undefined) {
    normalized.audioEqLowMidGainDb = clampAudioEqGainDb(normalized.audioEqLowMidGainDb)
  }
  if (normalized.audioEqLowMidFrequencyHz !== undefined) {
    normalized.audioEqLowMidFrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqLowMidFrequencyHz,
      AUDIO_EQ_LOW_MID_MIN_FREQUENCY_HZ,
      AUDIO_EQ_LOW_MID_MAX_FREQUENCY_HZ,
      AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
    )
  }
  if (normalized.audioEqLowMidQ !== undefined) {
    normalized.audioEqLowMidQ = clampAudioEqQ(normalized.audioEqLowMidQ, AUDIO_EQ_LOW_MID_Q)
  }
  if (normalized.audioEqMidGainDb !== undefined) {
    normalized.audioEqMidGainDb = clampAudioEqGainDb(normalized.audioEqMidGainDb)
  }
  if (normalized.audioEqHighMidEnabled !== undefined) {
    normalized.audioEqHighMidEnabled = !!normalized.audioEqHighMidEnabled
  }
  if (normalized.audioEqHighMidGainDb !== undefined) {
    normalized.audioEqHighMidGainDb = clampAudioEqGainDb(normalized.audioEqHighMidGainDb)
  }
  if (normalized.audioEqHighMidFrequencyHz !== undefined) {
    normalized.audioEqHighMidFrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqHighMidFrequencyHz,
      AUDIO_EQ_HIGH_MID_MIN_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_MID_MAX_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
    )
  }
  if (normalized.audioEqHighMidQ !== undefined) {
    normalized.audioEqHighMidQ = clampAudioEqQ(normalized.audioEqHighMidQ, AUDIO_EQ_HIGH_MID_Q)
  }
  if (normalized.audioEqHighEnabled !== undefined) {
    normalized.audioEqHighEnabled = !!normalized.audioEqHighEnabled
  }
  if (normalized.audioEqHighGainDb !== undefined) {
    normalized.audioEqHighGainDb = clampAudioEqGainDb(normalized.audioEqHighGainDb)
  }
  if (normalized.audioEqHighFrequencyHz !== undefined) {
    normalized.audioEqHighFrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqHighFrequencyHz,
      AUDIO_EQ_HIGH_MIN_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_MAX_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_FREQUENCY_HZ,
    )
  }
  if (normalized.audioEqHighQ !== undefined) {
    normalized.audioEqHighQ = clampAudioEqQ(normalized.audioEqHighQ, AUDIO_EQ_HIGH_MID_Q)
  }
  if (normalized.audioEqBand6Enabled !== undefined) {
    normalized.audioEqBand6Enabled = !!normalized.audioEqBand6Enabled
  }
  if (normalized.audioEqBand6FrequencyHz !== undefined) {
    normalized.audioEqBand6FrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqBand6FrequencyHz,
      AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
    )
  }
  if (normalized.audioEqBand6GainDb !== undefined) {
    normalized.audioEqBand6GainDb = clampAudioEqGainDb(normalized.audioEqBand6GainDb)
  }
  if (normalized.audioEqBand6Q !== undefined) {
    normalized.audioEqBand6Q = clampAudioEqQ(normalized.audioEqBand6Q, AUDIO_EQ_HIGH_MID_Q)
  }
  if (normalized.audioEqBand6SlopeDbPerOct !== undefined) {
    normalized.audioEqBand6SlopeDbPerOct = clampAudioEqCutSlopeDbPerOct(
      normalized.audioEqBand6SlopeDbPerOct,
    )
  }
  if (normalized.audioEqHighCutEnabled !== undefined) {
    normalized.audioEqHighCutEnabled = !!normalized.audioEqHighCutEnabled
  }
  if (normalized.audioEqHighCutFrequencyHz !== undefined) {
    normalized.audioEqHighCutFrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqHighCutFrequencyHz,
      AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
    )
  }
  if (normalized.audioEqHighCutSlopeDbPerOct !== undefined) {
    normalized.audioEqHighCutSlopeDbPerOct = clampAudioEqCutSlopeDbPerOct(
      normalized.audioEqHighCutSlopeDbPerOct,
    )
  }

  return normalized
}

export function normalizeTrack(track: TimelineTrack): TimelineTrack {
  return {
    ...track,
    volume: track.volume === undefined ? undefined : Math.max(-60, Math.min(12, track.volume)),
    audioEq: normalizeAudioEqSettings(track.audioEq),
  }
}

/**
 * Trim a subtitle segment from its start: re-anchor every cue's time so the
 * new `from` becomes 0, dropping cues entirely before the new boundary and
 * clamping cues that straddle it.
 *
 * `clampedAmount` is in timeline frames — positive means trimming inward.
 */
export function trimSubtitleCuesAtStart(
  item: SubtitleSegmentItem,
  clampedAmount: number,
  timelineFps: number,
): { cues: SubtitleSegmentItem['cues'] } | null {
  if (clampedAmount === 0) return null
  const offsetSeconds = clampedAmount / timelineFps
  const nextCues: SubtitleSegmentItem['cues'] = []
  for (const cue of item.cues) {
    if (cue.endSeconds <= offsetSeconds) continue // entirely outside new window
    const startSeconds = Math.max(0, cue.startSeconds - offsetSeconds)
    const endSeconds = cue.endSeconds - offsetSeconds
    if (endSeconds <= startSeconds) continue
    nextCues.push({ ...cue, startSeconds, endSeconds })
  }
  return { cues: nextCues }
}

/**
 * Trim a subtitle segment from its end: drop cues past the new duration and
 * clamp cues that straddle the boundary.
 */
export function trimSubtitleCuesAtEnd(
  item: SubtitleSegmentItem,
  newDurationFrames: number,
  timelineFps: number,
): { cues: SubtitleSegmentItem['cues'] } | null {
  const newEndSeconds = newDurationFrames / timelineFps
  const nextCues: SubtitleSegmentItem['cues'] = []
  for (const cue of item.cues) {
    if (cue.startSeconds >= newEndSeconds) continue
    const endSeconds = Math.min(cue.endSeconds, newEndSeconds)
    if (endSeconds <= cue.startSeconds) continue
    nextCues.push({ ...cue, endSeconds })
  }
  return { cues: nextCues }
}
