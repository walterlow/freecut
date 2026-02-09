import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShaderGraphBuilder } from './shader-graph';
import { GraphCompiler } from './compiler';
import { ResourcePool } from './resource-pool';
import { RenderGraph } from './render-graph';
import { GraphRenderer, createGraphRenderer } from './graph-renderer';
import { PassMerger } from './pass-merger';
import { createCompositor } from './compositor';
import { createTextureSourceNode } from './nodes/source-node';
import { createBrightnessNode, createContrastNode, createSaturationNode } from './nodes/effect-nodes';
import { createScaleNode, createRotateNode } from './nodes/transform-node';
import { createOutputNode } from './nodes/output-node';
import type { RenderBackend, BackendCapabilities } from '../backend/types';

// Mock backend for testing
function createMockBackend(): RenderBackend {
  let textureIdCounter = 0;

  return {
    type: 'webgl2',
    initialize: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    getCapabilities: vi.fn().mockReturnValue({
      maxTextureSize: 4096,
      maxTextures: 16,
      features: new Set(['readback']),
    } as BackendCapabilities),
    createTexture: vi.fn().mockImplementation((desc) => ({
      id: `tex-${++textureIdCounter}`,
      width: desc.width,
      height: desc.height,
      format: desc.format,
    })),
    deleteTexture: vi.fn(),
    beginPass: vi.fn(),
    endPass: vi.fn(),
    setUniform: vi.fn(),
    bindTexture: vi.fn(),
    drawFullscreenQuad: vi.fn(),
    readPixels: vi.fn().mockResolvedValue(new Uint8Array(100)),
    resize: vi.fn(),
    present: vi.fn(),
  };
}

