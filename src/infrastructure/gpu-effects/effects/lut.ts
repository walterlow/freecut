import type { GpuEffectDefinition } from '../types'
import { createIdentityLutData, decodeLutData } from '../lut/cube-lut'

const IDENTITY_LUT_SIZE = 2

/**
 * 3D LUT (.cube) color grade. The LUT data is embedded in the effect params
 * (base64 rgba8, resampled to ≤33³ on import) so it travels with the project
 * and reaches the export worker without a side channel. Sampled trilinearly
 * from a 3D texture at @binding(3).
 */
export const lut3d: GpuEffectDefinition = {
  id: 'gpu-lut',
  name: 'LUT (.cube)',
  category: 'color',
  entryPoint: 'lutFragment',
  uniformSize: 16,
  shader: /* wgsl */ `
struct LutParams { intensity: f32, size: f32, _p2: f32, _p3: f32 };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: LutParams;
@group(0) @binding(3) var lutTex: texture_3d<f32>;
@fragment
fn lutFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let size = max(params.size, 2.0);
  let coords = (clamp(color.rgb, vec3f(0.0), vec3f(1.0)) * (size - 1.0) + vec3f(0.5)) / size;
  let graded = textureSample(lutTex, texSampler, coords).rgb;
  return vec4f(mix(color.rgb, graded, clamp(params.intensity, 0.0, 1.0)), color.a);
}`,
  params: {
    intensity: {
      type: 'number',
      label: 'Intensity',
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    lutName: { type: 'json', label: 'LUT Name', default: '' },
    lutSize: { type: 'json', label: 'LUT Size', default: '0' },
    lutData: { type: 'json', label: 'LUT Data', default: '' },
  },
  packUniforms: (p) => {
    const intensity = typeof p.intensity === 'number' ? p.intensity : 1
    const size = readLutSize(p)
    return new Float32Array([intensity, size, 0, 0])
  },
  dataTexture: {
    dimension: '3d',
    // The base64 payload is the texture's identity. Returning the string
    // itself (no concatenation) keeps the per-frame key comparison a cheap
    // same-reference check for unchanged params.
    key: (p) => (typeof p.lutData === 'string' ? p.lutData : ''),
    build: (p) => {
      const size = readLutSize(p)
      const encoded = typeof p.lutData === 'string' ? p.lutData : ''
      if (size >= 2 && encoded.length > 0) {
        try {
          const data = decodeLutData(encoded)
          if (data.length === size * size * size * 4) {
            return { width: size, height: size, depth: size, data }
          }
        } catch {
          // fall through to identity
        }
      }
      return {
        width: IDENTITY_LUT_SIZE,
        height: IDENTITY_LUT_SIZE,
        depth: IDENTITY_LUT_SIZE,
        data: createIdentityLutData(IDENTITY_LUT_SIZE),
      }
    },
  },
}

function readLutSize(params: Record<string, number | boolean | string>): number {
  const raw = params.lutSize
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : 0
  if (!Number.isFinite(parsed) || parsed < 2 || parsed > 129) return IDENTITY_LUT_SIZE
  return Math.floor(parsed)
}
