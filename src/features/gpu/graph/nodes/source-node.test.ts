import { describe, it, expect } from 'vitest';
import { createTextureSourceNode, createColorSourceNode } from './source-node';

describe('Source Nodes', () => {
  describe('TextureSourceNode', () => {
    it('should create a texture source node', () => {
      const node = createTextureSourceNode('source-1');

      expect(node.id).toBe('source-1');
      expect(node.type).toBe('source');
      expect(node.name).toBe('Texture Source');
      expect(node.outputs.output).toBeDefined();
      expect(node.outputs.output.type).toBe('texture');
    });

    it('should accept texture handle parameter', () => {
      const node = createTextureSourceNode('source-1', { textureId: 'tex-123' });

      expect(node.params.textureId.value).toBe('tex-123');
    });
  });

  describe('ColorSourceNode', () => {
    it('should create a solid color source node', () => {
      const node = createColorSourceNode('color-1');

      expect(node.id).toBe('color-1');
      expect(node.type).toBe('source');
      expect(node.name).toBe('Solid Color');
      expect(node.outputs.output.type).toBe('texture');
    });

    it('should accept color parameter', () => {
      const node = createColorSourceNode('color-1', { color: [1, 0, 0, 1] });

      expect(node.params.color.value).toEqual([1, 0, 0, 1]);
    });

    it('should have shader code', () => {
      const node = createColorSourceNode('color-1');

      expect(node.shader).toBeDefined();
      expect(node.shader?.code).toContain('fn');
    });
  });
});
