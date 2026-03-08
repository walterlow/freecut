import type { GpuTransitionDefinition } from '../types';

export const glitch: GpuTransitionDefinition = {
  id: 'glitch',
  name: 'Glitch',
  category: 'custom',
  hasDirection: false,
  entryPoint: 'glitchFragment',
  uniformSize: 32,
  shader: /* wgsl */ `
struct GlitchParams {
  progress: f32,
  width: f32,
  height: f32,
  intensity: f32,
  blockSize: f32,
  rgbSplit: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var leftTex: texture_2d<f32>;
@group(0) @binding(2) var rightTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: GlitchParams;

@fragment
fn glitchFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let p = params.progress;

  // Intensity envelope — peaks in the middle of the transition
  let envelope = sin(p * PI);
  let strength = envelope * params.intensity;

  // Block-based horizontal displacement
  let blockH = params.blockSize / params.height;
  let blockY = floor(uv.y / blockH) * blockH;
  let blockSeed = hash(vec2f(blockY * 17.3, floor(p * 20.0)));
  let shouldDisplace = step(0.5 - strength * 0.4, blockSeed);
  let displacement = (hash(vec2f(blockY * 31.7, floor(p * 25.0))) - 0.5) * strength * 0.25 * shouldDisplace;

  let displacedUv = vec2f(clamp(uv.x + displacement, 0.0, 1.0), uv.y);

  // RGB channel split amount
  let split = params.rgbSplit * strength * 0.015;

  // Progressive switch from left to right based on noise + progress
  let switchSeed = hash(vec2f(blockY * 7.3, floor(p * 15.0)));
  let useRight = smoothstep(0.0, 1.0, (p - switchSeed) * 3.0 + 0.5);

  // Sample left clip with RGB split
  let lR = textureSample(leftTex, texSampler, displacedUv + vec2f(split, 0.0)).r;
  let lG = textureSample(leftTex, texSampler, displacedUv).g;
  let lB = textureSample(leftTex, texSampler, displacedUv - vec2f(split, 0.0)).b;
  let lA = textureSample(leftTex, texSampler, displacedUv).a;
  let leftColor = vec4f(lR, lG, lB, lA);

  // Sample right clip with RGB split
  let rR = textureSample(rightTex, texSampler, displacedUv + vec2f(split, 0.0)).r;
  let rG = textureSample(rightTex, texSampler, displacedUv).g;
  let rB = textureSample(rightTex, texSampler, displacedUv - vec2f(split, 0.0)).b;
  let rA = textureSample(rightTex, texSampler, displacedUv).a;
  let rightColor = vec4f(rR, rG, rB, rA);

  // Mix based on per-block switching
  var color = mix(leftColor, rightColor, useRight);

  // Occasional scan lines
  let scanLine = step(0.97 - strength * 0.05, hash(vec2f(uv.y * 500.0, floor(p * 30.0))));
  color = mix(color, vec4f(1.0, 1.0, 1.0, color.a), scanLine * 0.3 * envelope);

  return color;
}`,
  packUniforms: (progress, width, height, _direction, properties) => {
    const intensity = (properties?.intensity as number) ?? 1.0;
    const blockSize = (properties?.blockSize as number) ?? 30.0;
    const rgbSplit = (properties?.rgbSplit as number) ?? 1.0;
    return new Float32Array([
      progress, width, height, intensity,
      blockSize, rgbSplit, 0, 0,
    ]);
  },
};
