import { describe, it, expect, beforeEach } from 'vitest';
import { NodeRegistry } from './node-registry';

describe('NodeRegistry', () => {
  let registry: NodeRegistry;

  beforeEach(() => {
    registry = new NodeRegistry();
  });

  it('should start empty', () => {
    expect(registry.getNames()).toHaveLength(0);
  });

  it('should register a node factory', () => {
    registry.register('test-node', (id) => ({
      id,
      type: 'effect',
      name: 'Test Node',
      inputs: {},
      outputs: {},
      params: {},
    }));

    expect(registry.getNames()).toContain('test-node');
  });

  it('should create nodes from registered factories', () => {
    registry.register('brightness', (id, params) => ({
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
        value: { type: 'number', value: params?.value ?? 0, default: 0, min: -1, max: 1 },
      },
    }));

    const node = registry.create('brightness', 'brightness-1', { value: 0.5 });

    expect(node.id).toBe('brightness-1');
    expect(node.name).toBe('Brightness');
    expect(node.params.value.value).toBe(0.5);
  });

  it('should throw when creating unregistered node', () => {
    expect(() => registry.create('unknown', 'id-1')).toThrow(/not registered/);
  });

  it('should check if a node type exists', () => {
    registry.register('blur', (id) => ({
      id,
      type: 'effect',
      name: 'Blur',
      inputs: {},
      outputs: {},
      params: {},
    }));

    expect(registry.has('blur')).toBe(true);
    expect(registry.has('sharpen')).toBe(false);
  });
});
