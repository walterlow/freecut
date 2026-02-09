/**
 * Media System Integration Tests
 *
 * Tests the complete media pipeline from source loading to GPU texture import.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Types
import type { DecodedVideoFrame } from './types';
import type { RenderBackend, BackendCapabilities } from '../backend/types';

// Components
import { createFrameCache, FrameCache } from './frame-cache';
import { createMediaSourceManager, MediaSourceManager } from './media-source-manager';
import { createPrefetcher, FramePrefetcher } from './prefetch';
import { createTextureImporter, TextureImporter } from './texture-import';

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

vi.stubGlobal('VideoFrame', MockVideoFrame);
vi.stubGlobal('ImageBitmap', MockImageBitmap);

// Mock video element
const mockVideoElement = {
  preload: '',
  muted: false,
  src: '',
  currentTime: 0,
  duration: 60,
  videoWidth: 1920,
  videoHeight: 1080,
  load: vi.fn(),
  onloadedmetadata: null as ((ev: Event) => void) | null,
  onerror: null as ((ev: Event) => void) | null,
  addEventListener: vi.fn((event: string, handler: () => void) => {
    if (event === 'seeked') {
      setTimeout(handler, 0);
    }
  }),
  removeEventListener: vi.fn(),
};

// Mock canvas for frame extraction
const mockCanvas = {
  width: 0,
  height: 0,
  getContext: vi.fn(() => ({
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({
      data: new Uint8ClampedArray(1920 * 1080 * 4),
      width: 1920,
      height: 1080,
    })),
  })),
};

// Mock document.createElement
vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
  if (tagName === 'video') {
    setTimeout(() => {
      if (mockVideoElement.onloadedmetadata) {
        mockVideoElement.onloadedmetadata(new Event('loadedmetadata'));
      }
    }, 0);
    return mockVideoElement as unknown as HTMLElement;
  }
  if (tagName === 'canvas') {
    return mockCanvas as unknown as HTMLElement;
  }
  return document.createElement.call(document, tagName);
});

// Mock URL APIs
vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

// Mock OffscreenCanvas
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

/**
 * Create a mock render backend
 */
