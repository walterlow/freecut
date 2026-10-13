import type { GpuEffectDefinition } from '../types'

export const gaussianBlur: GpuEffectDefinition = {
  id: 'gpu-gaussian-blur',
  name: 'Gaussian Blur',
  category: 'blur',
  entryPoint: 'gaussianBlurFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct GaussianBlurParams { radius: f32, width: f32, height: f32, samples: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: GaussianBlurParams;
@fragment
fn gaussianBlurFragment(input: VertexOutput) -> @location(0) vec4f {
  if (params.radius < 0.5) {
    return textureSample(inputTex, texSampler, input.uv);
  }
  let texelSize = vec2f(1.0 / params.width, 1.0 / params.height);
  let sampleRadius = i32(clamp(params.samples, 1.0, 64.0));
  var color = vec4f(0.0);
  var totalWeight = 0.0;
  let sigma = params.radius / 3.0;
  let twoSigmaSq = 2.0 * sigma * sigma;
  for (var x = -sampleRadius; x <= sampleRadius; x++) {
    for (var y = -sampleRadius; y <= sampleRadius; y++) {
      let offset = vec2f(f32(x), f32(y)) * texelSize * (params.radius / f32(sampleRadius));
      let distSq = f32(x * x + y * y);
      let weight = exp(-distSq / twoSigmaSq);
      color += textureSample(inputTex, texSampler, input.uv + offset) * weight;
      totalWeight += weight;
    }
  }
  return color / totalWeight;
}`,
  params: {
    radius: {
      type: 'number',
      label: 'Radius',
      default: 10,
      min: 0,
      max: 50,
      step: 1,
      animatable: true,
    },
    samples: {
      type: 'number',
      label: 'Samples',
      default: 5,
      min: 1,
      max: 64,
      step: 1,
      animatable: false,
      quality: true,
    },
  },
  packUniforms: (p, w, h) =>
    new Float32Array([(p.radius as number) ?? 10, w, h, (p.samples as number) ?? 5]),
}

export const boxBlur: GpuEffectDefinition = {
  id: 'gpu-box-blur',
  name: 'Box Blur',
  category: 'blur',
  entryPoint: 'boxBlurFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct BoxBlurParams { radius: f32, width: f32, height: f32, _pad: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: BoxBlurParams;
@fragment
fn boxBlurFragment(input: VertexOutput) -> @location(0) vec4f {
  if (params.radius < 0.5) {
    return textureSample(inputTex, texSampler, input.uv);
  }
  let texelSize = vec2f(1.0 / params.width, 1.0 / params.height);
  let samples = i32(params.radius);
  var color = vec4f(0.0);
  var count = 0.0;
  for (var x = -samples; x <= samples; x++) {
    for (var y = -samples; y <= samples; y++) {
      let offset = vec2f(f32(x), f32(y)) * texelSize;
      color += textureSample(inputTex, texSampler, input.uv + offset);
      count += 1.0;
    }
  }
  return color / count;
}`,
  params: {
    radius: {
      type: 'number',
      label: 'Radius',
      default: 5,
      min: 0,
      max: 20,
      step: 1,
      animatable: true,
    },
  },
  packUniforms: (p, w, h) => new Float32Array([(p.radius as number) ?? 5, w, h, 0]),
}