describe('Render Graph Integration', () => {
  describe('full pipeline: graph → compile → execute', () => {
    it('should execute a simple brightness effect chain', () => {
      // Build graph
      const graph = new ShaderGraphBuilder('test-graph');
      const sourceNode = createTextureSourceNode('source', { textureId: 'video-1' });
      const brightnessNode = createBrightnessNode('brightness', { brightness: 1.2 });
      const outputNode = createOutputNode('output');

      graph.addNode(sourceNode);
      graph.addNode(brightnessNode);
      graph.addNode(outputNode);

      graph.connect('source', 'output', 'brightness', 'input');
      graph.connect('brightness', 'output', 'output', 'input');

      // Compile
      const compiler = new GraphCompiler();
      const passes = compiler.compile(graph.toGraph());

      // Execute via render graph
      const pool = new ResourcePool();
      const renderGraph = new RenderGraph(pool);

      const executedPasses: string[] = [];
      renderGraph.onPassExecute = (pass) => {
        executedPasses.push(pass.id);
      };

      renderGraph.setSourceTexture('source', { id: 'video-tex' });
      renderGraph.execute(passes, { width: 1920, height: 1080 });

      expect(executedPasses.length).toBeGreaterThan(0);
    });

    it('should execute a multi-effect chain', () => {
      const graph = new ShaderGraphBuilder('multi-effect');
      graph.addNode(createTextureSourceNode('source', { textureId: 'input' }));
      graph.addNode(createBrightnessNode('brightness', { brightness: 1.1 }));
      graph.addNode(createContrastNode('contrast', { contrast: 1.2 }));
      graph.addNode(createSaturationNode('saturation', { saturation: 1.3 }));
      graph.addNode(createOutputNode('output'));

      graph.connect('source', 'output', 'brightness', 'input');
      graph.connect('brightness', 'output', 'contrast', 'input');
      graph.connect('contrast', 'output', 'saturation', 'input');
      graph.connect('saturation', 'output', 'output', 'input');

      const compiler = new GraphCompiler();
      const passes = compiler.compile(graph.toGraph());

      const pool = new ResourcePool();
      const renderGraph = new RenderGraph(pool);

      let passCount = 0;
      renderGraph.onPassExecute = () => passCount++;

      renderGraph.execute(passes, { width: 1920, height: 1080 });

      // Should execute multiple passes (one per effect)
      expect(passCount).toBeGreaterThanOrEqual(3);
    });

    it('should handle transform + effect chain', () => {
      const graph = new ShaderGraphBuilder('transform-effect');
      graph.addNode(createTextureSourceNode('source', { textureId: 'input' }));
      graph.addNode(createScaleNode('scale', { uniform: 0.5 }));
      graph.addNode(createRotateNode('rotate', { rotation: 45 }));
      graph.addNode(createBrightnessNode('brightness', { brightness: 1.2 }));
      graph.addNode(createOutputNode('output'));

      graph.connect('source', 'output', 'scale', 'input');
      graph.connect('scale', 'output', 'rotate', 'input');
      graph.connect('rotate', 'output', 'brightness', 'input');
      graph.connect('brightness', 'output', 'output', 'input');

      const compiler = new GraphCompiler();
      const passes = compiler.compile(graph.toGraph());

      expect(passes.length).toBeGreaterThan(0);
    });
  });

  describe('pass merging optimization', () => {
    it('should merge adjacent color correction passes', () => {
      // Test pass merger directly with mergeable passes
      const mergablePasses = [
        {
          id: 'pass-0',
          nodes: ['brightness-1'],
          shader: 'shader-a',
          inputs: ['source'],
          output: 'temp-1',
          uniforms: { brightness: 1.1 },
        },
        {
          id: 'pass-1',
          nodes: ['contrast-1'],
          shader: 'shader-b',
          inputs: ['temp-1'],
          output: 'temp-2',
          uniforms: { contrast: 1.2 },
        },
        {
          id: 'pass-2',
          nodes: ['saturation-1'],
          shader: 'shader-c',
          inputs: ['temp-2'],
          output: 'screen',
          uniforms: { saturation: 1.0 },
        },
      ];

      const merger = new PassMerger();
      const mergeResult = merger.merge(mergablePasses);

      // Should reduce pass count through merging (3 -> 1)
      expect(mergeResult.mergedCount).toBe(2);
      expect(mergeResult.passes.length).toBe(1);
      expect(mergeResult.originalCount).toBe(3);
    });

    it('should not merge incompatible passes', () => {
      const graph = new ShaderGraphBuilder('no-merge-test');
      graph.addNode(createTextureSourceNode('source', { textureId: 'input' }));
      graph.addNode(createBrightnessNode('brightness', { brightness: 1.1 }));
      graph.addNode(createScaleNode('scale', { uniform: 0.5 })); // Transform - different category
      graph.addNode(createOutputNode('output'));

      graph.connect('source', 'output', 'brightness', 'input');
      graph.connect('brightness', 'output', 'scale', 'input');
      graph.connect('scale', 'output', 'output', 'input');

      const compiler = new GraphCompiler();
      const originalPasses = compiler.compile(graph.toGraph());

      const merger = new PassMerger();
      const mergeResult = merger.merge(originalPasses);

      // Brightness and scale should not merge (different categories)
      expect(mergeResult.passes.length).toBe(mergeResult.originalCount);
    });
  });

  describe('multi-layer compositing', () => {
    it('should build and compile a two-layer composition', () => {
      const compositor = createCompositor();
      compositor.setSettings({ width: 1920, height: 1080 });

      compositor.addLayer({
        id: 'background',
        sourceId: 'video-bg',
        visible: true,
        opacity: 1.0,
        blendMode: 'normal',
        zIndex: 0,
      });

      compositor.addLayer({
        id: 'foreground',
        sourceId: 'video-fg',
        visible: true,
        opacity: 0.8,
        blendMode: 'screen',
        zIndex: 1,
      });

      const result = compositor.build();

      expect(result.layerOrder).toEqual(['background', 'foreground']);
      expect(result.passes.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle layer with effects and transforms', () => {
      const compositor = createCompositor();

      compositor.addLayer({
        id: 'layer-1',
        sourceId: 'video-1',
        visible: true,
        opacity: 0.5,
        blendMode: 'multiply',
        zIndex: 0,
        transform: {
          scaleX: 0.8,
          scaleY: 0.8,
          rotation: 15,
        },
      });

      const result = compositor.build();

      // Should have source, transform, opacity nodes
      const graphJson = result.graph.toJSON();
      const nodeNames = graphJson.nodes.map((n) => n.name);
      expect(nodeNames).toContain('Texture Source');
      expect(nodeNames).toContain('transform');
      expect(nodeNames).toContain('Opacity');
    });

    it('should handle three-layer composition with different blend modes', () => {
      const compositor = createCompositor();

      compositor.addLayer({
        id: 'layer-1',
        sourceId: 'video-1',
        visible: true,
        opacity: 1.0,
        blendMode: 'normal',
        zIndex: 0,
      });

      compositor.addLayer({
        id: 'layer-2',
        sourceId: 'video-2',
        visible: true,
        opacity: 1.0,
        blendMode: 'multiply',
        zIndex: 1,
      });

      compositor.addLayer({
        id: 'layer-3',
        sourceId: 'video-3',
        visible: true,
        opacity: 1.0,
        blendMode: 'screen',
        zIndex: 2,
      });

      compositor.build();

      // Should have 2 blend operations (3 layers = 2 blends)
      const stats = compositor.getStats();
      expect(stats.blendOperations).toBe(2);
    });
  });

  describe('resource pool efficiency', () => {
    it('should reuse textures across frames', () => {
      const pool = new ResourcePool();
      const renderGraph = new RenderGraph(pool);

      const passes = [
        {
          id: 'pass-0',
          nodes: ['effect-1'],
          shader: 'shader',
          inputs: ['source'],
          output: 'temp-1',
          uniforms: {},
        },
        {
          id: 'pass-1',
          nodes: ['effect-2'],
          shader: 'shader',
          inputs: ['temp-1'],
          output: 'screen',
          uniforms: {},
        },
      ];

      // First frame
      renderGraph.execute(passes, { width: 1920, height: 1080 });
      const allocsFrame1 = pool.getTotalAllocations();

      // Second frame - should reuse textures
      renderGraph.execute(passes, { width: 1920, height: 1080 });
      const reuseCount = pool.getReuseCount();

      expect(reuseCount).toBeGreaterThan(0);
      // Allocations shouldn't double
      expect(pool.getTotalAllocations()).toBe(allocsFrame1);
    });

    it('should handle resolution changes', () => {
      const pool = new ResourcePool();
      const renderGraph = new RenderGraph(pool);

      const passes = [
        {
          id: 'pass-0',
          nodes: ['effect-1'],
          shader: 'shader',
          inputs: ['source'],
          output: 'temp-1',
          uniforms: {},
        },
      ];

      // First frame at 1080p
      renderGraph.execute(passes, { width: 1920, height: 1080 });
      const allocsAfter1080 = pool.getTotalAllocations();

      // Second frame at 720p - needs new textures
      renderGraph.execute(passes, { width: 1280, height: 720 });
      const allocsAfter720 = pool.getTotalAllocations();

      // Should allocate new textures for different resolution
      expect(allocsAfter720).toBeGreaterThan(allocsAfter1080);
    });
  });

  describe('GraphRenderer integration', () => {
    let renderer: GraphRenderer;
    let mockBackend: RenderBackend;

    beforeEach(() => {
      renderer = createGraphRenderer();
      mockBackend = createMockBackend();
      renderer.setBackend(mockBackend);
    });

    it('should render compositor output', () => {
      const compositor = createCompositor();

      compositor.addLayer({
        id: 'layer-1',
        sourceId: 'video-1',
        visible: true,
        opacity: 1.0,
        blendMode: 'normal',
        zIndex: 0,
      });

      const compositorResult = compositor.build();

      // Register source textures
      renderer.registerSourceTexture({
        id: 'video-1',
        texture: { id: 'tex-1', width: 1920, height: 1080, format: 'rgba8unorm' },
        width: 1920,
        height: 1080,
      });

      const renderResult = renderer.render(compositorResult.passes, { width: 1920, height: 1080 });

      expect(renderResult.renderTime).toBeGreaterThanOrEqual(0);
      expect(mockBackend.beginPass).toHaveBeenCalled();
    });

    it('should export to texture', () => {
      const compositor = createCompositor();

      compositor.addLayer({
        id: 'layer-1',
        sourceId: 'video-1',
        visible: true,
        opacity: 1.0,
        blendMode: 'normal',
        zIndex: 0,
      });

      const compositorResult = compositor.build();

      renderer.registerSourceTexture({
        id: 'video-1',
        texture: { id: 'tex-1', width: 1920, height: 1080, format: 'rgba8unorm' },
        width: 1920,
        height: 1080,
      });

      const outputTexture = renderer.renderToTexture(compositorResult.passes, {
        width: 1920,
        height: 1080,
      });

      expect(outputTexture).toBeDefined();
      expect(outputTexture?.width).toBe(1920);
      expect(outputTexture?.height).toBe(1080);
    });
  });

  describe('error handling', () => {
    it('should detect cycles in graph', () => {
      const graph = new ShaderGraphBuilder('cycle-test');
      graph.addNode(createBrightnessNode('a', { brightness: 1.0 }));
      graph.addNode(createContrastNode('b', { contrast: 1.0 }));

      graph.connect('a', 'output', 'b', 'input');

      // Connecting b->a would create a cycle
      expect(() => {
        graph.connect('b', 'output', 'a', 'input');
      }).toThrow('cycle');
    });

    it('should handle missing node gracefully', () => {
      const graph = new ShaderGraphBuilder('missing-test');
      graph.addNode(createBrightnessNode('brightness', { brightness: 1.0 }));

      expect(() => {
        graph.connect('nonexistent', 'output', 'brightness', 'input');
      }).toThrow();
    });
  });
});
