import type { GpuTransitionDefinition } from '../types';

export const flip: GpuTransitionDefinition = {
  id: 'flip',
  name: 'Flip',
  category: 'flip',
  hasDirection: true,
  directions: ['from-left', 'from-right', 'from-top', 'from-bottom'],
  entryPoint: 'flipFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct FlipParams {
  progress: f32,
  width: f32,
  height: f32,
  direction: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var leftTex: texture_2d<f32>;
@group(0) @binding(2) var rightTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: FlipParams;

@fragment
fn flipFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let p = params.progress;
  let dir = u32(params.direction);

  // Horizontal flip (from-left/from-right) scales X, vertical scales Y
  let isHorizontal = (dir == 0u || dir == 1u);
  let midpoint = 0.5;
  let centered = uv - vec2f(0.5, 0.5);

  // Phase 1: outgoing scales 1→0; Phase 2: incoming scales 0→1
  let flipProgress1 = p / midpoint;
  let flipProgress2 = (p - midpoint) / midpoint;
  let scale1 = max(cos(flipProgress1 * PI * 0.5), 0.001);
  let scale2 = max(sin(flipProgress2 * PI * 0.5), 0.001);
  let scale = select(scale2, scale1, p < midpoint);

  // Distort UV from center based on axis
  let hDistorted = vec2f(centered.x / scale + 0.5, uv.y);
  let vDistorted = vec2f(uv.x, centered.y / scale + 0.5);
  let distorted = select(vDistorted, hDistorted, isHorizontal);

  // Sample both textures at the distorted UV (uniform control flow)
  let left = textureSample(leftTex, texSampler, distorted);
  let right = textureSample(rightTex, texSampler, distorted);

  // Out of bounds = black
  let oob = distorted.x < 0.0 || distorted.x > 1.0 || distorted.y < 0.0 || distorted.y > 1.0;
  let black = vec4f(0.0, 0.0, 0.0, 1.0);

  // Phase 1 shows outgoing (left), Phase 2 shows incoming (right)
  let texColor = select(right, left, p < midpoint);
  return select(texColor, black, oob);
}`,
  packUniforms: (progress, width, height, direction) => {
    return new Float32Array([progress, width, height, direction]);
  },
};
