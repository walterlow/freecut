import type {
  AudioEqBand1Type,
  AudioEqBand6Type,
  AudioEqCutSlopeDbPerOct,
  AudioEqInnerBandType,
  AudioEqSettings,
  ResolvedAudioEqSettings,
} from '@/types/audio';

export interface AudioEqFieldSource {
  audioEqEnabled?: boolean;
  audioEqOutputGainDb?: number;
  audioEqBand1Enabled?: boolean;
  audioEqBand1Type?: AudioEqBand1Type;
  audioEqBand1FrequencyHz?: number;
  audioEqBand1GainDb?: number;
  audioEqBand1Q?: number;
  audioEqBand1SlopeDbPerOct?: AudioEqCutSlopeDbPerOct;
  audioEqLowCutEnabled?: boolean;
  audioEqLowCutFrequencyHz?: number;
  audioEqLowCutSlopeDbPerOct?: AudioEqCutSlopeDbPerOct;
  audioEqLowEnabled?: boolean;
  audioEqLowType?: AudioEqInnerBandType;
  audioEqLowGainDb?: number;
  audioEqLowFrequencyHz?: number;
  audioEqLowQ?: number;
  audioEqLowMidEnabled?: boolean;
  audioEqLowMidType?: AudioEqInnerBandType;
  audioEqLowMidGainDb?: number;
  audioEqLowMidFrequencyHz?: number;
  audioEqLowMidQ?: number;
  audioEqMidGainDb?: number;
  audioEqHighMidEnabled?: boolean;
  audioEqHighMidType?: AudioEqInnerBandType;
  audioEqHighMidGainDb?: number;
  audioEqHighMidFrequencyHz?: number;
  audioEqHighMidQ?: number;
  audioEqHighEnabled?: boolean;
  audioEqHighType?: AudioEqInnerBandType;
  audioEqHighGainDb?: number;
  audioEqHighFrequencyHz?: number;
  audioEqHighQ?: number;
  audioEqBand6Enabled?: boolean;
  audioEqBand6Type?: AudioEqBand6Type;
  audioEqBand6FrequencyHz?: number;
  audioEqBand6GainDb?: number;
  audioEqBand6Q?: number;
  audioEqBand6SlopeDbPerOct?: AudioEqCutSlopeDbPerOct;
  audioEqHighCutEnabled?: boolean;
  audioEqHighCutFrequencyHz?: number;
  audioEqHighCutSlopeDbPerOct?: AudioEqCutSlopeDbPerOct;
}

export type AudioEqPresetId =
  | 'flat'
  | 'voice-clarity'
  | 'podcast'
  | 'warmth'
  | 'bass-boost'
  | 'de-mud'
  | 'smile'
  | 'sparkle'
  | 'air'
  | 'soften'
  | 'radio'
  | 'telephone'
  | 'dialog-lift'
  | 'rumble-cut'
  | 'brighten';

export interface AudioEqPresetDefinition {
  id: AudioEqPresetId;
  label: string;
  settings: ResolvedAudioEqSettings;
}

export interface AudioEqResponsePoint {
  frequencyHz: number;
  gainDb: number;
}

export interface AudioEqIirCoefficients {
  feedforward: [number, number];
  feedback: [number, number];
}

interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

interface OnePoleCoefficients {
  b0: number;
  b1: number;
  a1: number;
}

export const AUDIO_EQ_GAIN_DB_MIN = -20;
export const AUDIO_EQ_GAIN_DB_MAX = 20;
export const AUDIO_EQ_Q_MIN = 0.3;
export const AUDIO_EQ_Q_MAX = 10.3;
export const AUDIO_EQ_BAND1_TYPES = ['low-shelf', 'peaking', 'high-shelf', 'high-pass'] as const satisfies ReadonlyArray<AudioEqBand1Type>;
export const AUDIO_EQ_INNER_BAND_TYPES = ['low-shelf', 'peaking', 'high-shelf', 'notch'] as const satisfies ReadonlyArray<AudioEqInnerBandType>;
export const AUDIO_EQ_BAND6_TYPES = ['low-pass', 'low-shelf', 'peaking', 'high-shelf'] as const satisfies ReadonlyArray<AudioEqBand6Type>;
export const AUDIO_EQ_CUT_SLOPES_DB_PER_OCT = [6, 12, 18, 24] as const;
export const AUDIO_EQ_LOW_CUT_FREQUENCY_HZ = 30;
export const AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ = 20;
export const AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ = 399;
export const AUDIO_EQ_LOW_FREQUENCY_HZ = 120;
export const AUDIO_EQ_LOW_MIN_FREQUENCY_HZ = 20;
export const AUDIO_EQ_LOW_MAX_FREQUENCY_HZ = 22000;
export const AUDIO_EQ_LOW_MID_FREQUENCY_HZ = 400;
export const AUDIO_EQ_LOW_MID_MIN_FREQUENCY_HZ = 20;
export const AUDIO_EQ_LOW_MID_MAX_FREQUENCY_HZ = 22000;
export const AUDIO_EQ_MID_FREQUENCY_HZ = 1000;
export const AUDIO_EQ_MID_Q = 0.9;
export const AUDIO_EQ_LOW_MID_Q = 1.1;
export const AUDIO_EQ_HIGH_MID_FREQUENCY_HZ = 1600;
export const AUDIO_EQ_HIGH_MID_MIN_FREQUENCY_HZ = 20;
export const AUDIO_EQ_HIGH_MID_MAX_FREQUENCY_HZ = 22000;
export const AUDIO_EQ_HIGH_MID_Q = 1.1;
export const AUDIO_EQ_HIGH_FREQUENCY_HZ = 2800;
export const AUDIO_EQ_HIGH_MIN_FREQUENCY_HZ = 20;
export const AUDIO_EQ_HIGH_MAX_FREQUENCY_HZ = 22000;
export const AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ = 22000;
export const AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ = 1400;
export const AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ = 22000;

const AUDIO_EQ_SHELF_SLOPE = 1;
const AUDIO_EQ_ACTIVE_EPSILON = 0.001;
const AUDIO_EQ_BAND1_Q = 1.1;
const AUDIO_EQ_LOW_Q = 2.3;
const AUDIO_EQ_HIGH_Q = 2.3;
const AUDIO_EQ_BAND6_Q = 1.1;

export const DEFAULT_AUDIO_EQ_SETTINGS: Readonly<ResolvedAudioEqSettings> = Object.freeze({
  outputGainDb: 0,
  band1Enabled: false,
  band1Type: 'high-pass',
  band1FrequencyHz: AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
  band1GainDb: 0,
  band1Q: AUDIO_EQ_BAND1_Q,
  band1SlopeDbPerOct: 12,
  lowCutEnabled: false,
  lowCutFrequencyHz: AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
  lowCutSlopeDbPerOct: 12,
  lowEnabled: true,
  lowType: 'low-shelf',
  lowGainDb: 0,
  lowFrequencyHz: AUDIO_EQ_LOW_FREQUENCY_HZ,
  lowQ: AUDIO_EQ_LOW_Q,
  lowMidEnabled: true,
  lowMidType: 'peaking',
  lowMidGainDb: 0,
  lowMidFrequencyHz: AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
  lowMidQ: AUDIO_EQ_LOW_MID_Q,
  midGainDb: 0,
  highMidEnabled: true,
  highMidType: 'peaking',
  highMidGainDb: 0,
  highMidFrequencyHz: AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
  highMidQ: AUDIO_EQ_HIGH_MID_Q,
  highEnabled: true,
  highType: 'high-shelf',
  highGainDb: 0,
  highFrequencyHz: AUDIO_EQ_HIGH_FREQUENCY_HZ,
  highQ: AUDIO_EQ_HIGH_Q,
  band6Enabled: false,
  band6Type: 'low-pass',
  band6FrequencyHz: AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
  band6GainDb: 0,
  band6Q: AUDIO_EQ_BAND6_Q,
  band6SlopeDbPerOct: 12,
  highCutEnabled: false,
  highCutFrequencyHz: AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
  highCutSlopeDbPerOct: 12,
});

