/**
 * Blur Effect Nodes
 *
 * Various blur implementations for the shader graph.
 */

import type { ShaderNode } from '../types';

/**
 * Simple box blur node
 */
export function createBlurNode(
  id: string,
  params?: { radius?: number }
): ShaderNode {
  return {
    id,
    type: 'effect',
    name: 'Blur',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      radius: {
        type: 'number',
        value: params?.radius ?? 1,
        default: 1,
        min: 0,
        max: 50,
        step: 1,
      },
    },
    shader: {
      uniforms: `
struct Uniforms {
  radius: f32,
  texelSize: vec2f,
  _padding: f32,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var inputSampler: sampler;
`,
      code: `
@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let radius = i32(uniforms.radius);
  if (radius == 0) {
    return textureSample(inputTexture, inputSampler, uv);
  }

  var color = vec4f(0.0);
  var count = 0.0;

  for (var x = -radius; x <= radius; x++) {
    for (var y = -radius; y <= radius; y++) {
      let offset = vec2f(f32(x), f32(y)) * uniforms.texelSize;
      color += textureSample(inputTexture, inputSampler, uv + offset);
      count += 1.0;
    }
  }

  return color / count;
}
`,
      entryPoint: 'main',
    },
  };
}

/**
 * Gaussian blur node (separable, two-pass)
 * Note: This generates code for a single pass (horizontal or vertical)
 * The graph compiler should create two passes for full blur
 */
export function createGaussianBlurNode(
  id: string,
  params?: { sigma?: number; direction?: 'horizontal' | 'vertical' }
): ShaderNode {
  const direction = params?.direction ?? 'horizontal';

  return {
    id,
    type: 'effect',
    name: 'Gaussian Blur',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      sigma: {
        type: 'number',
        value: params?.sigma ?? 2,
        default: 2,
        min: 0.1,
        max: 20,
        step: 0.1,
      },
      direction: {
        type: 'select',
        value: direction,
        default: 'horizontal',
        options: [
          { label: 'Horizontal', value: 'horizontal' },
          { label: 'Vertical', value: 'vertical' },
        ],
      },
    },
    shader: {
      uniforms: `
struct Uniforms {
  sigma: f32,
  texelSize: vec2f,
  direction: f32, // 0 = horizontal, 1 = vertical
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var inputSampler: sampler;

fn gaussian(x: f32, sigma: f32) -> f32 {
  return exp(-(x * x) / (2.0 * sigma * sigma)) / (sqrt(2.0 * 3.14159) * sigma);
}
`,
      code: `
@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let sigma = uniforms.sigma;
  let radius = i32(ceil(sigma * 3.0));

  var color = vec4f(0.0);
  var weightSum = 0.0;

  let dir = select(vec2f(1.0, 0.0), vec2f(0.0, 1.0), uniforms.direction > 0.5);

  for (var i = -radius; i <= radius; i++) {
    let weight = gaussian(f32(i), sigma);
    let offset = dir * f32(i) * uniforms.texelSize;
    color += textureSample(inputTexture, inputSampler, uv + offset) * weight;
    weightSum += weight;
  }

  return color / weightSum;
}
`,
      entryPoint: 'main',
    },
  };
}

/**
 * Fast approximate blur using downsampling
 */
export function createFastBlurNode(
  id: string,
  params?: { strength?: number }
): ShaderNode {
  return {
    id,
    type: 'effect',
    name: 'Fast Blur',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      strength: {
        type: 'number',
        value: params?.strength ?? 1,
        default: 1,
        min: 0,
        max: 10,
        step: 0.1,
      },
    },
    shader: {
      uniforms: `
struct Uniforms {
  strength: f32,
  texelSize: vec2f,
  _padding: f32,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var inputSampler: sampler;
`,
      code: `
// Kawase blur - fast approximation
@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let offset = uniforms.texelSize * uniforms.strength;

  var color = textureSample(inputTexture, inputSampler, uv);
  color += textureSample(inputTexture, inputSampler, uv + vec2f(-offset.x, -offset.y));
  color += textureSample(inputTexture, inputSampler, uv + vec2f( offset.x, -offset.y));
  color += textureSample(inputTexture, inputSampler, uv + vec2f(-offset.x,  offset.y));
  color += textureSample(inputTexture, inputSampler, uv + vec2f( offset.x,  offset.y));

  return color / 5.0;
}
`,
      entryPoint: 'main',
    },
  };
}
