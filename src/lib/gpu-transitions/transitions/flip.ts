import type { GpuTransitionDefinition } from '../types';

export const flip: GpuTransitionDefinition = {
  id: 'flip',
  name: 'Flip',
  category: 'flip',
  hasDirection: true,
  directions: ['from-left', 'from-right', 'from-top', 'from-bottom'],
  entryPoint: 'flipFragment',
  uniformSize: 32,
  shader: /* wgsl */ `
struct FlipParams {
  progress: f32,
  width: f32,
  height: f32,
  direction: f32,
  perspectiveShift: f32,
  shadowStrength: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var leftTex: texture_2d<f32>;
@group(0) @binding(2) var rightTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: FlipParams;

fn sampleFlip(tex: texture_2d<f32>, uv: vec2f, scale: f32, horizontal: bool, signedOffset: f32) -> vec4f {
  let centered = uv - vec2f(0.5);
  var warped = centered;
  if (horizontal) {
    warped.x = centered.x / max(scale, 0.001) + signedOffset * (1.0 - scale);
  } else {
    warped.y = centered.y / max(scale, 0.001) + signedOffset * (1.0 - scale);
  }
  let sampleUv = warped + vec2f(0.5);
  if (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) {
    return vec4f(0.0);
  }
  return textureSample(tex, texSampler, sampleUv);
}

@fragment
fn flipFragment(input: VertexOutput) -> @location(0) vec4f {
  let p = clamp(params.progress, 0.0, 1.0);
  let dir = u32(params.direction);
  let horizontal = dir == 0u || dir == 1u;
  let signedOffset = select(1.0, -1.0, dir == 1u || dir == 3u);
  let midpoint = 0.5;

  var color = vec4f(0.0);
  var shadow = 0.0;

  if (p < midpoint) {
    let local = p / midpoint;
    let scale = max(0.001, cos(local * PI * 0.5));
    color = sampleFlip(leftTex, input.uv, scale, horizontal, signedOffset * params.perspectiveShift);
    shadow = (1.0 - scale) * params.shadowStrength;
  } else {
    let local = (p - midpoint) / midpoint;
    let scale = max(0.001, sin(local * PI * 0.5));
    color = sampleFlip(rightTex, input.uv, scale, horizontal, signedOffset * -params.perspectiveShift);
    shadow = (1.0 - scale) * params.shadowStrength;
  }

  return vec4f(color.rgb * (1.0 - shadow), color.a);
}`,
  packUniforms: (progress, width, height, direction) => {
    return new Float32Array([
      Math.max(0, Math.min(1, progress)), width, height, direction,
      0.12, 0.22, 0, 0,
    ]);
  },
};