function clampFrequencyForSampleRate(frequencyHz: number, sampleRate: number): number {
  return Math.max(20, Math.min(frequencyHz, sampleRate * 0.45));
}

export function clampAudioEqGainDb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(AUDIO_EQ_GAIN_DB_MIN, Math.min(AUDIO_EQ_GAIN_DB_MAX, value));
}

export function clampAudioEqQ(value: number, fallback = AUDIO_EQ_LOW_MID_Q): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(AUDIO_EQ_Q_MIN, Math.min(AUDIO_EQ_Q_MAX, value));
}

function clampAudioEqBand1Type(
  value: unknown,
  fallback = DEFAULT_AUDIO_EQ_SETTINGS.band1Type,
): AudioEqBand1Type {
  return AUDIO_EQ_BAND1_TYPES.includes(value as AudioEqBand1Type)
    ? value as AudioEqBand1Type
    : fallback;
}

function clampAudioEqInnerBandType(
  value: unknown,
  fallback = DEFAULT_AUDIO_EQ_SETTINGS.lowMidType,
): AudioEqInnerBandType {
  return AUDIO_EQ_INNER_BAND_TYPES.includes(value as AudioEqInnerBandType)
    ? value as AudioEqInnerBandType
    : fallback;
}

function clampAudioEqBand6Type(
  value: unknown,
  fallback = DEFAULT_AUDIO_EQ_SETTINGS.band6Type,
): AudioEqBand6Type {
  return AUDIO_EQ_BAND6_TYPES.includes(value as AudioEqBand6Type)
    ? value as AudioEqBand6Type
    : fallback;
}

