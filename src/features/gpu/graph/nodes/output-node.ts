/**
 * Output Nodes
 *
 * Terminal nodes that represent final outputs (screen, export, etc.)
 */

import type { ShaderNode } from '../types';

/**
 * Screen output node
 * Renders to the visible canvas
 */
export function createOutputNode(id: string): ShaderNode {
  return {
    id,
    type: 'output',
    name: 'Output',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {},
    params: {},
    // No shader - handled by the render graph
  };
}

/**
 * Export output node
 * Renders to a texture for readback/export
 */
export function createExportOutputNode(
  id: string,
  params?: { width?: number; height?: number; format?: string }
): ShaderNode {
  return {
    id,
    type: 'output',
    name: 'Export',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {},
    params: {
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
      format: {
        type: 'select',
        value: params?.format ?? 'rgba8unorm',
        default: 'rgba8unorm',
        options: [
          { label: 'RGBA 8-bit', value: 'rgba8unorm' },
          { label: 'RGBA 16-bit Float', value: 'rgba16float' },
        ],
      },
    },
  };
}

/**
 * Preview output node (lower resolution for performance)
 */
export function createPreviewOutputNode(
  id: string,
  params?: { scale?: number }
): ShaderNode {
  return {
    id,
    type: 'output',
    name: 'Preview',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {},
    params: {
      scale: {
        type: 'number',
        value: params?.scale ?? 0.5,
        default: 0.5,
        min: 0.1,
        max: 1,
        step: 0.1,
      },
    },
  };
}
