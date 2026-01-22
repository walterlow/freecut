/**
 * Frame Cache
 *
 * LRU cache for decoded video frames with memory budget management.
 * Provides fast frame access for timeline scrubbing and playback.
 */

import type { DecodedVideoFrame, FrameCacheEntry, CacheStats } from './types';

/**
 * Cache eviction policy
 */
export type EvictionPolicy = 'lru' | 'lfu' | 'fifo';

/**
 * Frame cache configuration
 */
export interface FrameCacheConfig {
  /** Maximum cache size in bytes */
  maxSizeBytes: number;
  /** Eviction policy (default: 'lru') */
  evictionPolicy?: EvictionPolicy;
  /** Target fill percentage after eviction (0-1, default: 0.8) */
  evictionTarget?: number;
  /** Enable background eviction */
  backgroundEviction?: boolean;
  /** Callback when frame is evicted */
  onEvict?: (entry: FrameCacheEntry) => void;
}

/**
 * Generate cache key for a frame
 */
export function generateCacheKey(sourceId: string, frameNumber: number): string {
  return `${sourceId}:frame-${frameNumber}`;
}

/**
 * Generate cache key from timestamp
 */
export function generateTimestampKey(sourceId: string, timestampMs: number, frameRate: number): string {
  const frameNumber = Math.floor(timestampMs * frameRate / 1000);
  return generateCacheKey(sourceId, frameNumber);
}

/**
 * Estimate frame size in bytes
 */
export function estimateFrameSize(frame: DecodedVideoFrame): number {
  if (frame.data instanceof Uint8Array) {
    return frame.data.byteLength;
  }

  // For VideoFrame or ImageBitmap, estimate based on dimensions
  const bytesPerPixel = frame.format === 'rgba' ? 4 :
                        frame.format === 'rgb' ? 3 :
                        frame.format === 'yuv420' ? 1.5 :
                        frame.format === 'yuv422' ? 2 :
                        frame.format === 'yuv444' ? 3 :
                        frame.format === 'nv12' ? 1.5 : 4;

  return Math.ceil(frame.width * frame.height * bytesPerPixel);
}

/**
 * LRU Frame Cache implementation
 */
export class FrameCache {
  private readonly config: Required<FrameCacheConfig>;
  private readonly entries: Map<string, FrameCacheEntry> = new Map();
  private readonly accessOrder: string[] = []; // For LRU
  private readonly insertOrder: string[] = []; // For FIFO

  private currentSizeBytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(config: FrameCacheConfig) {
    this.config = {
      maxSizeBytes: config.maxSizeBytes,
      evictionPolicy: config.evictionPolicy ?? 'lru',
      evictionTarget: config.evictionTarget ?? 0.8,
      backgroundEviction: config.backgroundEviction ?? false,
      onEvict: config.onEvict ?? (() => {}),
    };
  }

  /**
   * Get a frame from the cache
   */
  get(key: string): DecodedVideoFrame | null {
    const entry = this.entries.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    this.hits++;
    entry.lastAccess = Date.now();
    entry.accessCount++;

    // Update access order for LRU
    if (this.config.evictionPolicy === 'lru') {
      const index = this.accessOrder.indexOf(key);
      if (index !== -1) {
        this.accessOrder.splice(index, 1);
      }
      this.accessOrder.push(key);
    }

    return entry.frame;
  }

  /**
   * Get a frame by source and frame number
   */
  getFrame(sourceId: string, frameNumber: number): DecodedVideoFrame | null {
    const key = generateCacheKey(sourceId, frameNumber);
    return this.get(key);
  }

  /**
   * Get a frame by source and timestamp
   */
  getFrameByTimestamp(
    sourceId: string,
    timestampMs: number,
    frameRate: number
  ): DecodedVideoFrame | null {
    const key = generateTimestampKey(sourceId, timestampMs, frameRate);
    return this.get(key);
  }

