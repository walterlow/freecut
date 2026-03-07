import type { GpuEffectDefinition } from '../types';

export const chromaKey: GpuEffectDefinition = {
  id: 'gpu-chroma-key',
  name: 'Chroma Key',
  category: 'keying',
  entryPoint: 'chromaKeyFragment',
  uniformSize: 32,
  shader: /* wgsl */ `
struct ChromaKeyParams {
  keyR: f32, keyG: f32, keyB: f32, tolerance: f32,
  softness: f32, spillSuppression: f32, _p1: f32, _p2: f32,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: ChromaKeyParams;

fn rgb2ycbcr(rgb: vec3f) -> vec3f {
  let y = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
  let cb = 0.564 * (rgb.b - y);
  let cr = 0.713 * (rgb.r - y);
  return vec3f(y, cb, cr);
}

@fragment
fn chromaKeyFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let keyColor = vec3f(params.keyR, params.keyG, params.keyB);
  let colorYCbCr = rgb2ycbcr(color.rgb);
  let keyYCbCr = rgb2ycbcr(keyColor);
  let cbcrDist = length(colorYCbCr.yz - keyYCbCr.yz);
  let innerTolerance = params.tolerance;
  let outerTolerance = params.tolerance + params.softness;
  var alpha = smoothstep(innerTolerance, outerTolerance, cbcrDist);
  var finalColor = color.rgb;
  if (params.spillSuppression > 0.0) {
    if (params.keyG > params.keyR && params.keyG > params.keyB) {
      let spillAmount = max(0.0, finalColor.g - max(finalColor.r, finalColor.b)) * params.spillSuppression;
      finalColor.g -= spillAmount;
      finalColor.r += spillAmount * 0.5;
      finalColor.b += spillAmount * 0.5;
    } else if (params.keyB > params.keyR && params.keyB > params.keyG) {
      let spillAmount = max(0.0, finalColor.b - max(finalColor.r, finalColor.g)) * params.spillSuppression;
      finalColor.b -= spillAmount;
      finalColor.r += spillAmount * 0.5;
      finalColor.g += spillAmount * 0.5;
    }
  }
  return vec4f(finalColor, color.a * alpha);
}`,
  params: {
    keyColor: {
      type: 'select',
      label: 'Key Color',
      default: 'green',
      options: [
        { value: 'green', label: 'Green Screen' },
        { value: 'blue', label: 'Blue Screen' },
      ],
    },
    tolerance: { type: 'number', label: 'Tolerance', default: 0.2, min: 0, max: 1, step: 0.01, animatable: true },
    softness: { type: 'number', label: 'Edge Softness', default: 0.1, min: 0, max: 0.5, step: 0.01, animatable: true },
    spillSuppression: { type: 'number', label: 'Spill Suppression', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true },
  },
  packUniforms: (p) => {
    let keyR = 0, keyG = 1, keyB = 0;
    if ((p.keyColor as string) === 'blue') { keyR = 0; keyG = 0; keyB = 1; }
    return new Float32Array([
      keyR, keyG, keyB, p.tolerance as number ?? 0.2,
      p.softness as number ?? 0.1, p.spillSuppression as number ?? 0.5, 0, 0,
    ]);
  },
};
