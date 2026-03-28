import type { GpuEffectDefinition } from '../types';

export const vignette: GpuEffectDefinition = {
  id: 'gpu-vignette',
  name: 'Vignette',
  category: 'stylize',
  entryPoint: 'vignetteFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct VignetteParams { amount: f32, size: f32, softness: f32, roundness: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: VignetteParams;
@fragment
fn vignetteFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let center = input.uv - 0.5;
  let aspect = vec2f(1.0, params.roundness);
  let dist = length(center * aspect) * 2.0;
  let vig = 1.0 - smoothstep(params.size, params.size + params.softness, dist);
  let vigColor = mix(vec3f(0.0), color.rgb, mix(1.0, vig, params.amount));
  return vec4f(vigColor, color.a);
}`,
  params: {
    amount: { type: 'number', label: 'Amount', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true },
    size: { type: 'number', label: 'Size', default: 0.5, min: 0, max: 1.5, step: 0.01, animatable: true },
    softness: { type: 'number', label: 'Softness', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true },
    roundness: { type: 'number', label: 'Roundness', default: 1, min: 0.5, max: 2, step: 0.01, animatable: true },
  },
  packUniforms: (p) => new Float32Array([
    p.amount as number ?? 0.5, p.size as number ?? 0.5,
    p.softness as number ?? 0.5, p.roundness as number ?? 1,
  ]),
};

export const grain: GpuEffectDefinition = {
  id: 'gpu-grain',
  name: 'Film Grain',
  category: 'stylize',
  entryPoint: 'grainFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct GrainParams { amount: f32, size: f32, speed: f32, time: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: GrainParams;
fn grainNoise(uv: vec2f, t: f32) -> f32 {
  let seed = uv + vec2f(t * 0.1, t * 0.07);
  return fract(sin(dot(seed, vec2f(12.9898, 78.233))) * 43758.5453);
}
@fragment
fn grainFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let grainUV = input.uv * (100.0 / params.size);
  let noise = grainNoise(grainUV, params.time * params.speed) * 2.0 - 1.0;
  let luma = luminance(color.rgb);
  let grainIntensity = params.amount * (1.0 - luma * 0.5);
  let grainColor = color.rgb + vec3f(noise * grainIntensity);
  return vec4f(clamp(grainColor, vec3f(0.0), vec3f(1.0)), color.a);
}`,
  params: {
    amount: { type: 'number', label: 'Amount', default: 0.1, min: 0, max: 0.5, step: 0.01, animatable: true },
    size: { type: 'number', label: 'Size', default: 1, min: 0.5, max: 5, step: 0.1, animatable: true },
    speed: { type: 'number', label: 'Speed', default: 1, min: 0, max: 5, step: 0.1, animatable: false },
  },
  packUniforms: (p) => {
    const time = performance.now() / 1000;
    return new Float32Array([p.amount as number ?? 0.1, p.size as number ?? 1, p.speed as number ?? 1, time]);
  },
};

export const sharpen: GpuEffectDefinition = {
  id: 'gpu-sharpen',
  name: 'Sharpen',
  category: 'stylize',
  entryPoint: 'sharpenFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct SharpenParams { amount: f32, radius: f32, width: f32, height: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: SharpenParams;
@fragment
fn sharpenFragment(input: VertexOutput) -> @location(0) vec4f {
  let texelSize = vec2f(1.0 / params.width, 1.0 / params.height);
  let center = textureSample(inputTex, texSampler, input.uv);
  var blur = vec4f(0.0);
  var totalWeight = 0.0;
  let samples = 3;
  let sigma = params.radius * 0.5 + 0.5;
  for (var x = -samples; x <= samples; x++) {
    for (var y = -samples; y <= samples; y++) {
      let offset = vec2f(f32(x), f32(y)) * texelSize * params.radius;
      let distSq = f32(x * x + y * y);
      let weight = exp(-distSq / (2.0 * sigma * sigma));
      blur += textureSample(inputTex, texSampler, input.uv + offset) * weight;
      totalWeight += weight;
    }
  }
  blur /= totalWeight;
  let sharpened = center.rgb + (center.rgb - blur.rgb) * params.amount;
  return vec4f(clamp(sharpened, vec3f(0.0), vec3f(1.0)), center.a);
}`,
  params: {
    amount: { type: 'number', label: 'Amount', default: 1, min: 0, max: 5, step: 0.1, animatable: true },
    radius: { type: 'number', label: 'Radius', default: 1, min: 0.5, max: 5, step: 0.1, animatable: true },
  },
  packUniforms: (p, w, h) => new Float32Array([p.amount as number ?? 1, p.radius as number ?? 1, w, h]),
};

export const posterize: GpuEffectDefinition = {
  id: 'gpu-posterize',
  name: 'Posterize',
  category: 'stylize',
  entryPoint: 'posterizeFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct PosterizeParams { levels: f32, _p1: f32, _p2: f32, _p3: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: PosterizeParams;
@fragment
fn posterizeFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let levels = max(params.levels, 2.0);
  let posterized = floor(color.rgb * levels) / (levels - 1.0);
  return vec4f(posterized, color.a);
}`,
  params: {
    levels: { type: 'number', label: 'Levels', default: 6, min: 2, max: 32, step: 1, animatable: true },
  },
  packUniforms: (p) => new Float32Array([p.levels as number ?? 6, 0, 0, 0]),
};

export const glow: GpuEffectDefinition = {
  id: 'gpu-glow',
  name: 'Glow',
  category: 'stylize',
  entryPoint: 'glowFragment',
  uniformSize: 32,
  shader: /* wgsl */ `
struct GlowParams {
  amount: f32, threshold: f32, radius: f32, softness: f32,
  width: f32, height: f32, rings: f32, samplesPerRing: f32,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: GlowParams;
@fragment
fn glowFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let texelSize = vec2f(1.0 / params.width, 1.0 / params.height);
  var glowVal = vec3f(0.0);
  var totalWeight = 0.0;
  let rings = i32(clamp(params.rings, 1.0, 32.0));
  let samplesPerRing = i32(clamp(params.samplesPerRing, 4.0, 64.0));
  for (var ring = 1; ring <= rings; ring++) {
    let ringRadius = f32(ring) * params.radius * texelSize.x * 10.0;
    let ringWeight = gaussian(f32(ring) / f32(rings), params.softness + 0.3);
    for (var i = 0; i < samplesPerRing; i++) {
      let angle = f32(i) * TAU / f32(samplesPerRing) + f32(ring) * 0.5;
      let offset = vec2f(cos(angle), sin(angle)) * ringRadius;
      let sampleColor = textureSample(inputTex, texSampler, input.uv + offset);
      let sampleLuma = luminance(sampleColor.rgb);
      let brightFactor = smoothstep(params.threshold - 0.1, params.threshold + 0.1, sampleLuma);
      let brightColor = sampleColor.rgb * brightFactor;
      glowVal += brightColor * ringWeight;
      totalWeight += ringWeight;
    }
  }
  let centerLuma = luminance(color.rgb);
  let centerBright = smoothstep(params.threshold - 0.1, params.threshold + 0.1, centerLuma);
  glowVal += color.rgb * centerBright * 2.0;
  totalWeight += 2.0;
  glowVal /= totalWeight;
  let result = color.rgb + glowVal * params.amount * 2.0;
  return vec4f(clamp(result, vec3f(0.0), vec3f(1.0)), color.a);
}`,
  params: {
    amount: { type: 'number', label: 'Amount', default: 1, min: 0, max: 5, step: 0.1, animatable: true },
    threshold: { type: 'number', label: 'Threshold', default: 0.6, min: 0, max: 1, step: 0.01, animatable: true },
    radius: { type: 'number', label: 'Radius', default: 20, min: 1, max: 100, step: 1, animatable: true },
    softness: { type: 'number', label: 'Softness', default: 0.5, min: 0.1, max: 1, step: 0.05, animatable: true },
    rings: { type: 'number', label: 'Rings', default: 4, min: 1, max: 32, step: 1, animatable: false, quality: true },
    samplesPerRing: { type: 'number', label: 'Samples/Ring', default: 16, min: 4, max: 64, step: 1, animatable: false, quality: true },
  },
  packUniforms: (p, w, h) => new Float32Array([
    p.amount as number ?? 1, p.threshold as number ?? 0.6,
    p.radius as number ?? 20, p.softness as number ?? 0.5,
    w, h, p.rings as number ?? 4, p.samplesPerRing as number ?? 16,
  ]),
};

