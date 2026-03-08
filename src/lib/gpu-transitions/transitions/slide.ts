import type { GpuTransitionDefinition } from '../types';

export const slide: GpuTransitionDefinition = {
  id: 'slide',
  name: 'Slide',
  category: 'slide',
  hasDirection: true,
  directions: ['from-left', 'from-right', 'from-top', 'from-bottom'],
  entryPoint: 'slideFragment',
  uniformSize: 32,
  shader: /* wgsl */ `
struct SlideParams {
  progress: f32,
  width: f32,
  height: f32,
  direction: f32,
  outgoingFeather: f32,
  _pad1: f32,
  _pad2: f32,
  _pad3: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var leftTex: texture_2d<f32>;
@group(0) @binding(2) var rightTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: SlideParams;

fn axisOffset(progress: f32, dir: u32, isOutgoing: bool) -> vec2f {
  let phase = select(progress - 1.0, progress, isOutgoing);
  if (dir == 0u) { return vec2f(phase, 0.0); }
  if (dir == 1u) { return vec2f(-phase, 0.0); }
  if (dir == 2u) { return vec2f(0.0, phase); }
  return vec2f(0.0, -phase);
}

fn sampleIfInBounds(tex: texture_2d<f32>, uv: vec2f) -> vec4f {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    return vec4f(0.0);
  }
  return textureSample(tex, texSampler, uv);
}

@fragment
fn slideFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let dir = u32(params.direction);

  let rightUv = uv - axisOffset(params.progress, dir, false);
  let leftUv = uv - axisOffset(params.progress, dir, true);

  let right = sampleIfInBounds(rightTex, rightUv);
  var left = sampleIfInBounds(leftTex, leftUv);

  // Slight edge feather keeps the overlap seam from looking too hard.
  let seam = max(abs(leftUv.x - 0.5), abs(leftUv.y - 0.5));
  let edgeFade = smoothstep(0.5, 0.5 - params.outgoingFeather, seam);
  left = vec4f(left.rgb, left.a * edgeFade);

  let outRgb = right.rgb * (1.0 - left.a) + left.rgb;
  let outAlpha = clamp(right.a * (1.0 - left.a) + left.a, 0.0, 1.0);
  return vec4f(outRgb, outAlpha);
}`,
  packUniforms: (progress, width, height, direction) => {
    return new Float32Array([
      Math.max(0, Math.min(1, progress)), width, height, direction,
      0.02, 0, 0, 0,
    ]);
  },
};
