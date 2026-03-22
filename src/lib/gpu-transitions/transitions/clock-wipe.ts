import type { GpuTransitionDefinition } from '../types';

export const clockWipe: GpuTransitionDefinition = {
  id: 'clockWipe',
  name: 'Clock Wipe',
  category: 'mask',
  hasDirection: false,
  entryPoint: 'clockWipeFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct ClockWipeParams {
  progress: f32,
  width: f32,
  height: f32,
  edgeSoftness: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var leftTex: texture_2d<f32>;
@group(0) @binding(2) var rightTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: ClockWipeParams;

@fragment
fn clockWipeFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let p = params.progress;

  // Compute angle from center in pixel space (preserves aspect ratio)
  let pixelPos = uv * vec2f(params.width, params.height);
  let center = vec2f(params.width * 0.5, params.height * 0.5);
  let delta = pixelPos - center;

  // atan2(x, -y) gives angle from 12 o'clock (top), clockwise positive
  let angle = atan2(delta.x, -delta.y);

  // Normalize angle from [-PI, PI] to [0, TAU]
  let normalizedAngle = select(angle, angle + TAU, angle < 0.0);
  let sweepAngle = p * TAU;

  // Alpha envelopes matching CPU implementation
  let inAlpha = 0.85 + 0.15 * p;
  let outAlpha = 1.0 - 0.1 * p;

  // Sample both textures upfront (uniform control flow required)
  let left = textureSample(leftTex, texSampler, uv);
  let right = textureSample(rightTex, texSampler, uv);

  // Edge softness in radians (convert degrees to radians)
  let edge = params.edgeSoftness * TAU / 360.0;
  // Swept region with soft edge: incoming; un-swept: outgoing
  let swept = 1.0 - smoothstep(max(sweepAngle - edge, 0.0), sweepAngle + edge, normalizedAngle);
  let inColor = vec4f(right.rgb * inAlpha, 1.0);
  let outColor = vec4f(left.rgb * outAlpha, 1.0);
  return mix(outColor, inColor, swept);
}`,
  packUniforms: (progress, width, height, _direction, properties) => {
    const edgeSoftness = (properties?.edgeSoftness as number) ?? 8.0;
    return new Float32Array([progress, width, height, edgeSoftness]);
  },
};
