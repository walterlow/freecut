import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CanvasBackend } from './canvas-backend';

// Mock ImageData for jsdom environment
class MockImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;

  constructor(data: Uint8ClampedArray, width: number, height?: number) {
    this.data = data;
    this.width = width;
    this.height = height ?? data.length / (width * 4);
  }
}

// @ts-expect-error - mocking global ImageData
globalThis.ImageData = MockImageData;

describe('CanvasBackend', () => {
  let backend: CanvasBackend;
  let mockCanvas: HTMLCanvasElement;
  let mockContext: CanvasRenderingContext2D;

  // Mock for offscreen canvas contexts created during createTexture
  const createMockContext = () => ({
    drawImage: vi.fn(),
    getImageData: vi.fn().mockReturnValue({
      data: new Uint8ClampedArray(100 * 100 * 4),
    }),
    putImageData: vi.fn(),
    clearRect: vi.fn(),
    canvas: { width: 100, height: 100 },
  });

  beforeEach(() => {
    mockContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn().mockReturnValue({
        data: new Uint8ClampedArray(100 * 100 * 4),
      }),
      putImageData: vi.fn(),
      clearRect: vi.fn(),
      canvas: { width: 1920, height: 1080 },
    } as unknown as CanvasRenderingContext2D;

    mockCanvas = {
      getContext: vi.fn().mockReturnValue(mockContext),
      width: 1920,
      height: 1080,
    } as unknown as HTMLCanvasElement;

    // Mock document.createElement to return a canvas with a working 2d context
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'canvas') {
        const offscreenContext = createMockContext();
        return {
          width: 0,
          height: 0,
          getContext: vi.fn().mockReturnValue(offscreenContext),
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    });

    backend = new CanvasBackend();
  });

  describe('initialization', () => {
    it('should have correct name', () => {
      expect(backend.name).toBe('canvas');
    });

    it('should report limited capabilities', () => {
      expect(backend.capabilities.supportsComputeShaders).toBe(false);
      expect(backend.capabilities.supportsExternalTextures).toBe(false);
      expect(backend.capabilities.supportsFloat16).toBe(false);
    });

    it('should initialize with canvas', async () => {
      await backend.init(mockCanvas);
      expect(mockCanvas.getContext).toHaveBeenCalledWith('2d');
    });

    it('should throw error if context is not available', async () => {
      const failingCanvas = {
        getContext: vi.fn().mockReturnValue(null),
        width: 1920,
        height: 1080,
      } as unknown as HTMLCanvasElement;

      await expect(backend.init(failingCanvas)).rejects.toThrow(
        'Failed to get Canvas 2D context'
      );
    });
  });

  describe('texture management', () => {
    beforeEach(async () => {
      await backend.init(mockCanvas);
    });

    it('should create texture with correct dimensions', () => {
      const handle = backend.createTexture(100, 100, 'rgba8unorm');

      expect(handle.width).toBe(100);
      expect(handle.height).toBe(100);
      expect(handle.format).toBe('rgba8unorm');
      expect(handle.id).toBeDefined();
    });

    it('should create textures with unique IDs', () => {
      const handle1 = backend.createTexture(100, 100, 'rgba8unorm');
      const handle2 = backend.createTexture(200, 200, 'rgba8unorm');

      expect(handle1.id).not.toBe(handle2.id);
    });

    it('should upload pixels to texture', () => {
      const handle = backend.createTexture(100, 100, 'rgba8unorm');
      const pixels = new Uint8Array(100 * 100 * 4);

      expect(() => backend.uploadPixels(handle, pixels)).not.toThrow();
    });

    it('should throw when uploading to non-existent texture', () => {
      const fakeHandle = { id: 'fake', width: 100, height: 100, format: 'rgba8unorm' as const };
      const pixels = new Uint8Array(100 * 100 * 4);

      expect(() => backend.uploadPixels(fakeHandle, pixels)).toThrow('Texture not found: fake');
    });

    it('should release texture', async () => {
      const handle = backend.createTexture(100, 100, 'rgba8unorm');
      backend.releaseTexture(handle);

      // After release, reading should fail
      await expect(backend.readPixels(handle)).rejects.toThrow('Texture not found');
    });
  });

  describe('rendering', () => {
    beforeEach(async () => {
      await backend.init(mockCanvas);
    });

    it('should render texture to screen', () => {
      const handle = backend.createTexture(100, 100, 'rgba8unorm');

      backend.beginFrame();
      backend.renderToScreen(handle);
      backend.endFrame();

      expect(mockContext.drawImage).toHaveBeenCalled();
    });

    it('should clear on beginFrame', () => {
      backend.beginFrame();

      expect(mockContext.clearRect).toHaveBeenCalledWith(0, 0, 1920, 1080);
    });

    it('should handle renderToScreen with non-existent texture gracefully', () => {
      const fakeHandle = { id: 'fake', width: 100, height: 100, format: 'rgba8unorm' as const };

      expect(() => backend.renderToScreen(fakeHandle)).not.toThrow();
    });
  });

  describe('readback', () => {
    beforeEach(async () => {
      await backend.init(mockCanvas);
    });

    it('should read pixels from texture', async () => {
      const handle = backend.createTexture(100, 100, 'rgba8unorm');
      const pixels = await backend.readPixels(handle);

      expect(pixels).toBeInstanceOf(Uint8Array);
      expect(pixels.length).toBe(100 * 100 * 4);
    });

    it('should throw when reading from non-existent texture', async () => {
      const fakeHandle = { id: 'fake', width: 100, height: 100, format: 'rgba8unorm' as const };

      await expect(backend.readPixels(fakeHandle)).rejects.toThrow('Texture not found: fake');
    });
  });

  describe('destroy', () => {
    it('should clean up resources on destroy', async () => {
      await backend.init(mockCanvas);
      backend.createTexture(100, 100, 'rgba8unorm');

      backend.destroy();

      // After destroy, operations should not throw but may be no-ops
      expect(() => backend.beginFrame()).not.toThrow();
      expect(() => backend.endFrame()).not.toThrow();
    });
  });
});
