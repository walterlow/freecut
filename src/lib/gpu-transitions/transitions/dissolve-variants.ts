import type { GpuTransitionDefinition } from '../types'

const bindings = /* wgsl */ `
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var leftTex: texture_2d<f32>;
@group(0) @binding(2) var rightTex: texture_2d<f32>;
`

const sampleBlur = /* wgsl */ `
fn sampleSoft(tex: texture_2d<f32>, uv: vec2f, radius: vec2f) -> vec4f {
  let center = textureSample(tex, texSampler, uv);
  let a = textureSample(tex, texSampler, clamp(uv + vec2f(radius.x, 0.0), vec2f(0.0), vec2f(1.0)));
  let b = textureSample(tex, texSampler, clamp(uv - vec2f(radius.x, 0.0), vec2f(0.0), vec2f(1.0)));
  let c = textureSample(tex, texSampler, clamp(uv + vec2f(0.0, radius.y), vec2f(0.0), vec2f(1.0)));
  let d = textureSample(tex, texSampler, clamp(uv - vec2f(0.0, radius.y), vec2f(0.0), vec2f(1.0)));
  return center * 0.36 + (a + b + c + d) * 0.16;
}
`

export const additiveDissolve: GpuTransitionDefinition = {
  id: 'additiveDissolve',
  name: 'Additive Dissolve',
  category: 'dissolve',
  hasDirection: false,
  entryPoint: 'additiveDissolveFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct AdditiveDissolveParams {
  progress: f32,
  width: f32,
  height: f32,
  _pad: f32,
};

${bindings}
@group(0) @binding(3) var<uniform> params: AdditiveDissolveParams;

@fragment
fn additiveDissolveFragment(input: VertexOutput) -> @location(0) vec4f {
  let p = clamp(params.progress, 0.0, 1.0);
  let left = textureSample(leftTex, texSampler, input.uv);
  let right = textureSample(rightTex, texSampler, input.uv);
  let base = left.rgb * (1.0 - p) + right.rgb * p;
  let flash = (left.rgb + right.rgb) * sin(p * PI) * 0.22;
  return vec4f(clamp(base + flash, vec3f(0.0), vec3f(1.0)), mix(left.a, right.a, p));
}`,
  packUniforms: (progress, width, height) => new Float32Array([progress, width, height, 0]),
}

export const blurDissolve: GpuTransitionDefinition = {
  id: 'blurDissolve',
  name: 'Blur Dissolve',
  category: 'dissolve',
  hasDirection: false,
  entryPoint: 'blurDissolveFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct BlurDissolveParams {
  progress: f32,
  width: f32,
  height: f32,
  strength: f32,
};

${bindings}
@group(0) @binding(3) var<uniform> params: BlurDissolveParams;
${sampleBlur}

@fragment
fn blurDissolveFragment(input: VertexOutput) -> @location(0) vec4f {
  let p = clamp(params.progress, 0.0, 1.0);
  let envelope = sin(p * PI);
  let radius = vec2f(1.0 / params.width, 1.0 / params.height) * params.strength * envelope;
  let left = sampleSoft(leftTex, input.uv, radius);
  let right = sampleSoft(rightTex, input.uv, radius);
  let t = 0.5 - 0.5 * cos(p * PI);
  return mix(left, right, t);
}`,
  packUniforms: (progress, width, height, _direction, properties) => {
    const strength = (properties?.strength as number) ?? 9
    return new Float32Array([progress, width, height, strength])
  },
}

export const dipToColorDissolve: GpuTransitionDefinition = {
  id: 'dipToColorDissolve',
  name: 'Dip To Color Dissolve',
  category: 'dissolve',
  hasDirection: false,
  entryPoint: 'dipToColorDissolveFragment',
  uniformSize: 32,
  shader: /* wgsl */ `
struct DipToColorDissolveParams {
  progress: f32,
  width: f32,
  height: f32,
  colorR: f32,
  colorG: f32,
  colorB: f32,
  _pad1: f32,
  _pad2: f32,
};

${bindings}
@group(0) @binding(3) var<uniform> params: DipToColorDissolveParams;

@fragment
fn dipToColorDissolveFragment(input: VertexOutput) -> @location(0) vec4f {
  let p = clamp(params.progress, 0.0, 1.0);
  let left = textureSample(leftTex, texSampler, input.uv);
  let right = textureSample(rightTex, texSampler, input.uv);
  let color = vec4f(params.colorR, params.colorG, params.colorB, 1.0);
  let firstHalf = mix(left, color, smoothstep(0.0, 0.5, p));
  let secondHalf = mix(color, right, smoothstep(0.5, 1.0, p));
  return select(secondHalf, firstHalf, p < 0.5);
}`,
  packUniforms: (progress, width, height, _direction, properties) => {
    const color = properties?.color
    const colorArray = Array.isArray(color) ? color : [0, 0, 0]
    return new Float32Array([
      progress,
      width,
      height,
      (colorArray[0] as number | undefined) ?? 0,
      (colorArray[1] as number | undefined) ?? 0,
      (colorArray[2] as number | undefined) ?? 0,
      0,
      0,
    ])
  },
}

