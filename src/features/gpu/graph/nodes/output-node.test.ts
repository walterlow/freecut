import { describe, it, expect } from 'vitest';
import { createOutputNode, createExportOutputNode } from './output-node';

describe('Output Nodes', () => {
  describe('OutputNode', () => {
    it('should create a screen output node', () => {
      const node = createOutputNode('output-1');

      expect(node.type).toBe('output');
      expect(node.name).toBe('Output');
      expect(node.inputs.input).toBeDefined();
      expect(node.inputs.input.required).toBe(true);
      expect(Object.keys(node.outputs)).toHaveLength(0);
    });
  });

  describe('ExportOutputNode', () => {
    it('should create an export output node', () => {
      const node = createExportOutputNode('export-1');

      expect(node.type).toBe('output');
      expect(node.name).toBe('Export');
      expect(node.params.width).toBeDefined();
      expect(node.params.height).toBeDefined();
    });

    it('should accept resolution parameters', () => {
      const node = createExportOutputNode('export-1', {
        width: 3840,
        height: 2160,
      });

      expect(node.params.width.value).toBe(3840);
      expect(node.params.height.value).toBe(2160);
    });
  });
});
