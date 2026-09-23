import type { AudioEqCutSlopeDbPerOct } from '@/types/audio'
import {
  AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_Q,
  AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_Q,
} from '@/shared/utils/audio-eq'
import { demixValue } from '../utils/mixed-value'
import {
  AUDIO_EQ_BAND1_FILTER_OPTIONS,
  AUDIO_EQ_BAND6_FILTER_OPTIONS,
  AUDIO_EQ_INNER_FILTER_OPTIONS,
  DEFAULT_GAIN_BAND_CONTROL_RANGES,
  getAudioEqControlRangeById,
  type AudioEqControlRangeId,
  type AudioEqFilterType,
  type AudioEqGainBandControlKey,
  type AudioEqGainBandControlRanges,
} from './audio-eq-ui'
import {
  getEffectiveGainBandControlRangeId,
  type AudioEqDisplayValues,
} from './audio-eq-panel-values'
import type { AudioEqPatch } from './audio-eq-curve-editor'

/** The six bands the panel exposes, in the order they are laid out. */
export type AudioEqBandKey = 'band1' | 'low' | 'lowMid' | 'highMid' | 'high' | 'band6'

/** Bands whose frequency is pinned; the rest follow their control range. */
type AudioEqBandFrequencySource =
  | { rangeKey: AudioEqGainBandControlKey }
  | { bounds: { minFrequencyHz: number; maxFrequencyHz: number } }

interface AudioEqBandSlopeConfig {
  /** Filter type that swaps the gain body for cut-slope buttons. */
  type: AudioEqFilterType
  field: keyof AudioEqPatch
  value: AudioEqCutSlopeDbPerOct | 'mixed'
}

interface AudioEqBandConfig {
  key: AudioEqBandKey
  /** Short label used by the compact row layout. */
  label: string
  /** Full label used by the band cards. */
  title: string
  defaultType: AudioEqFilterType
  slope?: AudioEqBandSlopeConfig
  /** Filter types that hide the band body entirely. */
  suppressedTypes: ReadonlyArray<AudioEqFilterType>
  type: AudioEqFilterType | 'mixed'
  enabled: boolean | 'mixed'
  frequencyHz: number | 'mixed'
  gainDb: number | 'mixed'
  q: number | 'mixed'
  filterOptions: ReadonlyArray<AudioEqFilterType>
  coerceFilterType: (value: AudioEqFilterType) => AudioEqFilterType
  frequencySource: AudioEqBandFrequencySource
  resetPatch: AudioEqPatch
  typeField: keyof AudioEqPatch
  enabledField: keyof AudioEqPatch
  frequencyField: keyof AudioEqPatch
  gainField: keyof AudioEqPatch
  qField: keyof AudioEqPatch
}

/** One band resolved for rendering: display values plus the band's wiring. */
export interface AudioEqBandView {
  key: AudioEqBandKey
  label: string
  title: string
  type: AudioEqFilterType
  enabled: boolean
  frequencyHz: number | 'mixed'
  gainDb: number | 'mixed'
  q: number | 'mixed'
  /** Cut-slope control, present only for the band types that use one. */
  slope: { field: keyof AudioEqPatch; value: AudioEqCutSlopeDbPerOct | 'mixed' } | null
  minFrequencyHz: number
  maxFrequencyHz: number
  rangeId: AudioEqControlRangeId | null
  /** Control-range key of the band's frequency, or `null` when pinned. */
  rangeKey: AudioEqGainBandControlKey | null
  filterOptions: ReadonlyArray<AudioEqFilterType>
  coerceFilterType: (value: AudioEqFilterType) => AudioEqFilterType
  hidden: boolean
  resetPatch: AudioEqPatch
  typeField: keyof AudioEqPatch
  enabledField: keyof AudioEqPatch
  frequencyField: keyof AudioEqPatch
  gainField: keyof AudioEqPatch
  qField: keyof AudioEqPatch
}

const NO_SUPPRESSED_TYPES: ReadonlyArray<AudioEqFilterType> = Object.freeze([])

/** Pinned frequency bounds of a band, plus the control range it sits in. */
function getBandFrequencyBounds(
  source: AudioEqBandFrequencySource,
  frequencyHz: number | 'mixed',
  controlRanges: AudioEqGainBandControlRanges,
): {
  rangeId: AudioEqControlRangeId | null
  rangeKey: AudioEqGainBandControlKey | null
  minFrequencyHz: number
  maxFrequencyHz: number
} {
  if ('bounds' in source) {
    return {
      rangeId: null,
      rangeKey: null,
      minFrequencyHz: source.bounds.minFrequencyHz,
      maxFrequencyHz: source.bounds.maxFrequencyHz,
    }
  }
  const rangeId = getEffectiveGainBandControlRangeId(
    controlRanges[source.rangeKey],
    frequencyHz,
    DEFAULT_GAIN_BAND_CONTROL_RANGES[source.rangeKey],
  )
  const range = getAudioEqControlRangeById(rangeId)
  return {
    rangeId,
    rangeKey: source.rangeKey,
    minFrequencyHz: range.minFrequencyHz,
    maxFrequencyHz: range.maxFrequencyHz,
  }
}

