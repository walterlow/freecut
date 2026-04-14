import type { GpuTransitionDefinition } from '../types';

export const pixelate: GpuTransitionDefinition = {
  id: 'pixelate',
  name: 'Pixelate',
  category: 'custom',
  hasDirection: false,
  entryPoint: 'pixelateFragment',
  uniformSize: 32,
  shader: /* wgsl */ `
struct PixelateParams {
  progress: f32,
  // Pre-computed on CPU: block size in UV space (1/width * blockPx, 1/height * blockPx)
  blockU: f32,
  blockV: f32,
  crossfade: f32,
  _pad1: f32,
  _pad2: f32,
  _pad3: f32,
  _pad4: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var leftTex: texture_2d<f32>;
@group(0) @binding(2) var rightTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: PixelateParams;

@fragment
fn pixelateFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;

  // Snap UV to block grid center (block size pre-computed on CPU)
  let snappedUv = clamp(
    floor(uv / vec2f(params.blockU, params.blockV)) * vec2f(params.blockU, params.blockV)
      + vec2f(params.blockU, params.blockV) * 0.5,
    vec2f(0.0),
    vec2f(1.0)
  );

  // Sample both clips at the pixelated UV — only 2 texture reads
  let left = textureSample(leftTex, texSampler, snappedUv);
  let right = textureSample(rightTex, texSampler, snappedUv);

  return mix(left, right, params.crossfade);
}`,
  packUniforms: (progress, width, height, _direction, properties) => {
    const maxBlockSize = (properties?.maxBlockSize as number) ?? 48.0;

    // Pixelation ramps up to midpoint, then back down (smooth pow curve)
    const pixelProgress = 1.0 - Math.abs(progress * 2.0 - 1.0);
    const curved = pixelProgress * pixelProgress; // pow2 for snappier ramp
    const blockPx = Math.max(1.0, curved * maxBlockSize);

    // Pre-compute block size in UV space on CPU (avoids per-pixel division)
    const blockU = blockPx / width;
    const blockV = blockPx / height;

    // Crossfade: smooth S-curve switch at midpoint
    const t = Math.max(0, Math.min(1, (progress - 0.45) / 0.1));
    const crossfade = t * t * (3 - 2 * t); // smoothstep

    return new Float32Array([
      progress, blockU, blockV, crossfade,
      0, 0, 0, 0,
    ]);
  },
};
