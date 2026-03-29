import type { GpuTransitionDefinition } from '../types';

export const lightLeak: GpuTransitionDefinition = {
  id: 'lightLeak',
  name: 'Light Leak',
  category: 'light',
  hasDirection: true,
  directions: ['from-left', 'from-right', 'from-top', 'from-bottom'],
  entryPoint: 'lightLeakFragment',
  uniformSize: 32,
  shader: /* wgsl */ `
struct LightLeakParams {
  progress: f32,
  width: f32,
  height: f32,
  direction: f32,
  intensity: f32,
  spread: f32,
  warmth: f32,
  _pad: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var leftTex: texture_2d<f32>;
@group(0) @binding(2) var rightTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: LightLeakParams;

@fragment
fn lightLeakFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let p = params.progress;

  let left = textureSample(leftTex, texSampler, uv);
  let right = textureSample(rightTex, texSampler, uv);

  // Directional sweep coordinate (0→1 in sweep direction)
  let dir = u32(params.direction);
  var sweepPos: f32;
  if (dir == 0u) { sweepPos = uv.x; }
  else if (dir == 1u) { sweepPos = 1.0 - uv.x; }
  else if (dir == 2u) { sweepPos = uv.y; }
  else { sweepPos = 1.0 - uv.y; }

  // Cross-fade follows the sweep with a soft edge
  let crossfade = smoothstep(p * 1.4 - 0.3, p * 1.4 + 0.1, sweepPos);
  let base = mix(right, left, crossfade);

  // Light leak: gaussian blob that follows the sweep front
  let leakCenter = p;
  let leakSigma = params.spread * 0.3;
  let leakAmount = exp(-pow(sweepPos - leakCenter, 2.0) / (2.0 * leakSigma * leakSigma));

  // Add organic variation to the leak using noise
  let noiseVal = noise2d(uv * 4.0 + vec2f(p * 2.0, 0.0));
  let organicLeak = leakAmount * (0.7 + 0.3 * noiseVal);

  // Warm/cool color for the leak
  let warmColor = mix(
    vec3f(1.0, 0.95, 0.85),
    vec3f(1.0, 0.8, 0.5),
    params.warmth
  );

  // Intensity envelope — stronger in the middle of the transition
  let envelope = sin(p * PI);
  let leakStrength = organicLeak * params.intensity * envelope;

  // Apply additive light leak
  let leaked = base.rgb + warmColor * leakStrength;

  // Slight bloom/overexposure compression
  let compressed = 1.0 - exp(-leaked * 1.2);

  return vec4f(compressed, base.a);
}`,
  packUniforms: (progress, width, height, direction, properties) => {
    const intensity = (properties?.intensity as number) ?? 1.5;
    const spread = (properties?.spread as number) ?? 1.0;
    const warmth = (properties?.warmth as number) ?? 0.5;
    return new Float32Array([
      progress, width, height, direction,
      intensity, spread, warmth, 0,
    ]);
  },
};
