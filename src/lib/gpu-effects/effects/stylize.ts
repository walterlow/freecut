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
