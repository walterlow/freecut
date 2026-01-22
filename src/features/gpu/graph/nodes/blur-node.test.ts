import { describe, it, expect } from 'vitest';
import { createBlurNode, createGaussianBlurNode } from './blur-node';

describe('Blur Nodes', () => {
  describe('BlurNode', () => {
    it('should create a box blur node', () => {
      const node = createBlurNode('blur-1');

      expect(node.type).toBe('effect');
      expect(node.name).toBe('Blur');
      expect(node.params.radius).toBeDefined();
    });

    it('should have valid radius range', () => {
      const node = createBlurNode('blur-1');

      expect(node.params.radius.min).toBe(0);
      expect(node.params.radius.max).toBeGreaterThan(0);
    });

    it('should accept initial radius', () => {
      const node = createBlurNode('blur-1', { radius: 5 });

      expect(node.params.radius.value).toBe(5);
    });
  });

  describe('GaussianBlurNode', () => {
    it('should create a gaussian blur node', () => {
      const node = createGaussianBlurNode('gblur-1');

      expect(node.type).toBe('effect');
      expect(node.name).toBe('Gaussian Blur');
      expect(node.params.sigma).toBeDefined();
    });

    it('should have WGSL shader code', () => {
      const node = createGaussianBlurNode('gblur-1');

      expect(node.shader).toBeDefined();
      expect(node.shader?.code).toContain('gaussian');
    });
  });
});
