import type { GpuEffectDefinition } from '../types';

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
    amount: { type: 'number', label: 'Amount', default: 0, min: -1, max: 1, step: 0.01, animatable: true },
  },
  packUniforms: (p) => new Float32Array([p.amount as number ?? 0, 0, 0, 0]),
};

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
    amount: { type: 'number', label: 'Amount', default: 1, min: 0, max: 3, step: 0.01, animatable: true },
  },
  packUniforms: (p) => new Float32Array([p.amount as number ?? 1, 0, 0, 0]),
};

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
    exposure: { type: 'number', label: 'Exposure (EV)', default: 0, min: -3, max: 3, step: 0.1, animatable: true },
    offset: { type: 'number', label: 'Offset', default: 0, min: -0.5, max: 0.5, step: 0.01, animatable: true },
    gamma: { type: 'number', label: 'Gamma', default: 1, min: 0.2, max: 3, step: 0.01, animatable: true },
  },
  packUniforms: (p) => new Float32Array([
    p.exposure as number ?? 0, p.offset as number ?? 0, p.gamma as number ?? 1, 0,
  ]),
};

export const hueShift: GpuEffectDefinition = {
  id: 'gpu-hue-shift',
  name: 'Hue Shift',
  category: 'color',
  entryPoint: 'hueShiftFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct HueShiftParams { shift: f32, _p1: f32, _p2: f32, _p3: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: HueShiftParams;
@fragment
fn hueShiftFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  var hsv = rgb2hsv(color.rgb);
  hsv.x = fract(hsv.x + params.shift);
  return vec4f(hsv2rgb(hsv), color.a);
}`,
  params: {
    shift: { type: 'number', label: 'Shift', default: 0, min: 0, max: 1, step: 0.01, animatable: true },
  },
  packUniforms: (p) => new Float32Array([p.shift as number ?? 0, 0, 0, 0]),
};

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
};

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
    inputBlack: { type: 'number', label: 'Input Black', default: 0, min: 0, max: 1, step: 0.01, animatable: true },
    inputWhite: { type: 'number', label: 'Input White', default: 1, min: 0, max: 1, step: 0.01, animatable: true },
    gamma: { type: 'number', label: 'Gamma', default: 1, min: 0.1, max: 3, step: 0.01, animatable: true },
    outputBlack: { type: 'number', label: 'Output Black', default: 0, min: 0, max: 1, step: 0.01, animatable: true },
    outputWhite: { type: 'number', label: 'Output White', default: 1, min: 0, max: 1, step: 0.01, animatable: true },
  },
  packUniforms: (p) => new Float32Array([
    p.inputBlack as number ?? 0, p.inputWhite as number ?? 1, p.gamma as number ?? 1,
    p.outputBlack as number ?? 0, p.outputWhite as number ?? 1, 0, 0, 0,
  ]),
};

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
    amount: { type: 'number', label: 'Amount', default: 1, min: 0, max: 3, step: 0.01, animatable: true },
  },
  packUniforms: (p) => new Float32Array([p.amount as number ?? 1, 0, 0, 0]),
};

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
    temperature: { type: 'number', label: 'Temperature', default: 0, min: -1, max: 1, step: 0.01, animatable: true },
    tint: { type: 'number', label: 'Tint', default: 0, min: -1, max: 1, step: 0.01, animatable: true },
  },
  packUniforms: (p) => new Float32Array([
    p.temperature as number ?? 0, p.tint as number ?? 0, 0, 0,
  ]),
};

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
    amount: { type: 'number', label: 'Amount', default: 0, min: -1, max: 1, step: 0.01, animatable: true },
  },
  packUniforms: (p) => new Float32Array([p.amount as number ?? 0, 0, 0, 0]),
};
