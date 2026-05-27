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
import type { CropSettings } from '@/types/transform'
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

interface EqBandSpec {
  prefix: string
  freq?: { min: number; max: number; def: number }
  qDefault?: number
  hasEnabled?: boolean
  hasGain?: boolean
  hasSlope?: boolean
}

// EQ bands ordered low → high. Band1 and Band6 are full-featured aliases
// for the cut bands kept for legacy projects; LowCut and HighCut carry the
// enabled/freq/slope subset used by the simplified UI.
const EQ_BANDS: readonly EqBandSpec[] = [
  {
    prefix: 'audioEqBand1',
    hasEnabled: true,
    hasGain: true,
    hasSlope: true,
    qDefault: AUDIO_EQ_LOW_MID_Q,
    freq: {
      min: AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
      max: AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
      def: AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
    },
  },
  {
    prefix: 'audioEqLowCut',
    hasEnabled: true,
    hasSlope: true,
    freq: {
      min: AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
      max: AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
      def: AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
    },
  },
  {
    prefix: 'audioEqLow',
    hasEnabled: true,
    hasGain: true,
    qDefault: AUDIO_EQ_LOW_MID_Q,
    freq: {
      min: AUDIO_EQ_LOW_MIN_FREQUENCY_HZ,
      max: AUDIO_EQ_LOW_MAX_FREQUENCY_HZ,
      def: AUDIO_EQ_LOW_FREQUENCY_HZ,
    },
  },
  {
    prefix: 'audioEqLowMid',
    hasEnabled: true,
    hasGain: true,
    qDefault: AUDIO_EQ_LOW_MID_Q,
    freq: {
      min: AUDIO_EQ_LOW_MID_MIN_FREQUENCY_HZ,
      max: AUDIO_EQ_LOW_MID_MAX_FREQUENCY_HZ,
      def: AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
    },
  },
  { prefix: 'audioEqMid', hasGain: true },
  {
    prefix: 'audioEqHighMid',
    hasEnabled: true,
    hasGain: true,
    qDefault: AUDIO_EQ_HIGH_MID_Q,
    freq: {
      min: AUDIO_EQ_HIGH_MID_MIN_FREQUENCY_HZ,
      max: AUDIO_EQ_HIGH_MID_MAX_FREQUENCY_HZ,
      def: AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
    },
  },
  {
    prefix: 'audioEqHigh',
    hasEnabled: true,
    hasGain: true,
    qDefault: AUDIO_EQ_HIGH_MID_Q,
    freq: {
      min: AUDIO_EQ_HIGH_MIN_FREQUENCY_HZ,
      max: AUDIO_EQ_HIGH_MAX_FREQUENCY_HZ,
      def: AUDIO_EQ_HIGH_FREQUENCY_HZ,
    },
  },
  {
    prefix: 'audioEqBand6',
    hasEnabled: true,
    hasGain: true,
    hasSlope: true,
    qDefault: AUDIO_EQ_HIGH_MID_Q,
    freq: {
      min: AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
      max: AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
      def: AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
    },
  },
  {
    prefix: 'audioEqHighCut',
    hasEnabled: true,
    hasSlope: true,
    freq: {
      min: AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
      max: AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
      def: AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
    },
  },
]

interface FieldClamp {
  key: string
  clamp: (value: unknown) => unknown
}

function buildEqBandClamps(band: EqBandSpec): FieldClamp[] {
  const clamps: FieldClamp[] = []
  if (band.hasEnabled) {
    clamps.push({ key: `${band.prefix}Enabled`, clamp: (v) => !!v })
  }
  if (band.hasGain) {
    clamps.push({
      key: `${band.prefix}GainDb`,
      clamp: (v) => clampAudioEqGainDb(v as number),
    })
  }
  if (band.freq) {
    const { min, max, def } = band.freq
    clamps.push({
      key: `${band.prefix}FrequencyHz`,
      clamp: (v) => clampAudioEqFrequencyHz(v as number, min, max, def),
    })
  }
  if (band.qDefault !== undefined) {
    const qDef = band.qDefault
    clamps.push({ key: `${band.prefix}Q`, clamp: (v) => clampAudioEqQ(v as number, qDef) })
  }
  if (band.hasSlope) {
    clamps.push({
      key: `${band.prefix}SlopeDbPerOct`,
      clamp: (v) => clampAudioEqCutSlopeDbPerOct(v as number),
    })
  }
  return clamps
}

