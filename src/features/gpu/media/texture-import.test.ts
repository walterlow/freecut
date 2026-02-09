import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TextureImporter,
  createTextureImporter,
} from './texture-import';
import type { RenderBackend, BackendCapabilities } from '../backend/types';
import type { DecodedVideoFrame } from './types';

// Mock VideoFrame and ImageBitmap for Node.js environment
class MockVideoFrame {
  displayWidth: number;
  displayHeight: number;
  codedWidth: number;
  codedHeight: number;
  timestamp: number;
  duration: number;
  format: string;
  colorSpace: object;

  constructor(options: { width: number; height: number }) {
    this.displayWidth = options.width;
    this.displayHeight = options.height;
    this.codedWidth = options.width;
    this.codedHeight = options.height;
    this.timestamp = 0;
    this.duration = 33333;
    this.format = 'RGBA';
    this.colorSpace = {};
  }

  copyTo = vi.fn();
  clone = vi.fn();
  close = vi.fn();
}

class MockImageBitmap {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  close = vi.fn();
}

// Stub globals
vi.stubGlobal('VideoFrame', MockVideoFrame);
vi.stubGlobal('ImageBitmap', MockImageBitmap);

/**
 * Create a mock render backend
 */
function createMockBackend(options: {
  supportsExternalTextures?: boolean;
} = {}): RenderBackend {
  let textureId = 0;

  const capabilities: BackendCapabilities = {
    maxTextureSize: 8192,
    supportsFloat16: true,
    supportsComputeShaders: true,
    supportsExternalTextures: options.supportsExternalTextures ?? true,
    maxColorAttachments: 8,
  };

  return {
    name: 'webgpu',
    capabilities,
    init: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
    createTexture: vi.fn((width: number, height: number, format: string) => ({
      id: `tex_${textureId++}`,
      width,
      height,
      format,
    })),
    uploadPixels: vi.fn(),
    importVideoFrame: vi.fn((frame: VideoFrame) => ({
      id: `tex_${textureId++}`,
      width: frame.displayWidth,
      height: frame.displayHeight,
      format: 'rgba8unorm',
    })),
    importImageBitmap: vi.fn((bitmap: ImageBitmap) => ({
      id: `tex_${textureId++}`,
      width: bitmap.width,
      height: bitmap.height,
      format: 'rgba8unorm',
    })),
    beginFrame: vi.fn(),
    endFrame: vi.fn(),
    renderToScreen: vi.fn(),
    renderToTexture: vi.fn(),
    readPixels: vi.fn().mockResolvedValue(new Uint8Array(4)),
  } as unknown as RenderBackend;
}

/**
 * Create a mock decoded frame with Uint8Array data
 */
function createMockPixelFrame(options: {
  frameNumber?: number;
  width?: number;
  height?: number;
} = {}): DecodedVideoFrame {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;

  return {
    frameNumber: options.frameNumber ?? 0,
    timestampMs: (options.frameNumber ?? 0) * 33.33,
    width,
    height,
    format: 'rgba',
    data: new Uint8Array(width * height * 4),
    durationMs: 33.33,
    isKeyframe: (options.frameNumber ?? 0) % 30 === 0,
    source: 'webcodecs',
  };
}

/**
 * Create a mock VideoFrame
 */
function createMockVideoFrame(options: {
  width?: number;
  height?: number;
} = {}): VideoFrame {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;

  return new MockVideoFrame({ width, height }) as unknown as VideoFrame;
}

/**
 * Create a mock ImageBitmap
 */
function createMockImageBitmap(options: {
  width?: number;
  height?: number;
} = {}): ImageBitmap {
  return new MockImageBitmap(
    options.width ?? 1920,
    options.height ?? 1080
  ) as unknown as ImageBitmap;
}

// Mock OffscreenCanvas for ImageBitmap fallback
vi.stubGlobal(
  'OffscreenCanvas',
  class MockOffscreenCanvas {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return {
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({
          data: new Uint8ClampedArray(this.width * this.height * 4),
          width: this.width,
          height: this.height,
        })),
      };
    }
  }
);

