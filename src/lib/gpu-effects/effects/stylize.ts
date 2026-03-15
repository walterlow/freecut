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

export const halftone: GpuEffectDefinition = {
  id: 'gpu-halftone',
  name: 'Halftone',
  category: 'stylize',
  entryPoint: 'halftoneFragment',
  uniformSize: 32,
  shader: /* wgsl */ `
struct HalftoneParams {
  dotSize: f32, spacing: f32, angle: f32, intensity: f32,
  width: f32, height: f32, invertFlag: f32, patternType: f32,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: HalftoneParams;
@fragment
fn halftoneFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let luma = luminance601(color.rgb);
  let pixelPos = input.uv * vec2f(params.width, params.height);
  let angleRad = params.angle * PI / 180.0;
  let cosA = cos(angleRad);
  let sinA = sin(angleRad);
  let rotated = vec2f(
    pixelPos.x * cosA - pixelPos.y * sinA,
    pixelPos.x * sinA + pixelPos.y * cosA
  );
  var pattern: f32;
  let pType = i32(params.patternType);
  if (pType == 1) {
    let linePos = fract(rotated.y / params.spacing);
    let lineWidth = luma * 0.8;
    pattern = smoothstep(lineWidth - 0.05, lineWidth + 0.05, abs(linePos - 0.5) * 2.0);
  } else if (pType == 2) {
    let center = vec2f(params.width * 0.5, params.height * 0.5);
    let fromCenter = pixelPos - center;
    let ray = atan2(fromCenter.y, fromCenter.x);
    let rayPattern = fract(ray * params.spacing / TAU);
    pattern = smoothstep(luma - 0.1, luma + 0.1, abs(rayPattern - 0.5) * 2.0);
  } else if (pType == 3) {
    let center = vec2f(params.width * 0.5, params.height * 0.5);
    let dist = length(pixelPos - center);
    let ripple = fract(dist / params.spacing);
    pattern = smoothstep(luma - 0.1, luma + 0.1, abs(ripple - 0.5) * 2.0);
  } else {
    let cell = floor(rotated / params.spacing);
    let cellCenter = (cell + 0.5) * params.spacing;
    let dist = length(rotated - cellCenter);
    let dotRadius = params.dotSize * (1.0 - luma) * 0.5;
    pattern = smoothstep(dotRadius - 0.5, dotRadius + 0.5, dist);
  }
  if (params.invertFlag > 0.5) { pattern = 1.0 - pattern; }
  let result = mix(color.rgb, mix(vec3f(0.0), color.rgb, pattern), params.intensity);
  return vec4f(result, color.a);
}`,
  params: {
    patternType: {
      type: 'select', label: 'Pattern', default: 'dots',
      options: [
        { value: 'dots', label: 'Dots' },
        { value: 'lines', label: 'Lines' },
        { value: 'rays', label: 'Rays' },
        { value: 'ripples', label: 'Ripples' },
      ],
    },
    dotSize: { type: 'number', label: 'Dot Size', default: 8, min: 2, max: 20, step: 1, animatable: true },
    spacing: { type: 'number', label: 'Spacing', default: 10, min: 4, max: 40, step: 1, animatable: true },
    angle: { type: 'number', label: 'Angle', default: 45, min: 0, max: 360, step: 1, animatable: true },
    intensity: { type: 'number', label: 'Intensity', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true },
    invert: { type: 'boolean', label: 'Invert', default: false },
  },
  packUniforms: (p, w, h) => {
    const patternMap: Record<string, number> = { dots: 0, lines: 1, rays: 2, ripples: 3 };
    return new Float32Array([
      p.dotSize as number ?? 8, p.spacing as number ?? 10,
      p.angle as number ?? 45, p.intensity as number ?? 0.5,
      w, h, p.invert ? 1 : 0, patternMap[p.patternType as string] ?? 0,
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
