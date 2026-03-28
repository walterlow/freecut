import type { GpuTransitionDefinition } from '../types';

export const wipe: GpuTransitionDefinition = {
  id: 'wipe',
  name: 'Wipe',
  category: 'wipe',
  hasDirection: true,
  directions: ['from-left', 'from-right', 'from-top', 'from-bottom'],
  entryPoint: 'wipeFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct WipeParams {
  progress: f32,
  width: f32,
  height: f32,
  direction: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var leftTex: texture_2d<f32>;
@group(0) @binding(2) var rightTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: WipeParams;

@fragment
fn wipeFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let dir = u32(params.direction);

  // Sample both textures upfront (uniform control flow required)
  let left = textureSample(leftTex, texSampler, uv);
  let right = textureSample(rightTex, texSampler, uv);

  // Sweep position along the wipe axis (0→1 in sweep direction)
  var sweepPos: f32;
  if (dir == 0u) { sweepPos = uv.x; }             // from-left
  else if (dir == 1u) { sweepPos = 1.0 - uv.x; }  // from-right
  else if (dir == 2u) { sweepPos = uv.y; }         // from-top
  else { sweepPos = 1.0 - uv.y; }                  // from-bottom

  // Hard edge: swept region shows incoming, rest shows outgoing
  let t = step(sweepPos, params.progress);
  return mix(left, right, t);
}`,
  packUniforms: (progress, width, height, direction) => {
    return new Float32Array([progress, width, height, direction]);
  },
};
