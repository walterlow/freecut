import type { GpuTransitionDefinition } from '../types';

export const wipe: GpuTransitionDefinition = {
  id: 'wipe',
  name: 'Wipe',
  category: 'wipe',
  hasDirection: true,
  directions: ['from-left', 'from-right', 'from-top', 'from-bottom'],
  entryPoint: 'wipeFragment',
  uniformSize: 32,
  shader: /* wgsl */ `
struct WipeParams {
  progress: f32,
  width: f32,
  height: f32,
  direction: f32,
  incomingTravel: f32,
  outgoingTravel: f32,
  edgeSoftness: f32,
  _pad: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var leftTex: texture_2d<f32>;
@group(0) @binding(2) var rightTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: WipeParams;

fn directionVector(dir: u32) -> vec2f {
  if (dir == 0u) { return vec2f(1.0, 0.0); }
  if (dir == 1u) { return vec2f(-1.0, 0.0); }
  if (dir == 2u) { return vec2f(0.0, 1.0); }
  return vec2f(0.0, -1.0);
}

fn sweepPosition(uv: vec2f, dir: u32) -> f32 {
  if (dir == 0u) { return uv.x; }
  if (dir == 1u) { return 1.0 - uv.x; }
  if (dir == 2u) { return uv.y; }
  return 1.0 - uv.y;
}

fn sampleIfInBounds(tex: texture_2d<f32>, uv: vec2f) -> vec4f {
  let mask = unitUvMask(uv);
  let sampleUv = clamp(uv, vec2f(0.0), vec2f(1.0));
  return textureSample(tex, texSampler, sampleUv) * mask;
}

@fragment
fn wipeFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let dir = u32(params.direction);
  let vec = directionVector(dir);
  let sweep = sweepPosition(uv, dir);
  let edge = max(params.edgeSoftness, 0.0001);

  let incomingOffset = vec * ((params.progress - 1.0) * params.incomingTravel);
  let outgoingOffset = vec * (params.progress * params.outgoingTravel);
  let incomingUv = uv - incomingOffset;
  let outgoingUv = uv - outgoingOffset;

  let right = sampleIfInBounds(rightTex, incomingUv);
  let left = sampleIfInBounds(leftTex, outgoingUv);

  let incomingMask = smoothstep(params.progress - edge, params.progress + edge, sweep);
  let outgoingMask = 1.0 - incomingMask;

  let incomingColor = right * incomingMask;
  let outgoingColor = left * outgoingMask;
  let outRgb = incomingColor.rgb + outgoingColor.rgb;
  let outAlpha = clamp(incomingColor.a + outgoingColor.a, 0.0, 1.0);
  return vec4f(outRgb, outAlpha);
}`,
  packUniforms: (progress, width, height, direction) => {
    const p = Math.max(0, Math.min(1, progress));
    const edgeSoftness = 1.5 / Math.max(1, Math.min(width, height));
    return new Float32Array([
      p, width, height, direction,
      0.025, 0.035, edgeSoftness, 0,
    ]);
  },
};
