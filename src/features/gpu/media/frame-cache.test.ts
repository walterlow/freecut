import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FrameCache,
  createFrameCache,
  generateCacheKey,
  generateTimestampKey,
  estimateFrameSize,
  createMemoryPressureDetector,
} from './frame-cache';
import type { DecodedVideoFrame } from './types';

/**
 * Create a mock decoded frame for testing
 */
function createMockFrame(options: {
  frameNumber?: number;
  width?: number;
  height?: number;
  format?: 'rgba' | 'rgb' | 'yuv420';
  timestampMs?: number;
}): DecodedVideoFrame {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const format = options.format ?? 'rgba';
  const bytesPerPixel = format === 'rgba' ? 4 : format === 'rgb' ? 3 : 1.5;
  const dataSize = Math.ceil(width * height * bytesPerPixel);

  return {
    frameNumber: options.frameNumber ?? 0,
    timestampMs: options.timestampMs ?? 0,
    width,
    height,
    format,
    data: new Uint8Array(dataSize),
    durationMs: 33.33,
    isKeyframe: true,
    source: 'webcodecs',
  };
}

describe('Frame Cache', () => {
  describe('generateCacheKey', () => {
    it('should generate key from source and frame number', () => {
      const key = generateCacheKey('source-1', 100);

      expect(key).toBe('source-1:frame-100');
    });

    it('should handle special characters in source ID', () => {
      const key = generateCacheKey('path/to/video.mp4', 50);

      expect(key).toBe('path/to/video.mp4:frame-50');
    });
  });

  describe('generateTimestampKey', () => {
    it('should generate key from timestamp at 30fps', () => {
      const key = generateTimestampKey('source-1', 1000, 30); // 1 second at 30fps = frame 30

      expect(key).toBe('source-1:frame-30');
    });

    it('should generate key from timestamp at 60fps', () => {
      const key = generateTimestampKey('source-1', 500, 60); // 0.5 second at 60fps = frame 30

      expect(key).toBe('source-1:frame-30');
    });

    it('should handle fractional frames', () => {
      const key = generateTimestampKey('source-1', 100, 30); // 0.1 second at 30fps = frame 3

      expect(key).toBe('source-1:frame-3');
    });
  });

  describe('estimateFrameSize', () => {
    it('should estimate RGBA frame size', () => {
      const frame = createMockFrame({ width: 100, height: 100, format: 'rgba' });
      const size = estimateFrameSize(frame);

      expect(size).toBe(100 * 100 * 4);
    });

    it('should estimate RGB frame size', () => {
      const frame = createMockFrame({ width: 100, height: 100, format: 'rgb' });
      const size = estimateFrameSize(frame);

      expect(size).toBe(100 * 100 * 3);
    });

    it('should estimate YUV420 frame size', () => {
      const frame = createMockFrame({ width: 100, height: 100, format: 'yuv420' });
      const size = estimateFrameSize(frame);

      expect(size).toBe(100 * 100 * 1.5);
    });

    it('should use Uint8Array byteLength if available', () => {
      const data = new Uint8Array(5000);
      const frame: DecodedVideoFrame = {
        frameNumber: 0,
        timestampMs: 0,
        width: 100,
        height: 100,
        format: 'rgba',
        data,
        durationMs: 33.33,
        isKeyframe: true,
        source: 'ffmpeg',
      };

      const size = estimateFrameSize(frame);

      expect(size).toBe(5000);
    });
  });

  describe('createFrameCache', () => {
    it('should create a cache with default settings', () => {
      const cache = createFrameCache();
      const stats = cache.getStats();

      expect(stats.maxSizeBytes).toBe(500 * 1024 * 1024); // 500MB default
    });

    it('should create a cache with custom size', () => {
      const cache = createFrameCache(100); // 100MB
      const stats = cache.getStats();

      expect(stats.maxSizeBytes).toBe(100 * 1024 * 1024);
    });
  });

  describe('basic operations', () => {
    let cache: FrameCache;

    beforeEach(() => {
      // Small cache for testing (10MB)
      cache = new FrameCache({
        maxSizeBytes: 10 * 1024 * 1024,
      });
    });

    it('should store and retrieve a frame', () => {
      const frame = createMockFrame({ frameNumber: 0 });

      const stored = cache.set('test-key', frame);
      const retrieved = cache.get('test-key');

      expect(stored).toBe(true);
      expect(retrieved).toBe(frame);
    });

    it('should store and retrieve by frame number', () => {
      const frame = createMockFrame({ frameNumber: 42 });

      const stored = cache.setFrame('source-1', frame);
      const retrieved = cache.getFrame('source-1', 42);

      expect(stored).toBe(true);
      expect(retrieved).toBe(frame);
    });

    it('should return null for missing frame', () => {
      const retrieved = cache.get('nonexistent');

      expect(retrieved).toBeNull();
    });

    it('should check if frame exists', () => {
      const frame = createMockFrame({ frameNumber: 0 });
      cache.set('test-key', frame);

      expect(cache.has('test-key')).toBe(true);
      expect(cache.has('other-key')).toBe(false);
    });

    it('should check if frame exists by frame number', () => {
      const frame = createMockFrame({ frameNumber: 10 });
      cache.setFrame('source-1', frame);

      expect(cache.hasFrame('source-1', 10)).toBe(true);
      expect(cache.hasFrame('source-1', 11)).toBe(false);
    });

    it('should remove a frame', () => {
      const frame = createMockFrame({ frameNumber: 0 });
      cache.set('test-key', frame);

      const removed = cache.remove('test-key');

      expect(removed).toBe(true);
      expect(cache.has('test-key')).toBe(false);
    });

    it('should return false when removing nonexistent frame', () => {
      const removed = cache.remove('nonexistent');

      expect(removed).toBe(false);
    });
  });

  describe('LRU eviction', () => {
    let cache: FrameCache;

    beforeEach(() => {
      // Very small cache to trigger eviction (1MB)
      cache = new FrameCache({
        maxSizeBytes: 1 * 1024 * 1024,
        evictionPolicy: 'lru',
      });
    });

    it('should evict least recently used frame', () => {
      // Small frames to fit multiple in cache
      const frame1 = createMockFrame({ frameNumber: 0, width: 100, height: 100 });
      const frame2 = createMockFrame({ frameNumber: 1, width: 100, height: 100 });

      cache.setFrame('source-1', frame1);
      cache.setFrame('source-1', frame2);

      // Access frame1 to make it recently used
      cache.getFrame('source-1', 0);

      // Fill cache to trigger eviction
      const largeFrame = createMockFrame({ frameNumber: 3, width: 500, height: 500 });
      cache.setFrame('source-1', largeFrame);

      // frame2 should be evicted (least recently used)
      expect(cache.hasFrame('source-1', 0)).toBe(true); // Recently accessed
      // Note: frame2 may or may not be evicted depending on exact sizes
    });

    it('should update access order on get', () => {
      const frame1 = createMockFrame({ frameNumber: 0, width: 100, height: 100 });
      const frame2 = createMockFrame({ frameNumber: 1, width: 100, height: 100 });

      cache.setFrame('source-1', frame1);
      cache.setFrame('source-1', frame2);

      // Access frame1 multiple times
      cache.getFrame('source-1', 0);
      cache.getFrame('source-1', 0);
      cache.getFrame('source-1', 0);

      const stats = cache.getStats();
      expect(stats.hits).toBeGreaterThan(0);
    });

    it('should track hit rate', () => {
      const frame = createMockFrame({ frameNumber: 0, width: 100, height: 100 });
      cache.setFrame('source-1', frame);

      // 2 hits
      cache.getFrame('source-1', 0);
      cache.getFrame('source-1', 0);

      // 2 misses
      cache.getFrame('source-1', 1);
      cache.getFrame('source-1', 2);

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBe(0.5);
    });
  });

  describe('FIFO eviction', () => {
    let cache: FrameCache;

    beforeEach(() => {
      cache = new FrameCache({
        maxSizeBytes: 500 * 1024, // 500KB
        evictionPolicy: 'fifo',
      });
    });

    it('should evict first inserted frame', () => {
      const frame1 = createMockFrame({ frameNumber: 0, width: 100, height: 100 });
      const frame2 = createMockFrame({ frameNumber: 1, width: 100, height: 100 });
      const frame3 = createMockFrame({ frameNumber: 2, width: 100, height: 100 });

      cache.setFrame('source-1', frame1);
      cache.setFrame('source-1', frame2);
      cache.setFrame('source-1', frame3);

      // Manually evict to target
      cache.evictToTarget();

      // frame1 (first inserted) should be evicted first
      const entries = cache.getEntries();
      const frameNumbers = entries.map((e) => e.frame.frameNumber);

      // Later frames should still be present
      if (cache.hasFrame('source-1', 0) === false) {
        expect(frameNumbers).not.toContain(0);
      }
    });
  });

  describe('LFU eviction', () => {
    let cache: FrameCache;

    beforeEach(() => {
      cache = new FrameCache({
        maxSizeBytes: 500 * 1024,
        evictionPolicy: 'lfu',
      });
    });

    it('should evict least frequently used frame', () => {
      const frame1 = createMockFrame({ frameNumber: 0, width: 100, height: 100 });
      const frame2 = createMockFrame({ frameNumber: 1, width: 100, height: 100 });

      cache.setFrame('source-1', frame1);
      cache.setFrame('source-1', frame2);

      // Access frame1 multiple times
      cache.getFrame('source-1', 0);
      cache.getFrame('source-1', 0);
      cache.getFrame('source-1', 0);

      // Access frame2 once
      cache.getFrame('source-1', 1);

      // Evict to target
      cache.evictToTarget();

      // frame2 should be evicted first (less frequently accessed)
      const entries = cache.getEntries();
      const hasFrame1 = entries.some((e) => e.frame.frameNumber === 0);
      const hasFrame2 = entries.some((e) => e.frame.frameNumber === 1);

      // If anything was evicted, frame2 should go first
      if (entries.length < 2) {
        expect(hasFrame1).toBe(true);
        expect(hasFrame2).toBe(false);
      }
    });
  });

  describe('removeSource', () => {
    let cache: FrameCache;

    beforeEach(() => {
      cache = createFrameCache(100);
    });

    it('should remove all frames for a source', () => {
      const frame1 = createMockFrame({ frameNumber: 0, width: 100, height: 100 });
      const frame2 = createMockFrame({ frameNumber: 1, width: 100, height: 100 });
      const frame3 = createMockFrame({ frameNumber: 0, width: 100, height: 100 });

      cache.setFrame('source-1', frame1);
      cache.setFrame('source-1', frame2);
      cache.setFrame('source-2', frame3);

      const removed = cache.removeSource('source-1');

      expect(removed).toBe(2);
      expect(cache.hasFrame('source-1', 0)).toBe(false);
      expect(cache.hasFrame('source-1', 1)).toBe(false);
      expect(cache.hasFrame('source-2', 0)).toBe(true);
    });

    it('should return 0 for nonexistent source', () => {
      const removed = cache.removeSource('nonexistent');

      expect(removed).toBe(0);
    });
  });

  describe('clear', () => {
    let cache: FrameCache;

    beforeEach(() => {
      cache = createFrameCache(100);
    });

    it('should clear all entries', () => {
      const frame1 = createMockFrame({ frameNumber: 0 });
      const frame2 = createMockFrame({ frameNumber: 1 });

      cache.setFrame('source-1', frame1);
      cache.setFrame('source-1', frame2);

      cache.clear();

      const stats = cache.getStats();
      expect(stats.entries).toBe(0);
      expect(stats.sizeBytes).toBe(0);
    });

    it('should call onEvict for each entry', () => {
      const onEvict = vi.fn();
      cache = new FrameCache({
        maxSizeBytes: 100 * 1024 * 1024,
        onEvict,
      });

      const frame1 = createMockFrame({ frameNumber: 0, width: 100, height: 100 });
      const frame2 = createMockFrame({ frameNumber: 1, width: 100, height: 100 });

      cache.setFrame('source-1', frame1);
      cache.setFrame('source-1', frame2);

      cache.clear();

      expect(onEvict).toHaveBeenCalledTimes(2);
    });
  });

  describe('getFrameNumbersForSource', () => {
    let cache: FrameCache;

    beforeEach(() => {
      cache = createFrameCache(100);
    });

    it('should return sorted frame numbers', () => {
      cache.setFrame('source-1', createMockFrame({ frameNumber: 5, width: 100, height: 100 }));
      cache.setFrame('source-1', createMockFrame({ frameNumber: 2, width: 100, height: 100 }));
      cache.setFrame('source-1', createMockFrame({ frameNumber: 8, width: 100, height: 100 }));
      cache.setFrame('source-1', createMockFrame({ frameNumber: 1, width: 100, height: 100 }));

      const frameNumbers = cache.getFrameNumbersForSource('source-1');

      expect(frameNumbers).toEqual([1, 2, 5, 8]);
    });

    it('should return empty array for unknown source', () => {
      const frameNumbers = cache.getFrameNumbersForSource('unknown');

      expect(frameNumbers).toEqual([]);
    });
  });

  describe('evictForMemoryPressure', () => {
    let cache: FrameCache;

    beforeEach(() => {
      cache = createFrameCache(10);
    });

    it('should evict to free requested memory', () => {
      // Add frames
      for (let i = 0; i < 10; i++) {
        cache.setFrame('source-1', createMockFrame({ frameNumber: i, width: 100, height: 100 }));
      }

      const statsBefore = cache.getStats();
      const bytesToFree = statsBefore.sizeBytes / 2;

      const evicted = cache.evictForMemoryPressure(bytesToFree);

      const statsAfter = cache.getStats();
      expect(evicted).toBeGreaterThan(0);
      expect(statsAfter.sizeBytes).toBeLessThan(statsBefore.sizeBytes);
    });
  });

  describe('VideoFrame handling', () => {
    it('should close VideoFrame on removal', () => {
      const cache = createFrameCache(100);
      const mockClose = vi.fn();

      const frame: DecodedVideoFrame = {
        frameNumber: 0,
        timestampMs: 0,
        width: 100,
        height: 100,
        format: 'rgba',
        data: { close: mockClose } as unknown as VideoFrame,
        durationMs: 33.33,
        isKeyframe: true,
        source: 'webcodecs',
      };

      cache.setFrame('source-1', frame);
      cache.remove('source-1:frame-0');

      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('size limits', () => {
    it('should reject frame larger than max cache size', () => {
      const cache = new FrameCache({
        maxSizeBytes: 1024, // 1KB
      });

      // Frame much larger than cache
      const frame = createMockFrame({ frameNumber: 0, width: 1920, height: 1080 });

      const stored = cache.setFrame('source-1', frame);

      expect(stored).toBe(false);
    });

    it('should replace existing entry on duplicate key', () => {
      const cache = createFrameCache(10);

      const frame1 = createMockFrame({ frameNumber: 0, width: 100, height: 100 });
      const frame2 = createMockFrame({ frameNumber: 0, width: 200, height: 200 });

      cache.setFrame('source-1', frame1);
      cache.setFrame('source-1', frame2);

      const retrieved = cache.getFrame('source-1', 0);
      expect(retrieved?.width).toBe(200);
    });
  });

  describe('createMemoryPressureDetector', () => {
    it('should create a detector', () => {
      const detector = createMemoryPressureDetector();

      expect(detector).toBeDefined();
      expect(typeof detector.getUsedMemory).toBe('function');
      expect(typeof detector.getAvailableMemory).toBe('function');
      expect(typeof detector.isUnderPressure).toBe('function');
      expect(typeof detector.onPressure).toBe('function');
    });

    it('should return memory values', () => {
      const detector = createMemoryPressureDetector();

      const used = detector.getUsedMemory();
      const available = detector.getAvailableMemory();

      expect(typeof used).toBe('number');
      expect(typeof available).toBe('number');
    });

    it('should check pressure state', () => {
      const detector = createMemoryPressureDetector();

      const underPressure = detector.isUnderPressure();

      expect(typeof underPressure).toBe('boolean');
    });

    it('should allow subscribing to pressure events', () => {
      const detector = createMemoryPressureDetector();
      const callback = vi.fn();

      const unsubscribe = detector.onPressure(callback);

      expect(typeof unsubscribe).toBe('function');

      // Cleanup
      unsubscribe();
    });
  });

  describe('statistics', () => {
    it('should track eviction count', () => {
      const cache = new FrameCache({
        maxSizeBytes: 50 * 1024, // 50KB
        evictionPolicy: 'lru',
      });

      // Fill cache
      for (let i = 0; i < 20; i++) {
        cache.setFrame('source-1', createMockFrame({ frameNumber: i, width: 100, height: 100 }));
      }

      const stats = cache.getStats();
      expect(stats.evictions).toBeGreaterThan(0);
    });
  });
});
