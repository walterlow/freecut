import type { GpuTransitionDefinition } from '../types'

export const dissolve: GpuTransitionDefinition = {
  id: 'dissolve',
  name: 'Cross Dissolve',
  category: 'dissolve',
  hasDirection: false,
  entryPoint: 'dissolveFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct DissolveParams {
  progress: f32,
  width: f32,
  height: f32,
  _pad: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var leftTex: texture_2d<f32>;
@group(0) @binding(2) var rightTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: DissolveParams;

@fragment
fn dissolveFragment(input: VertexOutput) -> @location(0) vec4f {
  let left = textureSample(leftTex, texSampler, input.uv);
  let right = textureSample(rightTex, texSampler, input.uv);
  let t = 0.5 - 0.5 * cos(clamp(params.progress, 0.0, 1.0) * PI);
  return mix(left, right, t);
}`,
  packUniforms: (progress, width, height) => {
    return new Float32Array([progress, width, height, 0])
  },
}
