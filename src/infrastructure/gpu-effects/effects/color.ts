import type { EffectDataTexturePayload, EffectParam, GpuEffectDefinition } from '../types'
import {
  GPU_CURVES_CHANNELS,
  GPU_CURVES_LUT_WIDTH,
  buildGpuCurvesLutData,
  getDefaultGpuCurvesChannelControl,
  getGpuCurvesChannelParamKeys,
  getGpuCurvesLutKey,
  getGpuCurvesPointsParamKey,
} from '@/shared/utils/gpu-curves'

function readNumberParam(
  params: Record<string, number | boolean | string>,
  key: string,
  fallback: number,
): number {
  const value = params[key]
  return typeof value === 'number' ? value : fallback
}

function parseHexColorRgb(
  color: string,
  fallback: [number, number, number],
): [number, number, number] {
  if (typeof color !== 'string' || !color.startsWith('#')) return fallback
  const hex = color.slice(1)
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex
  if (full.length < 6) return fallback
  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255
  return [r, g, b].every(Number.isFinite) ? [r, g, b] : fallback
}

export const brightness: GpuEffectDefinition = {
  id: 'gpu-brightness',
  name: 'Brightness',
  category: 'color',
  entryPoint: 'brightnessFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct BrightnessParams { amount: f32, _p1: f32, _p2: f32, _p3: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: BrightnessParams;
@fragment
fn brightnessFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let adjusted = color.rgb + params.amount;
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}`,
  params: {
    amount: {
      type: 'number',
      label: 'Amount',
      default: 0,
      min: -1,
      max: 1,
      step: 0.01,
      animatable: true,
    },
  },
  packUniforms: (p) => new Float32Array([(p.amount as number) ?? 0, 0, 0, 0]),
}

export const contrast: GpuEffectDefinition = {
  id: 'gpu-contrast',
  name: 'Contrast',
  category: 'color',
  entryPoint: 'contrastFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct ContrastParams { amount: f32, _p1: f32, _p2: f32, _p3: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: ContrastParams;
@fragment
fn contrastFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let adjusted = (color.rgb - 0.5) * params.amount + 0.5;
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}`,
  params: {
    amount: {
      type: 'number',
      label: 'Amount',
      default: 1,
      min: 0,
      max: 3,
      step: 0.01,
      animatable: true,
    },
  },
  packUniforms: (p) => new Float32Array([(p.amount as number) ?? 1, 0, 0, 0]),
}

export const exposure: GpuEffectDefinition = {
  id: 'gpu-exposure',
  name: 'Exposure',
  category: 'color',
  entryPoint: 'exposureFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct ExposureParams { exposure: f32, offset: f32, gamma: f32, _pad: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: ExposureParams;
@fragment
fn exposureFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  var adjusted = color.rgb * pow(2.0, params.exposure);
  adjusted += params.offset;
  adjusted = pow(max(adjusted, vec3f(0.0)), vec3f(1.0 / params.gamma));
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}`,
  params: {
    exposure: {
      type: 'number',
      label: 'Exposure (EV)',
      default: 0,
      min: -3,
      max: 3,
      step: 0.1,
      animatable: true,
    },
    offset: {
      type: 'number',
      label: 'Offset',
      default: 0,
      min: -0.5,
      max: 0.5,
      step: 0.01,
      animatable: true,
    },
    gamma: {
      type: 'number',
      label: 'Gamma',
      default: 1,
      min: 0.2,
      max: 3,
      step: 0.01,
      animatable: true,
    },
  },
  packUniforms: (p) =>
    new Float32Array([
      (p.exposure as number) ?? 0,
      (p.offset as number) ?? 0,
      (p.gamma as number) ?? 1,
      0,
    ]),
}

export const hueShift: GpuEffectDefinition = {
  id: 'gpu-hue-shift',
  name: 'Hue Shift',
  category: 'color',
  entryPoint: 'hueShiftFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct HueShiftParams { shift: f32, span: f32, flow: f32, time: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: HueShiftParams;
@fragment
fn hueShiftFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  var hsv = rgb2hsv(color.rgb);
  // span compresses (<1) or expands (>1) the hue range around the shift offset;
  // span = 1 is a plain hue rotation (backward compatible), span = 0 maps every
  // pixel to a single hue (monochrome tint). flow cycles the offset over time.
  hsv.x = fract(params.shift + params.flow * params.time + hsv.x * params.span);
  return vec4f(hsv2rgb(hsv), color.a);
}`,
  params: {
    shift: {
      type: 'number',
      label: 'Shift',
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    span: {
      type: 'number',
      label: 'Span',
      default: 1,
      min: 0,
      max: 2,
      step: 0.01,
      animatable: true,
    },
    flow: {
      type: 'number',
      label: 'Flow',
      default: 0,
      min: 0,
      max: 2,
      step: 0.05,
      animatable: false,
    },
  },
  packUniforms: (p) =>
    new Float32Array([
      (p.shift as number) ?? 0,
      (p.span as number) ?? 1,
      (p.flow as number) ?? 0,
      performance.now() / 1000,
    ]),
}