export const edgeDetect: GpuEffectDefinition = {
  id: 'gpu-edge-detect',
  name: 'Edge Detect',
  category: 'stylize',
  entryPoint: 'edgeDetectFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct EdgeDetectParams { strength: f32, width: f32, height: f32, invertFlag: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: EdgeDetectParams;
@fragment
fn edgeDetectFragment(input: VertexOutput) -> @location(0) vec4f {
  let texelSize = vec2f(1.0 / params.width, 1.0 / params.height);
  let tl = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(-texelSize.x, -texelSize.y)).rgb);
  let t  = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(0.0, -texelSize.y)).rgb);
  let tr = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(texelSize.x, -texelSize.y)).rgb);
  let l  = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(-texelSize.x, 0.0)).rgb);
  let r  = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(texelSize.x, 0.0)).rgb);
  let bl = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(-texelSize.x, texelSize.y)).rgb);
  let b  = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(0.0, texelSize.y)).rgb);
  let br = luminance(textureSample(inputTex, texSampler, input.uv + vec2f(texelSize.x, texelSize.y)).rgb);
  let gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
  let gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
  var edge = sqrt(gx*gx + gy*gy) * params.strength;
  edge = clamp(edge, 0.0, 1.0);
  if (params.invertFlag > 0.5) { edge = 1.0 - edge; }
  return vec4f(vec3f(edge), 1.0);
}`,
  params: {
    strength: { type: 'number', label: 'Strength', default: 1, min: 0, max: 5, step: 0.1, animatable: true },
    invert: { type: 'boolean', label: 'Invert', default: false },
  },
  packUniforms: (p, w, h) => new Float32Array([p.strength as number ?? 1, w, h, p.invert ? 1 : 0]),
};

export const scanlines: GpuEffectDefinition = {
  id: 'gpu-scanlines',
  name: 'Scanlines',
  category: 'stylize',
  entryPoint: 'scanlinesFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct ScanlinesParams { density: f32, opacity: f32, speed: f32, time: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: ScanlinesParams;
@fragment
fn scanlinesFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let scrollOffset = params.time * params.speed * 0.1;
  let scanline = sin((input.uv.y + scrollOffset) * params.density * 100.0) * 0.5 + 0.5;
  let darken = 1.0 - params.opacity * (1.0 - scanline);
  return vec4f(color.rgb * darken, color.a);
}`,
  params: {
    density: { type: 'number', label: 'Density', default: 5, min: 1, max: 20, step: 0.5, animatable: true },
    opacity: { type: 'number', label: 'Opacity', default: 0.3, min: 0, max: 1, step: 0.01, animatable: true },
    speed: { type: 'number', label: 'Scroll Speed', default: 0, min: 0, max: 5, step: 0.1, animatable: false },
  },
  packUniforms: (p) => {
    const time = performance.now() / 1000;
    return new Float32Array([p.density as number ?? 5, p.opacity as number ?? 0.3, p.speed as number ?? 0, time]);
  },
};

export const colorGlitch: GpuEffectDefinition = {
  id: 'gpu-color-glitch',
  name: 'Color Glitch',
  category: 'stylize',
  entryPoint: 'colorGlitchFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct ColorGlitchParams { intensity: f32, speed: f32, time: f32, _pad: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: ColorGlitchParams;
@fragment
fn colorGlitchFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let t = params.time * params.speed;
  let glitchNoise = hash(vec2f(floor(t * 8.0), floor(input.uv.y * 20.0)));
  let shouldGlitch = step(1.0 - params.intensity, glitchNoise);
  let hueShift = hash(vec2f(floor(t * 12.0), 0.0)) * shouldGlitch;
  var hsv = rgb2hsv(color.rgb);
  hsv.x = fract(hsv.x + hueShift);
  let glitched = hsv2rgb(hsv);
  return vec4f(mix(color.rgb, glitched, shouldGlitch * params.intensity), color.a);
}`,
  params: {
    intensity: { type: 'number', label: 'Intensity', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true },
    speed: { type: 'number', label: 'Speed', default: 1, min: 0.1, max: 5, step: 0.1, animatable: false },
  },
  packUniforms: (p) => {
    const time = performance.now() / 1000;
    return new Float32Array([p.intensity as number ?? 0.5, p.speed as number ?? 1, time, 0]);
  },
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function parseHexColor(color: string, fallback: [number, number, number, number]): [number, number, number, number] {
  if (!color.startsWith('#')) return fallback;

  const hex = color.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    const values = hex.split('').map((ch) => parseInt(ch + ch, 16) / 255);
    return [
      values[0] ?? fallback[0],
      values[1] ?? fallback[1],
      values[2] ?? fallback[2],
      values[3] ?? 1,
    ];
  }

  if (hex.length === 6 || hex.length === 8) {
    const values = [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
      hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    ];
    if (values.every((value) => Number.isFinite(value))) {
      return values as [number, number, number, number];
    }
  }

  return fallback;
}

function legacySpacingToPaperSize(spacing: number | undefined, height: number): number {
  if (!spacing || spacing <= 0 || !Number.isFinite(spacing)) return 0.5;
  const cellsPerSide = Math.max(7, Math.min(300, height / spacing));
  const normalized = clamp01((300 - cellsPerSide) / 293);
  return Math.pow(normalized, 1 / 0.7);
}

function legacyDotRatioToRadius(dotSize: number | undefined, spacing: number | undefined): number {
  if (!dotSize || !spacing || spacing <= 0) return 1.25;
  return Math.max(0, Math.min(2, (dotSize / spacing) * 2));
}

// Adapted from Paper Design's halftone-dots shader (MIT, Lost Coast Labs, Inc.):
// https://github.com/paper-design/shaders
export const halftone: GpuEffectDefinition = {
  id: 'gpu-halftone',
  name: 'Halftone',
  category: 'stylize',
  entryPoint: 'halftoneFragment',
  uniformSize: 80,
  shader: /* wgsl */ `
struct HalftoneParams {
  colorFront: vec4f,
  colorBack: vec4f,
  primary: vec4f,
  secondary: vec4f,
  tertiary: vec4f,
};