export function clampAudioEqFrequencyHz(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export function clampAudioEqCutSlopeDbPerOct(
  value: number,
  fallback: AudioEqCutSlopeDbPerOct = 12,
): AudioEqCutSlopeDbPerOct {
  return AUDIO_EQ_CUT_SLOPES_DB_PER_OCT.includes(value as AudioEqCutSlopeDbPerOct)
    ? value as AudioEqCutSlopeDbPerOct
    : fallback;
}

function resolveBoolean(value: boolean | undefined, fallback: boolean): boolean {
  return value === undefined ? fallback : value;
}

function isAudioEqSourceDisabled(
  source?: AudioEqSettings | AudioEqFieldSource | null,
): boolean {
  if (source == null) return false;
  if ('audioEqEnabled' in source && source.audioEqEnabled === false) return true;
  if ('enabled' in source && source.enabled === false) return true;
  return false;
}

function getSettingsValue<
  TSettingsKey extends keyof AudioEqSettings,
  TFieldKey extends keyof AudioEqFieldSource,
>(
  settings: AudioEqSettings | null | undefined,
  fields: AudioEqFieldSource | null | undefined,
  settingsKey: TSettingsKey,
  fieldKey: TFieldKey,
): AudioEqSettings[TSettingsKey] | AudioEqFieldSource[TFieldKey] | undefined {
  return settings?.[settingsKey] ?? fields?.[fieldKey];
}

export function getAudioEqSettings(source?: AudioEqFieldSource | null): AudioEqSettings {
  return {
    enabled: source?.audioEqEnabled,
    outputGainDb: source?.audioEqOutputGainDb,
    band1Enabled: source?.audioEqBand1Enabled,
    band1Type: source?.audioEqBand1Type,
    band1FrequencyHz: source?.audioEqBand1FrequencyHz,
    band1GainDb: source?.audioEqBand1GainDb,
    band1Q: source?.audioEqBand1Q,
    band1SlopeDbPerOct: source?.audioEqBand1SlopeDbPerOct,
    lowCutEnabled: source?.audioEqLowCutEnabled,
    lowCutFrequencyHz: source?.audioEqLowCutFrequencyHz,
    lowCutSlopeDbPerOct: source?.audioEqLowCutSlopeDbPerOct,
    lowEnabled: source?.audioEqLowEnabled,
    lowType: source?.audioEqLowType,
    lowGainDb: source?.audioEqLowGainDb,
    lowFrequencyHz: source?.audioEqLowFrequencyHz,
    lowQ: source?.audioEqLowQ,
    lowMidEnabled: source?.audioEqLowMidEnabled,
    lowMidType: source?.audioEqLowMidType,
    lowMidGainDb: source?.audioEqLowMidGainDb,
    lowMidFrequencyHz: source?.audioEqLowMidFrequencyHz,
    lowMidQ: source?.audioEqLowMidQ,
    midGainDb: source?.audioEqMidGainDb,
    highMidEnabled: source?.audioEqHighMidEnabled,
    highMidType: source?.audioEqHighMidType,
    highMidGainDb: source?.audioEqHighMidGainDb,
    highMidFrequencyHz: source?.audioEqHighMidFrequencyHz,
    highMidQ: source?.audioEqHighMidQ,
    highEnabled: source?.audioEqHighEnabled,
    highType: source?.audioEqHighType,
    highGainDb: source?.audioEqHighGainDb,
    highFrequencyHz: source?.audioEqHighFrequencyHz,
    highQ: source?.audioEqHighQ,
    band6Enabled: source?.audioEqBand6Enabled,
    band6Type: source?.audioEqBand6Type,
    band6FrequencyHz: source?.audioEqBand6FrequencyHz,
    band6GainDb: source?.audioEqBand6GainDb,
    band6Q: source?.audioEqBand6Q,
    band6SlopeDbPerOct: source?.audioEqBand6SlopeDbPerOct,
    highCutEnabled: source?.audioEqHighCutEnabled,
    highCutFrequencyHz: source?.audioEqHighCutFrequencyHz,
    highCutSlopeDbPerOct: source?.audioEqHighCutSlopeDbPerOct,
  };
}

export function getSparseAudioEqSettings(source?: AudioEqFieldSource | null): AudioEqSettings {
  const settings = getAudioEqSettings(source);
  const sparse = Object.fromEntries(
    Object.entries(settings).filter(([, value]) => value !== undefined),
  ) as AudioEqSettings;

  const hasLegacyBand1Patch = source && (
    source.audioEqLowCutEnabled !== undefined
    || source.audioEqLowCutFrequencyHz !== undefined
    || source.audioEqLowCutSlopeDbPerOct !== undefined
  );
  if (hasLegacyBand1Patch) {
    if (source?.audioEqBand1Enabled === undefined && sparse.lowCutEnabled !== undefined) {
      sparse.band1Enabled = sparse.lowCutEnabled;
    }
    if (source?.audioEqBand1FrequencyHz === undefined && sparse.lowCutFrequencyHz !== undefined) {
      sparse.band1FrequencyHz = sparse.lowCutFrequencyHz;
    }
    if (source?.audioEqBand1SlopeDbPerOct === undefined && sparse.lowCutSlopeDbPerOct !== undefined) {
      sparse.band1SlopeDbPerOct = sparse.lowCutSlopeDbPerOct;
    }
    if (source?.audioEqBand1Type === undefined) {
      sparse.band1Type = 'high-pass';
    }
  }

  const hasLegacyBand6Patch = source && (
    source.audioEqHighCutEnabled !== undefined
    || source.audioEqHighCutFrequencyHz !== undefined
    || source.audioEqHighCutSlopeDbPerOct !== undefined
  );
  if (hasLegacyBand6Patch) {
    if (source?.audioEqBand6Enabled === undefined && sparse.highCutEnabled !== undefined) {
      sparse.band6Enabled = sparse.highCutEnabled;
    }
    if (source?.audioEqBand6FrequencyHz === undefined && sparse.highCutFrequencyHz !== undefined) {
      sparse.band6FrequencyHz = sparse.highCutFrequencyHz;
    }
    if (source?.audioEqBand6SlopeDbPerOct === undefined && sparse.highCutSlopeDbPerOct !== undefined) {
      sparse.band6SlopeDbPerOct = sparse.highCutSlopeDbPerOct;
    }
    if (source?.audioEqBand6Type === undefined) {
      sparse.band6Type = 'low-pass';
    }
  }

  return sparse;
}

export function resolveAudioEqSettings(
  source?: AudioEqSettings | AudioEqFieldSource | null,
): ResolvedAudioEqSettings {
  const settings = source as AudioEqSettings | null | undefined;
  const fields = source as AudioEqFieldSource | null | undefined;

  const legacyLowCutEnabled = resolveBoolean(
    getSettingsValue(settings, fields, 'lowCutEnabled', 'audioEqLowCutEnabled'),
    DEFAULT_AUDIO_EQ_SETTINGS.lowCutEnabled,
  );
  const legacyLowCutFrequencyHz = clampAudioEqFrequencyHz(
    Number(getSettingsValue(settings, fields, 'lowCutFrequencyHz', 'audioEqLowCutFrequencyHz')),
    AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
    AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
    DEFAULT_AUDIO_EQ_SETTINGS.lowCutFrequencyHz,
  );
  const legacyLowCutSlopeDbPerOct = clampAudioEqCutSlopeDbPerOct(
    Number(getSettingsValue(settings, fields, 'lowCutSlopeDbPerOct', 'audioEqLowCutSlopeDbPerOct')),
    DEFAULT_AUDIO_EQ_SETTINGS.lowCutSlopeDbPerOct,
  );
  const band1EnabledSource = getSettingsValue(settings, fields, 'band1Enabled', 'audioEqBand1Enabled');
  const band1TypeSource = getSettingsValue(settings, fields, 'band1Type', 'audioEqBand1Type');
  const band1FrequencySource = getSettingsValue(settings, fields, 'band1FrequencyHz', 'audioEqBand1FrequencyHz');
  const band1GainSource = getSettingsValue(settings, fields, 'band1GainDb', 'audioEqBand1GainDb');
  const band1QSource = getSettingsValue(settings, fields, 'band1Q', 'audioEqBand1Q');
  const band1SlopeSource = getSettingsValue(settings, fields, 'band1SlopeDbPerOct', 'audioEqBand1SlopeDbPerOct');
  const hasExplicitBand1 = [
    band1EnabledSource,
    band1TypeSource,
    band1FrequencySource,
    band1GainSource,
    band1QSource,
    band1SlopeSource,
  ].some((value) => value !== undefined);
  const band1Type = hasExplicitBand1
    ? clampAudioEqBand1Type(band1TypeSource, DEFAULT_AUDIO_EQ_SETTINGS.band1Type)
    : 'high-pass';
  const band1Enabled = resolveBoolean(
    hasExplicitBand1 ? band1EnabledSource : legacyLowCutEnabled,
    DEFAULT_AUDIO_EQ_SETTINGS.band1Enabled,
  );
  const band1FrequencyHz = clampAudioEqFrequencyHz(
    Number(hasExplicitBand1 ? band1FrequencySource : legacyLowCutFrequencyHz),
    AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
    AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
    DEFAULT_AUDIO_EQ_SETTINGS.band1FrequencyHz,
  );
  const band1GainDb = clampAudioEqGainDb(Number(band1GainSource));
  const band1Q = clampAudioEqQ(Number(band1QSource), DEFAULT_AUDIO_EQ_SETTINGS.band1Q);
  const band1SlopeDbPerOct = clampAudioEqCutSlopeDbPerOct(
    Number(hasExplicitBand1 ? band1SlopeSource : legacyLowCutSlopeDbPerOct),
    DEFAULT_AUDIO_EQ_SETTINGS.band1SlopeDbPerOct,
  );

  const legacyHighCutEnabled = resolveBoolean(
    getSettingsValue(settings, fields, 'highCutEnabled', 'audioEqHighCutEnabled'),
    DEFAULT_AUDIO_EQ_SETTINGS.highCutEnabled,
  );
  const legacyHighCutFrequencyHz = clampAudioEqFrequencyHz(
    Number(getSettingsValue(settings, fields, 'highCutFrequencyHz', 'audioEqHighCutFrequencyHz')),
    AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
    AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
    DEFAULT_AUDIO_EQ_SETTINGS.highCutFrequencyHz,
  );
  const legacyHighCutSlopeDbPerOct = clampAudioEqCutSlopeDbPerOct(
    Number(getSettingsValue(settings, fields, 'highCutSlopeDbPerOct', 'audioEqHighCutSlopeDbPerOct')),
    DEFAULT_AUDIO_EQ_SETTINGS.highCutSlopeDbPerOct,
  );
  const band6EnabledSource = getSettingsValue(settings, fields, 'band6Enabled', 'audioEqBand6Enabled');
  const band6TypeSource = getSettingsValue(settings, fields, 'band6Type', 'audioEqBand6Type');
  const band6FrequencySource = getSettingsValue(settings, fields, 'band6FrequencyHz', 'audioEqBand6FrequencyHz');
  const band6GainSource = getSettingsValue(settings, fields, 'band6GainDb', 'audioEqBand6GainDb');
  const band6QSource = getSettingsValue(settings, fields, 'band6Q', 'audioEqBand6Q');
  const band6SlopeSource = getSettingsValue(settings, fields, 'band6SlopeDbPerOct', 'audioEqBand6SlopeDbPerOct');
  const hasExplicitBand6 = [
    band6EnabledSource,
    band6TypeSource,
    band6FrequencySource,
    band6GainSource,
    band6QSource,
    band6SlopeSource,
  ].some((value) => value !== undefined);
  const band6Type = hasExplicitBand6
    ? clampAudioEqBand6Type(band6TypeSource, DEFAULT_AUDIO_EQ_SETTINGS.band6Type)
    : 'low-pass';
  const band6Enabled = resolveBoolean(
    hasExplicitBand6 ? band6EnabledSource : legacyHighCutEnabled,
    DEFAULT_AUDIO_EQ_SETTINGS.band6Enabled,
  );
  const band6FrequencyHz = clampAudioEqFrequencyHz(
    Number(hasExplicitBand6 ? band6FrequencySource : legacyHighCutFrequencyHz),
    AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
    AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
    DEFAULT_AUDIO_EQ_SETTINGS.band6FrequencyHz,
  );
  const band6GainDb = clampAudioEqGainDb(Number(band6GainSource));
  const band6Q = clampAudioEqQ(Number(band6QSource), DEFAULT_AUDIO_EQ_SETTINGS.band6Q);
  const band6SlopeDbPerOct = clampAudioEqCutSlopeDbPerOct(
    Number(hasExplicitBand6 ? band6SlopeSource : legacyHighCutSlopeDbPerOct),
    DEFAULT_AUDIO_EQ_SETTINGS.band6SlopeDbPerOct,
  );

  return {
    outputGainDb: clampAudioEqGainDb(
      Number(getSettingsValue(settings, fields, 'outputGainDb', 'audioEqOutputGainDb')),
    ),
    band1Enabled,
    band1Type,
    band1FrequencyHz,
    band1GainDb,
    band1Q,
    band1SlopeDbPerOct,
    lowCutEnabled: band1Enabled && band1Type === 'high-pass',
    lowCutFrequencyHz: band1FrequencyHz,
    lowCutSlopeDbPerOct: band1SlopeDbPerOct,
    lowEnabled: resolveBoolean(
      getSettingsValue(settings, fields, 'lowEnabled', 'audioEqLowEnabled'),
      DEFAULT_AUDIO_EQ_SETTINGS.lowEnabled,
    ),
    lowType: clampAudioEqInnerBandType(
      getSettingsValue(settings, fields, 'lowType', 'audioEqLowType'),
      DEFAULT_AUDIO_EQ_SETTINGS.lowType,
    ),
    lowGainDb: clampAudioEqGainDb(
      Number(getSettingsValue(settings, fields, 'lowGainDb', 'audioEqLowGainDb')),
    ),
    lowFrequencyHz: clampAudioEqFrequencyHz(
      Number(getSettingsValue(settings, fields, 'lowFrequencyHz', 'audioEqLowFrequencyHz')),
      AUDIO_EQ_LOW_MIN_FREQUENCY_HZ,
      AUDIO_EQ_LOW_MAX_FREQUENCY_HZ,
      DEFAULT_AUDIO_EQ_SETTINGS.lowFrequencyHz,
    ),
    lowQ: clampAudioEqQ(
      Number(getSettingsValue(settings, fields, 'lowQ', 'audioEqLowQ')),
      DEFAULT_AUDIO_EQ_SETTINGS.lowQ,
    ),
    lowMidEnabled: resolveBoolean(
      getSettingsValue(settings, fields, 'lowMidEnabled', 'audioEqLowMidEnabled'),
      DEFAULT_AUDIO_EQ_SETTINGS.lowMidEnabled,
    ),
    lowMidType: clampAudioEqInnerBandType(
      getSettingsValue(settings, fields, 'lowMidType', 'audioEqLowMidType'),
      DEFAULT_AUDIO_EQ_SETTINGS.lowMidType,
    ),
    lowMidGainDb: clampAudioEqGainDb(
      Number(getSettingsValue(settings, fields, 'lowMidGainDb', 'audioEqLowMidGainDb')),
    ),
    lowMidFrequencyHz: clampAudioEqFrequencyHz(
      Number(getSettingsValue(settings, fields, 'lowMidFrequencyHz', 'audioEqLowMidFrequencyHz')),
      AUDIO_EQ_LOW_MID_MIN_FREQUENCY_HZ,
      AUDIO_EQ_LOW_MID_MAX_FREQUENCY_HZ,
      DEFAULT_AUDIO_EQ_SETTINGS.lowMidFrequencyHz,
    ),
    lowMidQ: clampAudioEqQ(
      Number(getSettingsValue(settings, fields, 'lowMidQ', 'audioEqLowMidQ')),
      DEFAULT_AUDIO_EQ_SETTINGS.lowMidQ,
    ),
    midGainDb: clampAudioEqGainDb(
      Number(getSettingsValue(settings, fields, 'midGainDb', 'audioEqMidGainDb')),
    ),
    highMidEnabled: resolveBoolean(
      getSettingsValue(settings, fields, 'highMidEnabled', 'audioEqHighMidEnabled'),
      DEFAULT_AUDIO_EQ_SETTINGS.highMidEnabled,
    ),
    highMidType: clampAudioEqInnerBandType(
      getSettingsValue(settings, fields, 'highMidType', 'audioEqHighMidType'),
      DEFAULT_AUDIO_EQ_SETTINGS.highMidType,
    ),
    highMidGainDb: clampAudioEqGainDb(
      Number(getSettingsValue(settings, fields, 'highMidGainDb', 'audioEqHighMidGainDb')),
    ),
    highMidFrequencyHz: clampAudioEqFrequencyHz(
      Number(getSettingsValue(settings, fields, 'highMidFrequencyHz', 'audioEqHighMidFrequencyHz')),
      AUDIO_EQ_HIGH_MID_MIN_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_MID_MAX_FREQUENCY_HZ,
      DEFAULT_AUDIO_EQ_SETTINGS.highMidFrequencyHz,
    ),
    highMidQ: clampAudioEqQ(
      Number(getSettingsValue(settings, fields, 'highMidQ', 'audioEqHighMidQ')),
      DEFAULT_AUDIO_EQ_SETTINGS.highMidQ,
    ),
    highEnabled: resolveBoolean(
      getSettingsValue(settings, fields, 'highEnabled', 'audioEqHighEnabled'),
      DEFAULT_AUDIO_EQ_SETTINGS.highEnabled,
    ),
    highType: clampAudioEqInnerBandType(
      getSettingsValue(settings, fields, 'highType', 'audioEqHighType'),
      DEFAULT_AUDIO_EQ_SETTINGS.highType,
    ),
    highGainDb: clampAudioEqGainDb(
      Number(getSettingsValue(settings, fields, 'highGainDb', 'audioEqHighGainDb')),
    ),
    highFrequencyHz: clampAudioEqFrequencyHz(
      Number(getSettingsValue(settings, fields, 'highFrequencyHz', 'audioEqHighFrequencyHz')),
      AUDIO_EQ_HIGH_MIN_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_MAX_FREQUENCY_HZ,
      DEFAULT_AUDIO_EQ_SETTINGS.highFrequencyHz,
    ),
    highQ: clampAudioEqQ(
      Number(getSettingsValue(settings, fields, 'highQ', 'audioEqHighQ')),
      DEFAULT_AUDIO_EQ_SETTINGS.highQ,
    ),
    band6Enabled,
    band6Type,
    band6FrequencyHz,
    band6GainDb,
    band6Q,
    band6SlopeDbPerOct,
    highCutEnabled: band6Enabled && band6Type === 'low-pass',
    highCutFrequencyHz: band6FrequencyHz,
    highCutSlopeDbPerOct: band6SlopeDbPerOct,
  };
}

export function appendResolvedAudioEqStage(
  stages: ReadonlyArray<ResolvedAudioEqSettings> | undefined,
  source?: AudioEqSettings | AudioEqFieldSource | null,
): ResolvedAudioEqSettings[] {
  if (source == null || isAudioEqSourceDisabled(source)) {
    return [...(stages ?? [])];
  }

  return [...(stages ?? []), resolveAudioEqSettings(source)];
}

export function appendOptionalResolvedAudioEqStage(
  stages: ReadonlyArray<ResolvedAudioEqSettings> | undefined,
  source?: AudioEqSettings | AudioEqFieldSource | null,
): ResolvedAudioEqSettings[] {
  if (source == null || isAudioEqSourceDisabled(source)) {
    return [...(stages ?? [])];
  }

  return appendResolvedAudioEqStage(stages, source);
}

export function appendResolvedAudioEqSources(
  stages: ReadonlyArray<ResolvedAudioEqSettings> | undefined,
  ...sources: Array<AudioEqSettings | AudioEqFieldSource | null | undefined>
): ResolvedAudioEqSettings[] {
  let nextStages = [...(stages ?? [])];

  for (const source of sources) {
    if (source == null) continue;
    nextStages = appendResolvedAudioEqStage(nextStages, source);
  }

  return nextStages;
}

export function prependResolvedAudioEqSources(
  stages: ReadonlyArray<ResolvedAudioEqSettings> | undefined,
  ...sources: Array<AudioEqSettings | AudioEqFieldSource | null | undefined>
): ResolvedAudioEqSettings[] {
  const prefixStages = appendResolvedAudioEqSources(undefined, ...sources);

  if (prefixStages.length === 0) {
    return [...(stages ?? [])];
  }

  return [...prefixStages, ...(stages ?? [])];
}

export function normalizeAudioEqSettings(
  source?: AudioEqSettings | AudioEqFieldSource | null,
): AudioEqSettings | undefined {
  if (source == null) {
    return undefined;
  }

  return {
    ...(source && 'enabled' in source && source.enabled !== undefined ? { enabled: !!source.enabled } : {}),
    ...resolveAudioEqSettings(source),
  };
}

export function resolvePreviewAudioEqStages(
  baseStages: ReadonlyArray<ResolvedAudioEqSettings> | undefined,
  previewSource?: AudioEqFieldSource | null,
): ResolvedAudioEqSettings[] {
  const stages = baseStages && baseStages.length > 0
    ? [...baseStages]
    : [resolveAudioEqSettings()];
  const fallbackOwnStage = stages[stages.length - 1] ?? DEFAULT_AUDIO_EQ_SETTINGS;
  stages[stages.length - 1] = resolveAudioEqSettings({
    ...fallbackOwnStage,
    ...getSparseAudioEqSettings(previewSource),
  });

  return stages;
}

export function isAudioEqStageActive(stage?: AudioEqSettings | ResolvedAudioEqSettings | null): boolean {
  if (!stage) return false;
  return (
    Math.abs(stage.outputGainDb ?? 0) > AUDIO_EQ_ACTIVE_EPSILON
    ||
    (!!stage.band1Enabled && stage.band1Type === 'high-pass')
    || (!!stage.band1Enabled && stage.band1Type !== 'high-pass' && Math.abs(stage.band1GainDb ?? 0) > AUDIO_EQ_ACTIVE_EPSILON)
    || (!!stage.lowEnabled && stage.lowType === 'notch')
    || (!!stage.lowEnabled && Math.abs(stage.lowGainDb ?? 0) > AUDIO_EQ_ACTIVE_EPSILON)
    || (!!stage.lowMidEnabled && stage.lowMidType === 'notch')
    || (!!stage.lowMidEnabled && Math.abs(stage.lowMidGainDb ?? 0) > AUDIO_EQ_ACTIVE_EPSILON)
    || Math.abs(stage.midGainDb ?? 0) > AUDIO_EQ_ACTIVE_EPSILON
    || (!!stage.highMidEnabled && stage.highMidType === 'notch')
    || (!!stage.highMidEnabled && Math.abs(stage.highMidGainDb ?? 0) > AUDIO_EQ_ACTIVE_EPSILON)
    || (!!stage.highEnabled && stage.highType === 'notch')
    || (!!stage.highEnabled && Math.abs(stage.highGainDb ?? 0) > AUDIO_EQ_ACTIVE_EPSILON)
    || (!!stage.band6Enabled && stage.band6Type === 'low-pass')
    || (!!stage.band6Enabled && stage.band6Type !== 'low-pass' && Math.abs(stage.band6GainDb ?? 0) > AUDIO_EQ_ACTIVE_EPSILON)
  );
}

export function areAudioEqStagesEqual(
  left: ReadonlyArray<ResolvedAudioEqSettings> | undefined,
  right: ReadonlyArray<ResolvedAudioEqSettings> | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return !left && !right;
  if (left.length !== right.length) return false;

  for (let i = 0; i < left.length; i++) {
    const leftStage = left[i];
    const rightStage = right[i];
    if (!leftStage || !rightStage) return false;
    if (
      leftStage.outputGainDb !== rightStage.outputGainDb
      ||
      leftStage.band1Enabled !== rightStage.band1Enabled
      || leftStage.band1Type !== rightStage.band1Type
      || leftStage.band1FrequencyHz !== rightStage.band1FrequencyHz
      || leftStage.band1GainDb !== rightStage.band1GainDb
      || leftStage.band1Q !== rightStage.band1Q
      || leftStage.band1SlopeDbPerOct !== rightStage.band1SlopeDbPerOct
      || leftStage.lowCutEnabled !== rightStage.lowCutEnabled
      || leftStage.lowCutFrequencyHz !== rightStage.lowCutFrequencyHz
      || leftStage.lowCutSlopeDbPerOct !== rightStage.lowCutSlopeDbPerOct
      || leftStage.lowEnabled !== rightStage.lowEnabled
      || leftStage.lowType !== rightStage.lowType
      || leftStage.lowGainDb !== rightStage.lowGainDb
      || leftStage.lowFrequencyHz !== rightStage.lowFrequencyHz
      || leftStage.lowQ !== rightStage.lowQ
      || leftStage.lowMidEnabled !== rightStage.lowMidEnabled
      || leftStage.lowMidType !== rightStage.lowMidType
      || leftStage.lowMidGainDb !== rightStage.lowMidGainDb
      || leftStage.lowMidFrequencyHz !== rightStage.lowMidFrequencyHz
      || leftStage.lowMidQ !== rightStage.lowMidQ
      || leftStage.midGainDb !== rightStage.midGainDb
      || leftStage.highMidEnabled !== rightStage.highMidEnabled
      || leftStage.highMidType !== rightStage.highMidType
      || leftStage.highMidGainDb !== rightStage.highMidGainDb
      || leftStage.highMidFrequencyHz !== rightStage.highMidFrequencyHz
      || leftStage.highMidQ !== rightStage.highMidQ
      || leftStage.highEnabled !== rightStage.highEnabled
      || leftStage.highType !== rightStage.highType
      || leftStage.highGainDb !== rightStage.highGainDb
      || leftStage.highFrequencyHz !== rightStage.highFrequencyHz
      || leftStage.highQ !== rightStage.highQ
      || leftStage.band6Enabled !== rightStage.band6Enabled
      || leftStage.band6Type !== rightStage.band6Type
      || leftStage.band6FrequencyHz !== rightStage.band6FrequencyHz
      || leftStage.band6GainDb !== rightStage.band6GainDb
      || leftStage.band6Q !== rightStage.band6Q
      || leftStage.band6SlopeDbPerOct !== rightStage.band6SlopeDbPerOct
      || leftStage.highCutEnabled !== rightStage.highCutEnabled
      || leftStage.highCutFrequencyHz !== rightStage.highCutFrequencyHz
      || leftStage.highCutSlopeDbPerOct !== rightStage.highCutSlopeDbPerOct
    ) {
      return false;
    }
  }

  return true;
}

function definePreset(
  id: AudioEqPresetId,
  label: string,
  settings: AudioEqSettings,
): AudioEqPresetDefinition {
  return {
    id,
    label,
    settings: Object.freeze(resolveAudioEqSettings(settings)),
  };
}

export const AUDIO_EQ_PRESETS: ReadonlyArray<AudioEqPresetDefinition> = Object.freeze([
  definePreset('flat', 'Flat', {}),
  definePreset('voice-clarity', 'Voice Clarity', {
    lowCutEnabled: true,
    lowCutFrequencyHz: 80,
    lowCutSlopeDbPerOct: 12,
    lowGainDb: -1.5,
    lowFrequencyHz: 120,
    lowMidGainDb: -2.5,
    lowMidFrequencyHz: 320,
    lowMidQ: 1.2,
    highMidGainDb: 4.5,
    highMidFrequencyHz: 2800,
    highMidQ: 1.1,
    highGainDb: 2,
    highFrequencyHz: 7200,
  }),
  definePreset('podcast', 'Podcast', {
    lowCutEnabled: true,
    lowCutFrequencyHz: 70,
    lowCutSlopeDbPerOct: 12,
    lowGainDb: -1,
    lowFrequencyHz: 120,
    lowMidGainDb: -1.5,
    lowMidFrequencyHz: 250,
    lowMidQ: 1,
    highMidGainDb: 5.5,
    highMidFrequencyHz: 3000,
    highMidQ: 1.25,
    highGainDb: 2.5,
    highFrequencyHz: 9000,
  }),
  definePreset('warmth', 'Warmth', {
    lowGainDb: 4,
    lowFrequencyHz: 110,
    lowMidGainDb: 2,
    lowMidFrequencyHz: 280,
    lowMidQ: 0.9,
    highMidGainDb: -1.5,
    highMidFrequencyHz: 2600,
    highMidQ: 1,
    highGainDb: -2.5,
    highFrequencyHz: 6500,
  }),
  definePreset('bass-boost', 'Bass Boost', {
    lowGainDb: 7,
    lowFrequencyHz: 90,
    lowMidGainDb: 2.5,
    lowMidFrequencyHz: 180,
    lowMidQ: 0.85,
    highMidGainDb: -1,
    highMidFrequencyHz: 2500,
    highMidQ: 0.9,
    highGainDb: 0.5,
    highFrequencyHz: 7000,
  }),
  definePreset('de-mud', 'De-Mud', {
    lowCutEnabled: true,
    lowCutFrequencyHz: 55,
    lowCutSlopeDbPerOct: 12,
    lowGainDb: -1,
    lowFrequencyHz: 120,
    lowMidGainDb: -5,
    lowMidFrequencyHz: 300,
    lowMidQ: 1.4,
    highMidGainDb: 2,
    highMidFrequencyHz: 2600,
    highMidQ: 1,
    highGainDb: 1,
    highFrequencyHz: 7000,
  }),
  definePreset('smile', 'Smile', {
    lowGainDb: 3.5,
    lowFrequencyHz: 95,
    lowMidGainDb: -2,
    lowMidFrequencyHz: 420,
    lowMidQ: 1.2,
    highMidGainDb: 2.5,
    highMidFrequencyHz: 2500,
    highMidQ: 0.9,
    highGainDb: 4.5,
    highFrequencyHz: 9500,
  }),
  definePreset('sparkle', 'Sparkle', {
    lowCutEnabled: true,
    lowCutFrequencyHz: 60,
    lowCutSlopeDbPerOct: 6,
    lowGainDb: -2,
    lowFrequencyHz: 100,
    lowMidGainDb: -1.5,
    lowMidFrequencyHz: 350,
    lowMidQ: 1.1,
    highMidGainDb: 4,
    highMidFrequencyHz: 3400,
    highMidQ: 1,
    highGainDb: 6,
    highFrequencyHz: 9500,
  }),
  definePreset('air', 'Air', {
    lowCutEnabled: true,
    lowCutFrequencyHz: 75,
    lowCutSlopeDbPerOct: 12,
    lowGainDb: -3,
    lowFrequencyHz: 110,
    lowMidGainDb: -1.5,
    lowMidFrequencyHz: 350,
    lowMidQ: 0.95,
    highMidGainDb: 2,
    highMidFrequencyHz: 2800,
    highMidQ: 0.85,
    highGainDb: 7,
    highFrequencyHz: 11000,
  }),
  definePreset('soften', 'Soften', {
    lowGainDb: 1.5,
    lowFrequencyHz: 120,
    lowMidGainDb: 1,
    lowMidFrequencyHz: 280,
    lowMidQ: 1,
    highMidGainDb: -2.5,
    highMidFrequencyHz: 3200,
    highMidQ: 1.05,
    highGainDb: -4.5,
    highFrequencyHz: 8000,
    highCutEnabled: true,
    highCutFrequencyHz: 14000,
    highCutSlopeDbPerOct: 12,
  }),
  definePreset('radio', 'Radio', {
    lowCutEnabled: true,
    lowCutFrequencyHz: 220,
    lowCutSlopeDbPerOct: 18,
    lowGainDb: -6,
    lowFrequencyHz: 250,
    lowMidGainDb: -3,
    lowMidFrequencyHz: 500,
    lowMidQ: 1.3,
    highMidGainDb: 2,
    highMidFrequencyHz: 1800,
    highMidQ: 1,
    highGainDb: -6,
    highFrequencyHz: 3500,
    highCutEnabled: true,
    highCutFrequencyHz: 4200,
    highCutSlopeDbPerOct: 18,
  }),
  definePreset('telephone', 'Telephone', {
    lowCutEnabled: true,
    lowCutFrequencyHz: 399,
    lowCutSlopeDbPerOct: 24,
    lowGainDb: -18,
    lowFrequencyHz: 395,
    lowMidGainDb: -15,
    lowMidFrequencyHz: 657,
    lowMidQ: 1.4,
    highMidGainDb: -14,
    highMidFrequencyHz: 1600,
    highMidQ: 1.25,
    highGainDb: -18,
    highFrequencyHz: 2800,
    highCutEnabled: true,
    highCutFrequencyHz: 2000,
    highCutSlopeDbPerOct: 24,
  }),
  definePreset('dialog-lift', 'Dialog Lift', {
    lowCutEnabled: true,
    lowCutFrequencyHz: 75,
    lowCutSlopeDbPerOct: 12,
    lowGainDb: -2,
    lowFrequencyHz: 120,
    lowMidGainDb: -2,
    lowMidFrequencyHz: 280,
    lowMidQ: 1.1,
    highMidGainDb: 3.5,
    highMidFrequencyHz: 2400,
    highMidQ: 1.2,
    highGainDb: 1.5,
    highFrequencyHz: 7000,
  }),
  definePreset('rumble-cut', 'Rumble Cut', {
    lowCutEnabled: true,
    lowCutFrequencyHz: 100,
    lowCutSlopeDbPerOct: 18,
    lowGainDb: -3,
    lowFrequencyHz: 110,
    lowMidGainDb: -1,
    lowMidFrequencyHz: 250,
    lowMidQ: 1,
  }),
  definePreset('brighten', 'Brighten', {
    lowCutEnabled: true,
    lowCutFrequencyHz: 50,
    lowCutSlopeDbPerOct: 6,
    lowGainDb: -1,
    lowFrequencyHz: 120,
    lowMidGainDb: -1,
    lowMidFrequencyHz: 350,
    lowMidQ: 1,
    highMidGainDb: 2.5,
    highMidFrequencyHz: 3000,
    highMidQ: 1,
    highGainDb: 5,
    highFrequencyHz: 8500,
  }),
]);

export function getAudioEqPresetById(presetId: AudioEqPresetId): AudioEqPresetDefinition | undefined {
  return AUDIO_EQ_PRESETS.find((preset) => preset.id === presetId);
}

export function findAudioEqPresetId(
  source?: AudioEqSettings | AudioEqFieldSource | null,
): AudioEqPresetId | null {
  const resolved = resolveAudioEqSettings(source);
  const preset = AUDIO_EQ_PRESETS.find(({ settings }) => areAudioEqStagesEqual([settings], [resolved]));
  return preset?.id ?? null;
}

function buildPeakingCoefficients(
  frequencyHz: number,
  gainDb: number,
  sampleRate: number,
  q: number,
): BiquadCoefficients {
  const frequency = clampFrequencyForSampleRate(frequencyHz, sampleRate);
  const safeQ = clampAudioEqQ(q, AUDIO_EQ_LOW_MID_Q);
  const a = Math.pow(10, gainDb / 40);
  const w0 = 2 * Math.PI * (frequency / sampleRate);
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * safeQ);
  const b0 = 1 + alpha * a;
  const b1 = -2 * cosW0;
  const b2 = 1 - alpha * a;
  const a0 = 1 + alpha / a;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha / a;

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

function buildNotchCoefficients(
  frequencyHz: number,
  sampleRate: number,
  q: number,
): BiquadCoefficients {
  const frequency = clampFrequencyForSampleRate(frequencyHz, sampleRate);
  const safeQ = clampAudioEqQ(q, AUDIO_EQ_LOW_MID_Q);
  const w0 = 2 * Math.PI * (frequency / sampleRate);
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * safeQ);
  const b0 = 1;
  const b1 = -2 * cosW0;
  const b2 = 1;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha;

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

function buildShelfCoefficients(
  type: 'lowshelf' | 'highshelf',
  frequencyHz: number,
  gainDb: number,
  sampleRate: number,
): BiquadCoefficients {
  const frequency = clampFrequencyForSampleRate(frequencyHz, sampleRate);
  const a = Math.pow(10, gainDb / 40);
  const w0 = 2 * Math.PI * (frequency / sampleRate);
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const sqrtA = Math.sqrt(a);
  const alpha = sinW0 / 2 * Math.sqrt((a + 1 / a) * (1 / AUDIO_EQ_SHELF_SLOPE - 1) + 2);

  let b0: number;
  let b1: number;
  let b2: number;
  let a0: number;
  let a1: number;
  let a2: number;

  if (type === 'lowshelf') {
    b0 = a * ((a + 1) - (a - 1) * cosW0 + 2 * sqrtA * alpha);
    b1 = 2 * a * ((a - 1) - (a + 1) * cosW0);
    b2 = a * ((a + 1) - (a - 1) * cosW0 - 2 * sqrtA * alpha);
    a0 = (a + 1) + (a - 1) * cosW0 + 2 * sqrtA * alpha;
    a1 = -2 * ((a - 1) + (a + 1) * cosW0);
    a2 = (a + 1) + (a - 1) * cosW0 - 2 * sqrtA * alpha;
  } else {
    b0 = a * ((a + 1) + (a - 1) * cosW0 + 2 * sqrtA * alpha);
    b1 = -2 * a * ((a - 1) + (a + 1) * cosW0);
    b2 = a * ((a + 1) + (a - 1) * cosW0 - 2 * sqrtA * alpha);
    a0 = (a + 1) - (a - 1) * cosW0 + 2 * sqrtA * alpha;
    a1 = 2 * ((a - 1) - (a + 1) * cosW0);
    a2 = (a + 1) - (a - 1) * cosW0 - 2 * sqrtA * alpha;
  }

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

type AudioEqBiquadType = 'lowshelf' | 'highshelf' | 'peaking' | 'notch';

function isPassBand1Type(type: AudioEqBand1Type): type is 'high-pass' {
  return type === 'high-pass';
}

function isPassBand6Type(type: AudioEqBand6Type): type is 'low-pass' {
  return type === 'low-pass';
}

function getBand1BiquadType(type: AudioEqBand1Type): AudioEqBiquadType | null {
  switch (type) {
    case 'low-shelf':
      return 'lowshelf';
    case 'peaking':
      return 'peaking';
    case 'high-shelf':
      return 'highshelf';
    default:
      return null;
  }
}

function getBand6BiquadType(type: AudioEqBand6Type): AudioEqBiquadType | null {
  switch (type) {
    case 'low-shelf':
      return 'lowshelf';
    case 'peaking':
      return 'peaking';
    case 'high-shelf':
      return 'highshelf';
    default:
      return null;
  }
}

function getInnerBandBiquadType(type: AudioEqInnerBandType): AudioEqBiquadType {
  switch (type) {
    case 'low-shelf':
      return 'lowshelf';
    case 'high-shelf':
      return 'highshelf';
    case 'notch':
      return 'notch';
    default:
      return 'peaking';
  }
}

function buildEqBiquadCoefficients(
  type: AudioEqBiquadType,
  frequencyHz: number,
  gainDb: number,
  sampleRate: number,
  q: number,
): BiquadCoefficients {
  switch (type) {
    case 'lowshelf':
    case 'highshelf':
      return buildShelfCoefficients(type, frequencyHz, gainDb, sampleRate);
    case 'notch':
      return buildNotchCoefficients(frequencyHz, sampleRate, q);
    default:
      return buildPeakingCoefficients(frequencyHz, gainDb, sampleRate, q);
  }
}

function buildOnePolePassCoefficients(
  type: 'highpass' | 'lowpass',
  frequencyHz: number,
  sampleRate: number,
): OnePoleCoefficients {
  const frequency = clampFrequencyForSampleRate(frequencyHz, sampleRate);
  const k = Math.tan(Math.PI * (frequency / sampleRate));
  const norm = 1 / (1 + k);

  if (type === 'highpass') {
    return {
      b0: norm,
      b1: -norm,
      a1: (k - 1) * norm,
    };
  }

  return {
    b0: k * norm,
    b1: k * norm,
    a1: (k - 1) * norm,
  };
}

export function buildAudioEqPassIirCoefficients(
  type: 'highpass' | 'lowpass',
  frequencyHz: number,
  sampleRate: number,
): AudioEqIirCoefficients {
  const coefficients = buildOnePolePassCoefficients(type, frequencyHz, sampleRate);
  return {
    feedforward: [coefficients.b0, coefficients.b1],
    feedback: [1, coefficients.a1],
  };
}

function evaluateBiquadMagnitudeDb(
  coefficients: BiquadCoefficients,
  frequencyHz: number,
  sampleRate: number,
): number {
  const frequency = clampFrequencyForSampleRate(frequencyHz, sampleRate);
  const omega = 2 * Math.PI * (frequency / sampleRate);
  const cosOmega = Math.cos(omega);
  const sinOmega = Math.sin(omega);
  const cosDoubleOmega = Math.cos(2 * omega);
  const sinDoubleOmega = Math.sin(2 * omega);

  const numeratorReal = coefficients.b0 + coefficients.b1 * cosOmega + coefficients.b2 * cosDoubleOmega;
  const numeratorImag = -coefficients.b1 * sinOmega - coefficients.b2 * sinDoubleOmega;
  const denominatorReal = 1 + coefficients.a1 * cosOmega + coefficients.a2 * cosDoubleOmega;
  const denominatorImag = -coefficients.a1 * sinOmega - coefficients.a2 * sinDoubleOmega;

  const numeratorMagnitudeSq = numeratorReal * numeratorReal + numeratorImag * numeratorImag;
  const denominatorMagnitudeSq = denominatorReal * denominatorReal + denominatorImag * denominatorImag;
  const magnitude = Math.sqrt(numeratorMagnitudeSq / Math.max(denominatorMagnitudeSq, 1e-12));

  return 20 * Math.log10(Math.max(magnitude, 1e-6));
}

function evaluateOnePoleMagnitudeDb(
  coefficients: OnePoleCoefficients,
  frequencyHz: number,
  sampleRate: number,
): number {
  const frequency = clampFrequencyForSampleRate(frequencyHz, sampleRate);
  const omega = 2 * Math.PI * (frequency / sampleRate);
  const cosOmega = Math.cos(omega);
  const sinOmega = Math.sin(omega);

  const numeratorReal = coefficients.b0 + coefficients.b1 * cosOmega;
  const numeratorImag = -coefficients.b1 * sinOmega;
  const denominatorReal = 1 + coefficients.a1 * cosOmega;
  const denominatorImag = -coefficients.a1 * sinOmega;

  const numeratorMagnitudeSq = numeratorReal * numeratorReal + numeratorImag * numeratorImag;
  const denominatorMagnitudeSq = denominatorReal * denominatorReal + denominatorImag * denominatorImag;
  const magnitude = Math.sqrt(numeratorMagnitudeSq / Math.max(denominatorMagnitudeSq, 1e-12));

  return 20 * Math.log10(Math.max(magnitude, 1e-6));
}

function getCutFilterStageCount(slopeDbPerOct: AudioEqCutSlopeDbPerOct): number {
  return Math.max(1, Math.round(slopeDbPerOct / 6));
}

function getResolvedAudioEqResponseGainDb(
  stage: ResolvedAudioEqSettings,
  frequencyHz: number,
  sampleRate: number,
): number {
  let gainDb = 0;

  if (stage.band1Enabled && isPassBand1Type(stage.band1Type)) {
    const coefficients = buildOnePolePassCoefficients('highpass', stage.band1FrequencyHz, sampleRate);
    for (let i = 0; i < getCutFilterStageCount(stage.lowCutSlopeDbPerOct); i++) {
      gainDb += evaluateOnePoleMagnitudeDb(coefficients, frequencyHz, sampleRate);
    }
  } else if (stage.band1Enabled) {
    const biquadType = getBand1BiquadType(stage.band1Type);
    if (biquadType) {
      gainDb += evaluateBiquadMagnitudeDb(
        buildEqBiquadCoefficients(biquadType, stage.band1FrequencyHz, stage.band1GainDb, sampleRate, stage.band1Q),
        frequencyHz,
        sampleRate,
      );
    }
  }

  if (stage.lowEnabled && (stage.lowType === 'notch' || Math.abs(stage.lowGainDb) > AUDIO_EQ_ACTIVE_EPSILON)) {
    gainDb += evaluateBiquadMagnitudeDb(
      buildEqBiquadCoefficients(getInnerBandBiquadType(stage.lowType), stage.lowFrequencyHz, stage.lowGainDb, sampleRate, stage.lowQ),
      frequencyHz,
      sampleRate,
    );
  }

  if (stage.lowMidEnabled && (stage.lowMidType === 'notch' || Math.abs(stage.lowMidGainDb) > AUDIO_EQ_ACTIVE_EPSILON)) {
    gainDb += evaluateBiquadMagnitudeDb(
      buildEqBiquadCoefficients(getInnerBandBiquadType(stage.lowMidType), stage.lowMidFrequencyHz, stage.lowMidGainDb, sampleRate, stage.lowMidQ),
      frequencyHz,
      sampleRate,
    );
  }

  if (Math.abs(stage.midGainDb) > AUDIO_EQ_ACTIVE_EPSILON) {
    gainDb += evaluateBiquadMagnitudeDb(
      buildPeakingCoefficients(AUDIO_EQ_MID_FREQUENCY_HZ, stage.midGainDb, sampleRate, AUDIO_EQ_MID_Q),
      frequencyHz,
      sampleRate,
    );
  }

  if (stage.highMidEnabled && (stage.highMidType === 'notch' || Math.abs(stage.highMidGainDb) > AUDIO_EQ_ACTIVE_EPSILON)) {
    gainDb += evaluateBiquadMagnitudeDb(
      buildEqBiquadCoefficients(getInnerBandBiquadType(stage.highMidType), stage.highMidFrequencyHz, stage.highMidGainDb, sampleRate, stage.highMidQ),
      frequencyHz,
      sampleRate,
    );
  }

  if (stage.highEnabled && (stage.highType === 'notch' || Math.abs(stage.highGainDb) > AUDIO_EQ_ACTIVE_EPSILON)) {
    gainDb += evaluateBiquadMagnitudeDb(
      buildEqBiquadCoefficients(getInnerBandBiquadType(stage.highType), stage.highFrequencyHz, stage.highGainDb, sampleRate, stage.highQ),
      frequencyHz,
      sampleRate,
    );
  }

  if (stage.band6Enabled && isPassBand6Type(stage.band6Type)) {
    const coefficients = buildOnePolePassCoefficients('lowpass', stage.band6FrequencyHz, sampleRate);
    for (let i = 0; i < getCutFilterStageCount(stage.highCutSlopeDbPerOct); i++) {
      gainDb += evaluateOnePoleMagnitudeDb(coefficients, frequencyHz, sampleRate);
    }
  } else if (stage.band6Enabled) {
    const biquadType = getBand6BiquadType(stage.band6Type);
    if (biquadType) {
      gainDb += evaluateBiquadMagnitudeDb(
        buildEqBiquadCoefficients(biquadType, stage.band6FrequencyHz, stage.band6GainDb, sampleRate, stage.band6Q),
        frequencyHz,
        sampleRate,
      );
    }
  }

  return gainDb;
}

export function getAudioEqResponseGainDb(
  source?: AudioEqSettings | AudioEqFieldSource | null,
  frequencyHz = AUDIO_EQ_MID_FREQUENCY_HZ,
  sampleRate = 48000,
): number {
  return getResolvedAudioEqResponseGainDb(resolveAudioEqSettings(source), frequencyHz, sampleRate);
}

export function sampleAudioEqResponseCurve(
  source?: AudioEqSettings | AudioEqFieldSource | null,
  options?: {
    sampleRate?: number;
    sampleCount?: number;
    minFrequencyHz?: number;
    maxFrequencyHz?: number;
  },
): AudioEqResponsePoint[] {
  const sampleRate = options?.sampleRate ?? 48000;
  const sampleCount = Math.max(2, Math.round(options?.sampleCount ?? 96));
  const minFrequencyHz = Math.max(20, options?.minFrequencyHz ?? AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ);
  const maxFrequencyHz = Math.max(minFrequencyHz + 1, options?.maxFrequencyHz ?? 16000);
  const ratio = maxFrequencyHz / minFrequencyHz;
  const stage = resolveAudioEqSettings(source);

  return Array.from({ length: sampleCount }, (_, index) => {
    const t = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    const frequencyHz = minFrequencyHz * Math.pow(ratio, t);
    return {
      frequencyHz,
      gainDb: getResolvedAudioEqResponseGainDb(stage, frequencyHz, sampleRate),
    };
  });
}

function applyBiquad(samples: Float32Array, coefficients: BiquadCoefficients): Float32Array {
  const output = new Float32Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i] ?? 0;
    const y0 = (
      coefficients.b0 * x0
      + coefficients.b1 * x1
      + coefficients.b2 * x2
      - coefficients.a1 * y1
      - coefficients.a2 * y2
    );
    output[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }

  return output;
}

function applyOnePole(samples: Float32Array, coefficients: OnePoleCoefficients): Float32Array {
  const output = new Float32Array(samples.length);
  let x1 = 0;
  let y1 = 0;

  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i] ?? 0;
    const y0 = coefficients.b0 * x0 + coefficients.b1 * x1 - coefficients.a1 * y1;
    output[i] = y0;
    x1 = x0;
    y1 = y0;
  }

  return output;
}