describe('Texture Importer', () => {
  let importer: TextureImporter;
  let backend: RenderBackend;

  beforeEach(() => {
    backend = createMockBackend();
    importer = createTextureImporter();
    importer.setBackend(backend);
  });

  afterEach(() => {
    importer.dispose();
  });

  describe('createTextureImporter', () => {
    it('should create an importer with default config', () => {
      const imp = createTextureImporter();
      expect(imp).toBeInstanceOf(TextureImporter);
    });

    it('should create an importer with custom config', () => {
      const imp = createTextureImporter({
        maxPooledPerSize: 8,
        cleanupIntervalMs: 10000,
        maxIdleMs: 20000,
        preferZeroCopy: false,
      });
      expect(imp).toBeInstanceOf(TextureImporter);
    });
  });

  describe('setBackend', () => {
    it('should set the render backend', () => {
      const imp = createTextureImporter();
      imp.setBackend(backend);
      // Should not throw when importing
      const frame = createMockPixelFrame();
      expect(() => imp.import(frame)).not.toThrow();
      imp.dispose();
    });

    it('should throw if backend not set when importing', () => {
      const imp = createTextureImporter();
      const frame = createMockPixelFrame();
      expect(() => imp.import(frame)).toThrow('Render backend not set');
    });
  });

  describe('import with Uint8Array data', () => {
    it('should import pixel data frame', () => {
      const frame = createMockPixelFrame({ frameNumber: 10 });
      const result = importer.import(frame);

      expect(result).toBeDefined();
      expect(result.handle).toBeDefined();
      expect(result.frameNumber).toBe(10);
      expect(backend.createTexture).toHaveBeenCalledWith(1920, 1080, 'rgba8unorm');
      expect(backend.uploadPixels).toHaveBeenCalled();
    });

    it('should handle different frame sizes', () => {
      const frame = createMockPixelFrame({ width: 640, height: 480 });
      const result = importer.import(frame);

      expect(result.handle.width).toBe(640);
      expect(result.handle.height).toBe(480);
    });
  });

  describe('import with VideoFrame data', () => {
    it('should import VideoFrame directly when supported', () => {
      const videoFrame = createMockVideoFrame();
      const frame: DecodedVideoFrame = {
        frameNumber: 0,
        timestampMs: 0,
        width: 1920,
        height: 1080,
        format: 'rgba',
        data: videoFrame,
        durationMs: 33.33,
        isKeyframe: true,
        source: 'webcodecs',
      };

      const result = importer.import(frame);

      expect(result).toBeDefined();
      expect(backend.importVideoFrame).toHaveBeenCalledWith(videoFrame);
    });

    it('should fall back to pixel upload when external textures not supported', () => {
      const noExternalBackend = createMockBackend({ supportsExternalTextures: false });
      importer.setBackend(noExternalBackend);

      const videoFrame = createMockVideoFrame();
      const frame: DecodedVideoFrame = {
        frameNumber: 0,
        timestampMs: 0,
        width: 1920,
        height: 1080,
        format: 'rgba',
        data: videoFrame,
        durationMs: 33.33,
        isKeyframe: true,
        source: 'webcodecs',
      };

      const result = importer.import(frame);

      expect(result).toBeDefined();
      expect(videoFrame.copyTo).toHaveBeenCalled();
      expect(noExternalBackend.uploadPixels).toHaveBeenCalled();
    });

    it('should fall back when preferZeroCopy is false', () => {
      const imp = createTextureImporter({ preferZeroCopy: false });
      imp.setBackend(backend);

      const videoFrame = createMockVideoFrame();
      const frame: DecodedVideoFrame = {
        frameNumber: 0,
        timestampMs: 0,
        width: 1920,
        height: 1080,
        format: 'rgba',
        data: videoFrame,
        durationMs: 33.33,
        isKeyframe: true,
        source: 'webcodecs',
      };

      const result = imp.import(frame);

      expect(result).toBeDefined();
      expect(backend.importVideoFrame).not.toHaveBeenCalled();
      expect(videoFrame.copyTo).toHaveBeenCalled();

      imp.dispose();
    });
  });

  describe('import with ImageBitmap data', () => {
    it('should import ImageBitmap directly when supported', () => {
      const bitmap = createMockImageBitmap();
      const frame: DecodedVideoFrame = {
        frameNumber: 0,
        timestampMs: 0,
        width: 1920,
        height: 1080,
        format: 'rgba',
        data: bitmap,
        durationMs: 33.33,
        isKeyframe: true,
        source: 'webcodecs',
      };

      const result = importer.import(frame);

      expect(result).toBeDefined();
      expect(backend.importImageBitmap).toHaveBeenCalledWith(bitmap);
    });

    it('should fall back to canvas extraction when preferZeroCopy is false', () => {
      const imp = createTextureImporter({ preferZeroCopy: false });
      imp.setBackend(backend);

      const bitmap = createMockImageBitmap();
      const frame: DecodedVideoFrame = {
        frameNumber: 0,
        timestampMs: 0,
        width: 1920,
        height: 1080,
        format: 'rgba',
        data: bitmap,
        durationMs: 33.33,
        isKeyframe: true,
        source: 'webcodecs',
      };

      const result = imp.import(frame);

      expect(result).toBeDefined();
      expect(backend.importImageBitmap).not.toHaveBeenCalled();
      expect(backend.uploadPixels).toHaveBeenCalled();

      imp.dispose();
    });
  });

  describe('texture pooling', () => {
    it('should reuse pooled textures', () => {
      const frame1 = createMockPixelFrame({ frameNumber: 0 });
      const frame2 = createMockPixelFrame({ frameNumber: 1 });

      const result1 = importer.import(frame1);
      importer.release(result1);

      // Clear the mock call history
      vi.mocked(backend.createTexture).mockClear();

      const result2 = importer.import(frame2);

      // Should reuse the pooled texture
      expect(backend.createTexture).not.toHaveBeenCalled();
      expect(result2.handle.id).toBe(result1.handle.id);
    });

    it('should not reuse textures of different sizes', () => {
      const frame1 = createMockPixelFrame({ width: 1920, height: 1080 });
      const frame2 = createMockPixelFrame({ width: 1280, height: 720 });

      const result1 = importer.import(frame1);
      importer.release(result1);

      vi.mocked(backend.createTexture).mockClear();

      const result2 = importer.import(frame2);

      // Should create a new texture
      expect(backend.createTexture).toHaveBeenCalled();
      expect(result2.handle.id).not.toBe(result1.handle.id);
    });

    it('should limit pool size per resolution', () => {
      const imp = createTextureImporter({ maxPooledPerSize: 2 });
      imp.setBackend(backend);

      const frames = [
        createMockPixelFrame({ frameNumber: 0 }),
        createMockPixelFrame({ frameNumber: 1 }),
        createMockPixelFrame({ frameNumber: 2 }),
      ];

      const results = frames.map((f) => imp.import(f));
      results.forEach((r) => imp.release(r));

      const stats = imp.getStats();
      expect(stats.pooledTextures).toBe(2);

      imp.dispose();
    });
  });

  describe('release', () => {
    it('should release texture back to pool', () => {
      const frame = createMockPixelFrame();
      const result = importer.import(frame);

      expect(importer.getStats().pooledInUse).toBe(0);

      importer.release(result);

      expect(importer.getStats().pooledTextures).toBe(1);
    });
  });

  describe('getStats', () => {
    it('should track import statistics', () => {
      expect(importer.getStats().totalImports).toBe(0);

      const frame = createMockPixelFrame();
      importer.import(frame);

      expect(importer.getStats().totalImports).toBe(1);
    });

    it('should track pool statistics', () => {
      const frame1 = createMockPixelFrame({ frameNumber: 0 });
      const frame2 = createMockPixelFrame({ frameNumber: 1 });

      const result1 = importer.import(frame1);
      const result2 = importer.import(frame2);

      // Both are in use (not pooled yet)
      expect(importer.getStats().pooledTextures).toBe(0);

      importer.release(result1);
      expect(importer.getStats().pooledTextures).toBe(1);
      expect(importer.getStats().pooledInUse).toBe(0);

      // Acquire pooled texture
      const result3 = importer.import(createMockPixelFrame({ frameNumber: 2 }));
      expect(importer.getStats().pooledInUse).toBe(1);

      importer.release(result2);
      importer.release(result3);
    });
  });

  describe('clearPool', () => {
    it('should clear all pooled textures', () => {
      const frame1 = createMockPixelFrame({ frameNumber: 0 });
      const frame2 = createMockPixelFrame({ frameNumber: 1 });

      const result1 = importer.import(frame1);
      const result2 = importer.import(frame2);

      importer.release(result1);
      importer.release(result2);

      expect(importer.getStats().pooledTextures).toBe(2);

      importer.clearPool();

      expect(importer.getStats().pooledTextures).toBe(0);
    });
  });

  describe('dispose', () => {
    it('should dispose and clear pool', () => {
      const frame = createMockPixelFrame();
      const result = importer.import(frame);
      importer.release(result);

      importer.dispose();

      expect(importer.getStats().pooledTextures).toBe(0);
    });
  });

  describe('pixel format conversion', () => {
    it('should handle rgba format', () => {
      const frame = createMockPixelFrame();
      frame.format = 'rgba';

      const result = importer.import(frame);

      expect(result.handle.format).toBe('rgba8unorm');
    });

    it('should convert rgb to rgba', () => {
      const frame = createMockPixelFrame();
      frame.format = 'rgb';

      const result = importer.import(frame);

      expect(result.handle.format).toBe('rgba8unorm');
    });

    it('should convert yuv formats to rgba', () => {
      const frame = createMockPixelFrame();
      frame.format = 'yuv420';

      const result = importer.import(frame);

      expect(result.handle.format).toBe('rgba8unorm');
    });
  });

  describe('frame metadata', () => {
    it('should preserve frame number', () => {
      const frame = createMockPixelFrame({ frameNumber: 42 });
      const result = importer.import(frame);

      expect(result.frameNumber).toBe(42);
    });

    it('should preserve timestamp', () => {
      const frame = createMockPixelFrame({ frameNumber: 30 });
      const result = importer.import(frame);

      expect(result.timestampMs).toBeCloseTo(30 * 33.33, 1);
    });
  });
});
