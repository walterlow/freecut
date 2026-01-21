import { describe, it, expect } from 'vitest';
import type {
  ShaderNode,
  NodeInput,
  NodeOutput,
  Connection,
  ShaderGraph,
  NodeType,
  DataType,
} from './types';

describe('Graph Types', () => {
  it('should define node types correctly', () => {
    const nodeTypes: NodeType[] = ['source', 'effect', 'blend', 'transform', 'output'];
    expect(nodeTypes).toHaveLength(5);
  });

  it('should define data types correctly', () => {
    const dataTypes: DataType[] = ['color', 'alpha', 'number', 'vec2', 'vec4', 'texture'];
    expect(dataTypes).toHaveLength(6);
  });

  it('should allow creating a valid ShaderNode', () => {
    const node: ShaderNode = {
      id: 'brightness-1',
      type: 'effect',
      name: 'Brightness',
      inputs: {
        input: { name: 'input', type: 'texture', required: true },
      },
      outputs: {
        output: { name: 'output', type: 'texture' },
      },
      params: {
        brightness: { type: 'number', value: 0, min: -1, max: 1, default: 0 },
      },
    };

    expect(node.id).toBe('brightness-1');
    expect(node.type).toBe('effect');
    expect(node.inputs.input.type).toBe('texture');
  });

  it('should allow creating connections between nodes', () => {
    const connection: Connection = {
      id: 'conn-1',
      from: { nodeId: 'source-1', output: 'output' },
      to: { nodeId: 'effect-1', input: 'input' },
    };

    expect(connection.from.nodeId).toBe('source-1');
    expect(connection.to.nodeId).toBe('effect-1');
  });
});
