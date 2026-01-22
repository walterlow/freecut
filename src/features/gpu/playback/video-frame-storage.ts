/**
 * Video Frame Storage
 *
 * Manages actual VideoFrame objects on the JS side.
 * The Rust FrameBuffer only holds metadata with js_handle references
 * that index into this storage.
 *
 * This separation is necessary because:
 * 1. VideoFrame is a JS object that can't cross the WASM boundary
 * 2. VideoFrame holds GPU resources that need proper lifecycle management
 * 3. Rust can efficiently manage the buffer logic while JS handles the frames
 */

export interface StoredFrame {
  /** The actual VideoFrame object */
  frame: VideoFrame;
  /** Frame number for validation */
  frameNumber: number;
  /** Reference count (for shared frames) */
  refCount: number;
  /** Timestamp when stored */
  storedAt: number;
}

export interface VideoFrameStorageStats {
  /** Total frames currently stored */
  frameCount: number;
  /** Total handles allocated */
  handlesAllocated: number;
  /** Handles currently in use */
  handlesInUse: number;
  /** Frames released */
  framesReleased: number;
}

/**
 * Storage for VideoFrame objects referenced by Rust FrameBuffer
 */
export class VideoFrameStorage {
  private frames: Map<number, StoredFrame> = new Map();
  private nextHandle: number = 0;
  private freeHandles: number[] = [];
  private stats = {
    handlesAllocated: 0,
    framesReleased: 0,
  };

  /**
   * Store a VideoFrame and return a handle for Rust
   */
  store(frame: VideoFrame, frameNumber: number): number {
    // Reuse a free handle or allocate new one
    const handle = this.freeHandles.pop() ?? this.nextHandle++;

    if (handle === this.nextHandle - 1) {
      this.stats.handlesAllocated++;
    }

    this.frames.set(handle, {
      frame,
      frameNumber,
      refCount: 1,
      storedAt: performance.now(),
    });

    return handle;
  }

  /**
   * Get a VideoFrame by handle
   */
  get(handle: number): VideoFrame | null {
    const stored = this.frames.get(handle);
    return stored?.frame ?? null;
  }

  /**
   * Get stored frame info by handle
   */
  getInfo(handle: number): StoredFrame | null {
    return this.frames.get(handle) ?? null;
  }

  /**
   * Increment reference count for a frame
   */
  addRef(handle: number): void {
    const stored = this.frames.get(handle);
    if (stored) {
      stored.refCount++;
    }
  }

  /**
   * Release a frame by handle (decrements refCount, closes when 0)
   */
  release(handle: number): void {
    const stored = this.frames.get(handle);
    if (!stored) return;

    stored.refCount--;
    if (stored.refCount <= 0) {
      // Actually close the VideoFrame to release GPU resources
      try {
        stored.frame.close();
      } catch {
        // Frame may already be closed
      }

      this.frames.delete(handle);
      this.freeHandles.push(handle);
      this.stats.framesReleased++;
    }
  }

  /**
   * Release multiple frames by handles (batch operation from Rust clear())
   */
  releaseMany(handles: Uint32Array | number[]): void {
    for (const handle of handles) {
      this.release(handle);
    }
  }

  /**
   * Check if a handle is valid
   */
  has(handle: number): boolean {
    return this.frames.has(handle);
  }

  /**
   * Get all stored handles
   */
  getAllHandles(): number[] {
    return Array.from(this.frames.keys());
  }

  /**
   * Get storage statistics
   */
  getStats(): VideoFrameStorageStats {
    return {
      frameCount: this.frames.size,
      handlesAllocated: this.stats.handlesAllocated,
      handlesInUse: this.frames.size,
      framesReleased: this.stats.framesReleased,
    };
  }

  /**
   * Clear all stored frames
   */
  clear(): void {
    for (const stored of this.frames.values()) {
      try {
        stored.frame.close();
      } catch {
        // Frame may already be closed
      }
    }
    this.frames.clear();
    this.freeHandles = [];
    this.stats.framesReleased += this.frames.size;
  }

  /**
   * Dispose of storage and all frames
   */
  dispose(): void {
    this.clear();
  }
}

/**
 * Create a new VideoFrameStorage instance
 */
export function createVideoFrameStorage(): VideoFrameStorage {
  return new VideoFrameStorage();
}