export const nonAdditiveDissolve: GpuTransitionDefinition = {
  id: 'nonAdditiveDissolve',
  name: 'Non-Additive Dissolve',
  category: 'dissolve',
  hasDirection: false,
  entryPoint: 'nonAdditiveDissolveFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct NonAdditiveDissolveParams {
  progress: f32,
  width: f32,
  height: f32,
  _pad: f32,
};

${bindings}
@group(0) @binding(3) var<uniform> params: NonAdditiveDissolveParams;

@fragment
fn nonAdditiveDissolveFragment(input: VertexOutput) -> @location(0) vec4f {
  let p = clamp(params.progress, 0.0, 1.0);
  let left = textureSample(leftTex, texSampler, input.uv);
  let right = textureSample(rightTex, texSampler, input.uv);
  let neutral = mix(left.rgb, right.rgb, p);
  let luma = dot(neutral, vec3f(0.2126, 0.7152, 0.0722));
  let guarded = mix(neutral, min(neutral, vec3f(luma + 0.18)), sin(p * PI) * 0.18);
  return vec4f(clamp(guarded, vec3f(0.0), vec3f(1.0)), mix(left.a, right.a, p));
}`,
  packUniforms: (progress, width, height) => new Float32Array([progress, width, height, 0]),
}

export const smoothCut: GpuTransitionDefinition = {
  id: 'smoothCut',
  name: 'Smooth Cut',
  category: 'dissolve',
  hasDirection: false,
  entryPoint: 'smoothCutFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct SmoothCutParams {
  progress: f32,
  width: f32,
  height: f32,
  strength: f32,
};

${bindings}
@group(0) @binding(3) var<uniform> params: SmoothCutParams;
${sampleBlur}

fn smoothCutWarp(uv: vec2f, p: f32, envelope: f32, strength: f32) -> vec2f {
  let low = fbm(uv * vec2f(2.4, 1.8) + vec2f(p * 1.15, -p * 0.8));
  let mid = fbm(uv * vec2f(6.2, 4.8) + vec2f(-p * 1.65, p * 1.25));
  let horizontalBands =
    sin((uv.x * 4.6 + low * 1.8 + p * 1.25) * TAU) * 0.62 +
    sin((uv.x * 8.2 + uv.y * 0.22 + mid * 1.1 - p * 0.9) * TAU) * 0.28 +
    (low - 0.5) * 0.48 +
    (mid - 0.5) * 0.22;
  let horizontalWarp = horizontalBands;
  let verticalWarp = (mid - 0.5) * 0.14;
  let edgeFade = smoothstep(0.03, 0.18, uv.x) * smoothstep(0.97, 0.82, uv.x)
    * smoothstep(0.03, 0.18, uv.y) * smoothstep(0.97, 0.82, uv.y);
  return vec2f(horizontalWarp, verticalWarp) * envelope * strength * 0.052 * edgeFade;
}

@fragment
fn smoothCutFragment(input: VertexOutput) -> @location(0) vec4f {
  let p = clamp(params.progress, 0.0, 1.0);
  let strength = clamp(params.strength, 0.0, 1.0);
  let envelope = sin(p * PI);
  let warp = smoothCutWarp(input.uv, p, envelope, strength);
  let drift = vec2f((p - 0.5) * 0.018 * envelope * strength, 0.0);
  let radius = vec2f(1.0 / params.width, 1.0 / params.height) * envelope * strength * 2.4;
  let leftWarped = sampleSoft(leftTex, clamp(input.uv + warp - drift, vec2f(0.0), vec2f(1.0)), radius);
  let rightWarped = sampleSoft(rightTex, clamp(input.uv - warp + drift, vec2f(0.0), vec2f(1.0)), radius);
  let leftClean = textureSample(leftTex, texSampler, input.uv);
  let rightClean = textureSample(rightTex, texSampler, input.uv);
  let warpMix = smoothstep(0.12, 0.85, envelope);
  let left = mix(leftClean, leftWarped, warpMix);
  let right = mix(rightClean, rightWarped, warpMix);
  let blendWidth = mix(0.18, 0.36, strength);
  let t = smoothstep(0.5 - blendWidth, 0.5 + blendWidth, p);
  return mix(left, right, t);
}`,
  packUniforms: (progress, width, height, _direction, properties) => {
    const strength = (properties?.strength as number) ?? 0.9
    return new Float32Array([progress, width, height, strength])
  },
}
