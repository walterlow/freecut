import type { GpuTransitionDefinition } from '../types'

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
  let p = clamp(params.progress, 0.0, 1.0);

  let outgoingWeight = select(0.0, max(0.0, cos(p * PI)), p < 0.5);
  let incomingWeight = select(max(0.0, -cos(p * PI)), 0.0, p < 0.5);
  let blackWeight = 1.0 - max(outgoingWeight, incomingWeight);
  let color = left.rgb * outgoingWeight + right.rgb * incomingWeight;
  let alpha = clamp(left.a * outgoingWeight + right.a * incomingWeight + blackWeight, 0.0, 1.0);

  return vec4f(color, alpha);
}`,
  packUniforms: (progress, width, height) => {
    return new Float32Array([progress, width, height, 0])
  },
}
