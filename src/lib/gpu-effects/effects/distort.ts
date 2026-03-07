import type { GpuEffectDefinition } from '../types';

export const pixelate: GpuEffectDefinition = {
  id: 'gpu-pixelate',
  name: 'Pixelate',
  category: 'distort',
  entryPoint: 'pixelateFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct PixelateParams { pixelSize: f32, width: f32, height: f32, _p: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: PixelateParams;
@fragment
fn pixelateFragment(input: VertexOutput) -> @location(0) vec4f {
  let pixelX = params.pixelSize / params.width;
  let pixelY = params.pixelSize / params.height;
  let uv = vec2f(
    floor(input.uv.x / pixelX) * pixelX + pixelX * 0.5,
    floor(input.uv.y / pixelY) * pixelY + pixelY * 0.5
  );
  return textureSample(inputTex, texSampler, uv);
}`,
  params: {
    size: { type: 'number', label: 'Pixel Size', default: 8, min: 1, max: 64, step: 1, animatable: true },
  },
  packUniforms: (p, w, h) => new Float32Array([p.size as number ?? 8, w, h, 0]),
};

export const rgbSplit: GpuEffectDefinition = {
  id: 'gpu-rgb-split',
  name: 'RGB Split',
  category: 'distort',
  entryPoint: 'rgbSplitFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct RGBSplitParams { amount: f32, angle: f32, _p1: f32, _p2: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: RGBSplitParams;
@fragment
fn rgbSplitFragment(input: VertexOutput) -> @location(0) vec4f {
  let offset = vec2f(cos(params.angle), sin(params.angle)) * params.amount;
  let r = textureSample(inputTex, texSampler, input.uv + offset).r;
  let g = textureSample(inputTex, texSampler, input.uv).g;
  let b = textureSample(inputTex, texSampler, input.uv - offset).b;
  let a = textureSample(inputTex, texSampler, input.uv).a;
  return vec4f(r, g, b, a);
}`,
  params: {
    amount: { type: 'number', label: 'Amount', default: 0.01, min: 0, max: 0.1, step: 0.001, animatable: true },
    angle: { type: 'number', label: 'Angle', default: 0, min: 0, max: 6.28318, step: 0.01, animatable: true },
  },
  packUniforms: (p) => new Float32Array([p.amount as number ?? 0.01, p.angle as number ?? 0, 0, 0]),
};

export const twirl: GpuEffectDefinition = {
  id: 'gpu-twirl',
  name: 'Twirl',
  category: 'distort',
  entryPoint: 'twirlFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct TwirlParams { amount: f32, radius: f32, centerX: f32, centerY: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: TwirlParams;
@fragment
fn twirlFragment(input: VertexOutput) -> @location(0) vec4f {
  let center = vec2f(params.centerX, params.centerY);
  let delta = input.uv - center;
  let dist = length(delta);
  let safeRadius = max(params.radius, 0.0001);
  let factor = 1.0 - min(dist / safeRadius, 1.0);
  let angle = params.amount * factor * factor;
  let s = sin(angle);
  let c = cos(angle);
  let rotated = vec2f(delta.x * c - delta.y * s, delta.x * s + delta.y * c);
  let twirledUV = center + rotated;
  let inRadius = dist < params.radius;
  let finalUV = select(input.uv, twirledUV, inRadius);
  return textureSample(inputTex, texSampler, finalUV);
}`,
  params: {
    amount: { type: 'number', label: 'Amount', default: 1, min: -10, max: 10, step: 0.1, animatable: true },
    radius: { type: 'number', label: 'Radius', default: 0.5, min: 0.1, max: 1, step: 0.01, animatable: true },
    centerX: { type: 'number', label: 'Center X', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true },
    centerY: { type: 'number', label: 'Center Y', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true },
  },
  packUniforms: (p) => new Float32Array([
    p.amount as number ?? 1, p.radius as number ?? 0.5, p.centerX as number ?? 0.5, p.centerY as number ?? 0.5,
  ]),
};

export const wave: GpuEffectDefinition = {
  id: 'gpu-wave',
  name: 'Wave',
  category: 'distort',
  entryPoint: 'waveFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct WaveParams { amplitudeX: f32, amplitudeY: f32, frequencyX: f32, frequencyY: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: WaveParams;
@fragment
fn waveFragment(input: VertexOutput) -> @location(0) vec4f {
  var uv = input.uv;
  uv.y += sin(uv.x * params.frequencyX * TAU) * params.amplitudeX;
  uv.x += sin(uv.y * params.frequencyY * TAU) * params.amplitudeY;
  return textureSample(inputTex, texSampler, uv);
}`,
  params: {
    amplitudeX: { type: 'number', label: 'Horizontal Amp', default: 0.02, min: 0, max: 0.1, step: 0.001, animatable: true },
    amplitudeY: { type: 'number', label: 'Vertical Amp', default: 0.02, min: 0, max: 0.1, step: 0.001, animatable: true },
    frequencyX: { type: 'number', label: 'Horizontal Freq', default: 5, min: 1, max: 20, step: 0.5, animatable: true },
    frequencyY: { type: 'number', label: 'Vertical Freq', default: 5, min: 1, max: 20, step: 0.5, animatable: true },
  },
  packUniforms: (p) => new Float32Array([
    p.amplitudeX as number ?? 0.02, p.amplitudeY as number ?? 0.02,
    p.frequencyX as number ?? 5, p.frequencyY as number ?? 5,
  ]),
};