  /**
   * Store a frame in the cache
   */
  set(key: string, frame: DecodedVideoFrame): boolean {
    const sizeBytes = estimateFrameSize(frame);

    // Check if frame is too large for cache
    if (sizeBytes > this.config.maxSizeBytes) {
      return false;
    }

    // Evict if necessary
    while (this.currentSizeBytes + sizeBytes > this.config.maxSizeBytes) {
      if (!this.evictOne()) {
        return false;
      }
    }

    // Remove existing entry if present
    if (this.entries.has(key)) {
      this.remove(key);
    }

    const entry: FrameCacheEntry = {
      key,
      frame,
      sizeBytes,
      lastAccess: Date.now(),
      accessCount: 1,
    };

    this.entries.set(key, entry);
    this.currentSizeBytes += sizeBytes;
    this.accessOrder.push(key);
    this.insertOrder.push(key);

    return true;
  }

  /**
   * Store a frame by source and frame number
   */
  setFrame(sourceId: string, frame: DecodedVideoFrame): boolean {
    const key = generateCacheKey(sourceId, frame.frameNumber);
    return this.set(key, frame);
  }

  /**
   * Check if a frame exists in the cache
   */
  has(key: string): boolean {
    return this.entries.has(key);
  }

  /**
   * Check if a frame exists by source and frame number
   */
  hasFrame(sourceId: string, frameNumber: number): boolean {
    const key = generateCacheKey(sourceId, frameNumber);
    return this.has(key);
  }

  /**
   * Remove a frame from the cache
   */
  remove(key: string): boolean {
    const entry = this.entries.get(key);

    if (!entry) {
      return false;
    }

    this.entries.delete(key);
    this.currentSizeBytes -= entry.sizeBytes;

    // Remove from access order
    const accessIndex = this.accessOrder.indexOf(key);
    if (accessIndex !== -1) {
      this.accessOrder.splice(accessIndex, 1);
    }

    // Remove from insert order
    const insertIndex = this.insertOrder.indexOf(key);
    if (insertIndex !== -1) {
      this.insertOrder.splice(insertIndex, 1);
    }

    // Close VideoFrame if applicable
    this.closeFrameIfNeeded(entry.frame);

    return true;
  }

  /**
   * Remove all frames for a source
   */
  removeSource(sourceId: string): number {
    const prefix = `${sourceId}:`;
    const keysToRemove: string[] = [];

    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      this.remove(key);
    }

    return keysToRemove.length;
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    for (const entry of this.entries.values()) {
      this.closeFrameIfNeeded(entry.frame);
      this.config.onEvict(entry);
    }