function applyLinearGain(samples: Float32Array, gain: number): Float32Array {
  if (Math.abs(gain - 1) <= AUDIO_EQ_ACTIVE_EPSILON) {
    return samples;
  }

  const output = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    output[i] = (samples[i] ?? 0) * gain;
  }
  return output;
}

function applyCutFilter(
  samples: Float32Array,
  type: 'highpass' | 'lowpass',
  frequencyHz: number,
  slopeDbPerOct: AudioEqCutSlopeDbPerOct,
  sampleRate: number,
): Float32Array {
  const coefficients = buildOnePolePassCoefficients(type, frequencyHz, sampleRate);
  let output = samples;

  for (let i = 0; i < getCutFilterStageCount(slopeDbPerOct); i++) {
    output = applyOnePole(output, coefficients);
  }

  return output;
}

function applyAudioEqStage(
  samples: Float32Array,
  sampleRate: number,
  stage: ResolvedAudioEqSettings,
): Float32Array {
  let output = samples;

  if (stage.band1Enabled && isPassBand1Type(stage.band1Type)) {
    output = applyCutFilter(output, 'highpass', stage.band1FrequencyHz, stage.band1SlopeDbPerOct, sampleRate);
  } else if (stage.band1Enabled) {
    const biquadType = getBand1BiquadType(stage.band1Type);
    if (biquadType) {
      output = applyBiquad(
        output,
        buildEqBiquadCoefficients(biquadType, stage.band1FrequencyHz, stage.band1GainDb, sampleRate, stage.band1Q),
      );
    }
  }

  if (stage.lowEnabled && (stage.lowType === 'notch' || Math.abs(stage.lowGainDb) > AUDIO_EQ_ACTIVE_EPSILON)) {
    output = applyBiquad(
      output,
      buildEqBiquadCoefficients(getInnerBandBiquadType(stage.lowType), stage.lowFrequencyHz, stage.lowGainDb, sampleRate, stage.lowQ),
    );
  }

  if (stage.lowMidEnabled && (stage.lowMidType === 'notch' || Math.abs(stage.lowMidGainDb) > AUDIO_EQ_ACTIVE_EPSILON)) {
    output = applyBiquad(
      output,
      buildEqBiquadCoefficients(getInnerBandBiquadType(stage.lowMidType), stage.lowMidFrequencyHz, stage.lowMidGainDb, sampleRate, stage.lowMidQ),
    );
  }

  if (Math.abs(stage.midGainDb) > AUDIO_EQ_ACTIVE_EPSILON) {
    output = applyBiquad(
      output,
      buildPeakingCoefficients(AUDIO_EQ_MID_FREQUENCY_HZ, stage.midGainDb, sampleRate, AUDIO_EQ_MID_Q),
    );
  }

  if (stage.highMidEnabled && (stage.highMidType === 'notch' || Math.abs(stage.highMidGainDb) > AUDIO_EQ_ACTIVE_EPSILON)) {
    output = applyBiquad(
      output,
      buildEqBiquadCoefficients(getInnerBandBiquadType(stage.highMidType), stage.highMidFrequencyHz, stage.highMidGainDb, sampleRate, stage.highMidQ),
    );
  }

  if (stage.highEnabled && (stage.highType === 'notch' || Math.abs(stage.highGainDb) > AUDIO_EQ_ACTIVE_EPSILON)) {
    output = applyBiquad(
      output,
      buildEqBiquadCoefficients(getInnerBandBiquadType(stage.highType), stage.highFrequencyHz, stage.highGainDb, sampleRate, stage.highQ),
    );
  }

  if (stage.band6Enabled && isPassBand6Type(stage.band6Type)) {
    output = applyCutFilter(output, 'lowpass', stage.band6FrequencyHz, stage.band6SlopeDbPerOct, sampleRate);
  } else if (stage.band6Enabled) {
    const biquadType = getBand6BiquadType(stage.band6Type);
    if (biquadType) {
      output = applyBiquad(
        output,
        buildEqBiquadCoefficients(biquadType, stage.band6FrequencyHz, stage.band6GainDb, sampleRate, stage.band6Q),
      );
    }
  }

  if (Math.abs(stage.outputGainDb) > AUDIO_EQ_ACTIVE_EPSILON) {
    output = applyLinearGain(output, Math.pow(10, stage.outputGainDb / 20));
  }

  return output;
}

export function applyAudioEqStages(
  channels: Float32Array[],
  sampleRate: number,
  stages: ReadonlyArray<ResolvedAudioEqSettings> | undefined,
): Float32Array[] {
  if (!stages || stages.length === 0 || !stages.some(isAudioEqStageActive)) {
    return channels;
  }

  return channels.map((channel) => {
    let output = channel;
    for (const stage of stages) {
      if (!isAudioEqStageActive(stage)) continue;
      output = applyAudioEqStage(output, sampleRate, stage);
    }
    return output;
  });
}
