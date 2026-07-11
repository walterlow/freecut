import type { GpuTransitionDefinition } from '../types'

export const sceneOrbit: GpuTransitionDefinition = {
  id: 'sceneOrbit',
  name: '3D Scene Orbit',
  category: 'custom',
  hasDirection: true,
  directions: ['from-left', 'from-right'],
  entryPoint: 'sceneOrbitFragment',
  uniformSize: 32,
  shader: /* wgsl */ `
struct SceneOrbitParams {
  progress: f32,
  width: f32,
  height: f32,
  direction: f32,
  perspective: f32,
  travel: f32,
  edgeLight: f32,
  blur: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var leftTex: texture_2d<f32>;
@group(0) @binding(2) var rightTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: SceneOrbitParams;

fn cardUv(uv: vec2f, offset: f32, scale: f32, yaw: f32) -> vec2f {
  var point = uv - vec2f(0.5);
  point.x = (point.x - offset) / max(scale, 0.001);
  let depth = max(0.58, 1.0 + yaw * point.x);
  point.y /= depth;
  point.x += yaw * point.y * point.y * 0.08;
  return point + vec2f(0.5);
}

fn cardMask(uv: vec2f) -> f32 {
  let insideX = step(0.0, uv.x) * step(uv.x, 1.0);
  let insideY = step(0.0, uv.y) * step(uv.y, 1.0);
  return insideX * insideY;
}

fn orbitSample(tex: texture_2d<f32>, uv: vec2f, amount: f32) -> vec4f {
  let center = vec2f(0.5);
  let direction = center - uv;
  var color = vec4f(0.0);
  var weightSum = 0.0;
  for (var index = 0u; index < 5u; index++) {
    let phase = f32(index) / 4.0 - 0.5;
    let weight = 1.0 - abs(phase) * 0.65;
    color += textureSampleLevel(
      tex,
      texSampler,
      clamp(uv + direction * amount * phase, vec2f(0.0), vec2f(1.0)),
      0.0,
    ) * weight;
    weightSum += weight;
  }
  return color / weightSum;
}

@fragment
fn sceneOrbitFragment(input: VertexOutput) -> @location(0) vec4f {
  let raw = clamp(params.progress, 0.0, 1.0);
  let p = raw * raw * (3.0 - 2.0 * raw);
  let direction = select(-1.0, 1.0, u32(params.direction) == 1u);
  let envelope = sin(p * PI);
  let leftUv = cardUv(
    input.uv,
    -direction * params.travel * p,
    1.0 - 0.28 * p,
    direction * params.perspective * p,
  );
  let rightUv = cardUv(
    input.uv,
    direction * params.travel * (1.0 - p),
    0.72 + 0.28 * p,
    -direction * params.perspective * (1.0 - p),
  );
  let blurAmount = params.blur * envelope * 0.075;
  var left = orbitSample(leftTex, leftUv, blurAmount);
  var right = orbitSample(rightTex, rightUv, blurAmount);
  let leftMask = cardMask(leftUv);
  let rightMask = cardMask(rightUv);
  let reveal = smoothstep(0.38, 0.62, p);
  let leftEdge = (1.0 - smoothstep(0.0, 0.035, min(leftUv.x, 1.0 - leftUv.x))) * leftMask;
  let rightEdge = (1.0 - smoothstep(0.0, 0.035, min(rightUv.x, 1.0 - rightUv.x))) * rightMask;
  left.rgb *= 0.82 + 0.18 * (1.0 - p);
  right.rgb *= 0.82 + 0.18 * p;
  left.rgb += vec3f(0.78, 0.88, 1.0) * leftEdge * params.edgeLight * envelope;
  right.rgb += vec3f(0.78, 0.88, 1.0) * rightEdge * params.edgeLight * envelope;
  let backdrop = vec4f(0.012, 0.014, 0.02, 1.0);
  return mix(mix(backdrop, left, leftMask), mix(backdrop, right, rightMask), reveal);
}`,
  packUniforms: (progress, width, height, direction, properties) =>
    new Float32Array([
      progress,
      width,
      height,
      direction,
      (properties?.perspective as number) ?? 0.72,
      (properties?.travel as number) ?? 0.64,
      (properties?.edgeLight as number) ?? 0.16,
      (properties?.blur as number) ?? 0.42,
    ]),
}