struct HalftoneSample {
  shape: f32,
  color: vec4f,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: HalftoneParams;

fn rotateHalftonePoint(p: vec2f, angleRad: f32) -> vec2f {
  let c = cos(angleRad);
  let s = sin(angleRad);
  return vec2f(p.x * c - p.y * s, p.x * s + p.y * c);
}

fn halftoneLinearStep(edge0: f32, edge1: f32, x: f32) -> f32 {
  return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
}

fn halftoneSmoothStep(edge0: f32, edge1: f32, x: f32) -> f32 {
  return smoothstep(edge0, edge1, x);
}

fn halftoneSigmoid(x: f32, k: f32) -> f32 {
  return 1.0 / (1.0 + exp(-k * (x - 0.5)));
}

fn getCircle(uv: vec2f, r: f32, baseR: f32) -> f32 {
  let rr = mix(0.25 * baseR, 0.0, r);
  let d = length(uv - 0.5);
  let aa = 0.02;
  return 1.0 - smoothstep(rr - aa, rr + aa, d);
}

fn getCell(uv: vec2f) -> f32 {
  let insideX = step(0.0, uv.x) * (1.0 - step(1.0, uv.x));
  let insideY = step(0.0, uv.y) * (1.0 - step(1.0, uv.y));
  return insideX * insideY;
}

fn getCircleWithHole(uv: vec2f, r: f32, baseR: f32) -> f32 {
  let cell = getCell(uv);
  let rr = mix(0.75 * baseR, 0.0, r);
  let rMod = rr - floor(rr / 0.5) * 0.5;
  let d = length(uv - 0.5);
  let aa = 0.02;
  let circle = 1.0 - smoothstep(rMod - aa, rMod + aa, d);
  if (rr < 0.5) {
    return circle;
  }
  return cell - circle;
}

fn getGooeyBall(uv: vec2f, r: f32, baseR: f32, gridType: i32) -> f32 {
  var d = length(uv - 0.5);
  var sizeRadius = 0.3;
  if (gridType == 1) {
    sizeRadius = 0.42;
  }
  sizeRadius = mix(sizeRadius * baseR, 0.0, r);
  d = 1.0 - halftoneSmoothStep(0.0, sizeRadius, d);
  d = pow(d, 2.0 + baseR);
  return d;
}

fn getSoftBall(uv: vec2f, r: f32, baseR: f32) -> f32 {
  var d = length(uv - 0.5);
  var sizeRadius = clamp(baseR, 0.0, 1.0);
  sizeRadius = mix(0.5 * sizeRadius, 0.0, r);
  d = 1.0 - halftoneLinearStep(0.0, sizeRadius, d);
  let powRadius = 1.0 - halftoneLinearStep(0.0, 2.0, baseR);
  d = pow(d, 4.0 + 3.0 * powRadius);
  return d;
}

fn getLumAtPx(uv: vec2f, contrast: f32, inverted: bool) -> f32 {
  let tex = textureSampleLevel(inputTex, texSampler, uv, 0.0);
  if (tex.a <= 1e-4) {
    return select(0.0, 1.0, inverted);
  }
  let color = vec3f(
    halftoneSigmoid(tex.r, contrast),
    halftoneSigmoid(tex.g, contrast),
    halftoneSigmoid(tex.b, contrast)
  );
  var lum = luminance(color);
  if (inverted) {
    lum = 1.0 - lum;
  }
  return lum;
}

fn getLumBall(
  p: vec2f,
  pad: vec2f,
  texelSize: vec2f,
  inCellOffset: vec2f,
  contrast: f32,
  baseR: f32,
  stepSize: f32,
  styleType: i32,
  gridType: i32,
  inverted: bool,
  grainMixer: f32,
  grainSizeParam: f32
) -> HalftoneSample {
  let pp = p + inCellOffset;
  let uv_i = floor(pp);
  let uv_f = fract(pp);
  let samplingUV = (uv_i + 0.5 - inCellOffset) * pad + 0.5;
  let safeSamplingUV = clamp(samplingUV, texelSize * 0.5, vec2f(1.0) - texelSize * 0.5);
  var lum = getLumAtPx(safeSamplingUV, contrast, inverted);
  if (grainMixer > 0.001) {
    let grainSizeCurve = pow(grainSizeParam, 0.72);
    let grainDomainScale = mix(2600.0, 55.0, grainSizeCurve);
    let grainDomain = safeSamplingUV * grainDomainScale + inCellOffset * 37.0 + vec2f(21.0, -14.0);
    let grainPrimary = halftoneOverlayNoise(grainDomain * mix(1.15, 0.2, grainSizeCurve));
    let grainSecondary = halftoneNoise(
      grainDomain * mix(2.1, 0.38, grainSizeCurve) +
      uv_f * mix(14.0, 4.0, grainSizeCurve)
    );
    let edgeWeight = 1.0 - abs(lum * 2.0 - 1.0);
    let lumJitter = (grainSecondary * 2.0 - 1.0) * (0.08 + 0.32 * grainMixer) * (0.3 + 0.7 * edgeWeight);
    let lumCut = smoothstep(0.45, 0.85 - 0.2 * grainMixer, grainPrimary) * grainMixer * (0.1 + 0.8 * edgeWeight);
    lum = clamp(lum + lumJitter - lumCut, 0.0, 1.0);
  }
  let sampledColor = textureSampleLevel(inputTex, texSampler, safeSamplingUV, 0.0);
  let sourceCoverage = sampledColor.a;
  if (sourceCoverage <= 1e-4) {
    return HalftoneSample(0.0, vec4f(0.0));
  }
  var ballColor = vec4f(sampledColor.rgb * sourceCoverage, sourceCoverage);
  var ball = 0.0;
  if (styleType == 0) {
    ball = getCircle(uv_f, lum, baseR);
  } else if (styleType == 1) {
    ball = getGooeyBall(uv_f, lum, baseR, gridType);
  } else if (styleType == 2) {
    ball = getCircleWithHole(uv_f, lum, baseR);
  } else {
    ball = getSoftBall(uv_f, lum, baseR);
  }
  return HalftoneSample(ball * sourceCoverage, ballColor);
}

fn halftoneNoise(p: vec2f) -> f32 {
  let layerA = noise2d(p);
  let layerB = noise2d(vec2f(
    p.x * 1.31 + p.y * 0.74,
    p.x * -0.68 + p.y * 1.27
  ) + vec2f(11.7, 3.9));
  let layerC = noise2d(vec2f(
    p.x * -0.57 + p.y * 1.43,
    p.x * 1.19 + p.y * 0.53
  ) + vec2f(-7.4, 13.1));
  return (layerA + layerB + layerC) / 3.0;
}

fn halftoneOverlayNoise(p: vec2f) -> f32 {
  let coarse = halftoneNoise(p * 0.73 + vec2f(5.31, -8.17));
  let medium = halftoneNoise(vec2f(
    p.x * 1.41 - p.y * 0.52,
    p.x * 0.67 + p.y * 1.28
  ) + vec2f(-11.4, 4.6));
  let fine = halftoneNoise(vec2f(
    p.x * -0.88 + p.y * 1.19,
    p.x * -1.07 - p.y * 0.79
  ) + vec2f(8.2, 10.7));
  return coarse * 0.45 + medium * 0.35 + fine * 0.2;
}

fn getStepCount(styleType: i32) -> i32 {
  if (styleType == 1) {
    return 6;
  }
  if (styleType == 3) {
    return 6;
  }
  if (styleType == 0) {
    return 2;
  }
  return 1;
}

@fragment
fn halftoneFragment(input: VertexOutput) -> @location(0) vec4f {
  let sourceSample = textureSampleLevel(inputTex, texSampler, input.uv, 0.0);
  let sourceAlpha = sourceSample.a;
  if (sourceAlpha <= 1e-4) {
    return vec4f(0.0);
  }

  let dims = vec2f(textureDimensions(inputTex));
  let aspect = max(dims.x / max(dims.y, 1.0), 0.0001);
  let size = clamp(params.primary.x, 0.0, 1.0);
  let radius = clamp(params.primary.y, 0.0, 2.0);
  let contrastParam = clamp(params.primary.z, 0.0, 1.0);
  let originalColors = params.secondary.x > 0.5;
  let inverted = params.secondary.y > 0.5;
  let grainMixer = clamp(params.secondary.z, 0.0, 1.0);
  let grainOverlay = clamp(params.secondary.w, 0.0, 1.0);
  let grainSizeParam = clamp(params.tertiary.x, 0.0, 1.0);
  let gridType = i32(params.tertiary.y);
  let styleType = i32(params.tertiary.z);

  let stepCount = getStepCount(styleType);
  let stepSize = 1.0 / f32(stepCount);

  var cellsPerSide = mix(300.0, 7.0, pow(size, 0.7));
  cellsPerSide /= f32(stepCount);
  let cellSizeY = 1.0 / cellsPerSide;
  var pad = cellSizeY * vec2f(1.0 / aspect, 1.0);
  if (styleType == 1 && gridType == 1) {
    pad *= 0.7;
  }
  // Snap to whole cells AND force odd counts.  With an odd cell count the
  // centered grid puts uv = ±N.5 at the texture edges, which lands at
  // fract = 0.5 — right on the dot center.  Even counts land at fract = 0
  // (cell boundary), exposing the paper/background as a rectangular border.
  var rawCols = max(1.0, round(1.0 / max(pad.x, 1e-4)));
  var rawRows = max(1.0, round(1.0 / max(pad.y, 1e-4)));
  let cols = rawCols + select(0.0, 1.0, fract(rawCols * 0.5) < 0.25);
  let rows = rawRows + select(0.0, 1.0, fract(rawRows * 0.5) < 0.25);
  pad = vec2f(1.0 / cols, 1.0 / rows);
  let texelSize = 1.0 / max(dims, vec2f(1.0));

  var uv = input.uv - 0.5;
  uv /= pad;

  var contrast = mix(0.0, 15.0, pow(contrastParam, 1.5));
  var baseRadius = radius;
  if (originalColors) {
    contrast = mix(0.1, 4.0, pow(contrastParam, 2.0));
    baseRadius = 2.0 * pow(0.5 * radius, 0.3);
  }

  var totalShape = 0.0;
  var totalColor = vec3f(0.0);
  var totalOpacity = 0.0;

  for (var xi = 0; xi < 6; xi = xi + 1) {
    if (xi >= stepCount) {
      continue;
    }

    for (var yi = 0; yi < 6; yi = yi + 1) {
      if (yi >= stepCount) {
        continue;
      }

      var offset = vec2f(f32(xi) / f32(stepCount) - 0.5, f32(yi) / f32(stepCount) - 0.5);
      if (gridType == 1) {
        var rowIndex = f32(yi);
        var colIndex = f32(xi);
        if (stepCount == 1) {
          rowIndex = floor(uv.y + offset.y + 1.0);
          if (styleType == 1) {
            colIndex = floor(uv.x + offset.x + 1.0);
          }
        }
        if (styleType == 1) {
          if (fract((rowIndex + colIndex) * 0.5) >= 0.5) {
            continue;
          }
        } else if (fract(rowIndex * 0.5) >= 0.5) {
          offset.x += 0.5 * stepSize;
        }
      }

      let sample = getLumBall(
        uv,
        pad,
        texelSize,
        offset,
        contrast,
        baseRadius,
        stepSize,
        styleType,
        gridType,
        inverted,
        grainMixer,
        grainSizeParam
      );
      totalColor += sample.color.rgb * sample.shape;
      totalShape += sample.shape;
      totalOpacity += sample.shape;
    }
  }

  let eps = 1e-4;
  totalColor /= max(totalShape, eps);
  totalOpacity /= max(totalShape, eps);

  var finalShape = 0.0;
  if (styleType == 0) {
    finalShape = min(1.0, totalShape);
  } else if (styleType == 1) {
    let aa = 0.08;
    finalShape = smoothstep(0.5 - aa, 0.5 + aa, totalShape);
  } else if (styleType == 2) {
    finalShape = min(1.0, totalShape);
  } else {
    finalShape = totalShape;
  }

  let grainSizeCurve = pow(grainSizeParam, 0.72);
  let grainScale = mix(3200.0, 42.0, grainSizeCurve) * vec2f(1.0, 1.0 / aspect);
  let grainUV = input.uv * grainScale + vec2f(13.1, -9.7);
  let edgeBand = pow(clamp(1.0 - abs(finalShape * 2.0 - 1.0), 0.0, 1.0), 0.55);
  let grainField = halftoneOverlayNoise(grainUV * mix(0.95, 0.16, grainSizeCurve));
  let grainDetail = halftoneNoise(
    grainUV * mix(1.9, 0.28, grainSizeCurve) +
    vec2f(-17.3, 6.4)
  );
  let grainCut = smoothstep(0.42, 0.9, grainField);
  let grainWarp = (grainDetail * 2.0 - 1.0) * edgeBand * grainMixer * 0.24;
  let grainErode = edgeBand * grainCut * grainMixer * (0.35 + 1.75 * grainMixer);
  finalShape = clamp(finalShape + grainWarp - grainErode, 0.0, 1.0);

  var color = vec3f(0.0);
  var opacity = 0.0;
  if (originalColors) {
    color = totalColor * finalShape;
    opacity = totalOpacity * finalShape;
    let bgColor = params.colorBack.rgb * params.colorBack.a;
    color += bgColor * (1.0 - opacity);
    opacity += params.colorBack.a * (1.0 - opacity);
  } else {
    let fgColor = params.colorFront.rgb * params.colorFront.a;
    let bgColor = params.colorBack.rgb * params.colorBack.a;
    color = fgColor * finalShape;
    opacity = params.colorFront.a * finalShape;
    color += bgColor * (1.0 - opacity);
    opacity += params.colorBack.a * (1.0 - opacity);
  }

  var grainOverlayNoise = halftoneOverlayNoise(grainUV * mix(0.9, 0.14, grainSizeCurve));
  grainOverlayNoise = pow(grainOverlayNoise, 1.3);
  let grainOverlayV = grainOverlayNoise * 2.0 - 1.0;
  let grainOverlayColor = vec3f(select(0.0, 1.0, grainOverlayV >= 0.0));
  var grainOverlayStrength = grainOverlay * abs(grainOverlayV);
  grainOverlayStrength = pow(grainOverlayStrength, 0.8);
  color = mix(color, grainOverlayColor, 0.5 * grainOverlayStrength);
  opacity += 0.5 * grainOverlayStrength;

  opacity = clamp(opacity, 0.0, 1.0) * sourceAlpha;

  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)) * sourceAlpha, opacity);
}`,
  params: {
    colorFront: { type: 'color', label: 'Front Color', default: '#2b2b2b' },
    colorBack: { type: 'color', label: 'Back Color', default: '#f2f1e8' },
    originalColors: { type: 'boolean', label: 'Original Colors', default: false },
    inverted: { type: 'boolean', label: 'Inverted', default: false },
    grid: {
      type: 'select', label: 'Grid', default: 'hex',
      options: [
        { value: 'hex', label: 'Hex' },
        { value: 'square', label: 'Square' },
      ],
    },
    type: {
      type: 'select', label: 'Type', default: 'gooey',
      options: [
        { value: 'classic', label: 'Classic' },
        { value: 'gooey', label: 'Gooey' },
        { value: 'holes', label: 'Holes' },
        { value: 'soft', label: 'Soft' },
      ],
    },
    size: { type: 'number', label: 'Size', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true },
    radius: { type: 'number', label: 'Radius', default: 1.25, min: 0, max: 2, step: 0.01, animatable: true },
    contrast: { type: 'number', label: 'Contrast', default: 0.4, min: 0, max: 1, step: 0.01, animatable: true },
    grainMixer: { type: 'number', label: 'Grain Mixer', default: 0.2, min: 0, max: 1, step: 0.01, animatable: true },
    grainOverlay: { type: 'number', label: 'Grain Overlay', default: 0.2, min: 0, max: 1, step: 0.01, animatable: true },
    grainSize: { type: 'number', label: 'Grain Size', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true },
  },
  packUniforms: (p, w, h) => {
    const gridMap: Record<string, number> = { square: 0, hex: 1 };
    const styleMap: Record<string, number> = { classic: 0, gooey: 1, holes: 2, soft: 3 };
    const colorFront = parseHexColor((p.colorFront as string) ?? '#2b2b2b', [43 / 255, 43 / 255, 43 / 255, 1]);
    const colorBack = parseHexColor((p.colorBack as string) ?? '#f2f1e8', [242 / 255, 241 / 255, 232 / 255, 1]);
    const size = (p.size as number | undefined) ?? legacySpacingToPaperSize(p.spacing as number | undefined, h);
    const radius = (p.radius as number | undefined) ?? legacyDotRatioToRadius(p.dotSize as number | undefined, p.spacing as number | undefined);
    const contrast = (p.contrast as number | undefined) ?? 0.4;
    const originalColors = (p.originalColors as boolean | undefined) ?? false;
    const inverted = (p.inverted as boolean | undefined) ?? (p.invert as boolean | undefined) ?? false;
    const grainMixer = (p.grainMixer as number | undefined) ?? 0.2;
    const grainOverlay = (p.grainOverlay as number | undefined) ?? 0.2;
    const grainSize = (p.grainSize as number | undefined) ?? 0.5;
    const grid = (p.grid as string | undefined) ?? 'hex';
    const type = (p.type as string | undefined) ?? (p.dotStyle as string | undefined) ?? 'gooey';
    return new Float32Array([
      colorFront[0], colorFront[1], colorFront[2], colorFront[3],
      colorBack[0], colorBack[1], colorBack[2], colorBack[3],
      size, radius, contrast, w / Math.max(h, 1),
      originalColors ? 1 : 0, inverted ? 1 : 0, grainMixer, grainOverlay,
      grainSize, gridMap[grid] ?? 1, styleMap[type] ?? 1, 0,
    ]);
  },
};

const DITHER_PATTERN_MAP: Record<string, number> = {
  bayer2: 0,
  bayer4: 1,
  bayer8: 2,
  halftone: 3,
  lines: 4,
  crosses: 5,
  dots: 6,
  grid: 7,
  scales: 8,
};

const DITHER_MODE_MAP: Record<string, number> = {
  image: 0,
  linear: 1,
  radial: 2,
};

const DITHER_STYLE_MAP: Record<string, number> = {
  threshold: 0,
  scaled: 1,
};

const DITHER_SHAPE_MAP: Record<string, number> = {
  circle: 0,
  square: 1,
  diamond: 2,
};

const DITHER_PALETTE_MAP: Record<string, number> = {
  bw: 0,
  gameboy: 1,
  cga: 2,
  sepia: 3,
};

const ASCII_CHARSET_MAP: Record<string, number> = {
  standard: 0,
  simple: 1,
  blocks: 2,
  dots: 3,
  minimal: 4,
};

export const dither: GpuEffectDefinition = {
  id: 'gpu-dither',
  name: 'Dither',
  category: 'stylize',
  entryPoint: 'ditherFragment',
  uniformSize: 48,
  shader: /* wgsl */ `
