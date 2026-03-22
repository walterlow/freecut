import type { GpuTransitionDefinition } from '../types';

export const iris: GpuTransitionDefinition = {
  id: 'iris',
  name: 'Iris',
  category: 'mask',
  hasDirection: false,
  entryPoint: 'irisFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct IrisParams {
  progress: f32,
  width: f32,
  height: f32,
  _pad: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var leftTex: texture_2d<f32>;
@group(0) @binding(2) var rightTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: IrisParams;

@fragment
fn irisFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let p = params.progress;

  // Compute distance from center in pixel space
  let pixelPos = uv * vec2f(params.width, params.height);
  let halfW = params.width * 0.5;
  let halfH = params.height * 0.5;
  let center = vec2f(halfW, halfH);
  let dist = length(pixelPos - center);

  // Max radius = diagonal from center to corner * 1.2 (matches CPU)
  let maxRadius = sqrt(halfW * halfW + halfH * halfH) * 1.2;
  let radius = p * maxRadius;

  // Alpha envelopes matching CPU implementation
  let inAlpha = 0.85 + 0.15 * p;
  let outAlpha = 1.0 - 0.1 * p;

  // Sample both textures upfront (uniform control flow required)
  let left = textureSample(leftTex, texSampler, uv);
  let right = textureSample(rightTex, texSampler, uv);

  // Inside circle: incoming; outside: outgoing
  let inside = step(dist, radius);
  let inColor = vec4f(right.rgb * inAlpha, 1.0);
  let outColor = vec4f(left.rgb * outAlpha, 1.0);
  return mix(outColor, inColor, inside);
}`,
  packUniforms: (progress, width, height) => {
    return new Float32Array([progress, width, height, 0]);
  },
};
