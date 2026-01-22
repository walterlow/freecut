import { describe, it, expect } from 'vitest';
import {
  createBrightnessNode,
  createContrastNode,
  createSaturationNode,
  createOpacityNode,
} from './effect-nodes';

describe('Effect Nodes', () => {
  describe('BrightnessNode', () => {
    it('should create a brightness effect node', () => {
      const node = createBrightnessNode('brightness-1');

      expect(node.type).toBe('effect');
      expect(node.name).toBe('Brightness');
      expect(node.inputs.input).toBeDefined();
      expect(node.outputs.output).toBeDefined();
      expect(node.params.brightness).toBeDefined();
    });

    it('should have valid brightness range', () => {
      const node = createBrightnessNode('brightness-1');

      expect(node.params.brightness.min).toBe(-1);
      expect(node.params.brightness.max).toBe(1);
      expect(node.params.brightness.default).toBe(0);
    });

    it('should accept initial brightness value', () => {
      const node = createBrightnessNode('brightness-1', { brightness: 0.5 });

      expect(node.params.brightness.value).toBe(0.5);
    });

    it('should have WGSL shader code', () => {
      const node = createBrightnessNode('brightness-1');

      expect(node.shader).toBeDefined();
      expect(node.shader?.code).toContain('brightness');
    });
  });

  describe('ContrastNode', () => {
    it('should create a contrast effect node', () => {
      const node = createContrastNode('contrast-1');

      expect(node.type).toBe('effect');
      expect(node.name).toBe('Contrast');
      expect(node.params.contrast).toBeDefined();
    });

    it('should have valid contrast range', () => {
      const node = createContrastNode('contrast-1');

      expect(node.params.contrast.min).toBe(-1);
      expect(node.params.contrast.max).toBe(1);
    });
  });

  describe('SaturationNode', () => {
    it('should create a saturation effect node', () => {
      const node = createSaturationNode('saturation-1');

      expect(node.type).toBe('effect');
      expect(node.name).toBe('Saturation');
      expect(node.params.saturation).toBeDefined();
    });

    it('should have valid saturation range', () => {
      const node = createSaturationNode('saturation-1');

      expect(node.params.saturation.min).toBe(-1);
      expect(node.params.saturation.max).toBe(1);
    });
  });

  describe('OpacityNode', () => {
    it('should create an opacity effect node', () => {
      const node = createOpacityNode('opacity-1');

      expect(node.type).toBe('effect');
      expect(node.name).toBe('Opacity');
      expect(node.params.opacity).toBeDefined();
    });

    it('should have valid opacity range', () => {
      const node = createOpacityNode('opacity-1');

      expect(node.params.opacity.min).toBe(0);
      expect(node.params.opacity.max).toBe(1);
      expect(node.params.opacity.default).toBe(1);
    });
  });
});
