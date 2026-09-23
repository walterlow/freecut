import type {
  AudioEqBand1Type,
  AudioEqBand6Type,
  AudioEqCutSlopeDbPerOct,
  AudioEqInnerBandType,
  ResolvedAudioEqSettings,
} from '@/types/audio'
import {
  AUDIO_EQ_GAIN_DB_MAX,
  AUDIO_EQ_GAIN_DB_MIN,
  AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_Q,
  AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
  AUDIO_EQ_LOW_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_Q,
  getAudioEqPresetById,
  type AudioEqPresetId,
} from '@/shared/utils/audio-eq'
import { getMixedValue } from '../utils/mixed-value'
import {
  getAudioEqControlRangeById,
  inferAudioEqControlRangeId,
  type AudioEqControlRangeId,
} from './audio-eq-ui'
import type { AudioEqPatch } from './audio-eq-curve-editor'

/** A displayed EQ value the whole selection agrees on, or `'mixed'`. */
export type AudioEqDisplayValue<TValue> = TValue | 'mixed'

/**
 * Every band field the panel shows, resolved once per selection so the band
 * cards and the compact rows read the same snapshot.
 */
export type AudioEqDisplayValues = {
  outputGainDb: AudioEqDisplayValue<number>
  band1Enabled: AudioEqDisplayValue<boolean>
  band1Type: AudioEqDisplayValue<AudioEqBand1Type>
  band1FrequencyHz: AudioEqDisplayValue<number>
  band1GainDb: AudioEqDisplayValue<number>
  band1Q: AudioEqDisplayValue<number>
  band1SlopeDbPerOct: AudioEqDisplayValue<AudioEqCutSlopeDbPerOct>
  lowEnabled: AudioEqDisplayValue<boolean>
  lowType: AudioEqDisplayValue<AudioEqInnerBandType>
  lowGainDb: AudioEqDisplayValue<number>
  lowFrequencyHz: AudioEqDisplayValue<number>
  lowQ: AudioEqDisplayValue<number>
  lowMidEnabled: AudioEqDisplayValue<boolean>
  lowMidType: AudioEqDisplayValue<AudioEqInnerBandType>
  lowMidGainDb: AudioEqDisplayValue<number>
  lowMidFrequencyHz: AudioEqDisplayValue<number>
  lowMidQ: AudioEqDisplayValue<number>
  highMidEnabled: AudioEqDisplayValue<boolean>
  highMidType: AudioEqDisplayValue<AudioEqInnerBandType>
  highMidGainDb: AudioEqDisplayValue<number>
  highMidFrequencyHz: AudioEqDisplayValue<number>
  highMidQ: AudioEqDisplayValue<number>
  highEnabled: AudioEqDisplayValue<boolean>
  highType: AudioEqDisplayValue<AudioEqInnerBandType>
  highGainDb: AudioEqDisplayValue<number>
  highFrequencyHz: AudioEqDisplayValue<number>
  highQ: AudioEqDisplayValue<number>
  band6Enabled: AudioEqDisplayValue<boolean>
  band6Type: AudioEqDisplayValue<AudioEqBand6Type>
  band6FrequencyHz: AudioEqDisplayValue<number>
  band6GainDb: AudioEqDisplayValue<number>
  band6Q: AudioEqDisplayValue<number>
  band6SlopeDbPerOct: AudioEqDisplayValue<AudioEqCutSlopeDbPerOct>
}

/**
 * Resolves one EQ display value with live-preview priority: live patch edits
 * win, then track settings, then the mixed multi-clip value.
 * `resolveAudioEqSettings` always fills every field, so a present track object
 * never falls through to the mixed value. Key pairings below are moved
 * verbatim from the previous inline expressions.
 */