struct DitherParams {
  cellSize: f32, angleDeg: f32, scalePercent: f32, width: f32,
  height: f32, offsetX: f32, offsetY: f32, patternKind: f32,
  modeKind: f32, styleKind: f32, shapeKind: f32, paletteKind: f32,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: DitherParams;

fn bayer2Threshold(cell: vec2i) -> f32 {
  let x = cell.x % 2;
  let y = cell.y % 2;
  var raw = 0.0;
  if (y == 0) {
    raw = select(0.0, 2.0, x == 1);
  } else {
    raw = select(3.0, 1.0, x == 1);
  }
  return (raw + 0.5) / 4.0;
}

fn bayer4Index(cell: vec2i) -> i32 {
  let x = cell.x % 4;
  let y = cell.y % 4;
  if (y == 0) {
    if (x == 0) { return 0; }
    if (x == 1) { return 8; }
    if (x == 2) { return 2; }
    return 10;
  }
  if (y == 1) {
    if (x == 0) { return 12; }
    if (x == 1) { return 4; }
    if (x == 2) { return 14; }
    return 6;
  }
  if (y == 2) {
    if (x == 0) { return 3; }
    if (x == 1) { return 11; }
    if (x == 2) { return 1; }
    return 9;
  }
  if (x == 0) { return 15; }
  if (x == 1) { return 7; }
  if (x == 2) { return 13; }
  return 5;
}

fn bayer4Threshold(cell: vec2i) -> f32 {
  return (f32(bayer4Index(cell)) + 0.5) / 16.0;
}

fn bayer8Threshold(cell: vec2i) -> f32 {
  let base = bayer4Index(vec2i(cell.x % 4, cell.y % 4));
  let quad = select(0, 1, (cell.x % 8) >= 4) + select(0, 2, (cell.y % 8) >= 4);
  let offset = select(0, select(2, select(3, 1, quad == 3), quad == 2), quad > 0);
  let raw = 4 * base + offset;
  return (f32(raw) + 0.5) / 64.0;
}

fn patternThreshold(patternKind: i32, cell: vec2f, patternCellSize: f32) -> f32 {
  if (patternKind == 0) {
    return bayer2Threshold(vec2i(cell));
  }
  if (patternKind == 1) {
    return bayer4Threshold(vec2i(cell));
  }
  if (patternKind == 2) {
    return bayer8Threshold(vec2i(cell));
  }

  let safeCellSize = max(2.0, patternCellSize);
  let nx = fract(cell.x / safeCellSize);
  let ny = fract(cell.y / safeCellSize);
  let cx = 0.5;
  let cy = 0.5;

  if (patternKind == 3 || patternKind == 6) {
    let dx = nx - cx;
    let dy = ny - cy;
    return sqrt(dx * dx + dy * dy) * 1.41421356237;
  }
  if (patternKind == 4) {
    return ny;
  }
  if (patternKind == 5) {
    let distX = abs(nx - cx);
    let distY = abs(ny - cy);
    return min(distX, distY) * 2.0;
  }
  if (patternKind == 7) {
    let distX = abs(nx - cx);
    let distY = abs(ny - cy);
    return max(distX, distY) * 2.0;
  }
  if (patternKind == 8) {
    let sx = fract(nx * 2.0);
    let sy = fract(ny * 2.0);
    let dx = sx - 0.5;
    let dy = sy - 0.5;
    return sqrt(dx * dx + dy * dy) * 1.41421356237;
  }
  return 0.5;
}

fn paletteLastIndex(paletteKind: i32) -> i32 {
  if (paletteKind == 0) { return 1; }
  return 3;
}

fn paletteIndex(value: f32, paletteKind: i32) -> i32 {
  if (paletteKind == 0) {
    return select(1, 0, value <= 0.5);
  }
  if (value <= 0.25) { return 0; }
  if (value <= 0.5) { return 1; }
  if (value <= 0.75) { return 2; }
  return 3;
}

fn paletteColor(paletteKind: i32, colorIndex: i32) -> vec3f {
  if (paletteKind == 0) {
    if (colorIndex == 0) { return vec3f(0.0, 0.0, 0.0); }
    return vec3f(1.0, 1.0, 1.0);
  }
  if (paletteKind == 1) {
    if (colorIndex == 0) { return vec3f(0.0588, 0.2196, 0.0588); }
    if (colorIndex == 1) { return vec3f(0.1882, 0.3843, 0.1882); }
    if (colorIndex == 2) { return vec3f(0.5451, 0.6745, 0.0588); }
    return vec3f(0.6078, 0.7373, 0.0588);
  }
  if (paletteKind == 2) {
    if (colorIndex == 0) { return vec3f(0.0, 0.0, 0.0); }
    if (colorIndex == 1) { return vec3f(0.3333, 1.0, 1.0); }
    if (colorIndex == 2) { return vec3f(1.0, 0.3333, 1.0); }
    return vec3f(1.0, 1.0, 1.0);
  }
  if (colorIndex == 0) { return vec3f(0.1686, 0.1137, 0.0549); }
  if (colorIndex == 1) { return vec3f(0.4196, 0.2588, 0.1490); }
  if (colorIndex == 2) { return vec3f(0.7686, 0.5843, 0.4157); }
  return vec3f(0.9608, 0.9020, 0.7843);
}

fn clampTexelCoord(coord: vec2i, texSize: vec2i) -> vec2i {
  return vec2i(
    clamp(coord.x, 0, max(texSize.x - 1, 0)),
    clamp(coord.y, 0, max(texSize.y - 1, 0))
  );
}

fn loadInputTexel(coord: vec2i, texSize: vec2i) -> vec4f {
  return textureLoad(inputTex, clampTexelCoord(coord, texSize), 0);
}

fn sampleCellBrightness(cell: vec2f, cellSize: f32, texSizeI: vec2i) -> f32 {
  let sampleOffsets = array<vec2f, 4>(
    vec2f(0.25, 0.25),
    vec2f(0.75, 0.25),
    vec2f(0.25, 0.75),
    vec2f(0.75, 0.75)
  );
  var luminanceSum = 0.0;
  var alphaSum = 0.0;
  for (var i = 0; i < 4; i++) {
    let sampleCoord = vec2i((cell + sampleOffsets[i]) * cellSize);
    let sampleColor = loadInputTexel(sampleCoord, texSizeI);
    luminanceSum += luminance601(sampleColor.rgb) * sampleColor.a;
    alphaSum += sampleColor.a;
  }
  if (alphaSum <= 0.0001) {
    return 0.0;
  }
  return luminanceSum / alphaSum;
}

fn applyMode(brightness: f32, cell: vec2f, gridSize: vec2f, modeKind: i32, angleDeg: f32, scalePercent: f32, offsetX: f32, offsetY: f32) -> f32 {
  var adjusted = brightness;
  let nx = cell.x / max(gridSize.x, 1.0);
  let ny = cell.y / max(gridSize.y, 1.0);
  if (modeKind == 1) {
    let angleRad = angleDeg * PI / 180.0;
    let gradient = nx * cos(angleRad) + ny * sin(angleRad);
    adjusted = clamp(adjusted * 0.7 + gradient * 0.3, 0.0, 1.0);
  } else if (modeKind == 2) {
    let ox = offsetX / 100.0;
    let oy = offsetY / 100.0;
    let dx = nx - (0.5 + ox);
    let dy = ny - (0.5 + oy);
    let dist = length(vec2f(dx, dy)) * (scalePercent / 100.0) * 2.0;
    adjusted = clamp(adjusted * 0.7 + dist * 0.3, 0.0, 1.0);
  }
  return adjusted;
}

fn shapeMask(shapeKind: i32, localUv: vec2f, sizeFactor: f32, cellSize: f32) -> f32 {
  let centered = abs(localUv - 0.5) * 2.0;
  let radius = clamp(sizeFactor, 0.0, 1.0);
  let aa = max(1.0 / max(cellSize, 1.0), 0.003);

  if (shapeKind == 0) {
    return 1.0 - smoothstep(radius, radius + aa, length(centered));
  }
  if (shapeKind == 2) {
    return 1.0 - smoothstep(radius, radius + aa, centered.x + centered.y);
  }
  return 1.0 - smoothstep(radius, radius + aa, max(centered.x, centered.y));
}

@fragment
fn ditherFragment(input: VertexOutput) -> @location(0) vec4f {
  let texSize = vec2f(params.width, params.height);
  let texSizeI = vec2i(max(i32(params.width), 1), max(i32(params.height), 1));
  let cellSize = max(params.cellSize, 1.0);
  let pixelPos = input.uv * texSize;
  let base = loadInputTexel(vec2i(pixelPos), texSizeI);
  if (base.a <= 0.0001) {
    return vec4f(0.0);
  }

  let cell = floor(pixelPos / cellSize);
  let localUv = fract(pixelPos / cellSize);
  let gridSize = vec2f(
    max(1.0, ceil(texSize.x / cellSize)),
    max(1.0, ceil(texSize.y / cellSize))
  );

  let modeKind = i32(params.modeKind + 0.5);
  let styleKind = i32(params.styleKind + 0.5);
  let shapeKind = i32(params.shapeKind + 0.5);
  let paletteKind = i32(params.paletteKind + 0.5);
  let patternKind = i32(params.patternKind + 0.5);

  var brightness = sampleCellBrightness(cell, cellSize, texSizeI);
  brightness = applyMode(
    brightness,
    cell,
    gridSize,
    modeKind,
    params.angleDeg,
    params.scalePercent,
    params.offsetX,
    params.offsetY
  );

  var quantized = brightness;
  var sizeFactor = 1.0;
  if (styleKind == 1) {
    sizeFactor = 1.0 - brightness;
  } else {
    let threshold = patternThreshold(patternKind, cell, max(2.0, floor(cellSize * 0.5)));
    quantized = clamp(brightness + (threshold - 0.5) * 0.5, 0.0, 1.0);
  }

  let colorIndex = paletteIndex(quantized, paletteKind);
  let background = paletteColor(paletteKind, paletteLastIndex(paletteKind));
  let foreground = paletteColor(paletteKind, colorIndex);
  let mask = shapeMask(shapeKind, localUv, sizeFactor, cellSize);
  let color = mix(background, foreground, mask);

  return vec4f(color, base.a);
}`,
  params: {
    pattern: {
      type: 'select',
      label: 'Pattern',
      default: 'bayer4',
      options: [
        { value: 'bayer2', label: 'Bayer 2x2' },
        { value: 'bayer4', label: 'Bayer 4x4' },
        { value: 'bayer8', label: 'Bayer 8x8' },
        { value: 'halftone', label: 'Halftone' },
        { value: 'lines', label: 'Lines' },
        { value: 'crosses', label: 'Crosses' },
        { value: 'dots', label: 'Dots' },
        { value: 'grid', label: 'Grid' },
        { value: 'scales', label: 'Scales' },
      ],
    },
    mode: {
      type: 'select',
      label: 'Mode',
      default: 'image',
      options: [
        { value: 'image', label: 'Image' },
        { value: 'linear', label: 'Linear' },
        { value: 'radial', label: 'Radial' },
      ],
    },
    style: {
      type: 'select',
      label: 'Style',
      default: 'threshold',
      options: [
        { value: 'threshold', label: 'Threshold' },
        { value: 'scaled', label: 'Scaled' },
      ],
    },
    shape: {
      type: 'select',
      label: 'Shape',
      default: 'square',
      options: [
        { value: 'circle', label: 'Circle' },
        { value: 'square', label: 'Square' },
        { value: 'diamond', label: 'Diamond' },
      ],
    },
    palette: {
      type: 'select',
      label: 'Palette',
      default: 'gameboy',
      options: [
        { value: 'bw', label: 'B&W' },
        { value: 'gameboy', label: 'Game Boy' },
        { value: 'cga', label: 'CGA' },
        { value: 'sepia', label: 'Sepia' },
      ],
    },
    cellSize: { type: 'number', label: 'Cell Size', default: 8, min: 2, max: 32, step: 1, animatable: true },
    angle: {
      type: 'number',
      label: 'Angle',
      default: 45,
      min: 0,
      max: 360,
      step: 1,
      animatable: true,
      visibleWhen: (params) => params.mode === 'linear',
    },
    scale: {
      type: 'number',
      label: 'Scale',
      default: 100,
      min: 25,
      max: 200,
      step: 1,
      animatable: true,
      visibleWhen: (params) => params.mode === 'radial',
    },
    offsetX: {
      type: 'number',
      label: 'Offset X',
      default: 0,
      min: -100,
      max: 100,
      step: 1,
      animatable: true,
      visibleWhen: (params) => params.mode === 'radial',
    },
    offsetY: {
      type: 'number',
      label: 'Offset Y',
      default: 0,
      min: -100,
      max: 100,
      step: 1,
      animatable: true,
      visibleWhen: (params) => params.mode === 'radial',
    },
  },
  packUniforms: (p, w, h) => new Float32Array([
    p.cellSize as number ?? 8,
    p.angle as number ?? 45,
    p.scale as number ?? 100,
    w,
    h,
    p.offsetX as number ?? 0,
    p.offsetY as number ?? 0,
    DITHER_PATTERN_MAP[p.pattern as string] ?? DITHER_PATTERN_MAP.bayer4,
    DITHER_MODE_MAP[p.mode as string] ?? DITHER_MODE_MAP.image,
    DITHER_STYLE_MAP[p.style as string] ?? DITHER_STYLE_MAP.threshold,
    DITHER_SHAPE_MAP[p.shape as string] ?? DITHER_SHAPE_MAP.square,
    DITHER_PALETTE_MAP[p.palette as string] ?? DITHER_PALETTE_MAP.gameboy,
  ]),
};

// Inspired by Studio's cell-based ASCII renderer. This keeps the shader-friendly
// subset: per-cell sampling, preset character sets, and source/mono coloring.
export const ascii: GpuEffectDefinition = {
  id: 'gpu-ascii',
  name: 'ASCII',
  category: 'stylize',
  entryPoint: 'asciiFragment',
  uniformSize: 96,
  shader: /* wgsl */ `
struct AsciiParams {
  fontSize: f32, letterSpacing: f32, lineHeight: f32, charsetKind: f32,
  matchSourceColor: f32, invert: f32, asciiOpacity: f32, originalOpacity: f32,
  contrast: f32, brightness: f32, saturation: f32, width: f32,
  height: f32, _pad0: f32, _pad1: f32, _pad2: f32,
  textColor: vec4f,
  bgColor: vec4f,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: AsciiParams;

fn asciiClampTexelCoord(coord: vec2i, texSize: vec2i) -> vec2i {
  return vec2i(
    clamp(coord.x, 0, max(texSize.x - 1, 0)),
    clamp(coord.y, 0, max(texSize.y - 1, 0))
  );
}

fn asciiLoadTexel(coord: vec2i, texSize: vec2i) -> vec4f {
  return textureLoad(inputTex, asciiClampTexelCoord(coord, texSize), 0);
}

fn asciiAdjustColor(color: vec3f, contrast: f32, brightness: f32) -> vec3f {
  return clamp((color - 0.5) * contrast + 0.5 + vec3f(brightness), vec3f(0.0), vec3f(1.0));
}

fn asciiApplySaturation(color: vec3f, saturation: f32) -> vec3f {
  let gray = vec3f(luminance601(color));
  return clamp(gray + (color - gray) * saturation, vec3f(0.0), vec3f(1.0));
}

fn asciiSegmentDistance(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let denom = max(dot(ba, ba), 0.0001);
  let h = clamp(dot(pa, ba) / denom, 0.0, 1.0);
  return length(pa - ba * h);
}

fn asciiLineMask(p: vec2f, a: vec2f, b: vec2f, thickness: f32, blur: f32) -> f32 {
  let d = asciiSegmentDistance(p, a, b);
  return 1.0 - smoothstep(thickness, thickness + blur, d);
}

fn asciiBoxMask(p: vec2f, center: vec2f, halfSize: vec2f, blur: f32) -> f32 {
  let d = abs(p - center) - halfSize;
  return 1.0 - smoothstep(0.0, blur, max(d.x, d.y));
}

fn asciiCircleMask(p: vec2f, center: vec2f, radius: f32, blur: f32) -> f32 {
  let d = distance(p, center);
  return 1.0 - smoothstep(radius, radius + blur, d);
}

fn asciiRingMask(p: vec2f, center: vec2f, outerRadius: f32, innerRadius: f32, blur: f32) -> f32 {
  let outer = asciiCircleMask(p, center, outerRadius, blur);
  let inner = asciiCircleMask(p, center, innerRadius, blur);
  return clamp(outer - inner, 0.0, 1.0);
}

fn asciiBayer4Index(cell: vec2i) -> i32 {
  let x = cell.x % 4;
  let y = cell.y % 4;
  if (y == 0) {
    if (x == 0) { return 0; }
    if (x == 1) { return 8; }
    if (x == 2) { return 2; }
    return 10;
  }
  if (y == 1) {
    if (x == 0) { return 12; }
    if (x == 1) { return 4; }
    if (x == 2) { return 14; }
    return 6;
  }
  if (y == 2) {
    if (x == 0) { return 3; }
    if (x == 1) { return 11; }
    if (x == 2) { return 1; }
    return 9;
  }
  if (x == 0) { return 15; }
  if (x == 1) { return 7; }
  if (x == 2) { return 13; }
  return 5;
}

fn asciiBayer4Threshold(cell: vec2i) -> f32 {
  return (f32(asciiBayer4Index(cell)) + 0.5) / 16.0;
}

fn asciiBlocksMask(glyphIndex: i32, localUv: vec2f) -> f32 {
  if (glyphIndex <= 0) {
    return 0.0;
  }
  if (glyphIndex >= 4) {
    return 1.0;
  }

  var density = 0.25;
  if (glyphIndex == 2) {
    density = 0.5;
  } else if (glyphIndex == 3) {
    density = 0.75;
  }
  let patternCell = vec2i(floor(localUv * 4.0));
  return select(0.0, 1.0, density > asciiBayer4Threshold(patternCell));
}

fn asciiStandardMask(glyphIndex: i32, localUv: vec2f, blur: f32) -> f32 {
  if (glyphIndex <= 0) {
    return 0.0;
  }
  if (glyphIndex == 1) {
    return asciiCircleMask(localUv, vec2f(0.5, 0.76), 0.06, blur);
  }
  if (glyphIndex == 2) {
    let topDot = asciiCircleMask(localUv, vec2f(0.5, 0.34), 0.05, blur);
    let bottomDot = asciiCircleMask(localUv, vec2f(0.5, 0.72), 0.05, blur);
    return clamp(topDot + bottomDot, 0.0, 1.0);
  }
  if (glyphIndex == 3) {
    return asciiBoxMask(localUv, vec2f(0.5, 0.56), vec2f(0.23, 0.05), blur);
  }
  if (glyphIndex == 4) {
    let topLine = asciiBoxMask(localUv, vec2f(0.5, 0.38), vec2f(0.23, 0.04), blur);
    let bottomLine = asciiBoxMask(localUv, vec2f(0.5, 0.66), vec2f(0.23, 0.04), blur);
    return clamp(topLine + bottomLine, 0.0, 1.0);
  }
  if (glyphIndex == 5) {
    let horizontal = asciiBoxMask(localUv, vec2f(0.5, 0.52), vec2f(0.23, 0.04), blur);
    let vertical = asciiBoxMask(localUv, vec2f(0.5, 0.52), vec2f(0.04, 0.23), blur);
    return clamp(horizontal + vertical, 0.0, 1.0);
  }
  if (glyphIndex == 6) {
    let horizontal = asciiBoxMask(localUv, vec2f(0.5, 0.52), vec2f(0.22, 0.035), blur);
    let vertical = asciiBoxMask(localUv, vec2f(0.5, 0.52), vec2f(0.035, 0.22), blur);
    let diagA = asciiLineMask(localUv, vec2f(0.22, 0.22), vec2f(0.78, 0.78), 0.03, blur);
    let diagB = asciiLineMask(localUv, vec2f(0.78, 0.22), vec2f(0.22, 0.78), 0.03, blur);
    return clamp(horizontal + vertical + diagA + diagB, 0.0, 1.0);
  }
  if (glyphIndex == 7) {
    let left = asciiBoxMask(localUv, vec2f(0.34, 0.52), vec2f(0.03, 0.26), blur);
    let right = asciiBoxMask(localUv, vec2f(0.66, 0.52), vec2f(0.03, 0.26), blur);
    let top = asciiBoxMask(localUv, vec2f(0.5, 0.36), vec2f(0.24, 0.03), blur);
    let bottom = asciiBoxMask(localUv, vec2f(0.5, 0.68), vec2f(0.24, 0.03), blur);
    return clamp(left + right + top + bottom, 0.0, 1.0);
  }
  if (glyphIndex == 8) {
    let diag = asciiLineMask(localUv, vec2f(0.18, 0.82), vec2f(0.82, 0.18), 0.03, blur);
    let topCircle = asciiRingMask(localUv, vec2f(0.3, 0.3), 0.12, 0.065, blur);
    let bottomCircle = asciiRingMask(localUv, vec2f(0.7, 0.7), 0.12, 0.065, blur);
    return clamp(diag + topCircle + bottomCircle, 0.0, 1.0);
  }

  let ring = asciiRingMask(localUv, vec2f(0.5, 0.5), 0.34, 0.19, blur);
  let inner = asciiCircleMask(localUv, vec2f(0.55, 0.49), 0.1, blur);
  let tail = asciiLineMask(localUv, vec2f(0.53, 0.52), vec2f(0.74, 0.58), 0.035, blur);
  return clamp(ring + inner + tail, 0.0, 1.0);
}

fn asciiGlyphCount(charsetKind: i32) -> i32 {
  if (charsetKind == 1) { return 6; }
  if (charsetKind == 2) { return 5; }
  if (charsetKind == 3) { return 4; }
  if (charsetKind == 4) { return 3; }
  return 10;
}

fn asciiGlyphMask(charsetKind: i32, glyphIndex: i32, localUv: vec2f, blur: f32) -> f32 {
  if (charsetKind == 0) {
    return asciiStandardMask(glyphIndex, localUv, blur);
  }
  if (charsetKind == 1) {
    let mapped = array<i32, 6>(0, 1, 3, 5, 6, 7);
    return asciiStandardMask(mapped[clamp(glyphIndex, 0, 5)], localUv, blur);
  }
  if (charsetKind == 2) {
    return asciiBlocksMask(glyphIndex, localUv);
  }
  if (charsetKind == 3) {
    if (glyphIndex <= 0) { return 0.0; }
    if (glyphIndex == 1) { return asciiCircleMask(localUv, vec2f(0.5, 0.56), 0.05, blur); }
    if (glyphIndex == 2) { return asciiCircleMask(localUv, vec2f(0.5, 0.54), 0.1, blur); }
    return asciiCircleMask(localUv, vec2f(0.5, 0.52), 0.16, blur);
  }
  if (glyphIndex <= 0) {
    return 0.0;
  }
  if (glyphIndex == 1) {
    return asciiCircleMask(localUv, vec2f(0.5, 0.58), 0.055, blur);
  }
  let diagA = asciiLineMask(localUv, vec2f(0.24, 0.24), vec2f(0.76, 0.76), 0.035, blur);
  let diagB = asciiLineMask(localUv, vec2f(0.76, 0.24), vec2f(0.24, 0.76), 0.035, blur);
  return clamp(diagA + diagB, 0.0, 1.0);
}

fn asciiGlyphIndex(brightness: f32, charsetKind: i32) -> i32 {
  let maxIndex = max(asciiGlyphCount(charsetKind) - 1, 0);
  let scaled = floor(clamp(brightness, 0.0, 1.0) * f32(maxIndex));
  return i32(clamp(scaled, 0.0, f32(maxIndex)));
}

@fragment
fn asciiFragment(input: VertexOutput) -> @location(0) vec4f {
  let texSize = vec2f(params.width, params.height);
  let texSizeI = vec2i(max(i32(params.width), 1), max(i32(params.height), 1));
  let pixelPos = input.uv * texSize;
  let base = asciiLoadTexel(vec2i(pixelPos), texSizeI);
  if (base.a <= 0.0001) {
    return vec4f(0.0);
  }

  let adjustedBase = asciiAdjustColor(base.rgb, params.contrast, params.brightness);
  let background = mix(params.bgColor.rgb, adjustedBase, params.originalOpacity);

  let charAspect = max(0.25, 0.6 + params.letterSpacing * 0.05);
  let cellWidth = max(params.fontSize * charAspect, 1.0);
  let cellHeight = max(params.fontSize * max(params.lineHeight, 0.25), 1.0);
  let cols = max(1.0, floor(params.width / cellWidth));
  let rows = max(1.0, floor(params.height / cellHeight));
  let gridSize = vec2f(cols * cellWidth, rows * cellHeight);
  let origin = (texSize - gridSize) * 0.5;

  if (
    pixelPos.x < origin.x ||
    pixelPos.y < origin.y ||
    pixelPos.x >= origin.x + gridSize.x ||
    pixelPos.y >= origin.y + gridSize.y
  ) {
    return vec4f(background, base.a);
  }

  let gridPos = (pixelPos - origin) / vec2f(cellWidth, cellHeight);
  let cell = floor(gridPos);
  let localUv = fract(gridPos);
  let samplePos = origin + (cell + vec2f(0.5)) * vec2f(cellWidth, cellHeight);
  let sampleColor = asciiLoadTexel(vec2i(samplePos), texSizeI);
  let adjustedSample = asciiAdjustColor(sampleColor.rgb, params.contrast, params.brightness);

  var brightness = luminance601(adjustedSample);
  if (params.invert >= 0.5) {
    brightness = 1.0 - brightness;
  }

  let charsetKind = i32(params.charsetKind + 0.5);
  let glyphIndex = asciiGlyphIndex(brightness, charsetKind);
  let blur = max(0.5 / min(cellWidth, cellHeight), 0.002);
  let mask = asciiGlyphMask(charsetKind, glyphIndex, localUv, blur);

  var glyphColor = params.textColor.rgb;
  if (params.matchSourceColor >= 0.5) {
    glyphColor = asciiApplySaturation(adjustedSample, params.saturation);
  }

  let color = mix(background, glyphColor, clamp(mask * params.asciiOpacity, 0.0, 1.0));
  return vec4f(color, base.a);
}`,
  params: {
    charSet: {
      type: 'select',
      label: 'Character Set',
      default: 'standard',
      options: [
        { value: 'standard', label: 'Standard' },
        { value: 'simple', label: 'Simple' },
        { value: 'blocks', label: 'Blocks' },
        { value: 'dots', label: 'Dots' },
        { value: 'minimal', label: 'Minimal' },
      ],
    },
    fontSize: { type: 'number', label: 'Font Size', default: 8, min: 4, max: 24, step: 1, animatable: true },
    letterSpacing: { type: 'number', label: 'Letter Spacing', default: 0, min: -2, max: 5, step: 0.1, animatable: true },
    lineHeight: { type: 'number', label: 'Line Height', default: 1, min: 0.5, max: 2, step: 0.1, animatable: true },
    matchSourceColor: { type: 'boolean', label: 'Match Source Color', default: true },
    textColor: {
      type: 'color',
      label: 'Text Color',
      default: '#ffffff',
      visibleWhen: (params) => params.matchSourceColor !== true,
    },
    bgColor: { type: 'color', label: 'Background', default: '#0a0a0f' },
    colorSaturation: {
      type: 'number',
      label: 'Saturation',
      default: 100,
      min: 0,
      max: 200,
      step: 1,
      animatable: true,
      visibleWhen: (params) => params.matchSourceColor === true,
    },
    asciiOpacity: { type: 'number', label: 'ASCII Opacity', default: 100, min: 0, max: 100, step: 1, animatable: true },
    originalOpacity: { type: 'number', label: 'Original Opacity', default: 0, min: 0, max: 100, step: 1, animatable: true },
    contrast: { type: 'number', label: 'Contrast', default: 100, min: 50, max: 200, step: 1, animatable: true },
    brightness: { type: 'number', label: 'Brightness', default: 0, min: -100, max: 100, step: 1, animatable: true },
    invert: { type: 'boolean', label: 'Invert', default: false },
  },
  packUniforms: (p, w, h) => {
    const textColor = parseHexColor((p.textColor as string) ?? '#ffffff', [1, 1, 1, 1]);
    const bgColor = parseHexColor((p.bgColor as string) ?? '#0a0a0f', [10 / 255, 10 / 255, 15 / 255, 1]);
    return new Float32Array([
      p.fontSize as number ?? 8,
      p.letterSpacing as number ?? 0,
      p.lineHeight as number ?? 1,
      ASCII_CHARSET_MAP[p.charSet as string] ?? ASCII_CHARSET_MAP.standard,
      p.matchSourceColor === false ? 0 : 1,
      p.invert === true ? 1 : 0,
      ((p.asciiOpacity as number) ?? 100) / 100,
      ((p.originalOpacity as number) ?? 0) / 100,
      ((p.contrast as number) ?? 100) / 100,
      ((p.brightness as number) ?? 0) / 255,
      ((p.colorSaturation as number) ?? 100) / 100,
      w,
      h,
      0,
      0,
      0,
      textColor[0],
      textColor[1],
      textColor[2],
      textColor[3],
      bgColor[0],
      bgColor[1],
      bgColor[2],
      bgColor[3],
    ]);
  },
};

export const threshold: GpuEffectDefinition = {
  id: 'gpu-threshold',
  name: 'Threshold',
  category: 'stylize',
  entryPoint: 'thresholdFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct ThresholdParams { level: f32, _p1: f32, _p2: f32, _p3: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: ThresholdParams;
@fragment
fn thresholdFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let luma = luminance(color.rgb);
  let result = select(0.0, 1.0, luma > params.level);
  return vec4f(vec3f(result), color.a);
}`,
  params: {
    level: { type: 'number', label: 'Level', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true },
  },
  packUniforms: (p) => new Float32Array([p.level as number ?? 0.5, 0, 0, 0]),
};
