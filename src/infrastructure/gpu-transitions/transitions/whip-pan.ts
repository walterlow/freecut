import type { GpuTransitionDefinition } from '../types'

export const whipPan: GpuTransitionDefinition = {
  id: 'whipPan',
  name: 'Whip Pan',
  category: 'motion',
  hasDirection: true,
  directions: ['from-left', 'from-right', 'from-top', 'from-bottom'],
  entryPoint: 'whipPanFragment',
  uniformSize: 32,
  shader: /* wgsl */ `
struct WhipPanParams {
  progress: f32,
  width: f32,
  height: f32,
  direction: f32,
  blurSamples: f32,
  exposureBoost: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var leftTex: texture_2d<f32>;
@group(0) @binding(2) var rightTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: WhipPanParams;

@fragment
fn whipPanFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let p = clamp(params.progress, 0.0, 1.0);
  let envelope = sin(p * PI);
  let dir = u32(params.direction);

  // Non-linear acceleration curve for realistic camera whip
  let panOffset = smoothstep(0.0, 1.0, p);

  // Direction vector
  var dirVec = vec2f(1.0, 0.0);
  if (dir == 1u) { dirVec = vec2f(-1.0, 0.0); }
  else if (dir == 2u) { dirVec = vec2f(0.0, 1.0); }
  else if (dir == 3u) { dirVec = vec2f(0.0, -1.0); }

  let blurDist = envelope * 0.12 * dirVec;

  var accColor = vec4f(0.0);
  let samples = 9;
  for (var i = -4; i <= 4; i = i + 1) {
    let t = f32(i) / 4.0;
    let sampleUv = uv + blurDist * t;

    // Displaced UVs for incoming and outgoing
    let uvLeft = sampleUv - (panOffset) * dirVec;
    let uvRight = sampleUv + (1.0 - panOffset) * dirVec;

    let sampleLeft = textureSampleLevel(leftTex, texSampler, clamp(uvLeft, vec2f(0.0), vec2f(1.0)), 0.0);
    let sampleRight = textureSampleLevel(rightTex, texSampler, clamp(uvRight, vec2f(0.0), vec2f(1.0)), 0.0);

    let frameSample = mix(sampleLeft, sampleRight, step(0.5, p));
    accColor = accColor + frameSample;
  }
  accColor = accColor / 9.0;

  // Cinematic exposure boost during peak whip
  let boost = 1.0 + envelope * params.exposureBoost * 0.45;
  let color = clamp(accColor.rgb * boost, vec3f(0.0), vec3f(1.0));

  return vec4f(color, accColor.a);
}`,
  packUniforms: (progress, width, height, direction, properties) => {
    const blurSamples = (properties?.blurSamples as number) ?? 9.0
    const exposureBoost = (properties?.exposureBoost as number) ?? 1.2
    return new Float32Array([
      progress,
      width,
      height,
      direction,
      blurSamples,
      exposureBoost,
      0,
      0,
    ])
  },
}