/** Resolves one band config into the view both layouts render from. */
function defineBandView(
  config: AudioEqBandConfig,
  controlRanges: AudioEqGainBandControlRanges,
): AudioEqBandView {
  const type = demixValue(config.type, config.defaultType)
  const { rangeId, rangeKey, minFrequencyHz, maxFrequencyHz } = getBandFrequencyBounds(
    config.frequencySource,
    config.frequencyHz,
    controlRanges,
  )
  return {
    key: config.key,
    label: config.label,
    title: config.title,
    type,
    enabled: demixValue(config.enabled, false),
    frequencyHz: config.frequencyHz,
    gainDb: config.gainDb,
    q: config.q,
    slope:
      config.slope && config.slope.type === type
        ? { field: config.slope.field, value: config.slope.value }
        : null,
    minFrequencyHz,
    maxFrequencyHz,
    rangeId,
    rangeKey,
    filterOptions: config.filterOptions,
    coerceFilterType: config.coerceFilterType,
    hidden: config.suppressedTypes.includes(type),
    resetPatch: config.resetPatch,
    typeField: config.typeField,
    enabledField: config.enabledField,
    frequencyField: config.frequencyField,
    gainField: config.gainField,
    qField: config.qField,
  }
}

/** The six bands of the panel, resolved for the current selection. */
export function getAudioEqPanelBandViews(
  values: AudioEqDisplayValues,
  controlRanges: AudioEqGainBandControlRanges,
): AudioEqBandView[] {
  return [
    defineBandView(
      {
        key: 'band1',
        label: 'B 1',
        title: 'Band 1',
        defaultType: 'high-pass',
        slope: {
          type: 'high-pass',
          field: 'audioEqBand1SlopeDbPerOct',
          value: values.band1SlopeDbPerOct,
        },
        suppressedTypes: NO_SUPPRESSED_TYPES,
        type: values.band1Type,
        enabled: values.band1Enabled,
        frequencyHz: values.band1FrequencyHz,
        gainDb: values.band1GainDb,
        q: values.band1Q,
        filterOptions: AUDIO_EQ_BAND1_FILTER_OPTIONS,
        coerceFilterType: (value) => value,
        frequencySource: {
          bounds: {
            minFrequencyHz: AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
            maxFrequencyHz: AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
          },
        },
        resetPatch: {
          audioEqBand1Enabled: false,
          audioEqBand1Type: 'high-pass',
          audioEqBand1FrequencyHz: AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
          audioEqBand1GainDb: 0,
          audioEqBand1Q: AUDIO_EQ_LOW_MID_Q,
          audioEqBand1SlopeDbPerOct: 12,
        },
        typeField: 'audioEqBand1Type',
        enabledField: 'audioEqBand1Enabled',
        frequencyField: 'audioEqBand1FrequencyHz',
        gainField: 'audioEqBand1GainDb',
        qField: 'audioEqBand1Q',
      },
      controlRanges,
    ),
    defineBandView(
      {
        key: 'low',
        label: 'B 2',
        title: 'Band 2',
        defaultType: 'low-shelf',
        suppressedTypes: ['notch'],
        type: values.lowType,
        enabled: values.lowEnabled,
        frequencyHz: values.lowFrequencyHz,
        gainDb: values.lowGainDb,
        q: values.lowQ,
        filterOptions: AUDIO_EQ_INNER_FILTER_OPTIONS,
        coerceFilterType: (value) =>
          value === 'low-pass' || value === 'high-pass' ? 'low-shelf' : value,
        frequencySource: { rangeKey: 'low' },
        resetPatch: {
          audioEqLowEnabled: true,
          audioEqLowType: 'low-shelf',
          audioEqLowFrequencyHz: AUDIO_EQ_LOW_FREQUENCY_HZ,
          audioEqLowGainDb: 0,
          audioEqLowQ: AUDIO_EQ_LOW_MID_Q,
        },
        typeField: 'audioEqLowType',
        enabledField: 'audioEqLowEnabled',
        frequencyField: 'audioEqLowFrequencyHz',
        gainField: 'audioEqLowGainDb',
        qField: 'audioEqLowQ',
      },
      controlRanges,
    ),
    defineBandView(
      {
        key: 'lowMid',
        label: 'B 3',
        title: 'Band 3',
        defaultType: 'peaking',
        suppressedTypes: ['notch'],
        type: values.lowMidType,
        enabled: values.lowMidEnabled,
        frequencyHz: values.lowMidFrequencyHz,
        gainDb: values.lowMidGainDb,
        q: values.lowMidQ,
        filterOptions: AUDIO_EQ_INNER_FILTER_OPTIONS,
        coerceFilterType: (value) =>
          value === 'low-pass' || value === 'high-pass' ? 'peaking' : value,
        frequencySource: { rangeKey: 'lowMid' },
        resetPatch: {
          audioEqLowMidEnabled: true,
          audioEqLowMidType: 'peaking',
          audioEqLowMidFrequencyHz: AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
          audioEqLowMidGainDb: 0,
          audioEqLowMidQ: AUDIO_EQ_LOW_MID_Q,
        },
        typeField: 'audioEqLowMidType',
        enabledField: 'audioEqLowMidEnabled',
        frequencyField: 'audioEqLowMidFrequencyHz',
        gainField: 'audioEqLowMidGainDb',
        qField: 'audioEqLowMidQ',
      },
      controlRanges,
    ),
    defineBandView(
      {
        key: 'highMid',
        label: 'B 4',
        title: 'Band 4',
        defaultType: 'peaking',
        suppressedTypes: ['notch'],
        type: values.highMidType,
        enabled: values.highMidEnabled,
        frequencyHz: values.highMidFrequencyHz,
        gainDb: values.highMidGainDb,
        q: values.highMidQ,
        filterOptions: AUDIO_EQ_INNER_FILTER_OPTIONS,
        coerceFilterType: (value) =>
          value === 'low-pass' || value === 'high-pass' ? 'peaking' : value,
        frequencySource: { rangeKey: 'highMid' },
        resetPatch: {
          audioEqHighMidEnabled: true,
          audioEqHighMidType: 'peaking',
          audioEqHighMidFrequencyHz: AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
          audioEqHighMidGainDb: 0,
          audioEqHighMidQ: AUDIO_EQ_HIGH_MID_Q,
        },
        typeField: 'audioEqHighMidType',
        enabledField: 'audioEqHighMidEnabled',
        frequencyField: 'audioEqHighMidFrequencyHz',
        gainField: 'audioEqHighMidGainDb',
        qField: 'audioEqHighMidQ',
      },
      controlRanges,
    ),
    defineBandView(
      {
        key: 'high',
        label: 'B 5',
        title: 'Band 5',
        defaultType: 'high-shelf',
        suppressedTypes: ['notch'],
        type: values.highType,
        enabled: values.highEnabled,
        frequencyHz: values.highFrequencyHz,
        gainDb: values.highGainDb,
        q: values.highQ,
        filterOptions: AUDIO_EQ_INNER_FILTER_OPTIONS,
        coerceFilterType: (value) =>
          value === 'low-pass' || value === 'high-pass' ? 'high-shelf' : value,
        frequencySource: { rangeKey: 'high' },
        resetPatch: {
          audioEqHighEnabled: true,
          audioEqHighType: 'high-shelf',
          audioEqHighFrequencyHz: AUDIO_EQ_HIGH_FREQUENCY_HZ,
          audioEqHighGainDb: 0,
          audioEqHighQ: AUDIO_EQ_HIGH_MID_Q,
        },
        typeField: 'audioEqHighType',
        enabledField: 'audioEqHighEnabled',
        frequencyField: 'audioEqHighFrequencyHz',
        gainField: 'audioEqHighGainDb',
        qField: 'audioEqHighQ',
      },
      controlRanges,
    ),
    defineBandView(
      {
        key: 'band6',
        label: 'B 6',
        title: 'Band 6',
        defaultType: 'low-pass',
        slope: {
          type: 'low-pass',
          field: 'audioEqBand6SlopeDbPerOct',
          value: values.band6SlopeDbPerOct,
        },
        suppressedTypes: NO_SUPPRESSED_TYPES,
        type: values.band6Type,
        enabled: values.band6Enabled,
        frequencyHz: values.band6FrequencyHz,
        gainDb: values.band6GainDb,
        q: values.band6Q,
        filterOptions: AUDIO_EQ_BAND6_FILTER_OPTIONS,
        coerceFilterType: (value) =>
          value === 'high-pass' || value === 'notch' ? 'low-pass' : value,
        frequencySource: {
          bounds: {
            minFrequencyHz: AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
            maxFrequencyHz: AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
          },
        },
        resetPatch: {
          audioEqBand6Enabled: false,
          audioEqBand6Type: 'low-pass',
          audioEqBand6FrequencyHz: AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
          audioEqBand6GainDb: 0,
          audioEqBand6Q: AUDIO_EQ_HIGH_MID_Q,
          audioEqBand6SlopeDbPerOct: 12,
        },
        typeField: 'audioEqBand6Type',
        enabledField: 'audioEqBand6Enabled',
        frequencyField: 'audioEqBand6FrequencyHz',
        gainField: 'audioEqBand6GainDb',
        qField: 'audioEqBand6Q',
      },
      controlRanges,
    ),
  ]
}

/** Bands whose type still carries a gain value. */
export function bandShowsGain(type: AudioEqFilterType): boolean {
  return type !== 'high-pass' && type !== 'low-pass' && type !== 'notch'
}

/** Bands whose type carries a Q factor. */
export function bandShowsQ(type: AudioEqFilterType): boolean {
  return type === 'peaking'
}