function createMockBackend(): RenderBackend {
  let textureId = 0;

  const capabilities: BackendCapabilities = {
    maxTextureSize: 8192,
    supportsFloat16: true,
    supportsComputeShaders: true,
    supportsExternalTextures: true,
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

describe('Media System Integration', () => {
  let cache: FrameCache;
  let manager: MediaSourceManager;
  let prefetcher: FramePrefetcher;
  let textureImporter: TextureImporter;
  let backend: RenderBackend;

  beforeEach(() => {
    vi.clearAllMocks();
    mockVideoElement.src = '';
    mockVideoElement.currentTime = 0;

    // Create components
    cache = createFrameCache(200); // 200MB cache
    manager = createMediaSourceManager({
      skipDecoder: true,
      defaultCacheSizeMB: 200,
    });
    prefetcher = createPrefetcher({
      maxConcurrent: 4,
      defaultAheadFrames: 10,
      defaultBehindFrames: 2,
    });
    textureImporter = createTextureImporter({
      maxPooledPerSize: 4,
    });
    backend = createMockBackend();

    // Connect components
    prefetcher.setFrameCache(cache);
    textureImporter.setBackend(backend);
  });

  afterEach(() => {
    prefetcher.stop();
    manager.dispose();
    textureImporter.dispose();
  });

  describe('End-to-end Pipeline', () => {
    it('should create and open a media source', async () => {
      const source = await manager.createSource('test-video.mp4');

      expect(source).toBeDefined();
      expect(source.state).toBe('ready');
      expect(source.probeResult).toBeDefined();
      expect(source.probeResult?.video).toBeDefined();
    });

    it('should extract a frame and import to GPU', async () => {
      const source = await manager.createSource('test-video.mp4');
      const frame = await source.getVideoFrame(0);

      expect(frame).toBeDefined();
      expect(frame?.width).toBe(1920);
      expect(frame?.height).toBe(1080);

      // Import to GPU
      const texture = textureImporter.import(frame!);

      expect(texture).toBeDefined();
      expect(texture.handle.width).toBe(1920);
      expect(texture.handle.height).toBe(1080);
    });

    it('should cache frames across requests', async () => {
      const source = await manager.createSource('test-video.mp4', {
        id: 'cache-test-source',
      });

      // First request - should decode
      await source.getVideoFrame(0);

      // Check cache
      expect(manager.getFrameCache().hasFrame('cache-test-source', 0)).toBe(true);

      // Second request - should hit cache
      const cachedFrame = await source.getVideoFrame(0);

      expect(cachedFrame).toBeDefined();
    });

    it('should prefetch frames around playhead', async () => {
      const source = await manager.createSource('test-video.mp4');

      // Register with prefetcher
      prefetcher.registerSource(source);
      prefetcher.start();

      // Update playhead to trigger prefetch
      prefetcher.updatePlayhead(source.id, 50);

      // Give prefetcher time to queue requests
      await new Promise((resolve) => setTimeout(resolve, 10));

      const stats = prefetcher.getStats();
      expect(stats.totalRequests).toBeGreaterThan(0);
    });
  });

  describe('Multiple Sources', () => {
    it('should handle multiple concurrent sources', async () => {
      const source1 = await manager.createSource('video1.mp4', { id: 'src-1' });
      const source2 = await manager.createSource('video2.mp4', { id: 'src-2' });
      const source3 = await manager.createSource('video3.mp4', { id: 'src-3' });

      expect(manager.getSourceCount()).toBe(3);
      expect(source1.state).toBe('ready');
      expect(source2.state).toBe('ready');
      expect(source3.state).toBe('ready');
    });

    it('should extract frames from different sources', async () => {
      const source1 = await manager.createSource('video1.mp4', { id: 'frame-src-1' });
      const source2 = await manager.createSource('video2.mp4', { id: 'frame-src-2' });

      const frame1 = await source1.getVideoFrame(0);
      const frame2 = await source2.getVideoFrame(0);

      expect(frame1).toBeDefined();
      expect(frame2).toBeDefined();
    });

    it('should close oldest source when at limit', async () => {
      const limitedManager = createMediaSourceManager({
        maxConcurrentSources: 2,
        skipDecoder: true,
      });

      const source1 = await limitedManager.createSource('video1.mp4', { id: 'limit-1' });
      await limitedManager.createSource('video2.mp4', { id: 'limit-2' });
      await limitedManager.createSource('video3.mp4', { id: 'limit-3' });

      expect(source1.state).toBe('closed');
      expect(limitedManager.getSourceCount()).toBe(2);

      limitedManager.dispose();
    });
  });

  describe('Texture Pooling', () => {
    it('should reuse pooled textures', async () => {
      const source = await manager.createSource('test-video.mp4');

      // Get and import first frame
      const frame1 = await source.getVideoFrame(0);
      const texture1 = textureImporter.import(frame1!);
      textureImporter.release(texture1);

      // Get and import second frame (same dimensions)
      const frame2 = await source.getVideoFrameByNumber(1);
      const texture2 = textureImporter.import(frame2!);

      // Should have reused the pooled texture
      expect(texture2.handle.id).toBe(texture1.handle.id);
    });

    it('should track pool statistics', async () => {
      const source = await manager.createSource('test-video.mp4');

      // Import multiple frames
      const frames: DecodedVideoFrame[] = [];
      for (let i = 0; i < 3; i++) {
        const frame = await source.getVideoFrameByNumber(i);
        frames.push(frame!);
      }

      const textures = frames.map((f) => textureImporter.import(f));
      expect(textureImporter.getStats().totalImports).toBe(3);

      // Release back to pool
      textures.forEach((t) => textureImporter.release(t));
      expect(textureImporter.getStats().pooledTextures).toBe(3);
    });
  });

  describe('Cache Management', () => {
    it('should respect cache size limit', async () => {
      const smallManager = createMediaSourceManager({
        skipDecoder: true,
        defaultCacheSizeMB: 1,
      });

      const source = await smallManager.createSource('test-video.mp4');

      // Extract many frames
      for (let i = 0; i < 10; i++) {
        await source.getVideoFrameByNumber(i);
      }

      const stats = smallManager.getCacheStats();
      expect(stats.sizeBytes).toBeLessThanOrEqual(1 * 1024 * 1024);

      smallManager.dispose();
    });

    it('should clear cache when source is closed', async () => {
      const source = await manager.createSource('test-video.mp4', { id: 'clear-cache-test' });
      await source.getVideoFrame(0);

      // Verify frame is cached
      expect(manager.getFrameCache().hasFrame('clear-cache-test', 0)).toBe(true);

      // Close source
      manager.closeSource('clear-cache-test');

      // Frame should be removed from cache
      expect(manager.getFrameCache().hasFrame('clear-cache-test', 0)).toBe(false);
    });
  });

  describe('Prefetch Integration', () => {
    it('should prefetch frames with callbacks', async () => {
      const source = await manager.createSource('test-video.mp4');

      prefetcher.registerSource(source);
      prefetcher.start();

      // Request specific frame with callback
      const frameReady = new Promise<void>((resolve) => {
        prefetcher.requestFrame(source.id, 100, 'critical', () => resolve());
      });

      await frameReady;

      const stats = prefetcher.getStats();
      expect(stats.completedRequests).toBeGreaterThan(0);
    });

    it('should adapt prefetch based on playback direction', async () => {
      const source = await manager.createSource('test-video.mp4');

      prefetcher.registerSource(source);
      prefetcher.start();

      // Simulate forward playback
      prefetcher.updatePlayhead(source.id, 10);
      prefetcher.updatePlayhead(source.id, 20);
      prefetcher.updatePlayhead(source.id, 30);

      // Simulate reverse playback
      prefetcher.updatePlayhead(source.id, 25);
      prefetcher.updatePlayhead(source.id, 20);

      // Prefetcher should have queued requests
      const stats = prefetcher.getStats();
      expect(stats.totalRequests).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle source close during prefetch', async () => {
      const source = await manager.createSource('test-video.mp4');

      prefetcher.registerSource(source);
      prefetcher.start();

      // Request frames
      prefetcher.requestFrame(source.id, 50);
      prefetcher.requestFrame(source.id, 51);

      // Close source while prefetch is in progress
      manager.closeSource(source.id);

      // Unregister from prefetcher
      prefetcher.unregisterSource(source.id);

      // Should not throw
      const stats = prefetcher.getStats();
      expect(stats).toBeDefined();
    });

    it('should handle texture import after backend dispose', () => {
      const imp = createTextureImporter();
      imp.setBackend(backend);

      // Dispose
      imp.dispose();

      // Try to import - should throw
      const frame: DecodedVideoFrame = {
        frameNumber: 0,
        timestampMs: 0,
        width: 1920,
        height: 1080,
        format: 'rgba',
        data: new Uint8Array(1920 * 1080 * 4),
        durationMs: 33.33,
        isKeyframe: true,
        source: 'webcodecs',
      };

      expect(() => imp.import(frame)).toThrow('Render backend not set');
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should track end-to-end statistics', async () => {
      const source = await manager.createSource('test-video.mp4');

      // Extract and import frames
      for (let i = 0; i < 5; i++) {
        const frame = await source.getVideoFrameByNumber(i);
        const texture = textureImporter.import(frame!);
        textureImporter.release(texture);
      }

      // Check stats
      const cacheStats = manager.getCacheStats();
      const importStats = textureImporter.getStats();

      expect(cacheStats.entries).toBeGreaterThan(0);
      expect(importStats.totalImports).toBe(5);
    });
  });
});
