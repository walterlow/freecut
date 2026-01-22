import { describe, it, expect, beforeEach } from 'vitest';
import { NodeRegistry } from '../node-registry';
import { registerBuiltinNodes } from './index';

describe('Built-in Node Registration', () => {
  let registry: NodeRegistry;

  beforeEach(() => {
    registry = new NodeRegistry();
    registerBuiltinNodes(registry);
  });

  it('should register source nodes', () => {
    expect(registry.has('texture-source')).toBe(true);
    expect(registry.has('color-source')).toBe(true);
    expect(registry.has('gradient-source')).toBe(true);
  });

  it('should register effect nodes', () => {
    expect(registry.has('brightness')).toBe(true);
    expect(registry.has('contrast')).toBe(true);
    expect(registry.has('saturation')).toBe(true);
    expect(registry.has('opacity')).toBe(true);
    expect(registry.has('brightness-contrast')).toBe(true);
  });

  it('should register blur nodes', () => {
    expect(registry.has('blur')).toBe(true);
    expect(registry.has('gaussian-blur')).toBe(true);
    expect(registry.has('fast-blur')).toBe(true);
  });

  it('should register output nodes', () => {
    expect(registry.has('output')).toBe(true);
    expect(registry.has('export-output')).toBe(true);
    expect(registry.has('preview-output')).toBe(true);
  });

  it('should create nodes from registry', () => {
    const brightness = registry.create('brightness', 'b-1', { brightness: 0.3 });
    expect(brightness.name).toBe('Brightness');
    expect(brightness.params.brightness.value).toBe(0.3);

    const blur = registry.create('blur', 'blur-1', { radius: 5 });
    expect(blur.name).toBe('Blur');
    expect(blur.params.radius.value).toBe(5);
  });
});