    this.entries.clear();
    this.accessOrder.length = 0;
    this.insertOrder.length = 0;
    this.currentSizeBytes = 0;
    this.evictions += this.entries.size;
  }

  /**
   * Evict frames to reach target size
   */
  evictToTarget(): number {
    const targetSize = this.config.maxSizeBytes * this.config.evictionTarget;
    let evicted = 0;

    while (this.currentSizeBytes > targetSize && this.entries.size > 0) {
      if (this.evictOne()) {
        evicted++;
      } else {
        break;
      }
    }

    return evicted;
  }

  /**
   * Evict frames based on memory pressure
   */
  evictForMemoryPressure(bytesToFree: number): number {
    const targetSize = Math.max(0, this.currentSizeBytes - bytesToFree);
    let evicted = 0;

    while (this.currentSizeBytes > targetSize && this.entries.size > 0) {
      if (this.evictOne()) {
        evicted++;
      } else {
        break;
      }
    }

    return evicted;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;

    return {
      entries: this.entries.size,
      sizeBytes: this.currentSizeBytes,
      maxSizeBytes: this.config.maxSizeBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Get all keys in the cache
   */
  keys(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Get all entries (for debugging)
   */
  getEntries(): FrameCacheEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Get frame numbers cached for a source
   */
  getFrameNumbersForSource(sourceId: string): number[] {
    const prefix = `${sourceId}:frame-`;
    const frameNumbers: number[] = [];

    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        const frameNum = parseInt(key.substring(prefix.length), 10);
        if (!isNaN(frameNum)) {
          frameNumbers.push(frameNum);
        }
      }
    }

    return frameNumbers.sort((a, b) => a - b);
  }

  /**
   * Evict one entry based on policy
   */
  private evictOne(): boolean {
    let keyToEvict: string | null = null;

    switch (this.config.evictionPolicy) {
      case 'lru':
        keyToEvict = this.accessOrder[0] ?? null;
        break;

      case 'fifo':
        keyToEvict = this.insertOrder[0] ?? null;
        break;

      case 'lfu': {
        // Find least frequently used
        let minAccessCount = Infinity;
        for (const [key, entry] of this.entries) {
          if (entry.accessCount < minAccessCount) {
            minAccessCount = entry.accessCount;
            keyToEvict = key;
          }
        }
        break;
      }
    }

    if (keyToEvict) {
      const entry = this.entries.get(keyToEvict);
      if (entry) {
        this.config.onEvict(entry);
        this.evictions++;
      }
      return this.remove(keyToEvict);
    }

    return false;
  }

  /**
   * Close VideoFrame if applicable
   */
  private closeFrameIfNeeded(frame: DecodedVideoFrame): void {
    // Close VideoFrame to release GPU memory
    if (frame.data && typeof (frame.data as VideoFrame).close === 'function') {
      try {
        (frame.data as VideoFrame).close();
      } catch {
        // Ignore close errors
      }
    }
  }
}

/**
 * Create a new frame cache with default settings
 */
export function createFrameCache(maxSizeMB: number = 500): FrameCache {
  return new FrameCache({
    maxSizeBytes: maxSizeMB * 1024 * 1024,
    evictionPolicy: 'lru',
    evictionTarget: 0.8,
  });
}

/**
 * Memory pressure detector
 */
export interface MemoryPressureDetector {
  /** Current memory usage in bytes */
  getUsedMemory(): number;
  /** Available memory in bytes */
  getAvailableMemory(): number;
  /** Check if under memory pressure */
  isUnderPressure(): boolean;
  /** Subscribe to memory pressure events */
  onPressure(callback: () => void): () => void;
}

/**
 * Create a memory pressure detector using Performance API if available
 */
export function createMemoryPressureDetector(): MemoryPressureDetector {
  const listeners: (() => void)[] = [];
  let lastCheck = 0;
  const checkInterval = 1000; // Check every second

  // Check for memory API (Chrome only)
  const hasMemoryAPI = typeof performance !== 'undefined' &&
    'memory' in performance;

  return {
    getUsedMemory(): number {
      if (hasMemoryAPI) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (performance as any).memory?.usedJSHeapSize ?? 0;
      }
      return 0;
    },

    getAvailableMemory(): number {
      if (hasMemoryAPI) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const memory = (performance as any).memory;
        return (memory?.jsHeapSizeLimit ?? 0) - (memory?.usedJSHeapSize ?? 0);
      }
      return Infinity;
    },

    isUnderPressure(): boolean {
      if (!hasMemoryAPI) {
        return false;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const memory = (performance as any).memory;
      if (!memory) {
        return false;
      }

      const usageRatio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;
      return usageRatio > 0.9; // 90% threshold
    },

    onPressure(callback: () => void): () => void {
      listeners.push(callback);

      // Start monitoring if first listener
      if (listeners.length === 1) {
        const check = () => {
          const now = Date.now();
          if (now - lastCheck >= checkInterval) {
            lastCheck = now;
            if (this.isUnderPressure()) {
              listeners.forEach((cb) => cb());
            }
          }
        };

        // Use requestAnimationFrame for efficient monitoring
        const monitor = () => {
          check();
          if (listeners.length > 0) {
            requestAnimationFrame(monitor);
          }
        };

        requestAnimationFrame(monitor);
      }

      return () => {
        const index = listeners.indexOf(callback);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      };
    },
  };
}
