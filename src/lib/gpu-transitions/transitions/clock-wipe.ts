import type { GpuTransitionDefinition } from '../types';

export const clockWipe: GpuTransitionDefinition = {
  id: 'clockWipe',
  name: 'Clock Wipe',
  category: 'mask',
  hasDirection: false,
  entryPoint: 'clockWipeFragment',
  uniformSize: 32,
  shader: /* wgsl */ `
struct ClockWipeParams {
  progress: f32,
  width: f32,
  height: f32,
  edgeSoftness: f32,
  incomingScale: f32,
  outgoingScale: f32,
  incomingOpacity: f32,
  outgoingOpacity: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var leftTex: texture_2d<f32>;
@group(0) @binding(2) var rightTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: ClockWipeParams;

fn sampleScaled(tex: texture_2d<f32>, uv: vec2f, scale: f32) -> vec4f {
  let centered = (uv - vec2f(0.5)) / max(scale, 0.001) + vec2f(0.5);
  if (centered.x < 0.0 || centered.x > 1.0 || centered.y < 0.0 || centered.y > 1.0) {
    return vec4f(0.0);
  }
  return textureSample(tex, texSampler, centered);
}

@fragment
fn clockWipeFragment(input: VertexOutput) -> @location(0) vec4f {
  let p = clamp(params.progress, 0.0, 1.0);
  let left = sampleScaled(leftTex, input.uv, params.outgoingScale);
  let right = sampleScaled(rightTex, input.uv, params.incomingScale);

  let centered = vec2f(input.uv.x - 0.5, 0.5 - input.uv.y);
  let theta = atan2(centered.y, centered.x);
  let clockPos = fract(0.25 - theta / TAU);

  var leftMask = smoothstep(p - params.edgeSoftness, p + params.edgeSoftness, clockPos);
  if (p <= 0.0001) {
    leftMask = 1.0;
  } else if (p >= 0.9999) {
    leftMask = 0.0;
  }

  let leftContribution = left * (leftMask * params.outgoingOpacity);
  let rightContribution = right * params.incomingOpacity;
  let outRgb = rightContribution.rgb * (1.0 - leftContribution.a) + leftContribution.rgb;
  let outAlpha = clamp(rightContribution.a * (1.0 - leftContribution.a) + leftContribution.a, 0.0, 1.0);
  return vec4f(outRgb, outAlpha);
}`,
  packUniforms: (progress, width, height, _direction, properties) => {
    const p = Math.max(0, Math.min(1, progress));
    const edgeSoftnessPx = Math.max(0, (properties?.edgeSoftness as number) ?? 8);
    const edgeSoftness = edgeSoftnessPx / 360;
    return new Float32Array([
      p, width, height, edgeSoftness,
      1.04 - (0.04 * p), 1 - (0.04 * p), 0.85 + (0.15 * p), 1 - (0.1 * p),
    ]);
  },
};