export const bulge: GpuEffectDefinition = {
  id: 'gpu-bulge',
  name: 'Bulge/Pinch',
  category: 'distort',
  entryPoint: 'bulgeFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct BulgeParams { amount: f32, radius: f32, centerX: f32, centerY: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: BulgeParams;
@fragment
fn bulgeFragment(input: VertexOutput) -> @location(0) vec4f {
  let center = vec2f(params.centerX, params.centerY);
  let delta = input.uv - center;
  let dist = length(delta);
  let safeDist = max(dist, 0.0001);
  let normalizedDist = safeDist / params.radius;
  let factor = pow(normalizedDist, params.amount);
  let newDist = factor * params.radius;
  let direction = delta / safeDist;
  let bulgedUV = center + direction * newDist;
  let inRadius = dist < params.radius && dist > 0.0;
  let finalUV = select(input.uv, bulgedUV, inRadius);
  return textureSample(inputTex, texSampler, finalUV);
}`,
  params: {
    amount: { type: 'number', label: 'Amount', default: 0.5, min: 0.1, max: 3, step: 0.1, animatable: true },
    radius: { type: 'number', label: 'Radius', default: 0.5, min: 0.1, max: 1, step: 0.01, animatable: true },
    centerX: { type: 'number', label: 'Center X', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true },
    centerY: { type: 'number', label: 'Center Y', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true },
  },
  packUniforms: (p) => new Float32Array([
    p.amount as number ?? 0.5, p.radius as number ?? 0.5, p.centerX as number ?? 0.5, p.centerY as number ?? 0.5,
  ]),
};

export const kaleidoscope: GpuEffectDefinition = {
  id: 'gpu-kaleidoscope',
  name: 'Kaleidoscope',
  category: 'distort',
  entryPoint: 'kaleidoscopeFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct KaleidoscopeParams { segments: f32, rotation: f32, _p1: f32, _p2: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: KaleidoscopeParams;
@fragment
fn kaleidoscopeFragment(input: VertexOutput) -> @location(0) vec4f {
  var uv = input.uv - 0.5;
  let angle = atan2(uv.y, uv.x) + params.rotation;
  let radius = length(uv);
  let segmentAngle = TAU / params.segments;
  var a = fract(angle / segmentAngle) * segmentAngle;
  if (a > segmentAngle * 0.5) { a = segmentAngle - a; }
  uv = vec2f(cos(a), sin(a)) * radius + 0.5;
  return textureSample(inputTex, texSampler, uv);
}`,
  params: {
    segments: { type: 'number', label: 'Segments', default: 6, min: 2, max: 16, step: 1, animatable: true },
    rotation: { type: 'number', label: 'Rotation', default: 0, min: 0, max: 6.28318, step: 0.01, animatable: true },
  },
  packUniforms: (p) => new Float32Array([p.segments as number ?? 6, p.rotation as number ?? 0, 0, 0]),
};

export const mirror: GpuEffectDefinition = {
  id: 'gpu-mirror',
  name: 'Mirror',
  category: 'distort',
  entryPoint: 'mirrorFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct MirrorParams { horizontal: f32, vertical: f32, _p1: f32, _p2: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: MirrorParams;
@fragment
fn mirrorFragment(input: VertexOutput) -> @location(0) vec4f {
  var uv = input.uv;
  if (params.horizontal > 0.5 && uv.x > 0.5) { uv.x = 1.0 - uv.x; }
  if (params.vertical > 0.5 && uv.y > 0.5) { uv.y = 1.0 - uv.y; }
  return textureSample(inputTex, texSampler, uv);
}`,
  params: {
    horizontal: { type: 'boolean', label: 'Horizontal', default: true },
    vertical: { type: 'boolean', label: 'Vertical', default: false },
  },
  packUniforms: (p) => new Float32Array([p.horizontal ? 1 : 0, p.vertical ? 1 : 0, 0, 0]),
};
