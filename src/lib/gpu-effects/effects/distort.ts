import type { GpuEffectDefinition } from '../types';

function parseHexColor(color: string, fallback: [number, number, number, number]): [number, number, number, number] {
  if (!color.startsWith('#')) return fallback;

  const hex = color.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    const values = hex.split('').map((ch) => parseInt(ch + ch, 16) / 255);
    if (values.slice(0, 3).every((v) => Number.isFinite(v))) {
      return [
        values[0] ?? fallback[0],
        values[1] ?? fallback[1],
        values[2] ?? fallback[2],
        values[3] ?? 1,
      ];
    }
    return fallback;
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

// Adapted from Paper Design's fluted-glass shader (published package source).
export const flutedGlass: GpuEffectDefinition = {
  id: 'gpu-fluted-glass',
  name: 'Fluted Glass',
  category: 'distort',
  entryPoint: 'flutedGlassFragment',
  uniformSize: 128,
  shader: /* wgsl */ `
struct FlutedGlassParams {
  colorBack: vec4f,
  colorShadow: vec4f,
  colorHighlight: vec4f,
  settingsA: vec4f,
  settingsB: vec4f,
  settingsC: vec4f,
  settingsD: vec4f,
  margins: vec4f,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: FlutedGlassParams;

fn rotate2d(p: vec2f, angle: f32) -> vec2f {
  let c = cos(angle);
  let s = sin(angle);
  return vec2f(p.x * c - p.y * s, p.x * s + p.y * c);
}

fn rotateAspect(p: vec2f, angle: f32, aspect: f32) -> vec2f {
  var q = p;
  q.x *= aspect;
  q = rotate2d(q, angle);
  q.x /= aspect;
  return q;
}

fn smoothFract(x: f32) -> f32 {
  let f = fract(x);
  let w = fwidth(x);
  let edge = abs(f - 0.5) - 0.5;
  let band = smoothstep(-w, w, edge);
  return mix(f, 1.0 - f, band);
}

fn getUvFrame(uv: vec2f, softness: f32) -> f32 {
  let aax = 2.0 * fwidth(uv.x);
  let aay = 2.0 * fwidth(uv.y);
  let left = smoothstep(0.0, aax + softness, uv.x);
  let right = 1.0 - smoothstep(1.0 - softness - aax, 1.0, uv.x);
  let bottom = smoothstep(0.0, aay + softness, uv.y);
  let top = 1.0 - smoothstep(1.0 - softness - aay, 1.0, uv.y);
  return left * right * bottom * top;
}

fn samplePremultiplied(uv: vec2f) -> vec4f {
  let c = textureSampleLevel(inputTex, texSampler, uv, 0.0);
  return vec4f(c.rgb * c.a, c.a);
}

fn getBlur(uv: vec2f, texelSize: vec2f, dir: vec2f, sigma: f32) -> vec4f {
  if (sigma <= 0.5) {
    return textureSampleLevel(inputTex, texSampler, uv, 0.0);
  }

  let maxRadius = 50;
  let radius = i32(min(f32(maxRadius), ceil(3.0 * sigma)));
  let twoSigma2 = 2.0 * sigma * sigma;
  let gaussianNorm = 1.0 / sqrt(TAU * sigma * sigma);

  var sum = samplePremultiplied(uv) * gaussianNorm;
  var weightSum = gaussianNorm;

  for (var i = 1; i <= maxRadius; i = i + 1) {
    if (i > radius) {
      break;
    }

    let x = f32(i);
    let w = exp(-(x * x) / twoSigma2) * gaussianNorm;
    let offset = dir * texelSize * x;
    let s1 = samplePremultiplied(uv + offset);
    let s2 = samplePremultiplied(uv - offset);
    sum += (s1 + s2) * w;
    weightSum += 2.0 * w;
  }

  let result = sum / weightSum;
  if (result.a > 0.0) {
    return vec4f(result.rgb / result.a, result.a);
  }
  return result;
}

fn flutedOverlayNoise(p: vec2f) -> f32 {
  let coarse = noise2d(p * 0.83 + vec2f(4.1, -7.3));
  let medium = noise2d(vec2f(
    p.x * 1.27 - p.y * 0.58,
    p.x * 0.71 + p.y * 1.19
  ) + vec2f(-10.2, 5.4));
  let fine = noise2d(vec2f(
    p.x * -0.92 + p.y * 1.11,
    p.x * -1.06 - p.y * 0.82
  ) + vec2f(7.8, 9.6));
  return coarse * 0.45 + medium * 0.35 + fine * 0.2;
}

@fragment
fn flutedGlassFragment(input: VertexOutput) -> @location(0) vec4f {
  let width = max(params.settingsD.y, 1.0);
  let height = max(params.settingsD.z, 1.0);
  let aspect = max(params.settingsD.w, 0.0001);

  let size = clamp(params.settingsA.x, 0.0, 1.0);
  let shadowsAmount = clamp(params.settingsA.y, 0.0, 1.0);
  let angle = params.settingsA.z * PI / 180.0;
  let stretchAmount = clamp(params.settingsA.w, 0.0, 1.0);

  let shape = i32(params.settingsB.x);
  let distortionAmount = clamp(params.settingsB.y, 0.0, 1.0);
  let highlightsAmount = clamp(params.settingsB.z, 0.0, 1.0);
  let distortionShape = i32(params.settingsB.w);

  let shiftAmount = params.settingsC.x;
  let blurAmount = clamp(params.settingsC.y, 0.0, 1.0);
  let edgesAmount = clamp(params.settingsC.z, 0.0, 1.0);
  let grainMixer = clamp(params.settingsC.w, 0.0, 1.0);
  let grainOverlay = clamp(params.settingsD.x, 0.0, 1.0);

  let marginLeft = params.margins.x;
  let marginTop = params.margins.y;
  let marginRight = params.margins.z;
  let marginBottom = params.margins.w;

  let patternRotation = -angle;
  let patternSize = mix(200.0, 5.0, size);

  var uv = input.uv;
  let uvMask = input.position.xy / vec2f(width, height);
  let sw = vec2f(0.005);
  let mask =
    smoothstep(marginLeft, marginLeft + sw.x, uvMask.x + sw.x) *
    smoothstep(marginRight, marginRight + sw.x, 1.0 - uvMask.x + sw.x) *
    smoothstep(marginTop, marginTop + sw.y, uvMask.y + sw.y) *
    smoothstep(marginBottom, marginBottom + sw.y, 1.0 - uvMask.y + sw.y);
  let maskOuter =
    smoothstep(marginLeft - sw.x, marginLeft, uvMask.x + sw.x) *
    smoothstep(marginRight - sw.x, marginRight, 1.0 - uvMask.x + sw.x) *
    smoothstep(marginTop - sw.y, marginTop, uvMask.y + sw.y) *
    smoothstep(marginBottom - sw.y, marginBottom, 1.0 - uvMask.y + sw.y);
  let maskStroke = maskOuter - mask;
  let maskInner =
    smoothstep(marginLeft - 2.0 * sw.x, marginLeft, uvMask.x) *
    smoothstep(marginRight - 2.0 * sw.x, marginRight, 1.0 - uvMask.x) *
    smoothstep(marginTop - 2.0 * sw.y, marginTop, uvMask.y) *
    smoothstep(marginBottom - 2.0 * sw.y, marginBottom, 1.0 - uvMask.y);
  let maskStrokeInner = maskInner - mask;

  uv -= 0.5;
  uv *= patternSize;
  uv = rotateAspect(uv, patternRotation, aspect);

  var curve = 0.0;
  let patternY = uv.y / aspect;
  if (shape == 5) {
    curve = 0.5 + 0.5 * sin(0.5 * PI * uv.x) * cos(0.5 * PI * patternY);
  } else if (shape == 4) {
    curve = 10.0 * abs(fract(0.1 * patternY) - 0.5);
  } else if (shape == 3) {
    curve = 4.0 * sin(0.23 * patternY);
  } else if (shape == 2) {
    curve = 0.5 + 0.5 * sin(0.5 * uv.x) * sin(1.7 * uv.x);
  }

  let uvToFract = uv + curve;
  var fractOrigUV = fract(uv);
  var floorOrigUV = floor(uv);
  var x = smoothFract(uvToFract.x);
  let xNonSmooth = fract(uvToFract.x) + 0.0001;

  var highlightsWidth = 2.0 * max(0.001, fwidth(uvToFract.x));
  highlightsWidth += 2.0 * maskStrokeInner;
  var highlights = smoothstep(0.0, highlightsWidth, xNonSmooth);
  highlights *= smoothstep(1.0, 1.0 - highlightsWidth, xNonSmooth);
  highlights = 1.0 - highlights;
  highlights *= highlightsAmount;
  highlights = clamp(highlights, 0.0, 1.0);
  highlights *= mask;

  var shadows = pow(x, 1.3);
  var distortion = 0.0;
  var fadeX = 1.0;
  var frameFade = 0.0;

  var aa = fwidth(xNonSmooth);
  aa = max(aa, fwidth(uv.x));
  aa = max(aa, fwidth(uvToFract.x));
  aa = max(aa, 0.0001);

  if (distortionShape == 1) {
    distortion = -pow(1.5 * x, 3.0);
    distortion += 0.5 - shiftAmount;
    frameFade = pow(1.5 * x, 3.0);
    aa = max(0.2, aa);
    aa += mix(0.2, 0.0, size);
    fadeX = smoothstep(0.0, aa, xNonSmooth) * smoothstep(1.0, 1.0 - aa, xNonSmooth);
    distortion = mix(0.5, distortion, fadeX);
  } else if (distortionShape == 2) {
    distortion = 2.0 * pow(x, 2.0);
    distortion -= 0.5 + shiftAmount;
    frameFade = pow(abs(x - 0.5), 4.0);
    aa = max(0.2, aa);
    aa += mix(0.2, 0.0, size);
    fadeX = smoothstep(0.0, aa, xNonSmooth) * smoothstep(1.0, 1.0 - aa, xNonSmooth);
    distortion = mix(0.5, distortion, fadeX);
    frameFade = mix(1.0, frameFade, 0.5 * fadeX);
  } else if (distortionShape == 3) {
    distortion = pow(2.0 * (xNonSmooth - 0.5), 6.0);
    distortion -= 0.25;
    distortion -= shiftAmount;
    frameFade = 1.0 - 2.0 * pow(abs(x - 0.4), 2.0);
    aa = 0.15;
    aa += mix(0.1, 0.0, size);
    fadeX = smoothstep(0.0, aa, xNonSmooth) * smoothstep(1.0, 1.0 - aa, xNonSmooth);
    frameFade = mix(1.0, frameFade, fadeX);
  } else if (distortionShape == 4) {
    x = xNonSmooth;
    distortion = sin((x + 0.25) * TAU);
    shadows = 0.5 + 0.5 * asin(distortion) / (0.5 * PI);
    distortion *= 0.5;
    distortion -= shiftAmount;
    frameFade = 0.5 + 0.5 * sin(x * TAU);
  } else if (distortionShape == 5) {
    distortion -= pow(abs(x), 0.2) * x;
    distortion += 0.33;
    distortion -= 3.0 * shiftAmount;
    distortion *= 0.33;
    frameFade = 0.3 * smoothstep(0.0, 1.0, x);
    shadows = pow(x, 2.5);
    aa = max(0.1, aa);
    aa += mix(0.1, 0.0, size);
    fadeX = smoothstep(0.0, aa, xNonSmooth) * smoothstep(1.0, 1.0 - aa, xNonSmooth);
    distortion *= fadeX;
  }

  let dudx = dpdx(input.uv);
  let dudy = dpdy(input.uv);
  var grainUV = input.uv - 0.5;
  let derivativeScale = 0.8 / max(vec2f(length(dudx), length(dudy)), vec2f(0.0001));
  grainUV *= derivativeScale;
  grainUV += 0.5;
  var grain = flutedOverlayNoise(grainUV);
  grain = smoothstep(0.4, 0.7, grain);
  grain *= grainMixer;
  distortion = mix(distortion, 0.0, grain);

  shadows = min(shadows, 1.0);
  shadows += maskStrokeInner;
  shadows *= mask;
  shadows = min(shadows, 1.0);
  shadows *= pow(shadowsAmount, 2.0);
  shadows = clamp(shadows, 0.0, 1.0);

  distortion *= 3.0 * distortionAmount;
  frameFade *= distortionAmount;

  fractOrigUV = vec2f(fractOrigUV.x + distortion, fractOrigUV.y);
  floorOrigUV = rotateAspect(floorOrigUV, -patternRotation, aspect);
  fractOrigUV = rotateAspect(fractOrigUV, -patternRotation, aspect);

  uv = (floorOrigUV + fractOrigUV) / patternSize;
  uv += vec2f(pow(maskStroke, 4.0));
  uv += 0.5;

  uv = mix(input.uv, uv, smoothstep(0.0, 0.7, mask));
  var blur = mix(0.0, 50.0, blurAmount);
  blur = mix(0.0, blur, smoothstep(0.5, 1.0, mask));

  var edgeDistortion = mix(0.0, 0.04, edgesAmount);
  edgeDistortion += 0.06 * frameFade * edgesAmount;
  edgeDistortion *= mask;
  let frame = getUvFrame(uv, edgeDistortion);

  var stretch = 1.0 - smoothstep(0.0, 0.5, xNonSmooth) * smoothstep(1.0, 0.5, xNonSmooth);
  stretch = pow(stretch, 2.0);
  stretch *= mask;
  stretch *= getUvFrame(uv, 0.1 + 0.05 * mask * frameFade);
  uv = vec2f(uv.x, mix(uv.y, 0.5, stretchAmount * stretch));

  let imageSample = getBlur(uv, 1.0 / vec2f(width, height), vec2f(0.0, 1.0), blur);
  let image = vec4f(imageSample.rgb * imageSample.a, imageSample.a);
  let backColor = vec4f(params.colorBack.rgb * params.colorBack.a, params.colorBack.a);
  let highlightColor = vec4f(params.colorHighlight.rgb * params.colorHighlight.a, params.colorHighlight.a);
  let shadowColor = params.colorShadow;

  var color = highlightColor.rgb * highlights;
  var opacity = highlightColor.a * highlights;

  shadows = mix(shadows * shadowColor.a, 0.0, highlights);
  color = mix(color, shadowColor.rgb * shadowColor.a, 0.5 * shadows);
  color += 0.5 * pow(shadows, 0.5) * shadowColor.rgb;
  opacity += shadows;
  color = clamp(color, vec3f(0.0), vec3f(1.0));
  opacity = clamp(opacity, 0.0, 1.0);

  color += image.rgb * (1.0 - opacity) * frame;
  opacity += image.a * (1.0 - opacity) * frame;
  color += backColor.rgb * (1.0 - opacity);
  opacity += backColor.a * (1.0 - opacity);

  var grainOverlayNoise = flutedOverlayNoise(rotate2d(grainUV, 1.0) + vec2f(3.0));
  grainOverlayNoise = mix(grainOverlayNoise, flutedOverlayNoise(rotate2d(grainUV, 2.0) + vec2f(-1.0)), 0.5);
  grainOverlayNoise = pow(grainOverlayNoise, 1.3);

  let grainOverlayV = grainOverlayNoise * 2.0 - 1.0;
  let grainOverlayColor = vec3f(select(0.0, 1.0, grainOverlayV >= 0.0));
  var grainOverlayStrength = grainOverlay * abs(grainOverlayV);
  grainOverlayStrength = pow(grainOverlayStrength, 0.8);
  grainOverlayStrength *= mask;
  color = mix(color, grainOverlayColor, 0.35 * grainOverlayStrength);

  opacity += 0.5 * grainOverlayStrength;
  opacity = clamp(opacity, 0.0, 1.0);

  return vec4f(color, opacity);
}`,
  params: {
    colorBack: { type: 'color', label: 'Back Color', default: '#00000000' },
    colorShadow: { type: 'color', label: 'Shadow Color', default: '#000000' },
    colorHighlight: { type: 'color', label: 'Highlight Color', default: '#ffffff' },
    shadows: { type: 'number', label: 'Shadows', default: 0.25, min: 0, max: 1, step: 0.01, animatable: true },
    highlights: { type: 'number', label: 'Highlights', default: 0.1, min: 0, max: 1, step: 0.01, animatable: true },
    size: { type: 'number', label: 'Size', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true },
    shape: {
      type: 'select', label: 'Shape', default: 'lines',
      options: [
        { value: 'lines', label: 'Lines' },
        { value: 'linesIrregular', label: 'Irregular Lines' },
        { value: 'wave', label: 'Wave' },
        { value: 'zigzag', label: 'Zigzag' },
        { value: 'pattern', label: 'Pattern' },
      ],
    },
    angle: { type: 'number', label: 'Angle', default: 0, min: 0, max: 180, step: 1, animatable: true },
    distortionShape: {
      type: 'select', label: 'Distortion Shape', default: 'prism',
      options: [
        { value: 'prism', label: 'Prism' },
        { value: 'lens', label: 'Lens' },
        { value: 'contour', label: 'Contour' },
        { value: 'cascade', label: 'Cascade' },
        { value: 'flat', label: 'Flat' },
      ],
    },
    distortion: { type: 'number', label: 'Distortion', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true },
    shift: { type: 'number', label: 'Shift', default: 0, min: -1, max: 1, step: 0.01, animatable: true },
    stretch: { type: 'number', label: 'Stretch', default: 0, min: 0, max: 1, step: 0.01, animatable: true },
    blur: { type: 'number', label: 'Blur', default: 0, min: 0, max: 1, step: 0.01, animatable: true },
    edges: { type: 'number', label: 'Edges', default: 0.25, min: 0, max: 1, step: 0.01, animatable: true },
    margin: { type: 'number', label: 'Margin', default: 0, min: 0, max: 1, step: 0.01, animatable: true },
    marginLeft: { type: 'number', label: 'Left Margin', default: 0, min: 0, max: 1, step: 0.01, animatable: true },
    marginRight: { type: 'number', label: 'Right Margin', default: 0, min: 0, max: 1, step: 0.01, animatable: true },
    marginTop: { type: 'number', label: 'Top Margin', default: 0, min: 0, max: 1, step: 0.01, animatable: true },
    marginBottom: { type: 'number', label: 'Bottom Margin', default: 0, min: 0, max: 1, step: 0.01, animatable: true },
    grainMixer: { type: 'number', label: 'Grain Mixer', default: 0, min: 0, max: 1, step: 0.01, animatable: true },
    grainOverlay: { type: 'number', label: 'Grain Overlay', default: 0, min: 0, max: 1, step: 0.01, animatable: true },
  },
  packUniforms: (p, w, h) => {
    const gridShapeMap: Record<string, number> = {
      lines: 1,
      linesIrregular: 2,
      wave: 3,
      zigzag: 4,
      pattern: 5,
    };
    const distortionShapeMap: Record<string, number> = {
      prism: 1,
      lens: 2,
      contour: 3,
      cascade: 4,
      flat: 5,
    };
    const margin = (p.margin as number | undefined) ?? 0;
    const marginLeft = (p.marginLeft as number | undefined) ?? margin;
    const marginRight = (p.marginRight as number | undefined) ?? margin;
    const marginTop = (p.marginTop as number | undefined) ?? margin;
    const marginBottom = (p.marginBottom as number | undefined) ?? margin;
    const colorBack = parseHexColor((p.colorBack as string) ?? '#00000000', [0, 0, 0, 0]);
    const colorShadow = parseHexColor((p.colorShadow as string) ?? '#000000', [0, 0, 0, 1]);
    const colorHighlight = parseHexColor((p.colorHighlight as string) ?? '#ffffff', [1, 1, 1, 1]);
    return new Float32Array([
      colorBack[0], colorBack[1], colorBack[2], colorBack[3],
      colorShadow[0], colorShadow[1], colorShadow[2], colorShadow[3],
      colorHighlight[0], colorHighlight[1], colorHighlight[2], colorHighlight[3],
      p.size as number ?? 0.5, p.shadows as number ?? 0.25, p.angle as number ?? 0, p.stretch as number ?? 0,
      gridShapeMap[p.shape as string] ?? 1, p.distortion as number ?? 0.5, p.highlights as number ?? 0.1, distortionShapeMap[p.distortionShape as string] ?? 1,
      p.shift as number ?? 0, p.blur as number ?? 0, p.edges as number ?? 0.25, p.grainMixer as number ?? 0,
      p.grainOverlay as number ?? 0, w, h, w / Math.max(h, 1),
      marginLeft, marginTop, marginRight, marginBottom,
    ]);
  },
};
