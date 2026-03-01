import type {
  ItemEffect,
  LUTEffect,
  CurvesEffect,
  WheelsEffect,
  VisualEffect,
  CurvesChannels,
} from '@/types/effects';
import { LUT_PRESET_CONFIGS } from '@/types/effects';
import { evaluateMonotoneCurve } from '@/shared/utils/curve-spline';

type ColorGradingEffect = LUTEffect | CurvesEffect | WheelsEffect;

interface FilterTargets {
  brightness: number;
  contrast: number;
  saturate: number;
  sepia: number;
  hueRotate: number;
  grayscale: number;
}

const DEFAULT_FILTERS: FilterTargets = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  sepia: 0,
  hueRotate: 0,
  grayscale: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function mix(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function clampPercentFilter(value: number): number {
  return clamp(value, 0, 400);
}

function clampAngle(value: number): number {
  return clamp(value, -180, 180);
}

function toFilterTargets(effect: ColorGradingEffect): FilterTargets {
  if (effect.variant === 'lut') {
    return lutToTargets(effect);
  }
  if (effect.variant === 'curves') {
    return curvesToTargets(effect);
  }
  return wheelsToTargets(effect);
}

function curvesToLegacyControls(channels: CurvesChannels): {
  shadows: number;
  midtones: number;
  highlights: number;
  contrast: number;
  red: number;
  green: number;
  blue: number;
} {
  const m25 = evaluateMonotoneCurve(channels.master, 0.25);
  const m50 = evaluateMonotoneCurve(channels.master, 0.5);
  const m75 = evaluateMonotoneCurve(channels.master, 0.75);
  const r25 = evaluateMonotoneCurve(channels.red, 0.25);
  const r50 = evaluateMonotoneCurve(channels.red, 0.5);
  const r75 = evaluateMonotoneCurve(channels.red, 0.75);
  const g25 = evaluateMonotoneCurve(channels.green, 0.25);
  const g50 = evaluateMonotoneCurve(channels.green, 0.5);
  const g75 = evaluateMonotoneCurve(channels.green, 0.75);
  const b25 = evaluateMonotoneCurve(channels.blue, 0.25);
  const b50 = evaluateMonotoneCurve(channels.blue, 0.5);
  const b75 = evaluateMonotoneCurve(channels.blue, 0.75);

  const shadows = clamp((m25 - 0.25) * 220, -100, 100);
  const midtones = clamp((m50 - 0.5) * 220, -100, 100);
  const highlights = clamp((m75 - 0.75) * 220, -100, 100);
  const contrast = clamp((((m75 - m25) / 0.5) - 1) * 100, -100, 100);

  const red = clamp((((r25 - 0.25) + (r50 - 0.5) + (r75 - 0.75)) / 3) * 260, -100, 100);
  const green = clamp((((g25 - 0.25) + (g50 - 0.5) + (g75 - 0.75)) / 3) * 260, -100, 100);
  const blue = clamp((((b25 - 0.25) + (b50 - 0.5) + (b75 - 0.75)) / 3) * 260, -100, 100);

  return {
    shadows: round2(shadows),
    midtones: round2(midtones),
    highlights: round2(highlights),
    contrast: round2(contrast),
    red: round2(red),
    green: round2(green),
    blue: round2(blue),
  };
}

function lutToTargets(effect: LUTEffect): FilterTargets {
  if (effect.cubeData && effect.cubeData.trim().length > 0) {
    // Real .cube transforms are applied in pixel pipeline (export). Keep CSS filter path neutral.
    return { ...DEFAULT_FILTERS };
  }

  const preset = LUT_PRESET_CONFIGS[effect.preset];
  const intensity = clamp(effect.intensity, 0, 1);

  return {
    brightness: round2(mix(DEFAULT_FILTERS.brightness, preset.target.brightness ?? 100, intensity)),
    contrast: round2(mix(DEFAULT_FILTERS.contrast, preset.target.contrast ?? 100, intensity)),
    saturate: round2(mix(DEFAULT_FILTERS.saturate, preset.target.saturate ?? 100, intensity)),
    sepia: round2(mix(DEFAULT_FILTERS.sepia, preset.target.sepia ?? 0, intensity)),
    hueRotate: round2((preset.target.hueRotate ?? 0) * intensity),
    grayscale: round2(mix(DEFAULT_FILTERS.grayscale, preset.target.grayscale ?? 0, intensity)),
  };
}

function curvesToTargets(effect: CurvesEffect): FilterTargets {
  const controls = effect.channels
    ? curvesToLegacyControls(effect.channels)
    : {
        shadows: effect.shadows,
        midtones: effect.midtones,
        highlights: effect.highlights,
        contrast: effect.contrast,
        red: effect.red,
        green: effect.green,
        blue: effect.blue,
      };
  const shadows = clamp(controls.shadows, -100, 100);
  const midtones = clamp(controls.midtones, -100, 100);
  const highlights = clamp(controls.highlights, -100, 100);
  const contrastBias = clamp(controls.contrast, -100, 100);
  const red = clamp(controls.red, -100, 100);
  const green = clamp(controls.green, -100, 100);
  const blue = clamp(controls.blue, -100, 100);

  const brightness =
    100
    + highlights * 0.25
    + midtones * 0.14
    + shadows * 0.1;
  const contrast =
    100
    + contrastBias * 0.72
    + (highlights - shadows) * 0.22;
  const saturate =
    100
    + (red + green + blue) * 0.06
    + midtones * 0.05;
  const hueRotate =
    (green - red) * 0.08
    + (blue - green) * 0.05;
  const sepia =
    Math.max(0, red * 0.08 - blue * 0.05);
  const grayscale = Math.max(0, -(red + green + blue) * 0.05);

  return {
    brightness: round2(clampPercentFilter(brightness)),
    contrast: round2(clampPercentFilter(contrast)),
    saturate: round2(clampPercentFilter(saturate)),
    sepia: round2(clamp(sepia, 0, 100)),
    hueRotate: round2(clampAngle(hueRotate)),
    grayscale: round2(clamp(grayscale, 0, 100)),
  };
}

function wheelsToTargets(effect: WheelsEffect): FilterTargets {
  const shAmt = clamp(effect.shadowsAmount, 0, 1);
  const mtAmt = clamp(effect.midtonesAmount, 0, 1);
  const hiAmt = clamp(effect.highlightsAmount, 0, 1);

  const totalAmt = shAmt + mtAmt + hiAmt;

  const vecX =
    Math.cos((effect.shadowsHue * Math.PI) / 180) * shAmt
    + Math.cos((effect.midtonesHue * Math.PI) / 180) * mtAmt
    + Math.cos((effect.highlightsHue * Math.PI) / 180) * hiAmt;
  const vecY =
    Math.sin((effect.shadowsHue * Math.PI) / 180) * shAmt
    + Math.sin((effect.midtonesHue * Math.PI) / 180) * mtAmt
    + Math.sin((effect.highlightsHue * Math.PI) / 180) * hiAmt;

  const wheelHue = totalAmt > 0 ? (Math.atan2(vecY, vecX) * 180) / Math.PI : 0;

  const temperature = clamp(effect.temperature, -100, 100);
  const tint = clamp(effect.tint, -100, 100);
  const saturationBias = clamp(effect.saturation, -100, 100);

  const brightness =
    100
    + hiAmt * 8
    - shAmt * 6
    + temperature * 0.08;
  const contrast =
    100
    + (hiAmt - shAmt) * 18
    + mtAmt * 4;
  const saturate =
    100
    + saturationBias * 0.7
    + totalAmt * 20;
  const sepia =
    Math.max(0, temperature * 0.2 + mtAmt * 8);
  const hueRotate =
    wheelHue * 0.25
    + tint * 0.24
    + temperature * 0.05;

  return {
    brightness: round2(clampPercentFilter(brightness)),
    contrast: round2(clampPercentFilter(contrast)),
    saturate: round2(clampPercentFilter(saturate)),
    sepia: round2(clamp(sepia, 0, 100)),
    hueRotate: round2(clampAngle(hueRotate)),
    grayscale: 0,
  };
}

function targetsToCssFilters(targets: FilterTargets): string[] {
  const filters: string[] = [];

  if (Math.abs(targets.brightness - 100) > 0.05) {
    filters.push(`brightness(${round2(targets.brightness)}%)`);
  }
  if (Math.abs(targets.contrast - 100) > 0.05) {
    filters.push(`contrast(${round2(targets.contrast)}%)`);
  }
  if (Math.abs(targets.saturate - 100) > 0.05) {
    filters.push(`saturate(${round2(targets.saturate)}%)`);
  }
  if (Math.abs(targets.sepia) > 0.05) {
    filters.push(`sepia(${round2(targets.sepia)}%)`);
  }
  if (Math.abs(targets.grayscale) > 0.05) {
    filters.push(`grayscale(${round2(targets.grayscale)}%)`);
  }
  if (Math.abs(targets.hueRotate) > 0.05) {
    filters.push(`hue-rotate(${round2(targets.hueRotate)}deg)`);
  }

  return filters;
}

export function isColorGradingEffect(effect: VisualEffect): effect is ColorGradingEffect {
  return effect.type === 'color-grading';
}

export function colorGradingEffectToCssFilters(effect: ColorGradingEffect): string[] {
  return targetsToCssFilters(toFilterTargets(effect));
}

export function getColorGradingFilterString(effects: ItemEffect[]): string {
  return effects
    .filter((entry) => entry.enabled && isColorGradingEffect(entry.effect))
    .flatMap((entry) => colorGradingEffectToCssFilters(entry.effect))
    .join(' ');
}
