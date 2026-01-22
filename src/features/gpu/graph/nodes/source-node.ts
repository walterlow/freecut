/**
 * Source Nodes
 *
 * Nodes that provide input to the shader graph (textures, colors, etc.)
 */

import type { ShaderNode } from '../types';

/**
 * Create a texture source node
 * This node outputs an existing texture (video frame, image, etc.)
 */
export function createTextureSourceNode(
  id: string,
  params?: { textureId?: string }
): ShaderNode {
  return {
    id,
    type: 'source',
    name: 'Texture Source',
    inputs: {},
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      textureId: {
        type: 'number', // Stored as string but type system uses 'number' for IDs
        value: params?.textureId ?? '',
        default: '',
      },
    },
    // No shader - this node just passes through an existing texture
  };
}

/**
 * Create a solid color source node
 * This node generates a solid color texture
 */
export function createColorSourceNode(
  id: string,
  params?: { color?: [number, number, number, number]; width?: number; height?: number }
): ShaderNode {
  return {
    id,
    type: 'source',
    name: 'Solid Color',
    inputs: {},
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      color: {
        type: 'color',
        value: params?.color ?? [0, 0, 0, 1],
        default: [0, 0, 0, 1],
      },
      width: {
        type: 'number',
        value: params?.width ?? 1920,
        default: 1920,
        min: 1,
        max: 8192,
      },
      height: {
        type: 'number',
        value: params?.height ?? 1080,
        default: 1080,
        min: 1,
        max: 8192,
      },
    },
    shader: {
      uniforms: `
struct Uniforms {
  color: vec4f,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
`,
      code: `
@fragment
fn main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return uniforms.color;
}
`,
      entryPoint: 'main',
    },
  };
}

/**
 * Create a gradient source node
 */
export function createGradientSourceNode(
  id: string,
  params?: {
    startColor?: [number, number, number, number];
    endColor?: [number, number, number, number];
    angle?: number;
  }
): ShaderNode {
  return {
    id,
    type: 'source',
    name: 'Gradient',
    inputs: {},
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      startColor: {
        type: 'color',
        value: params?.startColor ?? [0, 0, 0, 1],
        default: [0, 0, 0, 1],
      },
      endColor: {
        type: 'color',
        value: params?.endColor ?? [1, 1, 1, 1],
        default: [1, 1, 1, 1],
      },
      angle: {
        type: 'number',
        value: params?.angle ?? 0,
        default: 0,
        min: 0,
        max: 360,
      },
    },
    shader: {
      uniforms: `
struct Uniforms {
  startColor: vec4f,
  endColor: vec4f,
  angle: f32,
  _padding: vec3f,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
`,
      code: `
@fragment
fn main(@builtin(position) pos: vec4f, @location(0) uv: vec2f) -> @location(0) vec4f {
  let angle = uniforms.angle * 3.14159 / 180.0;
  let dir = vec2f(cos(angle), sin(angle));
  let t = dot(uv - 0.5, dir) + 0.5;
  return mix(uniforms.startColor, uniforms.endColor, clamp(t, 0.0, 1.0));
}
`,
      entryPoint: 'main',
    },
  };
}
