import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  GraphRenderer,
  createGraphRenderer,
  SourceTextureInfo,
} from './graph-renderer';
import type { RenderBackend, RenderTexture, BackendCapabilities } from '../backend/types';
import type { CompiledPass } from './types';

// Mock backend for testing
function createMockBackend(): RenderBackend {
  let textureIdCounter = 0;

  const mockBackend: RenderBackend = {
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

  return mockBackend;
}

describe('GraphRenderer', () => {
  let renderer: GraphRenderer;
  let mockBackend: RenderBackend;

  beforeEach(() => {
    renderer = createGraphRenderer();
    mockBackend = createMockBackend();
  });

  describe('backend management', () => {
    it('should set and get backend', () => {
      renderer.setBackend(mockBackend);

      expect(renderer.getBackend()).toBe(mockBackend);
    });

    it('should throw when rendering without backend', () => {
      const passes: CompiledPass[] = [];

      expect(() => renderer.render(passes, { width: 1920, height: 1080 })).toThrow(
        'No render backend set'
      );
    });
  });

  describe('source textures', () => {
    it('should register source textures', () => {
      const sourceInfo: SourceTextureInfo = {
        id: 'video-1',
        texture: { id: 'tex-1', width: 1920, height: 1080, format: 'rgba8unorm' },
        width: 1920,
        height: 1080,
      };

      renderer.registerSourceTexture(sourceInfo);
      // No error means success
    });

    it('should unregister source textures', () => {
      const sourceInfo: SourceTextureInfo = {
        id: 'video-1',
        texture: { id: 'tex-1', width: 1920, height: 1080, format: 'rgba8unorm' },
        width: 1920,
        height: 1080,
      };

      renderer.registerSourceTexture(sourceInfo);
      const result = renderer.unregisterSourceTexture('video-1');

      expect(result).toBe(true);
    });

    it('should clear all source textures', () => {
      const sourceInfo: SourceTextureInfo = {
        id: 'video-1',
        texture: { id: 'tex-1', width: 1920, height: 1080, format: 'rgba8unorm' },
        width: 1920,
        height: 1080,
      };

      renderer.registerSourceTexture(sourceInfo);
      renderer.clearSourceTextures();

      // Unregister should return false since already cleared
      expect(renderer.unregisterSourceTexture('video-1')).toBe(false);
    });
  });

  describe('render', () => {
    beforeEach(() => {
      renderer.setBackend(mockBackend);
    });

    it('should render empty passes', () => {
      const result = renderer.render([], { width: 1920, height: 1080 });

      expect(result.passCount).toBe(0);
      expect(result.renderTime).toBeGreaterThanOrEqual(0);
    });

    it('should render single pass', () => {
      const passes: CompiledPass[] = [
        {
          id: 'pass-0',
          nodes: ['brightness-1'],
          shader: 'test shader',
          inputs: ['source-1'],
          output: 'screen',
          uniforms: { brightness: 1.2 },
        },
      ];

      // Register source texture
      renderer.registerSourceTexture({
        id: 'source-1',
        texture: { id: 'tex-source', width: 1920, height: 1080, format: 'rgba8unorm' },
        width: 1920,
        height: 1080,
      });

      const result = renderer.render(passes, { width: 1920, height: 1080 });

      expect(result.passCount).toBe(1);
      expect(mockBackend.beginPass).toHaveBeenCalled();
      expect(mockBackend.endPass).toHaveBeenCalled();
    });

    it('should return render statistics', () => {
      const passes: CompiledPass[] = [
        {
          id: 'pass-0',
          nodes: ['effect-1'],
          shader: 'shader',
          inputs: ['source-1'],
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

      renderer.registerSourceTexture({
        id: 'source-1',
        texture: { id: 'tex-source', width: 1920, height: 1080, format: 'rgba8unorm' },
        width: 1920,
        height: 1080,
      });

      const result = renderer.render(passes, { width: 1920, height: 1080 });

      expect(result.passCount).toBeGreaterThan(0);
      expect(typeof result.renderTime).toBe('number');
      expect(typeof result.texturesAllocated).toBe('number');
      expect(typeof result.texturesReused).toBe('number');
    });
  });

  describe('pass merging', () => {
    beforeEach(() => {
      renderer.setBackend(mockBackend);
    });

    it('should merge passes when enabled', () => {
      const passes: CompiledPass[] = [
        {
          id: 'pass-0',
          nodes: ['brightness-1'],
          shader: 'shader',
          inputs: ['source-1'],
          output: 'temp-1',
          uniforms: {},
        },
        {
          id: 'pass-1',
          nodes: ['contrast-1'],
          shader: 'shader',
          inputs: ['temp-1'],
          output: 'screen',
          uniforms: {},
        },
      ];

      renderer.registerSourceTexture({
        id: 'source-1',
        texture: { id: 'tex-source', width: 1920, height: 1080, format: 'rgba8unorm' },
        width: 1920,
        height: 1080,
      });

      const result = renderer.render(passes, { width: 1920, height: 1080 });

      // Passes should be merged (2 -> 1)
      expect(result.passCount).toBe(1);
    });

    it('should not merge passes when disabled', () => {
      const noMergeRenderer = createGraphRenderer({ enablePassMerging: false });
      noMergeRenderer.setBackend(mockBackend);

      const passes: CompiledPass[] = [
        {
          id: 'pass-0',
          nodes: ['brightness-1'],
          shader: 'shader',
          inputs: ['source-1'],
          output: 'temp-1',
          uniforms: {},
        },
        {
          id: 'pass-1',
          nodes: ['contrast-1'],
          shader: 'shader',
          inputs: ['temp-1'],
          output: 'screen',
          uniforms: {},
        },
      ];

      noMergeRenderer.registerSourceTexture({
        id: 'source-1',
        texture: { id: 'tex-source', width: 1920, height: 1080, format: 'rgba8unorm' },
        width: 1920,
        height: 1080,
      });

      const result = noMergeRenderer.render(passes, { width: 1920, height: 1080 });

      // Passes should not be merged
      expect(result.passCount).toBe(2);
    });
  });

  describe('renderToTexture', () => {
    beforeEach(() => {
      renderer.setBackend(mockBackend);
    });

    it('should create output texture', () => {
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

      renderer.registerSourceTexture({
        id: 'source-1',
        texture: { id: 'tex-source', width: 1920, height: 1080, format: 'rgba8unorm' },
        width: 1920,
        height: 1080,
      });

      const texture = renderer.renderToTexture(passes, { width: 1920, height: 1080 });

      expect(texture).toBeDefined();
      expect(texture?.width).toBe(1920);
      expect(texture?.height).toBe(1080);
    });
  });

  describe('readPixels', () => {
    beforeEach(() => {
      renderer.setBackend(mockBackend);
    });

    it('should read pixels from texture', async () => {
      const texture: RenderTexture = {
        id: 'tex-1',
        width: 100,
        height: 100,
        format: 'rgba8unorm',
      };

      const pixels = await renderer.readPixels(texture);

      expect(pixels).toBeInstanceOf(Uint8Array);
    });

    it('should return null when no backend', async () => {
      renderer.setBackend(null as unknown as RenderBackend);

      const texture: RenderTexture = {
        id: 'tex-1',
        width: 100,
        height: 100,
        format: 'rgba8unorm',
      };

      const pixels = await renderer.readPixels(texture);

      expect(pixels).toBeNull();
    });
  });

  describe('statistics', () => {
    it('should return pool statistics', () => {
      const stats = renderer.getStats();

      expect(stats.poolSize).toBeDefined();
      expect(stats.inUseTextures).toBeDefined();
      expect(stats.totalAllocations).toBeDefined();
      expect(stats.reuseCount).toBeDefined();
    });
  });

  describe('cleanup', () => {
    it('should clear pool', () => {
      renderer.clearPool();

      const stats = renderer.getStats();
      expect(stats.poolSize).toBe(0);
    });

    it('should dispose renderer', () => {
      renderer.setBackend(mockBackend);
      renderer.dispose();

      expect(renderer.getBackend()).toBeNull();
    });
  });

  describe('options', () => {
    it('should accept custom texture format', () => {
      const customRenderer = createGraphRenderer({ textureFormat: 'rgba16float' });
      customRenderer.setBackend(mockBackend);

      // Renderer created successfully with custom format
      expect(customRenderer).toBeDefined();
    });
  });
});
