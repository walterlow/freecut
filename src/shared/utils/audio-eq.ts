import type { AudioEqSettings, ResolvedAudioEqSettings } from '@/types/audio';

export interface AudioEqFieldSource {
  audioEqLowGainDb?: number;
  audioEqMidGainDb?: number;
  audioEqHighGainDb?: number;
}

export const AUDIO_EQ_GAIN_DB_MIN = -18;
export const AUDIO_EQ_GAIN_DB_MAX = 18;
export const AUDIO_EQ_LOW_FREQUENCY_HZ = 200;
export const AUDIO_EQ_MID_FREQUENCY_HZ = 1000;
export const AUDIO_EQ_MID_Q = 0.9;
export const AUDIO_EQ_HIGH_FREQUENCY_HZ = 5000;
const AUDIO_EQ_SHELF_SLOPE = 1;
const AUDIO_EQ_ACTIVE_EPSILON = 0.001;

export const DEFAULT_AUDIO_EQ_SETTINGS: Readonly<ResolvedAudioEqSettings> = Object.freeze({
  lowGainDb: 0,
  midGainDb: 0,
  highGainDb: 0,
});

function clampFrequency(frequencyHz: number, sampleRate: number): number {
  return Math.max(20, Math.min(frequencyHz, sampleRate * 0.45));
}

export function clampAudioEqGainDb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(AUDIO_EQ_GAIN_DB_MIN, Math.min(AUDIO_EQ_GAIN_DB_MAX, value));
}

export function getAudioEqSettings(source?: AudioEqFieldSource | null): AudioEqSettings {
  return {
    lowGainDb: source?.audioEqLowGainDb,
    midGainDb: source?.audioEqMidGainDb,
    highGainDb: source?.audioEqHighGainDb,
  };
}

export function resolveAudioEqSettings(source?: AudioEqSettings | AudioEqFieldSource | null): ResolvedAudioEqSettings {
  const settings = source as AudioEqSettings | null | undefined;
  const fields = source as AudioEqFieldSource | null | undefined;
  return {
    lowGainDb: clampAudioEqGainDb(settings?.lowGainDb ?? fields?.audioEqLowGainDb ?? 0),
    midGainDb: clampAudioEqGainDb(settings?.midGainDb ?? fields?.audioEqMidGainDb ?? 0),
    highGainDb: clampAudioEqGainDb(settings?.highGainDb ?? fields?.audioEqHighGainDb ?? 0),
  };
}

export function appendResolvedAudioEqStage(
  stages: ReadonlyArray<ResolvedAudioEqSettings> | undefined,
  source?: AudioEqSettings | AudioEqFieldSource | null,
): ResolvedAudioEqSettings[] {
  return [...(stages ?? []), resolveAudioEqSettings(source)];
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
    lowGainDb: previewSource?.audioEqLowGainDb ?? fallbackOwnStage.lowGainDb,
    midGainDb: previewSource?.audioEqMidGainDb ?? fallbackOwnStage.midGainDb,
    highGainDb: previewSource?.audioEqHighGainDb ?? fallbackOwnStage.highGainDb,
  });
  return stages;
}

export function isAudioEqStageActive(stage?: AudioEqSettings | ResolvedAudioEqSettings | null): boolean {
  if (!stage) return false;
  return (
    Math.abs(stage.lowGainDb ?? 0) > AUDIO_EQ_ACTIVE_EPSILON
    || Math.abs(stage.midGainDb ?? 0) > AUDIO_EQ_ACTIVE_EPSILON
    || Math.abs(stage.highGainDb ?? 0) > AUDIO_EQ_ACTIVE_EPSILON
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
      leftStage.lowGainDb !== rightStage.lowGainDb
      || leftStage.midGainDb !== rightStage.midGainDb
      || leftStage.highGainDb !== rightStage.highGainDb
    ) {
      return false;
    }
  }
  return true;
}

interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function buildPeakingCoefficients(
  frequencyHz: number,
  gainDb: number,
  sampleRate: number,
  q: number,
): BiquadCoefficients {
  const frequency = clampFrequency(frequencyHz, sampleRate);
  const a = Math.pow(10, gainDb / 40);
  const w0 = 2 * Math.PI * (frequency / sampleRate);
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
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

function buildShelfCoefficients(
  type: 'lowshelf' | 'highshelf',
  frequencyHz: number,
  gainDb: number,
  sampleRate: number,
): BiquadCoefficients {
  const frequency = clampFrequency(frequencyHz, sampleRate);
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

function applyAudioEqStage(
  samples: Float32Array,
  sampleRate: number,
  stage: ResolvedAudioEqSettings,
): Float32Array {
  let output = samples;

  if (Math.abs(stage.lowGainDb) > AUDIO_EQ_ACTIVE_EPSILON) {
    output = applyBiquad(
      output,
      buildShelfCoefficients('lowshelf', AUDIO_EQ_LOW_FREQUENCY_HZ, stage.lowGainDb, sampleRate),
    );
  }
  if (Math.abs(stage.midGainDb) > AUDIO_EQ_ACTIVE_EPSILON) {
    output = applyBiquad(
      output,
      buildPeakingCoefficients(AUDIO_EQ_MID_FREQUENCY_HZ, stage.midGainDb, sampleRate, AUDIO_EQ_MID_Q),
    );
  }
  if (Math.abs(stage.highGainDb) > AUDIO_EQ_ACTIVE_EPSILON) {
    output = applyBiquad(
      output,
      buildShelfCoefficients('highshelf', AUDIO_EQ_HIGH_FREQUENCY_HZ, stage.highGainDb, sampleRate),
    );
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
