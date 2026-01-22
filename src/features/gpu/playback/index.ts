/**
 * @module features/gpu/playback
 *
 * High-Performance Video Playback Module
 *
 * This module provides buffered video playback using:
 * - Rust/WASM ring buffer for efficient frame management
 * - WebCodecs for hardware-accelerated decoding
 * - A/V sync for smooth playback
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
 * │  WebCodecs      │───►│  VideoFrame      │───►│  Rust Frame     │
 * │  Decoder        │    │  Storage (JS)    │    │  Buffer (WASM)  │
 * └─────────────────┘    └──────────────────┘    └─────────────────┘
 *                              │ (actual frames)        │ (metadata)
 *                              ▼                        ▼
 *                        ┌──────────────────────────────────┐
 *                        │     Buffered Playback Controller │
 *                        │     - Display loop               │
 *                        │     - A/V sync                   │
 *                        │     - Buffer management          │
 *                        └──────────────────────────────────┘
 *                                       │
 *                                       ▼
 *                               ┌───────────────┐
 *                               │  GPU Display  │
 *                               │  (WebGPU/GL)  │
 *                               └───────────────┘
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * import { createBufferedPlaybackController } from './playback';
 * import { createMediaSourceManager } from './media';
 *
 * // Create controller
 * const controller = await createBufferedPlaybackController({
 *   bufferCapacity: 60, // 2 seconds at 30fps
 *   syncThresholdMs: 40,
 * });
 *
 * // Set source
 * const sourceManager = createMediaSourceManager();
 * const source = await sourceManager.createSource('video.mp4');
 * controller.setSource(source);
 *
 * // Listen for frames
 * controller.on('frame', ({ frame, frameNumber, shouldDrop }) => {
 *   if (!shouldDrop) {
 *     renderToGPU(frame);
 *   }
 * });
 *
 * // Start playback
 * await controller.play();
 * ```
 *
 * ## Performance Characteristics
 *
 * | Buffer State | Description | Behavior |
 * |--------------|-------------|----------|
 * | Starving | Empty buffer | Pause and buffer |
 * | Low | Below 25% | Increase decode rate |
 * | Healthy | 25-75% | Normal operation |
 * | Full | Above 75% | Throttle decode |
 *
 * ## A/V Sync
 *
 * The controller maintains audio/video sync using:
 * - Drift tracking (video time - audio time)
 * - Frame dropping when video is behind
 * - Frame repetition when video is ahead
 * - Configurable sync threshold (default: 40ms)
 */

// WASM loader and types
export {
  initWasm,
  isWasmReady,
  createFrameBuffer,
  createFrameInfo,
  createAVSync,
  getBufferStateEnum,
  type FrameBuffer,
  type FrameInfo,
  type AVSync,
  type BufferStats,
  type BufferState,
} from './wasm-loader';

// Video frame storage
export {
  VideoFrameStorage,
  createVideoFrameStorage,
  type StoredFrame,
  type VideoFrameStorageStats,
} from './video-frame-storage';

// Buffered playback controller
export {
  BufferedPlaybackController,
  createBufferedPlaybackController,
  type PlaybackState,
  type PlaybackConfig,
  type PlaybackStats,
  type PlaybackFrame,
} from './buffered-playback-controller';