export const motionBlur: GpuEffectDefinition = {
  id: 'gpu-motion-blur',
  name: 'Motion Blur',
  category: 'blur',
  entryPoint: 'motionBlurFragment',
  // Two vec4-aligned rows. The second row carries the hard radius bound so
  // corrupted/legacy project values cannot turn one layer into an unbounded
  // full-frame texture walk.
  uniformSize: 32,
  shader: /* wgsl */ `
struct MotionBlurParams {
  amount: f32,
  angle: f32,
  shutterAngle: f32,
  samples: f32,
  maxRadius: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: MotionBlurParams;
@fragment
fn motionBlurFragment(input: VertexOutput) -> @location(0) vec4f {
  let exposure = clamp(params.shutterAngle / 360.0, 0.0, 1.0);
  let radius = min(max(params.amount, 0.0) * exposure, params.maxRadius);
  if (radius < 0.001 || exposure < 0.001) {
    return textureSample(inputTex, texSampler, input.uv);
  }
  let direction = vec2f(cos(params.angle), sin(params.angle));
  // Quality is deliberately bounded: shutter blur is on a per-layer hot path.
  let samples = i32(clamp(params.samples, 4.0, 32.0));
  var color = vec4f(0.0);
  var totalWeight = 0.0;
  for (var i = 0; i < samples; i++) {
    let t = (f32(i) / f32(samples - 1) - 0.5) * 2.0;
    let offset = direction * t * radius;
    let weight = exp(-t * t * 2.0);
    color += textureSample(inputTex, texSampler, input.uv + offset) * weight;
    totalWeight += weight;
  }
  return color / totalWeight;
}`,
  params: {
    amount: {
      type: 'number',
      label: 'Amount',
      default: 0.05,
      min: 0,
      max: 0.3,
      step: 0.005,
      animatable: true,
    },
    angle: {
      type: 'number',
      label: 'Angle',
      default: 0,
      min: 0,
      max: 6.28318,
      step: 0.01,
      animatable: true,
    },
    samples: {
      type: 'number',
      label: 'Samples',
      default: 16,
      min: 4,
      max: 32,
      step: 1,
      animatable: false,
      quality: true,
    },
    shutterAngle: {
      type: 'number',
      label: 'Shutter Angle',
      default: 180,
      min: 0,
      max: 360,
      step: 1,
      animatable: true,
    },
  },
  packUniforms: (p) =>
    new Float32Array([
      (p.amount as number) ?? 0.05,
      (p.angle as number) ?? 0,
      // Existing effect instances have legacy params but no shutterAngle;
      // a truly empty params object is the registry's "use defaults" probe.
      (p.shutterAngle as number | undefined) ?? (Object.keys(p).length > 0 ? 360 : 180),
      (p.samples as number) ?? 16,
      0.2,
      0,
      0,
      0,
    ]),
}

export const radialBlur: GpuEffectDefinition = {
  id: 'gpu-radial-blur',
  name: 'Radial Blur',
  category: 'blur',
  entryPoint: 'radialBlurFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct RadialBlurParams { amount: f32, centerX: f32, centerY: f32, samples: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: RadialBlurParams;
@fragment
fn radialBlurFragment(input: VertexOutput) -> @location(0) vec4f {
  let center = vec2f(params.centerX, params.centerY);
  let dir = input.uv - center;
  let dist = length(dir);
  if (params.amount < 0.01) {
    return textureSample(inputTex, texSampler, input.uv);
  }
  var color = vec4f(0.0);
  let samples = i32(clamp(params.samples, 4.0, 256.0));
  let amount = params.amount * 0.2;
  var totalWeight = 0.0;
  for (var i = 0; i < samples; i++) {
    let t = f32(i) / f32(samples - 1);
    let scale = 1.0 - amount * t * dist;
    let weight = 1.0 - t * 0.5;
    let samplePos = center + dir * scale;
    color += textureSample(inputTex, texSampler, samplePos) * weight;
    totalWeight += weight;
  }
  return color / totalWeight;
}`,
  params: {
    amount: {
      type: 'number',
      label: 'Amount',
      default: 0.5,
      min: 0,
      max: 2,
      step: 0.01,
      animatable: true,
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
    samples: {
      type: 'number',
      label: 'Samples',
      default: 32,
      min: 4,
      max: 256,
      step: 1,
      animatable: false,
      quality: true,
    },
  },
  packUniforms: (p) =>
    new Float32Array([
      (p.amount as number) ?? 0.5,
      (p.centerX as number) ?? 0.5,
      (p.centerY as number) ?? 0.5,
      (p.samples as number) ?? 32,
    ]),
}

export const zoomBlur: GpuEffectDefinition = {
  id: 'gpu-zoom-blur',
  name: 'Zoom Blur',
  category: 'blur',
  entryPoint: 'zoomBlurFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct ZoomBlurParams { amount: f32, centerX: f32, centerY: f32, samples: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: ZoomBlurParams;
@fragment
fn zoomBlurFragment(input: VertexOutput) -> @location(0) vec4f {
  let center = vec2f(params.centerX, params.centerY);
  let dir = input.uv - center;
  var color = vec4f(0.0);
  let samples = i32(clamp(params.samples, 4.0, 256.0));
  let amount = params.amount * 0.5;
  for (var i = 0; i < samples; i++) {
    let t = f32(i) / f32(samples - 1);
    let scale = 1.0 + amount * t;
    let samplePos = center + dir * scale;
    color += textureSample(inputTex, texSampler, samplePos);
  }
  return color / f32(samples);
}`,
  params: {
    amount: {
      type: 'number',
      label: 'Amount',
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
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
    samples: {
      type: 'number',
      label: 'Samples',
      default: 16,
      min: 4,
      max: 256,
      step: 1,
      animatable: false,
      quality: true,
    },
  },
  packUniforms: (p) =>
    new Float32Array([
      (p.amount as number) ?? 0.3,
      (p.centerX as number) ?? 0.5,
      (p.centerY as number) ?? 0.5,
      (p.samples as number) ?? 16,
    ]),
}
