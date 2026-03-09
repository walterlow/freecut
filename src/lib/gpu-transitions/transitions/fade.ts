import type { GpuTransitionDefinition } from '../types';

export const fade: GpuTransitionDefinition = {
  id: 'fade',
  name: 'Fade',
  category: 'basic',
  hasDirection: false,
  entryPoint: 'fadeFragment',
  uniformSize: 32,
  shader: /* wgsl */ `
struct FadeParams {
  progress: f32,
  width: f32,
  height: f32,
  outgoingScale: f32,
  incomingScale: f32,
  outgoingOpacity: f32,
  incomingOpacity: f32,
  _pad: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var leftTex: texture_2d<f32>;
@group(0) @binding(2) var rightTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: FadeParams;

fn sampleScaled(tex: texture_2d<f32>, uv: vec2f, scale: f32) -> vec4f {
  let centered = (uv - vec2f(0.5)) / max(scale, 0.001) + vec2f(0.5);
  let mask = unitUvMask(centered);
  let sampleUv = clamp(centered, vec2f(0.0), vec2f(1.0));
  return textureSample(tex, texSampler, sampleUv) * mask;
}

@fragment
fn fadeFragment(input: VertexOutput) -> @location(0) vec4f {
  let left = sampleScaled(leftTex, input.uv, params.outgoingScale);
  let right = sampleScaled(rightTex, input.uv, params.incomingScale);

  let leftContribution = left * params.outgoingOpacity;
  let rightContribution = right * params.incomingOpacity;

  let outRgb = rightContribution.rgb + leftContribution.rgb;
  let outAlpha = clamp(rightContribution.a + leftContribution.a, 0.0, 1.0);
  return vec4f(outRgb, outAlpha);
}`,
  packUniforms: (progress, width, height) => {
    const p = Math.max(0, Math.min(1, progress));
    const outgoingOpacity = Math.cos((p * Math.PI) / 2);
    const incomingOpacity = Math.sin((p * Math.PI) / 2);
    const outgoingScale = 1 - (0.04 * p);
    const incomingScale = 1.04 - (0.04 * p);

    return new Float32Array([
      p, width, height, outgoingScale,
      incomingScale, outgoingOpacity, incomingOpacity, 0,
    ]);
  },
};