export const invert: GpuEffectDefinition = {
  id: 'gpu-invert',
  name: 'Invert',
  category: 'color',
  entryPoint: 'invertFragment',
  uniformSize: 0,
  shader: /* wgsl */ `
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@fragment
fn invertFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  return vec4f(1.0 - color.rgb, color.a);
}`,
  params: {},
  packUniforms: () => null,
}

export const levels: GpuEffectDefinition = {
  id: 'gpu-levels',
  name: 'Levels',
  category: 'color',
  entryPoint: 'levelsFragment',
  uniformSize: 32,
  shader: /* wgsl */ `
struct LevelsParams {
  inputBlack: f32, inputWhite: f32, gamma: f32, outputBlack: f32,
  outputWhite: f32, _p1: f32, _p2: f32, _p3: f32,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: LevelsParams;
@fragment
fn levelsFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  var adjusted = (color.rgb - vec3f(params.inputBlack)) /
                 (params.inputWhite - params.inputBlack);
  adjusted = clamp(adjusted, vec3f(0.0), vec3f(1.0));
  adjusted = pow(adjusted, vec3f(1.0 / params.gamma));
  adjusted = mix(vec3f(params.outputBlack), vec3f(params.outputWhite), adjusted);
  return vec4f(adjusted, color.a);
}`,
  params: {
    inputBlack: {
      type: 'number',
      label: 'Input Black',
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    inputWhite: {
      type: 'number',
      label: 'Input White',
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    gamma: {
      type: 'number',
      label: 'Gamma',
      default: 1,
      min: 0.1,
      max: 3,
      step: 0.01,
      animatable: true,
    },
    outputBlack: {
      type: 'number',
      label: 'Output Black',
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    outputWhite: {
      type: 'number',
      label: 'Output White',
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
  },
  packUniforms: (p) =>
    new Float32Array([
      (p.inputBlack as number) ?? 0,
      (p.inputWhite as number) ?? 1,
      (p.gamma as number) ?? 1,
      (p.outputBlack as number) ?? 0,
      (p.outputWhite as number) ?? 1,
      0,
      0,
      0,
    ]),
}

export const saturation: GpuEffectDefinition = {
  id: 'gpu-saturation',
  name: 'Saturation',
  category: 'color',
  entryPoint: 'saturationFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct SaturationParams { amount: f32, _p1: f32, _p2: f32, _p3: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: SaturationParams;
@fragment
fn saturationFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let gray = luminance601(color.rgb);
  let adjusted = mix(vec3f(gray), color.rgb, params.amount);
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}`,
  params: {
    amount: {
      type: 'number',
      label: 'Amount',
      default: 1,
      min: 0,
      max: 3,
      step: 0.01,
      animatable: true,
    },
  },
  packUniforms: (p) => new Float32Array([(p.amount as number) ?? 1, 0, 0, 0]),
}

export const temperature: GpuEffectDefinition = {
  id: 'gpu-temperature',
  name: 'Temperature',
  category: 'color',
  entryPoint: 'temperatureFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct TemperatureParams { temperature: f32, tint: f32, _p1: f32, _p2: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: TemperatureParams;
@fragment
fn temperatureFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  var adjusted = color.rgb;
  adjusted.r += params.temperature * 0.1;
  adjusted.b -= params.temperature * 0.1;
  adjusted.g -= params.tint * 0.1;
  adjusted.r += params.tint * 0.05;
  adjusted.b += params.tint * 0.05;
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}`,
  params: {
    temperature: {
      type: 'number',
      label: 'Temperature',
      default: 0,
      min: -1,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    tint: {
      type: 'number',
      label: 'Tint',
      default: 0,
      min: -1,
      max: 1,
      step: 0.01,
      animatable: true,
    },
  },
  packUniforms: (p) =>
    new Float32Array([(p.temperature as number) ?? 0, (p.tint as number) ?? 0, 0, 0]),
}

export const grayscale: GpuEffectDefinition = {
  id: 'gpu-grayscale',
  name: 'Grayscale',
  category: 'color',
  entryPoint: 'grayscaleFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct GrayscaleParams { amount: f32, _p1: f32, _p2: f32, _p3: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: GrayscaleParams;
@fragment
fn grayscaleFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let gray = luminance601(color.rgb);
  let adjusted = mix(color.rgb, vec3f(gray), params.amount);
  return vec4f(adjusted, color.a);
}`,
  params: {
    amount: {
      type: 'number',
      label: 'Amount',
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
  },
  packUniforms: (p) => new Float32Array([(p.amount as number) ?? 1, 0, 0, 0]),
}

export const sepia: GpuEffectDefinition = {
  id: 'gpu-sepia',
  name: 'Sepia',
  category: 'color',
  entryPoint: 'sepiaFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct SepiaParams { amount: f32, _p1: f32, _p2: f32, _p3: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: SepiaParams;
@fragment
fn sepiaFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let sepiaR = dot(color.rgb, vec3f(0.393, 0.769, 0.189));
  let sepiaG = dot(color.rgb, vec3f(0.349, 0.686, 0.168));
  let sepiaB = dot(color.rgb, vec3f(0.272, 0.534, 0.131));
  let sepiaColor = vec3f(sepiaR, sepiaG, sepiaB);
  let adjusted = mix(color.rgb, sepiaColor, params.amount);
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}`,
  params: {
    amount: {
      type: 'number',
      label: 'Amount',
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
  },
  packUniforms: (p) => new Float32Array([(p.amount as number) ?? 1, 0, 0, 0]),
}

/**
 * Curves with arbitrary control points. The combined per-channel transfer
 * functions (channel ∘ master, monotone cubic over the control points) are
 * baked CPU-side into a 256x1 rgba8 LUT bound at @binding(3) — the shader is
 * a single lookup per channel. Legacy 2-point numeric params remain (and
 * stay keyframable); the per-channel `<channel>Points` JSON params take
 * precedence when set.
 */
export const curves: GpuEffectDefinition = {
  id: 'gpu-curves',
  name: 'Curves',
  category: 'color',
  entryPoint: 'curvesFragment',
  uniformSize: 0,
  shader: /* wgsl */ `
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(3) var curveLut: texture_2d<f32>;

fn sampleCurveLut(value: f32) -> vec3f {
  let lutWidth = ${GPU_CURVES_LUT_WIDTH}.0;
  let u = (clamp(value, 0.0, 1.0) * (lutWidth - 1.0) + 0.5) / lutWidth;
  return textureSample(curveLut, texSampler, vec2f(u, 0.5)).rgb;
}

@fragment
fn curvesFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let c = vec3f(
    sampleCurveLut(color.r).r,
    sampleCurveLut(color.g).g,
    sampleCurveLut(color.b).b,
  );
  return vec4f(c, color.a);
}`,
  params: Object.fromEntries([
    ...GPU_CURVES_CHANNELS.flatMap((channel): Array<[string, EffectParam]> => {
      const keys = getGpuCurvesChannelParamKeys(channel)
      const defaults = getDefaultGpuCurvesChannelControl()
      const prefix = channel.charAt(0).toUpperCase() + channel.slice(1)
      return [
        [
          keys.shadowX,
          {
            type: 'number',
            label: `${prefix} Shadow X`,
            default: defaults.shadow.x,
            min: 0,
            max: 1,
            step: 0.001,
            animatable: true,
          },
        ],
        [
          keys.shadowY,
          {
            type: 'number',
            label: `${prefix} Shadow Y`,
            default: defaults.shadow.y,
            min: 0,
            max: 1,
            step: 0.001,
            animatable: true,
          },
        ],
        [
          keys.highlightX,
          {
            type: 'number',
            label: `${prefix} Highlight X`,
            default: defaults.highlight.x,
            min: 0,
            max: 1,
            step: 0.001,
            animatable: true,
          },
        ],
        [
          keys.highlightY,
          {
            type: 'number',
            label: `${prefix} Highlight Y`,
            default: defaults.highlight.y,
            min: 0,
            max: 1,
            step: 0.001,
            animatable: true,
          },
        ],
      ]
    }),
    ...GPU_CURVES_CHANNELS.map((channel): [string, EffectParam] => {
      const prefix = channel.charAt(0).toUpperCase() + channel.slice(1)
      return [
        getGpuCurvesPointsParamKey(channel),
        {
          type: 'json',
          label: `${prefix} Points`,
          default: '',
        },
      ]
    }),
  ]),
  packUniforms: () => null,
  dataTexture: {
    dimension: '2d',
    key: getGpuCurvesLutKey,
    build: (params) => ({
      width: GPU_CURVES_LUT_WIDTH,
      height: 1,
      depth: 1,
      data: buildGpuCurvesLutData(params),
    }),
  },
}

export const colorWheels: GpuEffectDefinition = {
  id: 'gpu-color-wheels',
  name: 'Color Wheels',
  category: 'color',
  entryPoint: 'colorWheelsFragment',
  uniformSize: 112,
  shader: /* wgsl */ `
struct WheelsParams {
  shHue: f32, shAmount: f32, midHue: f32, midAmount: f32,
  hlHue: f32, hlAmount: f32, temperature: f32, tint: f32,
  saturation: f32, exposure: f32, contrast: f32, pivot: f32,
  lift: f32, gamma: f32, gain: f32, offset: f32,
  blackPoint: f32, whitePoint: f32, offHue: f32, offAmount: f32,
  midDetail: f32, colorBoost: f32, shadows: f32, highlights: f32,
  hue: f32, lumMix: f32, _pad1: f32, _pad2: f32,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: WheelsParams;

fn wheelTint(color: vec3f, hue: f32, amount: f32, mask: f32) -> vec3f {
  if (amount < 0.001) { return color; }
  let rad = hue * TAU / 360.0;
  let tintColor = hsv2rgb(vec3f(hue / 360.0, 1.0, 1.0));
  return mix(color, color * mix(vec3f(1.0), tintColor, amount), mask);
}

@fragment
fn colorWheelsFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  var c = color.rgb;
  let luma = luminance601(c);
  let shadowMask = 1.0 - smoothstep(0.0, 0.5, luma);
  let highlightMask = smoothstep(0.5, 1.0, luma);
  let midtoneMask = 1.0 - shadowMask - highlightMask;
  c = wheelTint(c, params.shHue, params.shAmount, shadowMask);
  c = wheelTint(c, params.midHue, params.midAmount, midtoneMask);
  c = wheelTint(c, params.hlHue, params.hlAmount, highlightMask);
  c = wheelTint(c, params.offHue, params.offAmount, 1.0);
  let temp = params.temperature / 100.0;
  c.r += temp * 0.1;
  c.b -= temp * 0.1;
  let ti = params.tint / 100.0;
  c.g -= ti * 0.1;
  c.r += ti * 0.05;
  c.b += ti * 0.05;

  c *= pow(2.0, params.exposure);
  c = (c - vec3f(params.pivot)) * params.contrast + vec3f(params.pivot);
  if (abs(params.midDetail) > 0.001) {
    let detailLuma = luminance601(c);
    let detailAdjusted = vec3f(detailLuma) +
      (c - vec3f(detailLuma)) * (1.0 + params.midDetail / 100.0);
    c = mix(c, detailAdjusted, midtoneMask);
  }
  c = (c + vec3f(params.lift) + vec3f(params.offset)) * params.gain;
  c = pow(max(c, vec3f(0.0)), vec3f(1.0 / max(params.gamma, 0.05)));
  c = (c - vec3f(params.blackPoint)) /
      vec3f(max(params.whitePoint - params.blackPoint, 0.001));
  c += vec3f(params.shadows / 100.0) * shadowMask;
  c += vec3f(params.highlights / 100.0) * highlightMask;

  let sat = 1.0 + params.saturation / 100.0;
  let gray = luminance601(c);
  c = mix(vec3f(gray), c, sat);
  let colorBoost = params.colorBoost / 100.0;
  if (abs(colorBoost) > 0.001) {
    let boostedGray = luminance601(c);
    let chroma = c - vec3f(boostedGray);
    c = vec3f(boostedGray) + chroma * (1.0 + colorBoost * (1.0 - clamp(length(chroma), 0.0, 1.0)));
  }
  if (abs(params.hue - 50.0) > 0.001) {
    var hsv = rgb2hsv(c);
    hsv.x = fract(hsv.x + ((params.hue - 50.0) / 100.0));
    c = hsv2rgb(hsv);
  }
  let postLuma = luminance601(c);
  c = mix(vec3f(postLuma), c, clamp(params.lumMix / 100.0, 0.0, 1.0));
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), color.a);
}`,
  params: {
    shadowsHue: {
      type: 'number',
      label: 'Shadows Hue',
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      animatable: true,
    },
    shadowsAmount: {
      type: 'number',
      label: 'Shadows Amount',
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    midtonesHue: {
      type: 'number',
      label: 'Midtones Hue',
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      animatable: true,
    },
    midtonesAmount: {
      type: 'number',
      label: 'Midtones Amount',
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    highlightsHue: {
      type: 'number',
      label: 'Highlights Hue',
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      animatable: true,
    },
    highlightsAmount: {
      type: 'number',
      label: 'Highlights Amount',
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    offsetHue: {
      type: 'number',
      label: 'Offset Hue',
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      animatable: true,
    },
    offsetAmount: {
      type: 'number',
      label: 'Offset Amount',
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    temperature: {
      type: 'number',
      label: 'Temperature',
      default: 0,
      min: -100,
      max: 100,
      step: 1,
      animatable: true,
    },
    tint: {
      type: 'number',
      label: 'Tint',
      default: 0,
      min: -100,
      max: 100,
      step: 1,
      animatable: true,
    },
    saturation: {
      type: 'number',
      label: 'Saturation',
      default: 0,
      min: -100,
      max: 100,
      step: 1,
      animatable: true,
    },
    exposure: {
      type: 'number',
      label: 'Exposure',
      default: 0,
      min: -3,
      max: 3,
      step: 0.05,
      animatable: true,
    },
    contrast: {
      type: 'number',
      label: 'Contrast',
      default: 1,
      min: 0,
      max: 2,
      step: 0.01,
      animatable: true,
    },
    pivot: {
      type: 'number',
      label: 'Pivot',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    // Lift/gamma/gain/offset ranges mirror Resolve's primaries reach: lift
    // and offset span ±2.0 in normalized signal (Resolve shows offset as
    // 25 + 100x, i.e. -175..225), gamma is 0-centered in Resolve's display
    // (param = display + 1), gain is a plain multiplier up to 16 (+4 stops).
    lift: {
      type: 'number',
      label: 'Lift',
      default: 0,
      min: -2,
      max: 2,
      step: 0.01,
      animatable: true,
    },
    gamma: {
      type: 'number',
      label: 'Gamma',
      default: 1,
      min: 0,
      max: 4,
      step: 0.01,
      animatable: true,
    },
    gain: {
      type: 'number',
      label: 'Gain',
      default: 1,
      min: 0,
      max: 16,
      step: 0.01,
      animatable: true,
    },
    offset: {
      type: 'number',
      label: 'Offset',
      default: 0,
      min: -2,
      max: 2,
      step: 0.0025,
      animatable: true,
    },
    blackPoint: {
      type: 'number',
      label: 'Black Point',
      default: 0,
      min: 0,
      max: 0.5,
      step: 0.005,
      animatable: true,
    },
    whitePoint: {
      type: 'number',
      label: 'White Point',
      default: 1,
      min: 0.5,
      max: 1.5,
      step: 0.005,
      animatable: true,
    },
    midDetail: {
      type: 'number',
      label: 'Mid/Detail',
      default: 0,
      min: -100,
      max: 100,
      step: 1,
      animatable: true,
    },
    colorBoost: {
      type: 'number',
      label: 'Color Boost',
      default: 0,
      min: -100,
      max: 100,
      step: 1,
      animatable: true,
    },
    shadows: {
      type: 'number',
      label: 'Shadows',
      default: 0,
      min: -100,
      max: 100,
      step: 1,
      animatable: true,
    },
    highlights: {
      type: 'number',
      label: 'Highlights',
      default: 0,
      min: -100,
      max: 100,
      step: 1,
      animatable: true,
    },
    hue: {
      type: 'number',
      label: 'Hue',
      default: 50,
      min: 0,
      max: 100,
      step: 1,
      animatable: true,
    },
    lumMix: {
      type: 'number',
      label: 'Lum Mix',
      default: 100,
      min: 0,
      max: 100,
      step: 1,
      animatable: true,
    },
  },
  packUniforms: (p) =>
    new Float32Array(
      COLOR_WHEELS_UNIFORM_PARAMS.map(([key, fallback]) => readNumberParam(p, key, fallback)),
    ),
}

const COLOR_WHEELS_UNIFORM_PARAMS = [
  ['shadowsHue', 0],
  ['shadowsAmount', 0],
  ['midtonesHue', 0],
  ['midtonesAmount', 0],
  ['highlightsHue', 0],
  ['highlightsAmount', 0],
  ['temperature', 0],
  ['tint', 0],
  ['saturation', 0],
  ['exposure', 0],
  ['contrast', 1],
  ['pivot', 0.5],
  ['lift', 0],
  ['gamma', 1],
  ['gain', 1],
  ['offset', 0],
  ['blackPoint', 0],
  ['whitePoint', 1],
  ['offsetHue', 0],
  ['offsetAmount', 0],
  ['midDetail', 0],
  ['colorBoost', 0],
  ['shadows', 0],
  ['highlights', 0],
  ['hue', 50],
  ['lumMix', 100],
  ['_pad1', 0],
  ['_pad2', 0],
] as const

export const secondaryQualifier: GpuEffectDefinition = {
  id: 'gpu-secondary-qualifier',
  name: 'Secondary Qualifier',
  category: 'color',
  entryPoint: 'secondaryQualifierFragment',
  uniformSize: 64,
  shader: /* wgsl */ `
struct SecondaryQualifierParams {
  hueCenter: f32, hueWidth: f32, hueSoftness: f32, satLow: f32,
  satHigh: f32, satSoftness: f32, lumaLow: f32, lumaHigh: f32,
  lumaSoftness: f32, invertMask: f32, showMask: f32, exposure: f32,
  saturation: f32, temperature: f32, tint: f32, strength: f32,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: SecondaryQualifierParams;

fn circularHueDistance(hue: f32, center: f32) -> f32 {
  let diff = abs(hue - center);
  return min(diff, 1.0 - diff);
}

fn centeredRangeMask(value: f32, lowValue: f32, highValue: f32, softness: f32) -> f32 {
  let low = min(lowValue, highValue);
  let high = max(lowValue, highValue);
  let soft = max(softness, 0.0001);
  let lowMask = smoothstep(low - soft, low, value);
  let highMask = 1.0 - smoothstep(high, high + soft, value);
  return clamp(lowMask * highMask, 0.0, 1.0);
}

@fragment
fn secondaryQualifierFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let hsv = rgb2hsv(color.rgb);
  let luma = luminance601(color.rgb);
  let hueDistance = circularHueDistance(hsv.x, fract(params.hueCenter / 360.0));
  let hueWidth = clamp(params.hueWidth / 360.0, 0.0, 0.5);
  let hueSoftness = max(params.hueSoftness / 360.0, 0.0001);
  var mask = 1.0 - smoothstep(hueWidth, hueWidth + hueSoftness, hueDistance);
  mask *= centeredRangeMask(hsv.y, params.satLow, params.satHigh, params.satSoftness);
  mask *= centeredRangeMask(luma, params.lumaLow, params.lumaHigh, params.lumaSoftness);
  if (params.invertMask > 0.5) {
    mask = 1.0 - mask;
  }
  mask = clamp(mask * params.strength, 0.0, 1.0);

  if (params.showMask > 0.5) {
    return vec4f(vec3f(mask), color.a);
  }

  var corrected = color.rgb;
  corrected *= pow(2.0, params.exposure);
  let temp = params.temperature / 100.0;
  corrected.r += temp * 0.1;
  corrected.b -= temp * 0.1;
  let ti = params.tint / 100.0;
  corrected.g -= ti * 0.1;
  corrected.r += ti * 0.05;
  corrected.b += ti * 0.05;
  let sat = 1.0 + params.saturation / 100.0;
  let gray = luminance601(corrected);
  corrected = mix(vec3f(gray), corrected, sat);

  return vec4f(clamp(mix(color.rgb, corrected, mask), vec3f(0.0), vec3f(1.0)), color.a);
}`,
  params: {
    hueCenter: {
      type: 'number',
      label: 'Hue Center',
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      animatable: true,
    },
    hueWidth: {
      type: 'number',
      label: 'Hue Width',
      default: 35,
      min: 0,
      max: 180,
      step: 1,
      animatable: true,
    },
    hueSoftness: {
      type: 'number',
      label: 'Hue Softness',
      default: 20,
      min: 0,
      max: 120,
      step: 1,
      animatable: true,
    },
    satLow: {
      type: 'number',
      label: 'Sat Low',
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    satHigh: {
      type: 'number',
      label: 'Sat High',
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    satSoftness: {
      type: 'number',
      label: 'Sat Softness',
      default: 0.1,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    lumaLow: {
      type: 'number',
      label: 'Luma Low',
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    lumaHigh: {
      type: 'number',
      label: 'Luma High',
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    lumaSoftness: {
      type: 'number',
      label: 'Luma Softness',
      default: 0.1,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    invertMask: {
      type: 'boolean',
      label: 'Invert Mask',
      default: false,
    },
    showMask: {
      type: 'boolean',
      label: 'Show Mask',
      default: false,
    },
    exposure: {
      type: 'number',
      label: 'Exposure',
      default: 0,
      min: -3,
      max: 3,
      step: 0.05,
      animatable: true,
    },
    saturation: {
      type: 'number',
      label: 'Saturation',
      default: 0,
      min: -100,
      max: 100,
      step: 1,
      animatable: true,
    },
    temperature: {
      type: 'number',
      label: 'Temperature',
      default: 0,
      min: -100,
      max: 100,
      step: 1,
      animatable: true,
    },
    tint: {
      type: 'number',
      label: 'Tint',
      default: 0,
      min: -100,
      max: 100,
      step: 1,
      animatable: true,
    },
    strength: {
      type: 'number',
      label: 'Strength',
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
  },
  packUniforms: (p) =>
    new Float32Array(
      SECONDARY_QUALIFIER_UNIFORM_PARAMS.map(([key, fallback]) => {
        const value = p[key]
        if (typeof value === 'boolean') return value ? 1 : 0
        return typeof value === 'number' ? value : fallback
      }),
    ),
}

const SECONDARY_QUALIFIER_UNIFORM_PARAMS = [
  ['hueCenter', 0],
  ['hueWidth', 35],
  ['hueSoftness', 20],
  ['satLow', 0],
  ['satHigh', 1],
  ['satSoftness', 0.1],
  ['lumaLow', 0],
  ['lumaHigh', 1],
  ['lumaSoftness', 0.1],
  ['invertMask', 0],
  ['showMask', 0],
  ['exposure', 0],
  ['saturation', 0],
  ['temperature', 0],
  ['tint', 0],
  ['strength', 1],
] as const

const POWER_WINDOW_SHAPE_MAP: Record<string, number> = {
  ellipse: 0,
  rectangle: 1,
}

export const powerWindow: GpuEffectDefinition = {
  id: 'gpu-power-window',
  name: 'Power Window',
  category: 'color',
  entryPoint: 'powerWindowFragment',
  uniformSize: 64,
  shader: /* wgsl */ `
struct PowerWindowParams {
  shapeKind: f32, centerX: f32, centerY: f32, sizeX: f32,
  sizeY: f32, rotation: f32, feather: f32, invertMask: f32,
  showMask: f32, exposure: f32, saturation: f32, temperature: f32,
  tint: f32, strength: f32, sourceWidth: f32, sourceHeight: f32,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: PowerWindowParams;

fn rotateWindowPoint(point: vec2f, angleDeg: f32) -> vec2f {
  let angle = -angleDeg * PI / 180.0;
  let c = cos(angle);
  let s = sin(angle);
  return vec2f(point.x * c - point.y * s, point.x * s + point.y * c);
}

fn powerWindowMask(uv: vec2f) -> f32 {
  let aspect = max(params.sourceWidth / max(params.sourceHeight, 1.0), 0.0001);
  var local = uv - vec2f(params.centerX, params.centerY);
  local.x *= aspect;
  local = rotateWindowPoint(local, params.rotation);

  let size = max(vec2f(params.sizeX * aspect, params.sizeY) * 0.5, vec2f(0.0001));
  let normalized = local / size;
  let shapeKind = i32(params.shapeKind + 0.5);
  var dist = length(normalized);
  if (shapeKind == 1) {
    dist = max(abs(normalized.x), abs(normalized.y));
  }
  let feather = clamp(params.feather, 0.001, 1.0);
  return clamp(1.0 - smoothstep(1.0 - feather, 1.0, dist), 0.0, 1.0);
}

@fragment
fn powerWindowFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  var mask = powerWindowMask(input.uv);
  if (params.invertMask > 0.5) {
    mask = 1.0 - mask;
  }
  mask = clamp(mask * params.strength, 0.0, 1.0);

  if (params.showMask > 0.5) {
    return vec4f(vec3f(mask), color.a);
  }

  var corrected = color.rgb;
  corrected *= pow(2.0, params.exposure);
  let temp = params.temperature / 100.0;
  corrected.r += temp * 0.1;
  corrected.b -= temp * 0.1;
  let ti = params.tint / 100.0;
  corrected.g -= ti * 0.1;
  corrected.r += ti * 0.05;
  corrected.b += ti * 0.05;
  let sat = 1.0 + params.saturation / 100.0;
  let gray = luminance601(corrected);
  corrected = mix(vec3f(gray), corrected, sat);

  return vec4f(clamp(mix(color.rgb, corrected, mask), vec3f(0.0), vec3f(1.0)), color.a);
}`,
  params: {
    shape: {
      type: 'select',
      label: 'Shape',
      default: 'ellipse',
      options: [
        { value: 'ellipse', label: 'Ellipse' },
        { value: 'rectangle', label: 'Rectangle' },
      ],
    },
    centerX: {
      type: 'number',
      label: 'Center X',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    centerY: {
      type: 'number',
      label: 'Center Y',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    sizeX: {
      type: 'number',
      label: 'Width',
      default: 0.5,
      min: 0.02,
      max: 1.5,
      step: 0.01,
      animatable: true,
    },
    sizeY: {
      type: 'number',
      label: 'Height',
      default: 0.5,
      min: 0.02,
      max: 1.5,
      step: 0.01,
      animatable: true,
    },
    rotation: {
      type: 'number',
      label: 'Rotation',
      default: 0,
      min: -180,
      max: 180,
      step: 1,
      animatable: true,
    },
    feather: {
      type: 'number',
      label: 'Feather',
      default: 0.15,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    invertMask: {
      type: 'boolean',
      label: 'Invert Mask',
      default: false,
    },
    showMask: {
      type: 'boolean',
      label: 'Show Mask',
      default: false,
    },
    exposure: {
      type: 'number',
      label: 'Exposure',
      default: 0,
      min: -3,
      max: 3,
      step: 0.05,
      animatable: true,
    },
    saturation: {
      type: 'number',
      label: 'Saturation',
      default: 0,
      min: -100,
      max: 100,
      step: 1,
      animatable: true,
    },
    temperature: {
      type: 'number',
      label: 'Temperature',
      default: 0,
      min: -100,
      max: 100,
      step: 1,
      animatable: true,
    },
    tint: {
      type: 'number',
      label: 'Tint',
      default: 0,
      min: -100,
      max: 100,
      step: 1,
      animatable: true,
    },
    strength: {
      type: 'number',
      label: 'Strength',
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
  },
  packUniforms: (p, w, h) =>
    new Float32Array([
      POWER_WINDOW_SHAPE_MAP[p.shape as string] ?? 0,
      readNumberParam(p, 'centerX', 0.5),
      readNumberParam(p, 'centerY', 0.5),
      readNumberParam(p, 'sizeX', 0.5),
      readNumberParam(p, 'sizeY', 0.5),
      readNumberParam(p, 'rotation', 0),
      readNumberParam(p, 'feather', 0.15),
      p.invertMask === true ? 1 : 0,
      p.showMask === true ? 1 : 0,
      readNumberParam(p, 'exposure', 0),
      readNumberParam(p, 'saturation', 0),
      readNumberParam(p, 'temperature', 0),
      readNumberParam(p, 'tint', 0),
      readNumberParam(p, 'strength', 1),
      w,
      h,
    ]),
}

export const vibrance: GpuEffectDefinition = {
  id: 'gpu-vibrance',
  name: 'Vibrance',
  category: 'color',
  entryPoint: 'vibranceFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct VibranceParams { amount: f32, _p1: f32, _p2: f32, _p3: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: VibranceParams;
@fragment
fn vibranceFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let maxC = max(max(color.r, color.g), color.b);
  let minC = min(min(color.r, color.g), color.b);
  let sat = (maxC - minC) / (maxC + 0.001);
  let vibrance = params.amount * (1.0 - sat);
  let gray = luminance601(color.rgb);
  let adjusted = mix(vec3f(gray), color.rgb, 1.0 + vibrance);
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}`,
  params: {
    amount: {
      type: 'number',
      label: 'Amount',
      default: 0,
      min: -1,
      max: 1,
      step: 0.01,
      animatable: true,
    },
  },
  packUniforms: (p) => new Float32Array([(p.amount as number) ?? 0, 0, 0, 0]),
}

// Built-in N-stop colormaps (hex stops, ordered dark -> light). 'custom' uses the
// comma-separated customStops param instead.
export const GRADIENT_MAP_PRESETS: Record<string, string[]> = {
  inferno: ['#000004', '#420a68', '#932667', '#dd513a', '#fca50a', '#f0f921'],
  magma: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'],
  plasma: ['#0d0887', '#6a00a8', '#b12a90', '#e16462', '#fca636', '#f0f921'],
  viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  turbo: ['#30123b', '#4675ed', '#1bcfd4', '#a4fc3b', '#fe9b2d', '#cb2a04', '#7a0403'],
  fire: ['#000000', '#7a0000', '#ff4800', '#ffd000', '#ffffff'],
  ice: ['#000010', '#003b6f', '#1b78c2', '#7ec8ff', '#ffffff'],
  sunset: ['#241634', '#c2456b', '#ffd9a0'],
  grayscale: ['#000000', '#ffffff'],
}

const GRADIENT_MAP_DEFAULT_CUSTOM = GRADIENT_MAP_PRESETS.inferno!.join(', ')

/** Resolve a preset/custom selection to an ordered list of normalized RGB stops. */
function gradientMapStops(preset: string, customStops: string): [number, number, number][] {
  const hexes =
    preset === 'custom'
      ? customStops
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : (GRADIENT_MAP_PRESETS[preset] ?? GRADIENT_MAP_PRESETS.inferno!)
  const stops = hexes.map((h) => parseHexColorRgb(h, [0, 0, 0]))
  if (stops.length === 0) return [[0, 0, 0], [1, 1, 1]]
  if (stops.length === 1) return [stops[0]!, stops[0]!]
  return stops
}

/** Build a 256x1 RGBA8 LUT by linearly interpolating the stops across luminance. */
function buildGradientMapLut(stops: [number, number, number][]): EffectDataTexturePayload {
  const width = 256
  const data = new Uint8Array(width * 4)
  const segments = stops.length - 1
  for (let i = 0; i < width; i++) {
    const t = i / (width - 1)
    const scaled = t * segments
    const idx = Math.min(Math.floor(scaled), segments - 1)
    const f = scaled - idx
    const a = stops[idx]!
    const b = stops[idx + 1]!
    data[i * 4] = Math.round((a[0] + (b[0] - a[0]) * f) * 255)
    data[i * 4 + 1] = Math.round((a[1] + (b[1] - a[1]) * f) * 255)
    data[i * 4 + 2] = Math.round((a[2] + (b[2] - a[2]) * f) * 255)
    data[i * 4 + 3] = 255
  }
  return { width, height: 1, depth: 1, data }
}

export const gradientMap: GpuEffectDefinition = {
  id: 'gpu-gradient-map',
  name: 'Gradient Map',
  category: 'color',
  entryPoint: 'gradientMapFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct GradientMapParams { mix: f32, _p1: f32, _p2: f32, _p3: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: GradientMapParams;
@group(0) @binding(3) var gradientLut: texture_2d<f32>;
@fragment
fn gradientMapFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let lum = clamp(luminance601(color.rgb), 0.0, 1.0);
  let mapped = textureSampleLevel(gradientLut, texSampler, vec2f(lum, 0.5), 0.0).rgb;
  let outRgb = mix(color.rgb, mapped, clamp(params.mix, 0.0, 1.0));
  return vec4f(outRgb, color.a);
}`,
  params: {
    preset: {
      type: 'select',
      label: 'Palette',
      default: 'inferno',
      options: [
        { value: 'inferno', label: 'Inferno' },
        { value: 'magma', label: 'Magma' },
        { value: 'plasma', label: 'Plasma' },
        { value: 'viridis', label: 'Viridis' },
        { value: 'turbo', label: 'Turbo' },
        { value: 'fire', label: 'Fire' },
        { value: 'ice', label: 'Ice' },
        { value: 'sunset', label: 'Sunset' },
        { value: 'grayscale', label: 'Grayscale' },
        { value: 'custom', label: 'Custom' },
      ],
    },
    customStops: {
      type: 'text',
      label: 'Custom Stops',
      default: GRADIENT_MAP_DEFAULT_CUSTOM,
      visibleWhen: (params) => params.preset === 'custom',
    },
    mix: {
      type: 'number',
      label: 'Mix',
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
  },
  packUniforms: (p) => new Float32Array([readNumberParam(p, 'mix', 1), 0, 0, 0]),
  dataTexture: {
    dimension: '2d',
    key: (p) => {
      const preset = (p.preset as string) ?? 'inferno'
      return preset === 'custom' ? `custom:${(p.customStops as string) ?? ''}` : `preset:${preset}`
    },
    build: (p) =>
      buildGradientMapLut(
        gradientMapStops((p.preset as string) ?? 'inferno', (p.customStops as string) ?? ''),
      ),
  },
}
