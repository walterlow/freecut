/**
 * WASM Module Loader for Frame Buffer
 *
 * Handles lazy loading and initialization of the Rust frame buffer WASM module.
 */

import type {
  FrameBuffer,
  FrameInfo,
  AVSync,
  BufferStats,
  BufferState,
  InitOutput,
} from '../../../../crates/frame-buffer/pkg/frame_buffer';

// Re-export types for convenience
export type { FrameBuffer, FrameInfo, AVSync, BufferStats, BufferState };

// Module state
let wasmModule: InitOutput | null = null;
let initPromise: Promise<InitOutput> | null = null;
let wasmExports: typeof import('../../../../crates/frame-buffer/pkg/frame_buffer') | null = null;

/**
 * Initialize the WASM module (lazy, singleton)
 */
export async function initWasm(): Promise<InitOutput> {
  if (wasmModule) {
    return wasmModule;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      // Dynamic import of the WASM module
      const module = await import('../../../../crates/frame-buffer/pkg/frame_buffer');

      // Initialize WASM
      const output = await module.default();

      // Call init() to set up panic hook
      module.init();

      wasmExports = module;
      wasmModule = output;

      console.log('[WASM] Frame buffer module initialized');
      return output;
    } catch (error) {
      initPromise = null;
      console.error('[WASM] Failed to initialize frame buffer:', error);
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Get the WASM exports (must call initWasm first)
 */
export function getWasmExports(): typeof import('../../../../crates/frame-buffer/pkg/frame_buffer') {
  if (!wasmExports) {
    throw new Error('WASM module not initialized. Call initWasm() first.');
  }
  return wasmExports;
}

/**
 * Check if WASM is initialized
 */
export function isWasmReady(): boolean {
  return wasmModule !== null;
}

/**
 * Create a new FrameBuffer instance
 */
export function createFrameBuffer(capacity: number, fps: number): FrameBuffer {
  const exports = getWasmExports();
  return new exports.FrameBuffer(capacity, fps);
}

/**
 * Create a new FrameInfo instance
 */
export function createFrameInfo(
  frameNumber: number,
  ptsMs: number,
  durationMs: number,
  width: number,
  height: number,
  jsHandle: number,
  isKeyframe: boolean
): FrameInfo {
  const exports = getWasmExports();
  return new exports.FrameInfo(frameNumber, ptsMs, durationMs, width, height, jsHandle, isKeyframe);
}

/**
 * Create a new AVSync instance
 */
export function createAVSync(syncThresholdMs: number): AVSync {
  const exports = getWasmExports();
  return new exports.AVSync(syncThresholdMs);
}

/**
 * Get BufferState enum values
 */
export function getBufferStateEnum() {
  const exports = getWasmExports();
  return exports.BufferState;
}