function resolveEqDisplayValue<TValue>(
  livePatch: AudioEqPatch | null,
  liveKey: keyof AudioEqPatch,
  resolvedTrackEq: ResolvedAudioEqSettings | null,
  trackKey: keyof ResolvedAudioEqSettings,
  itemSettings: ResolvedAudioEqSettings[],
  getItemValue: (item: ResolvedAudioEqSettings) => TValue | undefined,
  fallback: TValue,
) {
  const liveValue = livePatch?.[liveKey] as unknown as TValue | undefined
  const trackValue = resolvedTrackEq?.[trackKey] as unknown as TValue | undefined
  return liveValue ?? trackValue ?? getMixedValue(itemSettings, getItemValue, fallback)
}

/** Resolves every displayed band field for the current selection. */
export function resolveEqDisplayValues(
  livePatch: AudioEqPatch | null,
  resolvedTrackEq: ResolvedAudioEqSettings | null,
  itemSettings: ResolvedAudioEqSettings[],
): AudioEqDisplayValues {
  return {
    outputGainDb: resolveEqDisplayValue(
      livePatch,
      'audioEqOutputGainDb',
      resolvedTrackEq,
      'outputGainDb',
      itemSettings,
      (item) => item.outputGainDb,
      0,
    ),
    band1Enabled: resolveEqDisplayValue(
      livePatch,
      'audioEqBand1Enabled',
      resolvedTrackEq,
      'band1Enabled',
      itemSettings,
      (item) => item.band1Enabled,
      false,
    ),
    band1Type: resolveEqDisplayValue(
      livePatch,
      'audioEqBand1Type',
      resolvedTrackEq,
      'band1Type',
      itemSettings,
      (item) => item.band1Type,
      'high-pass',
    ),
    band1FrequencyHz: resolveEqDisplayValue(
      livePatch,
      'audioEqBand1FrequencyHz',
      resolvedTrackEq,
      'band1FrequencyHz',
      itemSettings,
      (item) => item.band1FrequencyHz,
      AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
    ),
    band1GainDb: resolveEqDisplayValue(
      livePatch,
      'audioEqBand1GainDb',
      resolvedTrackEq,
      'band1GainDb',
      itemSettings,
      (item) => item.band1GainDb,
      0,
    ),
    band1Q: resolveEqDisplayValue(
      livePatch,
      'audioEqBand1Q',
      resolvedTrackEq,
      'band1Q',
      itemSettings,
      (item) => item.band1Q,
      AUDIO_EQ_LOW_MID_Q,
    ),
    band1SlopeDbPerOct: resolveEqDisplayValue(
      livePatch,
      'audioEqBand1SlopeDbPerOct',
      resolvedTrackEq,
      'band1SlopeDbPerOct',
      itemSettings,
      (item) => item.band1SlopeDbPerOct,
      12,
    ),
    lowEnabled: resolveEqDisplayValue(
      livePatch,
      'audioEqLowEnabled',
      resolvedTrackEq,
      'lowEnabled',
      itemSettings,
      (item) => item.lowEnabled,
      true,
    ),
    lowType: resolveEqDisplayValue(
      livePatch,
      'audioEqLowType',
      resolvedTrackEq,
      'lowType',
      itemSettings,
      (item) => item.lowType,
      'low-shelf',
    ),
    lowGainDb: resolveEqDisplayValue(
      livePatch,
      'audioEqLowGainDb',
      resolvedTrackEq,
      'lowGainDb',
      itemSettings,
      (item) => item.lowGainDb,
      0,
    ),
    lowFrequencyHz: resolveEqDisplayValue(
      livePatch,
      'audioEqLowFrequencyHz',
      resolvedTrackEq,
      'lowFrequencyHz',
      itemSettings,
      (item) => item.lowFrequencyHz,
      AUDIO_EQ_LOW_FREQUENCY_HZ,
    ),
    lowQ: resolveEqDisplayValue(
      livePatch,
      'audioEqLowQ',
      resolvedTrackEq,
      'lowQ',
      itemSettings,
      (item) => item.lowQ,
      AUDIO_EQ_LOW_MID_Q,
    ),
    lowMidEnabled: resolveEqDisplayValue(
      livePatch,
      'audioEqLowMidEnabled',
      resolvedTrackEq,
      'lowMidEnabled',
      itemSettings,
      (item) => item.lowMidEnabled,
      true,
    ),
    lowMidType: resolveEqDisplayValue(
      livePatch,
      'audioEqLowMidType',
      resolvedTrackEq,
      'lowMidType',
      itemSettings,
      (item) => item.lowMidType,
      'peaking',
    ),
    lowMidGainDb: resolveEqDisplayValue(
      livePatch,
      'audioEqLowMidGainDb',
      resolvedTrackEq,
      'lowMidGainDb',
      itemSettings,
      (item) => item.lowMidGainDb,
      0,
    ),
    lowMidFrequencyHz: resolveEqDisplayValue(
      livePatch,
      'audioEqLowMidFrequencyHz',
      resolvedTrackEq,
      'lowMidFrequencyHz',
      itemSettings,
      (item) => item.lowMidFrequencyHz,
      AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
    ),
    lowMidQ: resolveEqDisplayValue(
      livePatch,
      'audioEqLowMidQ',
      resolvedTrackEq,
      'lowMidQ',
      itemSettings,
      (item) => item.lowMidQ,
      AUDIO_EQ_LOW_MID_Q,
    ),
    highMidEnabled: resolveEqDisplayValue(
      livePatch,
      'audioEqHighMidEnabled',
      resolvedTrackEq,
      'highMidEnabled',
      itemSettings,
      (item) => item.highMidEnabled,
      true,
    ),
    highMidType: resolveEqDisplayValue(
      livePatch,
      'audioEqHighMidType',
      resolvedTrackEq,
      'highMidType',
      itemSettings,
      (item) => item.highMidType,
      'peaking',
    ),
    highMidGainDb: resolveEqDisplayValue(
      livePatch,
      'audioEqHighMidGainDb',
      resolvedTrackEq,
      'highMidGainDb',
      itemSettings,
      (item) => item.highMidGainDb,
      0,
    ),
    highMidFrequencyHz: resolveEqDisplayValue(
      livePatch,
      'audioEqHighMidFrequencyHz',
      resolvedTrackEq,
      'highMidFrequencyHz',
      itemSettings,
      (item) => item.highMidFrequencyHz,
      AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
    ),
    highMidQ: resolveEqDisplayValue(
      livePatch,
      'audioEqHighMidQ',
      resolvedTrackEq,
      'highMidQ',
      itemSettings,
      (item) => item.highMidQ,
      AUDIO_EQ_HIGH_MID_Q,
    ),
    highEnabled: resolveEqDisplayValue(
      livePatch,
      'audioEqHighEnabled',
      resolvedTrackEq,
      'highEnabled',
      itemSettings,
      (item) => item.highEnabled,
      true,
    ),
    highType: resolveEqDisplayValue(
      livePatch,
      'audioEqHighType',
      resolvedTrackEq,
      'highType',
      itemSettings,
      (item) => item.highType,
      'high-shelf',
    ),
    highGainDb: resolveEqDisplayValue(
      livePatch,
      'audioEqHighGainDb',
      resolvedTrackEq,
      'highGainDb',
      itemSettings,
      (item) => item.highGainDb,
      0,
    ),
    highFrequencyHz: resolveEqDisplayValue(
      livePatch,
      'audioEqHighFrequencyHz',
      resolvedTrackEq,
      'highFrequencyHz',
      itemSettings,
      (item) => item.highFrequencyHz,
      AUDIO_EQ_HIGH_FREQUENCY_HZ,
    ),
    highQ: resolveEqDisplayValue(
      livePatch,
      'audioEqHighQ',
      resolvedTrackEq,
      'highQ',
      itemSettings,
      (item) => item.highQ,
      AUDIO_EQ_HIGH_MID_Q,
    ),
    band6Enabled: resolveEqDisplayValue(
      livePatch,
      'audioEqBand6Enabled',
      resolvedTrackEq,
      'band6Enabled',
      itemSettings,
      (item) => item.band6Enabled,
      false,
    ),
    band6Type: resolveEqDisplayValue(
      livePatch,
      'audioEqBand6Type',
      resolvedTrackEq,
      'band6Type',
      itemSettings,
      (item) => item.band6Type,
      'low-pass',
    ),
    band6FrequencyHz: resolveEqDisplayValue(
      livePatch,
      'audioEqBand6FrequencyHz',
      resolvedTrackEq,
      'band6FrequencyHz',
      itemSettings,
      (item) => item.band6FrequencyHz,
      AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
    ),
    band6GainDb: resolveEqDisplayValue(
      livePatch,
      'audioEqBand6GainDb',
      resolvedTrackEq,
      'band6GainDb',
      itemSettings,
      (item) => item.band6GainDb,
      0,
    ),
    band6Q: resolveEqDisplayValue(
      livePatch,
      'audioEqBand6Q',
      resolvedTrackEq,
      'band6Q',
      itemSettings,
      (item) => item.band6Q,
      AUDIO_EQ_HIGH_MID_Q,
    ),
    band6SlopeDbPerOct: resolveEqDisplayValue(
      livePatch,
      'audioEqBand6SlopeDbPerOct',
      resolvedTrackEq,
      'band6SlopeDbPerOct',
      itemSettings,
      (item) => item.band6SlopeDbPerOct,
      12,
    ),
  }
}

