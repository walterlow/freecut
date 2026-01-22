import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RenderGraph } from './render-graph';
import { ResourcePool } from './resource-pool';
import type { CompiledPass } from './types';

describe('RenderGraph', () => {
  let renderGraph: RenderGraph;
  let pool: ResourcePool;

  beforeEach(() => {
    pool = new ResourcePool();
    renderGraph = new RenderGraph(pool);
  });

  describe('pass execution', () => {
    it('should execute a single pass', () => {
      const passes: CompiledPass[] = [
        {
          id: 'pass-0',
          nodes: ['effect-1'],
          shader: 'test shader',
          inputs: ['source-1'],
          output: 'screen',
          uniforms: { brightness: 0.5 },
        },
      ];

      const executedPasses: string[] = [];
      renderGraph.onPassExecute = (pass) => {
        executedPasses.push(pass.id);
      };

      renderGraph.execute(passes, { width: 1920, height: 1080 });

      expect(executedPasses).toContain('pass-0');
    });

    it('should execute passes in order', () => {
      const passes: CompiledPass[] = [
        {
          id: 'pass-0',
          nodes: ['effect-1'],
          shader: 'shader1',
          inputs: ['source-1'],
          output: 'temp-1',
          uniforms: {},
        },
        {
          id: 'pass-1',
          nodes: ['effect-2'],
          shader: 'shader2',
          inputs: ['temp-1'],
          output: 'temp-2',
          uniforms: {},
        },
        {
          id: 'pass-2',
          nodes: ['effect-3'],
          shader: 'shader3',
          inputs: ['temp-2'],
          output: 'screen',
          uniforms: {},
        },
      ];

      const executedPasses: string[] = [];
      renderGraph.onPassExecute = (pass) => {
        executedPasses.push(pass.id);
      };

      renderGraph.execute(passes, { width: 1920, height: 1080 });

      expect(executedPasses).toEqual(['pass-0', 'pass-1', 'pass-2']);
    });

    it('should allocate textures for intermediate passes', () => {
      const passes: CompiledPass[] = [
        {
          id: 'pass-0',
          nodes: ['effect-1'],
          shader: 'shader',
          inputs: ['source-1'],
          output: 'temp-1',
          uniforms: {},
        },
      ];

      renderGraph.execute(passes, { width: 1920, height: 1080 });

      // Should have allocated a texture for temp-1
      expect(pool.getTotalAllocations()).toBeGreaterThan(0);
    });

    it('should not allocate for screen output', () => {
      const passes: CompiledPass[] = [
        {
          id: 'pass-0',
          nodes: ['effect-1'],
          shader: 'shader',
          inputs: ['source-1'],
          output: 'screen',
          uniforms: {},
        },
      ];

      renderGraph.execute(passes, { width: 1920, height: 1080 });

      // screen output doesn't need texture allocation
      expect(pool.getTotalAllocations()).toBe(0);
    });
  });

  describe('texture mapping', () => {
    it('should track output textures by pass output name', () => {
      const passes: CompiledPass[] = [
        {
          id: 'pass-0',
          nodes: ['effect-1'],
          shader: 'shader',
          inputs: ['source-1'],
          output: 'intermediate',
          uniforms: {},
        },
        {
          id: 'pass-1',
          nodes: ['effect-2'],
          shader: 'shader2',
          inputs: ['intermediate'],
          output: 'screen',
          uniforms: {},
        },
      ];

      let intermediateTexture: unknown;
      renderGraph.onPassExecute = (pass, context) => {
        if (pass.id === 'pass-1') {
          intermediateTexture = context.inputTextures.get('intermediate');
        }
      };

      renderGraph.execute(passes, { width: 1920, height: 1080 });

      // The intermediate texture should have been passed to pass-1
      expect(intermediateTexture).toBeDefined();
    });

    it('should provide input textures to subsequent passes', () => {
      const passes: CompiledPass[] = [
        {
          id: 'pass-0',
          nodes: ['effect-1'],
          shader: 'shader1',
          inputs: ['source-1'],
          output: 'temp-1',
          uniforms: {},
        },
        {
          id: 'pass-1',
          nodes: ['effect-2'],
          shader: 'shader2',
          inputs: ['temp-1'],
          output: 'screen',
          uniforms: {},
        },
      ];

      let pass1InputTexture: unknown;
      renderGraph.onPassExecute = (pass, context) => {
        if (pass.id === 'pass-1') {
          pass1InputTexture = context.inputTextures.get('temp-1');
        }
      };

      renderGraph.execute(passes, { width: 1920, height: 1080 });

      expect(pass1InputTexture).toBeDefined();
    });
  });

  describe('frame lifecycle', () => {
    it('should begin and end frame on pool', () => {
      const beginSpy = vi.spyOn(pool, 'beginFrame');
      const endSpy = vi.spyOn(pool, 'endFrame');

      renderGraph.execute([], { width: 1920, height: 1080 });

      expect(beginSpy).toHaveBeenCalled();
      expect(endSpy).toHaveBeenCalled();
    });

    it('should clear texture mapping after frame', () => {
      const passes: CompiledPass[] = [
        {
          id: 'pass-0',
          nodes: ['effect-1'],
          shader: 'shader',
          inputs: ['source-1'],
          output: 'temp-1',
          uniforms: {},
        },
      ];

      renderGraph.execute(passes, { width: 1920, height: 1080 });

      // After frame, should clear
      expect(renderGraph.getTextureForOutput('temp-1')).toBeUndefined();
    });
  });

  describe('source textures', () => {
    it('should accept external source textures', () => {
      const sourceTexture = { id: 'external-source', width: 1920, height: 1080 };

      renderGraph.setSourceTexture('source-1', sourceTexture);

      const passes: CompiledPass[] = [
        {
          id: 'pass-0',
          nodes: ['effect-1'],
          shader: 'shader',
          inputs: ['source-1'],
          output: 'screen',
          uniforms: {},
        },
      ];

      let inputTexture: unknown;
      renderGraph.onPassExecute = (pass, context) => {
        inputTexture = context.inputTextures.get('source-1');
      };

      renderGraph.execute(passes, { width: 1920, height: 1080 });

      expect(inputTexture).toBe(sourceTexture);
    });
  });
});
