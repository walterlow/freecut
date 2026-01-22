/**
 * Effect Nodes
 *
 * Color correction and adjustment effect nodes.
 */

import type { ShaderNode } from '../types';

/**
 * Brightness adjustment node
 */
export function createBrightnessNode(
  id: string,
  params?: { brightness?: number }
): ShaderNode {
  return {
    id,
    type: 'effect',
    name: 'Brightness',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      brightness: {
        type: 'number',
        value: params?.brightness ?? 0,
        default: 0,
        min: -1,
        max: 1,
        step: 0.01,
      },
    },
    shader: {
      uniforms: `
struct Uniforms {
  brightness: f32,
  _padding: vec3f,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var inputSampler: sampler;
`,
      code: `
@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let color = textureSample(inputTexture, inputSampler, uv);
  let adjusted = color.rgb + uniforms.brightness;
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}
`,
      entryPoint: 'main',
    },
  };
}

/**
 * Contrast adjustment node
 */
export function createContrastNode(
  id: string,
  params?: { contrast?: number }
): ShaderNode {
  return {
    id,
    type: 'effect',
    name: 'Contrast',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      contrast: {
        type: 'number',
        value: params?.contrast ?? 0,
        default: 0,
        min: -1,
        max: 1,
        step: 0.01,
      },
    },
    shader: {
      uniforms: `
struct Uniforms {
  contrast: f32,
  _padding: vec3f,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var inputSampler: sampler;
`,
      code: `
@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let color = textureSample(inputTexture, inputSampler, uv);
  // Contrast: scale around 0.5 midpoint
  let factor = 1.0 + uniforms.contrast;
  let adjusted = (color.rgb - 0.5) * factor + 0.5;
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}
`,
      entryPoint: 'main',
    },
  };
}

/**
 * Saturation adjustment node
 */
export function createSaturationNode(
  id: string,
  params?: { saturation?: number }
): ShaderNode {
  return {
    id,
    type: 'effect',
    name: 'Saturation',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      saturation: {
        type: 'number',
        value: params?.saturation ?? 0,
        default: 0,
        min: -1,
        max: 1,
        step: 0.01,
      },
    },
    shader: {
      uniforms: `
struct Uniforms {
  saturation: f32,
  _padding: vec3f,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var inputSampler: sampler;
`,
      code: `
@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let color = textureSample(inputTexture, inputSampler, uv);
  // Luminance using standard coefficients
  let luminance = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
  let gray = vec3f(luminance);
  // Saturation: interpolate between gray and color
  let factor = 1.0 + uniforms.saturation;
  let adjusted = mix(gray, color.rgb, factor);
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}
`,
      entryPoint: 'main',
    },
  };
}

/**
 * Opacity adjustment node
 */
export function createOpacityNode(
  id: string,
  params?: { opacity?: number }
): ShaderNode {
  return {
    id,
    type: 'effect',
    name: 'Opacity',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      opacity: {
        type: 'number',
        value: params?.opacity ?? 1,
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
      },
    },
    shader: {
      uniforms: `
struct Uniforms {
  opacity: f32,
  _padding: vec3f,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var inputSampler: sampler;
`,
      code: `
@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let color = textureSample(inputTexture, inputSampler, uv);
  return vec4f(color.rgb, color.a * uniforms.opacity);
}
`,
      entryPoint: 'main',
    },
  };
}

/**
 * Combined brightness/contrast node (more efficient than separate)
 */
export function createBrightnessContrastNode(
  id: string,
  params?: { brightness?: number; contrast?: number }
): ShaderNode {
  return {
    id,
    type: 'effect',
    name: 'Brightness/Contrast',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      brightness: {
        type: 'number',
        value: params?.brightness ?? 0,
        default: 0,
        min: -1,
        max: 1,
        step: 0.01,
      },
      contrast: {
        type: 'number',
        value: params?.contrast ?? 0,
        default: 0,
        min: -1,
        max: 1,
        step: 0.01,
      },
    },
    shader: {
      uniforms: `
struct Uniforms {
  brightness: f32,
  contrast: f32,
  _padding: vec2f,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var inputSampler: sampler;
`,
      code: `
@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let color = textureSample(inputTexture, inputSampler, uv);
  // Apply contrast first, then brightness
  let contrastFactor = 1.0 + uniforms.contrast;
  let adjusted = (color.rgb - 0.5) * contrastFactor + 0.5 + uniforms.brightness;
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}
`,
      entryPoint: 'main',
    },
  };
}
