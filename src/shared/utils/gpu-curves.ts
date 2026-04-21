import { buildMonotoneCurveSvgPath, evaluateMonotoneCurve } from './curve-spline';

export type GpuCurvesChannelKey = 'master' | 'red' | 'green' | 'blue';

export interface GpuCurvesControlPoint {
  x: number;
  y: number;
}

export interface GpuCurvesChannelControl {
  shadow: GpuCurvesControlPoint;
  highlight: GpuCurvesControlPoint;
}

type EffectParams = Record<string, number | boolean | string>;

const DEFAULT_POINT_XS = {
  shadow: 0.25,
  highlight: 0.75,
} as const;

export const GPU_CURVES_CHANNELS: GpuCurvesChannelKey[] = ['master', 'red', 'green', 'blue'];
export const GPU_CURVES_POINT_MIN_X = 0.02;
export const GPU_CURVES_POINT_MAX_X = 0.98;
export const GPU_CURVES_POINT_MIN_GAP = 0.04;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asFiniteNumber(value: number | boolean | string | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getLegacyChannelOffset(params: EffectParams, channel: Exclude<GpuCurvesChannelKey, 'master'>): number {
  const value = asFiniteNumber(params[channel], 0);
  return clamp(value / 200, -0.5, 0.5);
}

function applyLegacyShadows(c: number, amount: number): number {
  const shadow = 1 - c;
  return c + shadow * shadow * amount * 0.5;
}

function applyLegacyMidtones(c: number, amount: number): number {
  const mid = 4 * c * (1 - c);
  return c + mid * amount * 0.25;
}

function applyLegacyHighlights(c: number, amount: number): number {
  return c + c * c * amount * 0.5;
}

function applyLegacyContrast(c: number, amount: number): number {
  return (c - 0.5) * (1 + amount) + 0.5;
}

function computeLegacyMasterCurve(params: EffectParams, input: number): number {
  const shadows = asFiniteNumber(params.shadows, 0) / 100;
  const midtones = asFiniteNumber(params.midtones, 0) / 100;
  const highlights = asFiniteNumber(params.highlights, 0) / 100;
  const contrast = asFiniteNumber(params.contrast, 0) / 100;

  let value = input;
  value = applyLegacyShadows(value, shadows);
  value = applyLegacyMidtones(value, midtones);
  value = applyLegacyHighlights(value, highlights);
  value = applyLegacyContrast(value, contrast);
  return clamp(value, 0, 1);
}

export function getGpuCurvesChannelParamKeys(channel: GpuCurvesChannelKey) {
  const prefix = channel.charAt(0).toUpperCase() + channel.slice(1);
  return {
    shadowX: `${channel}ShadowX`,
    shadowY: `${channel}ShadowY`,
    highlightX: `${channel}HighlightX`,
    highlightY: `${channel}HighlightY`,
    prefix,
  } as const;
}

export function getDefaultGpuCurvesChannelControl(): GpuCurvesChannelControl {
  return {
    shadow: { x: DEFAULT_POINT_XS.shadow, y: DEFAULT_POINT_XS.shadow },
    highlight: { x: DEFAULT_POINT_XS.highlight, y: DEFAULT_POINT_XS.highlight },
  };
}

export function sanitizeGpuCurvesChannelControl(control: GpuCurvesChannelControl): GpuCurvesChannelControl {
  const defaultControl = getDefaultGpuCurvesChannelControl();

  let shadowX = clamp(
    asFiniteNumber(control.shadow.x, defaultControl.shadow.x),
    GPU_CURVES_POINT_MIN_X,
    GPU_CURVES_POINT_MAX_X,
  );
  let highlightX = clamp(
    asFiniteNumber(control.highlight.x, defaultControl.highlight.x),
    GPU_CURVES_POINT_MIN_X,
    GPU_CURVES_POINT_MAX_X,
  );

  if (shadowX > highlightX) {
    [shadowX, highlightX] = [highlightX, shadowX];
  }

  if (highlightX - shadowX < GPU_CURVES_POINT_MIN_GAP) {
    const midpoint = clamp(
      (shadowX + highlightX) / 2,
      GPU_CURVES_POINT_MIN_X + GPU_CURVES_POINT_MIN_GAP / 2,
      GPU_CURVES_POINT_MAX_X - GPU_CURVES_POINT_MIN_GAP / 2,
    );
    shadowX = midpoint - GPU_CURVES_POINT_MIN_GAP / 2;
    highlightX = midpoint + GPU_CURVES_POINT_MIN_GAP / 2;
  }

  return {
    shadow: {
      x: shadowX,
      y: clamp(asFiniteNumber(control.shadow.y, defaultControl.shadow.y), 0, 1),
    },
    highlight: {
      x: highlightX,
      y: clamp(asFiniteNumber(control.highlight.y, defaultControl.highlight.y), 0, 1),
    },
  };
}

export function buildGpuCurvesChannelPoints(control: GpuCurvesChannelControl) {
  const sanitized = sanitizeGpuCurvesChannelControl(control);
  return [
    { x: 0, y: 0 },
    sanitized.shadow,
    sanitized.highlight,
    { x: 1, y: 1 },
  ];
}

export function readGpuCurvesChannelControl(params: EffectParams, channel: GpuCurvesChannelKey): GpuCurvesChannelControl {
  const keys = getGpuCurvesChannelParamKeys(channel);
  const hasExplicitPoints = [keys.shadowX, keys.shadowY, keys.highlightX, keys.highlightY]
    .some((key) => typeof params[key] === 'number' && Number.isFinite(params[key] as number));

  if (hasExplicitPoints) {
    return sanitizeGpuCurvesChannelControl({
      shadow: {
        x: asFiniteNumber(params[keys.shadowX], DEFAULT_POINT_XS.shadow),
        y: asFiniteNumber(params[keys.shadowY], DEFAULT_POINT_XS.shadow),
      },
      highlight: {
        x: asFiniteNumber(params[keys.highlightX], DEFAULT_POINT_XS.highlight),
        y: asFiniteNumber(params[keys.highlightY], DEFAULT_POINT_XS.highlight),
      },
    });
  }

  if (channel === 'master') {
    return sanitizeGpuCurvesChannelControl({
      shadow: {
        x: DEFAULT_POINT_XS.shadow,
        y: computeLegacyMasterCurve(params, DEFAULT_POINT_XS.shadow),
      },
      highlight: {
        x: DEFAULT_POINT_XS.highlight,
        y: computeLegacyMasterCurve(params, DEFAULT_POINT_XS.highlight),
      },
    });
  }

  const offset = getLegacyChannelOffset(params, channel);
  return sanitizeGpuCurvesChannelControl({
    shadow: {
      x: DEFAULT_POINT_XS.shadow,
      y: DEFAULT_POINT_XS.shadow + offset,
    },
    highlight: {
      x: DEFAULT_POINT_XS.highlight,
      y: DEFAULT_POINT_XS.highlight + offset,
    },
  });
}

export function toGpuCurvesChannelParamUpdates(
  channel: GpuCurvesChannelKey,
  control: GpuCurvesChannelControl,
): Record<string, number> {
  const sanitized = sanitizeGpuCurvesChannelControl(control);
  const keys = getGpuCurvesChannelParamKeys(channel);
  return {
    [keys.shadowX]: sanitized.shadow.x,
    [keys.shadowY]: sanitized.shadow.y,
    [keys.highlightX]: sanitized.highlight.x,
    [keys.highlightY]: sanitized.highlight.y,
  };
}

export function getGpuCurvesDefaultParams(): Record<string, number> {
  return GPU_CURVES_CHANNELS.reduce<Record<string, number>>((acc, channel) => {
    Object.assign(acc, toGpuCurvesChannelParamUpdates(channel, getDefaultGpuCurvesChannelControl()));
    return acc;
  }, {});
}

export function getGpuCurvesDraftParams(params: EffectParams): Record<string, number> {
  return GPU_CURVES_CHANNELS.reduce<Record<string, number>>((acc, channel) => {
    Object.assign(acc, toGpuCurvesChannelParamUpdates(channel, readGpuCurvesChannelControl(params, channel)));
    return acc;
  }, {});
}

export function evaluateGpuCurvesChannel(control: GpuCurvesChannelControl, input: number): number {
  return evaluateMonotoneCurve(buildGpuCurvesChannelPoints(control), input);
}

export function evaluateGpuCurvesEffectChannel(
  params: EffectParams,
  channel: GpuCurvesChannelKey,
  input: number,
): number {
  const masterValue = evaluateGpuCurvesChannel(readGpuCurvesChannelControl(params, 'master'), input);
  if (channel === 'master') {
    return masterValue;
  }
  return evaluateGpuCurvesChannel(readGpuCurvesChannelControl(params, channel), masterValue);
}

export function buildGpuCurvesEffectPath(
  params: EffectParams,
  channel: GpuCurvesChannelKey,
  size: number,
  samples: number,
): string {
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= samples; i += 1) {
    const input = i / samples;
    points.push({
      x: input,
      y: evaluateGpuCurvesEffectChannel(params, channel, input),
    });
  }
  return buildMonotoneCurveSvgPath(points, size, size);
}
