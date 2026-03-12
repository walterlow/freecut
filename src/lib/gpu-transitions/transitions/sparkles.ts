import type { GpuTransitionDefinition } from '../types';

export const sparkles: GpuTransitionDefinition = {
  id: 'sparkles',
  name: 'Sparkles',
  category: 'light',
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

  let directionAngle = seed * TAU;
  let direction = vec2f(cos(directionAngle), sin(directionAngle));
  let motionEnvelope = sin(progress * PI);
  let drift = direction
    * motionScale
    * (0.35 + (sizeSeed * 1.4))
    * motionEnvelope;
  let orbit = rotateVec2(
    vec2f(0.0, 1.0),
    directionAngle + (progress * (1.8 + (orbitSeed * 2.7)) * PI)
  ) * motionScale * 0.55 * (0.3 + orbitSeed) * motionEnvelope;

  let center = (centerSeed * 0.72) + drift + orbit;
  let rotation = (seed * TAU) + (progress * (1.0 + (sizeSeed * 3.5)) * PI);
  let size = sizeBase + (sizeSeed * sizeVariance);
  let twinkle = 0.25 + (0.75 * ((sin((progress * (5.0 + (sizeSeed * 8.0)) + seed) * TAU) + 1.0) * 0.5));
  let activation = smoothstep(threshold, 1.0, seed);

  let starLocal = rotateVec2(local - center, rotation);
  let main = sparkleShape(starLocal, size) * activation * twinkle;

  let trailCenter = center - (
    direction
    * motionScale
    * (0.45 + sizeSeed)
    * (0.25 + (motionEnvelope * 0.75))
  );
  let trailLocal = rotateVec2(local - trailCenter, rotation - 0.4);
  let trailShape = vec2f(trailLocal.x * 1.5, trailLocal.y * 0.62);
  let trail = sparkleShape(trailShape, size * 0.72)
    * activation
    * twinkle
    * motionEnvelope
    * (0.45 + (sizeSeed * 0.25));

  let flicker = smoothstep(
    0.48,
    1.0,
    noise2d((cell * 0.9) + vec2f((progress * 3.0) + phase, phase))
  );
  let reveal = clamp(
    (main * (0.55 + (flicker * 0.2)))
      + (trail * 0.38)
      + (seed * 0.05),
    0.0,
    1.0
  );
  let glow = max(main, trail * 0.85) * (0.65 + (sizeSeed * 0.7));

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
  let sparkleMask = max(coarseLayer.x, microLayer.x * 0.75);
  let trailGlow = max(coarseLayer.z, microLayer.z * 0.6);
  let sparkleReveal = max(coarseLayer.y, microLayer.y * 0.82);
  let haloReveal = max(trailGlow, sparkleMask * 0.72);
  let baseWash = smoothstep(0.0, 1.0, p);
  let reveal = clamp(
    ((baseWash * baseWash) * 1.08) - 0.08
      + (sparkleReveal * (0.52 + (params.intensity * 0.12)))
      + (haloReveal * (0.22 + (params.glow * 0.14))),
    0.0,
    1.0
  );
  let t = smoothstep(0.03, 0.97, reveal);

  var color = mix(right, left, t);
  let frontPresence = smoothstep(0.05, 0.4, t) * (1.0 - smoothstep(0.58, 0.98, t));
  let starPulse = sin(p * PI) * (0.75 + (sparkleMask * 0.45));
  let edgeGlow = frontPresence
    * haloReveal
    * params.intensity
    * params.glow
    * starPulse;
  let glowColor = mix(vec3f(1.0, 0.97, 0.88), vec3f(1.0, 0.82, 0.56), heroSeed);
  let veilGlow = glowColor * haloReveal * params.glow * frontPresence * 0.18;
  let lifted = color.rgb + veilGlow + (glowColor * edgeGlow * 1.08);
  let compressed = 1.0 - exp(-lifted * (1.0 + (edgeGlow * 0.6)));

  return vec4f(
    clamp(mix(lifted, compressed, 0.42), vec3f(0.0), vec3f(1.0)),
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
