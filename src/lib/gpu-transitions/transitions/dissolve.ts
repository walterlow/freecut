import type { GpuTransitionDefinition } from '../types';

export const dissolve: GpuTransitionDefinition = {
  id: 'dissolve',
  name: 'Dissolve',
  category: 'basic',
  hasDirection: false,
  entryPoint: 'dissolveFragment',
  uniformSize: 32,
  shader: /* wgsl */ `
struct DissolveParams {
  progress: f32,
  width: f32,
  height: f32,
  edgeSoftness: f32,
  noiseScale: f32,
  _pad1: f32,
  _pad2: f32,
  _pad3: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var leftTex: texture_2d<f32>;
@group(0) @binding(2) var rightTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: DissolveParams;

@fragment
fn dissolveFragment(input: VertexOutput) -> @location(0) vec4f {
  let left = textureSample(leftTex, texSampler, input.uv);
  let right = textureSample(rightTex, texSampler, input.uv);

  // Multi-octave noise for organic dissolve pattern
  let n = fbm(input.uv * params.noiseScale);

  // Edge softness in normalized space
  let edge = params.edgeSoftness * 0.15;
  let threshold = params.progress;

  // Smooth transition band around the threshold
  let t = smoothstep(threshold - edge, threshold + edge, n);

  // Add slight brightness boost at the dissolve edge for visual punch
  let edgeDist = abs(n - threshold);
  let edgeGlow = exp(-edgeDist * edgeDist / (edge * edge * 2.0)) * 0.15 * sin(params.progress * PI);

  let color = mix(right, left, t);
  return vec4f(min(color.rgb + edgeGlow, vec3f(1.0)), color.a);
}`,
  packUniforms: (progress, width, height, _direction, properties) => {
    const edgeSoftness = (properties?.edgeSoftness as number) ?? 3.0;
    const noiseScale = (properties?.noiseScale as number) ?? 8.0;
    return new Float32Array([
      progress, width, height, edgeSoftness,
      noiseScale, 0, 0, 0,
    ]);
  },
};
