import type { GpuTransitionDefinition } from '../types'

export const anamorphicStreak: GpuTransitionDefinition = {
  id: 'anamorphicStreak',
  name: 'Anamorphic Streak',
  category: 'light',
  hasDirection: true,
  directions: ['from-left', 'from-right'],
  entryPoint: 'anamorphicStreakFragment',
  uniformSize: 32,
  shader: /* wgsl */ `
struct AnamorphicStreakParams {
  progress: f32,
  width: f32,
  height: f32,
  direction: f32,
  streakLength: f32,
  intensity: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var leftTex: texture_2d<f32>;
@group(0) @binding(2) var rightTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: AnamorphicStreakParams;

@fragment
fn anamorphicStreakFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let p = clamp(params.progress, 0.0, 1.0);
  let envelope = sin(p * PI);

  let left = textureSampleLevel(leftTex, texSampler, uv, 0.0);
  let right = textureSampleLevel(rightTex, texSampler, uv, 0.0);

  // Directional streak sweep
  let streakCenter = select(p, 1.0 - p, params.direction > 0.5);
  let dist = abs(uv.x - streakCenter);
  let core = exp(-dist * dist * 40.0 * (1.0 / max(0.01, params.streakLength)));

  // Horizontal flare sampling
  let dx = params.streakLength * 0.02 * envelope;
  var flareSum = vec3f(0.0);
  for (var i = -6; i <= 6; i = i + 1) {
    let sUv = vec2f(clamp(uv.x + f32(i) * dx, 0.0, 1.0), uv.y);
    let sampleColor = mix(left, right, p);
    let luma = max(0.0, dot(sampleColor.rgb, vec3f(0.299, 0.587, 0.114)) - 0.5);
    flareSum = flareSum + sampleColor.rgb * luma * exp(-abs(f32(i)) * 0.3);
  }

  let cyanTint = vec3f(0.2, 0.7, 1.0);
  let streakLight = (flareSum * 0.3 + cyanTint * core * 1.5) * envelope * params.intensity;

  // Base crossfade with flash bloom
  let base = mix(left, right, smoothstep(0.35, 0.65, p));
  let finalColor = clamp(base.rgb + streakLight, vec3f(0.0), vec3f(1.0));
  return vec4f(finalColor, base.a);
}`,
  packUniforms: (progress, width, height, direction, properties) => {
    const streakLength = (properties?.streakLength as number) ?? 1.0
    const intensity = (properties?.intensity as number) ?? 1.8
    return new Float32Array([
      progress,
      width,
      height,
      direction,
      streakLength,
      intensity,
      0,
      0,
    ])
  },
}
