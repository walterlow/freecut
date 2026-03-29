import type { GpuTransitionDefinition } from '../types';

export const fade: GpuTransitionDefinition = {
  id: 'fade',
  name: 'Fade',
  category: 'basic',
  hasDirection: false,
  entryPoint: 'fadeFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct FadeParams {
  progress: f32,
  width: f32,
  height: f32,
  _pad: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var leftTex: texture_2d<f32>;
@group(0) @binding(2) var rightTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: FadeParams;

@fragment
fn fadeFragment(input: VertexOutput) -> @location(0) vec4f {
  let left = textureSample(leftTex, texSampler, input.uv);
  let right = textureSample(rightTex, texSampler, input.uv);

  // Equal-power crossfade: outgoing weight = cos(p * PI/2)
  let t = cos(params.progress * PI * 0.5);
  return mix(right, left, t);
}`,
  packUniforms: (progress, width, height) => {
    return new Float32Array([progress, width, height, 0]);
  },
};