/** True while any displayed field disagrees across the selection. */
export function hasMixedEqDisplayValues(values: AudioEqDisplayValues): boolean {
  for (const value of Object.values(values)) {
    if (value === 'mixed') return true
  }
  return false
}

/** Preset dropdown placeholder: mixed selection, matched preset, or custom. */
export function getEqPresetPlaceholder(
  hasMixedEqValues: boolean,
  selectedPresetId: AudioEqPresetId | null,
): string {
  if (hasMixedEqValues) return 'Mixed'
  if (!selectedPresetId) return 'Custom'
  return getAudioEqPresetById(selectedPresetId)?.label ?? 'Custom'
}

/** Mixed selections and a disabled EQ both freeze every band control. */
export function getEqControlsDisabled(
  hasMixedEqValues: boolean,
  isCompactLayout: boolean,
  eqEnabled: boolean,
  clipEqEnabled: boolean,
): boolean {
  if (hasMixedEqValues) return true
  return isCompactLayout ? !clipEqEnabled : !eqEnabled
}

/** Frequency axis label: compact `1.4K` above 1 kHz, whole hertz below. */
export function formatFrequencyRangeLabel(frequencyHz: number): string {
  if (frequencyHz >= 1000) {
    return `${(frequencyHz / 1000).toFixed(1)}K`
  }
  return `${Math.round(frequencyHz)}`
}

/** Which control range a gain band's frequency currently falls in. */
export function getEffectiveGainBandControlRangeId(
  selectedRangeId: AudioEqControlRangeId,
  frequencyHz: number | 'mixed',
  preferredRangeId: AudioEqControlRangeId,
): AudioEqControlRangeId {
  if (frequencyHz === 'mixed') return preferredRangeId
  const selectedRange = getAudioEqControlRangeById(selectedRangeId)
  if (frequencyHz >= selectedRange.minFrequencyHz && frequencyHz <= selectedRange.maxFrequencyHz) {
    return selectedRangeId
  }
  return inferAudioEqControlRangeId(frequencyHz, preferredRangeId)
}

/** Clamps a pixel-derived output gain and rounds it to the shown decimal. */
export function roundOutputGainDb(value: number): number {
  if (!Number.isFinite(value)) return 0
  const clamped = Math.max(AUDIO_EQ_GAIN_DB_MIN, Math.min(AUDIO_EQ_GAIN_DB_MAX, value))
  return Math.round(clamped * 10) / 10
}

/** Output gain readout: `Mixed` or a signed one-decimal dB value. */
export function formatOutputGainDb(value: number | 'mixed'): string {
  if (value === 'mixed') return 'Mixed'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`
}
