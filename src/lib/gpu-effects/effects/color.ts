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
    amount: { type: 'number', label: 'Amount', default: 1, min: 0, max: 1, step: 0.01, animatable: true },
  },
  packUniforms: (p) => new Float32Array([p.amount as number ?? 1, 0, 0, 0]),
};

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
    amount: { type: 'number', label: 'Amount', default: 1, min: 0, max: 1, step: 0.01, animatable: true },
  },
  packUniforms: (p) => new Float32Array([p.amount as number ?? 1, 0, 0, 0]),
};

export const curves: GpuEffectDefinition = {
  id: 'gpu-curves',
  name: 'Curves',
  category: 'color',
  entryPoint: 'curvesFragment',
  uniformSize: 48,
  shader: /* wgsl */ `
struct CurvesParams {
  shadows: f32, midtones: f32, highlights: f32, contrast: f32,
  red: f32, green: f32, blue: f32, _pad1: f32,
  _pad2: f32, _pad3: f32, _pad4: f32, _pad5: f32,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: CurvesParams;

fn applyShadows(c: f32, amount: f32) -> f32 {
  let shadow = 1.0 - c;
  return c + shadow * shadow * amount * 0.5;
}
fn applyHighlights(c: f32, amount: f32) -> f32 {
  return c + c * c * amount * 0.5;
}
fn applyMidtones(c: f32, amount: f32) -> f32 {
  let mid = 4.0 * c * (1.0 - c);
  return c + mid * amount * 0.25;
}

@fragment
fn curvesFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  var c = color.rgb;
  let sh = params.shadows / 100.0;
  let mt = params.midtones / 100.0;
  let hl = params.highlights / 100.0;
  let ct = params.contrast / 100.0;
  c = vec3f(applyShadows(c.r, sh), applyShadows(c.g, sh), applyShadows(c.b, sh));
  c = vec3f(applyMidtones(c.r, mt), applyMidtones(c.g, mt), applyMidtones(c.b, mt));
  c = vec3f(applyHighlights(c.r, hl), applyHighlights(c.g, hl), applyHighlights(c.b, hl));
  c = (c - 0.5) * (1.0 + ct) + 0.5;
  c.r += params.red / 200.0;
  c.g += params.green / 200.0;
  c.b += params.blue / 200.0;
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), color.a);
}`,
  params: {
    shadows: { type: 'number', label: 'Shadows', default: 0, min: -100, max: 100, step: 1, animatable: true },
    midtones: { type: 'number', label: 'Midtones', default: 0, min: -100, max: 100, step: 1, animatable: true },
    highlights: { type: 'number', label: 'Highlights', default: 0, min: -100, max: 100, step: 1, animatable: true },
    contrast: { type: 'number', label: 'Contrast', default: 0, min: -100, max: 100, step: 1, animatable: true },
    red: { type: 'number', label: 'Red', default: 0, min: -100, max: 100, step: 1, animatable: true },
    green: { type: 'number', label: 'Green', default: 0, min: -100, max: 100, step: 1, animatable: true },
    blue: { type: 'number', label: 'Blue', default: 0, min: -100, max: 100, step: 1, animatable: true },
  },
  packUniforms: (p) => new Float32Array([
    p.shadows as number ?? 0, p.midtones as number ?? 0,
    p.highlights as number ?? 0, p.contrast as number ?? 0,
    p.red as number ?? 0, p.green as number ?? 0,
    p.blue as number ?? 0, 0,
    0, 0, 0, 0,
  ]),
};

export const colorWheels: GpuEffectDefinition = {
  id: 'gpu-color-wheels',
  name: 'Color Wheels',
  category: 'color',
  entryPoint: 'colorWheelsFragment',
  uniformSize: 48,
  shader: /* wgsl */ `
struct WheelsParams {
  shHue: f32, shAmount: f32, midHue: f32, midAmount: f32,
  hlHue: f32, hlAmount: f32, temperature: f32, tint: f32,
  saturation: f32, _pad1: f32, _pad2: f32, _pad3: f32,
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
  let temp = params.temperature / 100.0;
  c.r += temp * 0.1;
  c.b -= temp * 0.1;
  let ti = params.tint / 100.0;
  c.g -= ti * 0.1;
  c.r += ti * 0.05;
  c.b += ti * 0.05;
  let sat = 1.0 + params.saturation / 100.0;
  let gray = luminance601(c);
  c = mix(vec3f(gray), c, sat);
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), color.a);
}`,
  params: {
    shadowsHue: { type: 'number', label: 'Shadows Hue', default: 0, min: 0, max: 360, step: 1, animatable: true },
    shadowsAmount: { type: 'number', label: 'Shadows Amount', default: 0, min: 0, max: 1, step: 0.01, animatable: true },
    midtonesHue: { type: 'number', label: 'Midtones Hue', default: 0, min: 0, max: 360, step: 1, animatable: true },
    midtonesAmount: { type: 'number', label: 'Midtones Amount', default: 0, min: 0, max: 1, step: 0.01, animatable: true },
    highlightsHue: { type: 'number', label: 'Highlights Hue', default: 0, min: 0, max: 360, step: 1, animatable: true },
    highlightsAmount: { type: 'number', label: 'Highlights Amount', default: 0, min: 0, max: 1, step: 0.01, animatable: true },
    temperature: { type: 'number', label: 'Temperature', default: 0, min: -100, max: 100, step: 1, animatable: true },
    tint: { type: 'number', label: 'Tint', default: 0, min: -100, max: 100, step: 1, animatable: true },
    saturation: { type: 'number', label: 'Saturation', default: 0, min: -100, max: 100, step: 1, animatable: true },
  },
  packUniforms: (p) => new Float32Array([
    p.shadowsHue as number ?? 0, p.shadowsAmount as number ?? 0,
    p.midtonesHue as number ?? 0, p.midtonesAmount as number ?? 0,
    p.highlightsHue as number ?? 0, p.highlightsAmount as number ?? 0,
    p.temperature as number ?? 0, p.tint as number ?? 0,
    p.saturation as number ?? 0, 0, 0, 0,
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
