/**
 * Canvas Pool for reusing OffscreenCanvas objects
 *
 * Creating new OffscreenCanvas objects every frame is expensive.
 * This pool pre-allocates canvases and reuses them across frames.
 */

import { createLogger } from '@/shared/logging/logger';

const log = createLogger('CanvasPool');

export class CanvasPool {
  private available: OffscreenCanvas[] = [];
  private inUse: Set<OffscreenCanvas> = new Set();
  private width: number;
  private height: number;
  private maxSize: number;

  constructor(width: number, height: number, initialSize: number = 8, maxSize: number = 20) {
    this.width = width;
    this.height = height;
    this.maxSize = maxSize;

    // Pre-allocate canvases
    for (let i = 0; i < initialSize; i++) {
      this.available.push(new OffscreenCanvas(width, height));
    }
  }

  /**
   * Acquire a canvas from the pool
   */
  acquire(): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } {
    let canvas: OffscreenCanvas;

    if (this.available.length > 0) {
      canvas = this.available.pop()!;
    } else if (this.inUse.size < this.maxSize) {
      // Pool exhausted but under max, create new
      canvas = new OffscreenCanvas(this.width, this.height);
    } else {
      // Pool exhausted and at max, create temporary (will be discarded)
      log.warn('Canvas pool exhausted, creating temporary canvas');
      canvas = new OffscreenCanvas(this.width, this.height);
    }

    this.inUse.add(canvas);
    // Reset dimensions in case a previous user resized the canvas (e.g. sub-comp rendering)
    if (canvas.width !== this.width || canvas.height !== this.height) {
      canvas.width = this.width;
      canvas.height = this.height;
    }
    const ctx = canvas.getContext('2d')!;
    // Reset context state that might leak between pool users.
    // save/restore should handle this, but a stale globalAlpha or
    // globalCompositeOperation from an unbalanced save/restore would
    // silently make all subsequent draws invisible.
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // Clear the canvas for reuse
    ctx.clearRect(0, 0, this.width, this.height);
    return { canvas, ctx };
  }

  /**
   * Release a canvas back to the pool
   */
  release(canvas: OffscreenCanvas): void {
    if (this.inUse.has(canvas)) {
      this.inUse.delete(canvas);
      if (this.available.length < this.maxSize) {
        this.available.push(canvas);
      }
      // If over maxSize, let it be garbage collected
    }
  }

  /**
   * Release all canvases and clear the pool
   */
  dispose(): void {
    this.available.length = 0;
    this.inUse.clear();
  }

  /**
   * Get pool statistics for debugging
   */
  getStats(): { available: number; inUse: number; total: number } {
    return {
      available: this.available.length,
      inUse: this.inUse.size,
      total: this.available.length + this.inUse.size,
    };
  }
}

/**
 * Cache for text measurements to avoid repeated measureText() calls
 */
export class TextMeasurementCache {
  private cache = new Map<string, number>();
  private maxSize = 1000;

  /**
   * Get cached measurement or measure and cache
   */
  measure(ctx: OffscreenCanvasRenderingContext2D, text: string, letterSpacing: number): number {
    const key = `${ctx.font}|${text}|${letterSpacing}`;

    let width = this.cache.get(key);
    if (width === undefined) {
      const baseWidth = ctx.measureText(text).width;
      const spacingWidth = Math.max(0, text.length - 1) * letterSpacing;
      width = baseWidth + spacingWidth;

      // Evict oldest entries if cache is full
      if (this.cache.size >= this.maxSize) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) this.cache.delete(firstKey);
      }
      this.cache.set(key, width);
    }

    return width;
  }

  /**
   * Clear the cache (call between renders)
   */
  clear(): void {
    this.cache.clear();
  }
}