// Single source of truth for "if-defined-then-clamp" item field normalization.
// Both normalizeFrameFields and normalizeItemUpdates iterate this table.
const OPTIONAL_FIELD_CLAMPS: ReadonlyArray<FieldClamp> = [
  // Frame fields
  { key: 'trimStart', clamp: (v) => roundFrame(v as number) },
  { key: 'trimEnd', clamp: (v) => roundFrame(v as number) },
  { key: 'sourceStart', clamp: (v) => roundFrame(v as number) },
  { key: 'sourceEnd', clamp: (v) => roundFrame(v as number) },
  { key: 'sourceDuration', clamp: (v) => roundFrame(v as number) },
  { key: 'sourceFps', clamp: (v) => normalizeOptionalFps(v as number) },
  { key: 'crop', clamp: (v) => normalizeCropSettings(v as CropSettings) },
  // Audio fades
  { key: 'audioFadeInCurve', clamp: (v) => clampAudioFadeCurve(v as number) },
  { key: 'audioFadeOutCurve', clamp: (v) => clampAudioFadeCurve(v as number) },
  { key: 'audioFadeInCurveX', clamp: (v) => clampAudioFadeCurveX(v as number) },
  { key: 'audioFadeOutCurveX', clamp: (v) => clampAudioFadeCurveX(v as number) },
  // Pitch
  { key: 'audioPitchSemitones', clamp: (v) => clampAudioPitchSemitones(v as number) },
  { key: 'audioPitchCents', clamp: (v) => clampAudioPitchCents(v as number) },
  // EQ output + bands
  { key: 'audioEqOutputGainDb', clamp: (v) => clampAudioEqGainDb(v as number) },
  ...EQ_BANDS.flatMap(buildEqBandClamps),
]

function applyOptionalClamps(target: Record<string, unknown>): void {
  for (const { key, clamp } of OPTIONAL_FIELD_CLAMPS) {
    const current = target[key]
    if (current === undefined) continue
    target[key] = clamp(current)
  }
}

export function normalizeFrameFields<T extends TimelineItem>(item: T): T {
  // Start from a shallow copy so the optional-clamp loop can rewrite fields
  // in place without mutating the caller's object.
  const normalized = { ...item } as Record<string, unknown>
  normalized.from = roundFrame(item.from)
  normalized.durationInFrames = roundDuration(item.durationInFrames)
  applyOptionalClamps(normalized)

  const result = normalized as TimelineItem

  if (result.cornerPin) {
    const cornerPinTargetRect = resolveCornerPinTargetRect(
      result.transform?.width ?? 0,
      result.transform?.height ?? 0,
      result.type === 'video' || result.type === 'image'
        ? {
            sourceWidth: result.sourceWidth,
            sourceHeight: result.sourceHeight,
            crop: result.crop,
          }
        : undefined,
    )
    result.cornerPin = {
      ...result.cornerPin,
      referenceWidth:
        result.cornerPin.referenceWidth ??
        (cornerPinTargetRect.width > 0 ? cornerPinTargetRect.width : undefined),
      referenceHeight:
        result.cornerPin.referenceHeight ??
        (cornerPinTargetRect.height > 0 ? cornerPinTargetRect.height : undefined),
    }
  }

  if (result.type === 'shape' && result.isMask) {
    result.blendMode = 'normal'
  }

  // Legacy split clips can have sourceEnd without sourceStart.
  // Treat them as explicitly bounded from 0 to sourceEnd so rate stretch
  // operates on the split segment rather than the full media duration.
  if (
    (result.type === 'video' || result.type === 'audio') &&
    result.sourceEnd !== undefined &&
    result.sourceStart === undefined
  ) {
    result.sourceStart = 0
  }

  return result as T
}

export function normalizeItemUpdates(updates: Partial<TimelineItem>): Partial<TimelineItem> {
  const normalized = { ...updates } as Record<string, unknown>

  if (normalized.from !== undefined) normalized.from = roundFrame(normalized.from as number)
  if (normalized.durationInFrames !== undefined) {
    normalized.durationInFrames = roundDuration(normalized.durationInFrames as number)
  }

  applyOptionalClamps(normalized)

  // Keep legacy end-only bounds explicit and stable.
  if (normalized.sourceEnd !== undefined && normalized.sourceStart === undefined) {
    normalized.sourceStart = 0
  }

  return normalized as Partial<TimelineItem>
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
