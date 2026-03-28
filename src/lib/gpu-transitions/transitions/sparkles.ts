import type { GpuTransitionDefinition } from '../types';

export const sparkles: GpuTransitionDefinition = {
  id: 'sparkles',
  name: 'Sparkles',
  category: 'custom',
  hasDirection: false,
  entryPoint: 'sparklesFragment',
  uniformSize: 32,
  shader: /* wgsl */ `
struct SparklesParams {
  progress: f32,
  width: f32,
  height: f32,
  sparkleScale: f32,
  intensity: f32,
  density: f32,
  glow: f32,
  _pad: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var leftTex: texture_2d<f32>;
@group(0) @binding(2) var rightTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: SparklesParams;

fn rotateVec2(v: vec2f, angle: f32) -> vec2f {
  let c = cos(angle);
  let s = sin(angle);
  return vec2f(
    (v.x * c) - (v.y * s),
    (v.x * s) + (v.y * c)
  );
}

fn sparkleShape(local: vec2f, size: f32) -> f32 {
  let absLocal = abs(local);
  let core = smoothstep(size * 0.34, 0.0, length(local));
  let horizontal = smoothstep(size * 0.14, 0.0, absLocal.y)
    * smoothstep(size, 0.0, absLocal.x);
  let vertical = smoothstep(size * 0.14, 0.0, absLocal.x)
    * smoothstep(size, 0.0, absLocal.y);
  let diagonalA = smoothstep(size * 0.22, 0.0, abs(local.x - local.y))
    * smoothstep(size * 0.9, 0.0, length(local));
  let diagonalB = smoothstep(size * 0.22, 0.0, abs(local.x + local.y))
    * smoothstep(size * 0.9, 0.0, length(local));
  return max(core, max(horizontal, max(vertical, max(diagonalA, diagonalB) * 0.7)));
}

fn sparkleLayer(
  scaledUv: vec2f,
  progress: f32,
  density: f32,
  sizeBase: f32,
  sizeVariance: f32,
  motionScale: f32,
  threshold: f32,
  phase: f32,
) -> vec4f {
  let cellUv = scaledUv * density;
  let cell = floor(cellUv);
  let local = fract(cellUv) - vec2f(0.5, 0.5);
  let seed = hash(cell + vec2f(phase * 1.37, phase * 2.11));
  let centerSeed = vec2f(
    hash(cell + vec2f(phase + 1.7, phase + 6.2)),
    hash(cell + vec2f(phase + 8.4, phase + 3.1))
  ) - vec2f(0.5, 0.5);
  let sizeSeed = hash(cell + vec2f(phase + 2.4, phase + 9.7));
  let orbitSeed = hash(cell + vec2f(phase + 4.6, phase + 11.2));
  let ignitePoint = clamp(
    0.04
      + (seed * 0.72)
      + (noise2d((cell * 0.17) + vec2f(phase * 0.31, phase * 0.67)) * 0.16),
    0.04,
    0.94
  );
  let igniteDuration = 0.14 + (sizeSeed * 0.18);
  let igniteProgress = clamp((progress - ignitePoint) / igniteDuration, 0.0, 1.0);
  let igniteIn = smoothstep(0.0, 0.16, igniteProgress);
  let igniteOut = 1.0 - smoothstep(0.3, 0.95, igniteProgress);
  let pulse = igniteIn * igniteOut;
  let afterglow = smoothstep(0.06, 0.72, igniteProgress);

  let directionAngle = seed * TAU;
  let direction = vec2f(cos(directionAngle), sin(directionAngle));
  let motionEnvelope = pulse * (0.6 + (0.4 * sin(progress * PI)));
  let drift = direction
    * motionScale
    * (0.42 + (sizeSeed * 1.45))
    * motionEnvelope;
  let orbit = rotateVec2(
    vec2f(0.0, 1.0),
    directionAngle + (igniteProgress * (1.5 + (orbitSeed * 2.6)) * PI)
  ) * motionScale * 0.62 * (0.28 + orbitSeed) * motionEnvelope;

  let center = (centerSeed * 0.72) + drift + orbit;
  let rotation = (seed * TAU) + (igniteProgress * (1.2 + (sizeSeed * 3.1)) * PI);
  let size = sizeBase + (sizeSeed * sizeVariance);
  let twinkle = 0.35 + (0.65 * ((sin((igniteProgress * (2.8 + (sizeSeed * 4.5)) + seed) * TAU) + 1.0) * 0.5));
  let activation = smoothstep(threshold, 1.0, seed);

  let starLocal = rotateVec2(local - center, rotation);
  let main = sparkleShape(starLocal, size) * activation * twinkle * pulse;

  let trailCenter = center - (
    direction
    * motionScale
    * (0.6 + sizeSeed)
    * (0.25 + (pulse * 0.95))
  );
  let trailLocal = rotateVec2(local - trailCenter, rotation - 0.4);
  let trailShape = vec2f(trailLocal.x * 1.7, trailLocal.y * 0.58);
  let trail = sparkleShape(trailShape, size * 0.72)
    * activation
    * twinkle
    * pulse
    * (0.42 + (sizeSeed * 0.28));

  let dustNoise = noise2d((cell * 0.85) + vec2f((igniteProgress * 4.2) + phase, phase * 0.37));
  let dust = smoothstep(0.62, 1.0, dustNoise)
    * afterglow
    * activation
    * (0.16 + (sizeSeed * 0.34));
  let reveal = clamp(
    (main * 0.72)
      + (trail * 0.34)
      + (afterglow * activation * 0.24)
      + (dust * 0.12),
    0.0,
    1.0
  );
  let glow = max(main, trail * 0.88) * (0.65 + (sizeSeed * 0.75)) + (dust * 0.3);

  return vec4f(main, reveal, glow, seed);
}

@fragment
fn sparklesFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let p = params.progress;
  let aspect = params.width / max(params.height, 1.0);
  let scaledUv = vec2f(uv.x * aspect, uv.y);

  let left = textureSample(leftTex, texSampler, uv);
  let right = textureSample(rightTex, texSampler, uv);

  let coarseLayer = sparkleLayer(
    scaledUv,
    p,
    5.5 + (params.density * 5.0),
    0.15 * params.sparkleScale,
    0.28 * params.sparkleScale,
    0.18,
    0.58,
    3.7
  );
  let microLayer = sparkleLayer(
    scaledUv,
    p,
    10.0 + (params.density * 9.0),
    0.06 * params.sparkleScale,
    0.14 * params.sparkleScale,
    0.09,
    0.7,
    11.4
  );

  let heroMix = step(microLayer.z, coarseLayer.z);
  let heroSeed = mix(microLayer.w, coarseLayer.w, heroMix);
  let sparkleCore = max(coarseLayer.x, microLayer.x * 0.78);
  let sparkleField = max(coarseLayer.y, microLayer.y * 0.86);
  let glowField = max(coarseLayer.z, microLayer.z * 0.74);
  let macroNoise = fbm((scaledUv * (2.6 + (params.density * 0.9))) + vec2f(0.0, p * 0.7));
  let dustNoise = noise2d(
    (scaledUv * (13.0 + (params.density * 7.0)))
      + vec2f((p * 5.2) + (heroSeed * 3.1), heroSeed * 7.4)
  );
  let dissolveCurve = smoothstep(0.03, 0.97, p);
  let sparkleWindow = smoothstep(0.02, 0.28, p) * (1.0 - smoothstep(0.8, 1.0, p));
  let dustField = smoothstep(0.58, 1.0, dustNoise)
    * (0.12 + (sparkleField * 0.88))
    * sin(p * PI);
  let thresholdMap = clamp(
    (macroNoise * 0.58)
      + (dustNoise * 0.14)
      + ((1.0 - sparkleField) * 0.18)
      + ((1.0 - glowField) * 0.08),
    0.0,
    1.0
  );
  let dissolveProgress = clamp(
    (dissolveCurve * 1.08) - 0.04
      + (sparkleField * (0.28 + (params.intensity * 0.12)) * sparkleWindow)
      + (glowField * (0.1 + (params.glow * 0.08)))
      + (dustField * 0.12),
    0.0,
    1.0
  );
  let edge = 0.075 + (0.018 * params.sparkleScale);
  let leftPresence = 1.0 - smoothstep(thresholdMap - edge, thresholdMap + edge, dissolveProgress);
  let rightPresence = 1.0 - leftPresence;

  var color = mix(right, left, leftPresence);
  let dissolveEdge = clamp(leftPresence * rightPresence * 4.0, 0.0, 1.0);
  let sparkleEnvelope = sin(p * PI);
  let edgeGlow = dissolveEdge
    * glowField
    * params.intensity
    * params.glow
    * (0.5 + (sparkleEnvelope * 0.4));
  let sparkleFlash = sparkleCore
    * (0.38 + (params.intensity * 0.52))
    * (0.62 + (sparkleEnvelope * 0.38));
  let glowColor = mix(vec3f(1.0, 0.97, 0.88), vec3f(1.0, 0.82, 0.56), heroSeed);
  let warmVeil = glowColor * glowField * params.glow * (0.06 + (rightPresence * 0.12));
  let incomingLift = right.rgb * (glowField * rightPresence * 0.05 * params.glow);
  let lifted = color.rgb
    + warmVeil
    + incomingLift
    + (glowColor * edgeGlow * 0.95)
    + (glowColor * sparkleFlash * 0.72);
  let compressed = 1.0 - exp(-lifted * (1.0 + (edgeGlow * 0.45)));

  return vec4f(
    clamp(mix(lifted, compressed, 0.46), vec3f(0.0), vec3f(1.0)),
    color.a
  );
}`,
  packUniforms: (progress, width, height, _direction, properties) => {
    const sparkleScale = (properties?.sparkleScale as number) ?? 1.0;
    const intensity = (properties?.intensity as number) ?? 1.0;
    const density = (properties?.density as number) ?? 1.0;
    const glow = (properties?.glow as number) ?? 1.0;
    return new Float32Array([
      progress, width, height, sparkleScale,
      intensity, density, glow, 0,
    ]);
  },
};
