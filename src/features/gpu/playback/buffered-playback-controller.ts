/**
 * Buffered Playback Controller
 *
 * High-performance video playback using:
 * - WebCodecs for hardware-accelerated decoding
 * - Rust/WASM ring buffer for frame management
 * - A/V sync for smooth playback
 *
 * Architecture:
 * ```
 * WebCodecs Decoder → VideoFrameStorage → Rust FrameBuffer → Display Loop
 *                          ↓                    ↓
 *                    (actual frames)      (metadata only)
 * ```
 */

import type { FrameBuffer, AVSync } from './wasm-loader';
import {
  initWasm,
  createFrameBuffer,
  createFrameInfo,
  createAVSync,
  getBufferStateEnum,
} from './wasm-loader';
import { VideoFrameStorage, createVideoFrameStorage } from './video-frame-storage';
import type { ManagedMediaSource, DecodedVideoFrame } from '../media';

export type PlaybackState = 'idle' | 'buffering' | 'playing' | 'paused' | 'seeking' | 'ended';

export interface PlaybackConfig {
  /** Buffer capacity in frames (default: 60 = 2 seconds at 30fps) */
  bufferCapacity?: number;
  /** A/V sync threshold in ms (default: 40ms) */
  syncThresholdMs?: number;
  /** Target buffer fill before starting playback (0-1, default: 0.5) */
  targetBufferFill?: number;
  /** Enable A/V sync (default: true) */
  enableAVSync?: boolean;
}

export interface PlaybackStats {
  /** Current playback state */
  state: PlaybackState;
  /** Current frame number */
  currentFrame: number;
  /** Current time in ms */
  currentTimeMs: number;
  /** Buffer statistics from Rust */
  buffer: {
    frameCount: number;
    capacity: number;
    state: 'starving' | 'low' | 'healthy' | 'full';
    durationMs: number;
    framesDecoded: number;
    framesDisplayed: number;
    framesDropped: number;
  };
  /** A/V sync info */
  sync: {
    driftMs: number;
    isSynced: boolean;
  };
  /** Frame storage stats */
  storage: {
    frameCount: number;
    handlesInUse: number;
  };
}

export interface PlaybackFrame {
  /** The VideoFrame to display */
  frame: VideoFrame;
  /** Frame number */
  frameNumber: number;
  /** Presentation time in ms */
  ptsMs: number;
  /** Whether this frame should be dropped (for sync) */
  shouldDrop: boolean;
  /** Whether to repeat previous frame (for sync) */
  shouldRepeat: boolean;
}

type PlaybackEventType = 'statechange' | 'frame' | 'buffering' | 'error' | 'ended';

interface PlaybackEventMap {
  statechange: { state: PlaybackState; previousState: PlaybackState };
  frame: PlaybackFrame;
  buffering: { progress: number };
  error: { message: string; error?: Error };
  ended: {};
}

type PlaybackEventCallback<T extends PlaybackEventType> = (
  event: PlaybackEventMap[T]
) => void;

/**
 * Buffered playback controller with Rust/WASM frame buffer
 */
export class BufferedPlaybackController {
  private source: ManagedMediaSource | null = null;
  private frameBuffer: FrameBuffer | null = null;
  private avSync: AVSync | null = null;
  private storage: VideoFrameStorage;
  private config: Required<PlaybackConfig>;

  private state: PlaybackState = 'idle';
  private currentFrame: number = 0;
  private playbackStartTime: number = 0;
  private fps: number = 30;
  private totalFrames: number = 0;

  private decodeLoopId: number | null = null;
  private displayLoopId: number | null = null;
  private isDecoding: boolean = false;

  private listeners: Map<PlaybackEventType, Set<PlaybackEventCallback<any>>> = new Map();

  constructor(config: PlaybackConfig = {}) {
    this.config = {
      bufferCapacity: config.bufferCapacity ?? 60,
      syncThresholdMs: config.syncThresholdMs ?? 40,
      targetBufferFill: config.targetBufferFill ?? 0.5,
      enableAVSync: config.enableAVSync ?? true,
    };

    this.storage = createVideoFrameStorage();
  }

  /**
   * Initialize the controller (loads WASM)
   */
  async init(): Promise<void> {
    await initWasm();
    console.log('[Playback] Controller initialized');
  }

  /**
   * Set the media source
   */
  setSource(source: ManagedMediaSource): void {
    this.cleanup();

    this.source = source;

    // Get video info from probe result
    const videoInfo = source.probeResult?.video;
    if (!videoInfo) {
      throw new Error('Source has no video track');
    }

    this.fps = videoInfo.frameRate;
    // Calculate total frames from probe result duration
    const durationMs = source.probeResult?.durationMs ?? 0;
    this.totalFrames = Math.ceil((durationMs / 1000) * this.fps);

    // Create Rust frame buffer
    this.frameBuffer = createFrameBuffer(this.config.bufferCapacity, this.fps);

    // Create A/V sync if enabled
    if (this.config.enableAVSync) {
      this.avSync = createAVSync(this.config.syncThresholdMs);
    }

    this.setState('idle');
    console.log(`[Playback] Source set: ${this.fps}fps, ${this.totalFrames} frames`);
  }

  /**
   * Start playback from current position
   */
  async play(): Promise<void> {
    if (!this.source || !this.frameBuffer) {
      throw new Error('No source set');
    }

    if (this.state === 'playing') return;

    // Start buffering
    this.setState('buffering');

    // Start decode loop
    this.startDecodeLoop();

    // Wait for buffer to fill
    await this.waitForBuffer();

    // Start playback
    this.playbackStartTime = performance.now();
    this.frameBuffer.start_playback(this.currentFrame, this.playbackStartTime);

    if (this.avSync) {
      this.avSync.reset();
    }

    this.setState('playing');

    // Start display loop
    this.startDisplayLoop();
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (this.state !== 'playing') return;

    this.stopDisplayLoop();
    this.frameBuffer?.stop_playback();
    this.setState('paused');
  }

  /**
   * Seek to a specific frame
   */
  async seek(frameNumber: number): Promise<void> {
    if (!this.source || !this.frameBuffer) return;

    const wasPlaying = this.state === 'playing';
    if (wasPlaying) {
      this.pause();
    }

    this.setState('seeking');

    // Clear buffer
    const handles = this.frameBuffer.clear();
    this.storage.releaseMany(handles);

    // Update position
    this.currentFrame = Math.max(0, Math.min(frameNumber, this.totalFrames - 1));

    // Decode frames around seek position
    this.startDecodeLoop();
    await this.waitForBuffer();

    if (wasPlaying) {
      await this.play();
    } else {
      this.setState('paused');
    }
  }

  /**
   * Stop playback and reset
   */
  stop(): void {
    this.stopDisplayLoop();
    this.stopDecodeLoop();

    if (this.frameBuffer) {
      const handles = this.frameBuffer.clear();
      this.storage.releaseMany(handles);
      this.frameBuffer.stop_playback();
    }

    this.currentFrame = 0;
    this.setState('idle');
  }

  /**
   * Get current playback statistics
   */
  getStats(): PlaybackStats {
    const bufferStats = this.frameBuffer?.get_stats();
    const BufferState = getBufferStateEnum();

    const bufferState = bufferStats
      ? (() => {
          switch (bufferStats.state) {
            case BufferState.Starving:
              return 'starving' as const;
            case BufferState.Low:
              return 'low' as const;
            case BufferState.Healthy:
              return 'healthy' as const;
            case BufferState.Full:
              return 'full' as const;
            default:
              return 'starving' as const;
          }
        })()
      : ('starving' as const);

    const storageStats = this.storage.getStats();

    return {
      state: this.state,
      currentFrame: this.currentFrame,
      currentTimeMs: (this.currentFrame / this.fps) * 1000,
      buffer: {
        frameCount: bufferStats?.frame_count ?? 0,
        capacity: bufferStats?.capacity ?? this.config.bufferCapacity,
        state: bufferState,
        durationMs: bufferStats?.buffer_duration_ms ?? 0,
        framesDecoded: bufferStats?.frames_decoded ?? 0,
        framesDisplayed: bufferStats?.frames_displayed ?? 0,
        framesDropped: bufferStats?.frames_dropped ?? 0,
      },
      sync: {
        driftMs: this.avSync?.get_drift_ms() ?? 0,
        isSynced: this.avSync?.is_synced() ?? true,
      },
      storage: {
        frameCount: storageStats.frameCount,
        handlesInUse: storageStats.handlesInUse,
      },
    };
  }

  /**
   * Get the current frame to display (for scrubbing/preview)
   */
  async getCurrentFrame(): Promise<VideoFrame | null> {
    if (!this.source || !this.frameBuffer) return null;

    // Check buffer first
    const frameInfo = this.frameBuffer.get_frame_by_number(this.currentFrame);
    if (frameInfo) {
      return this.storage.get(frameInfo.js_handle);
    }

    // Decode on demand
    const decoded = await this.source.getVideoFrameByNumber(this.currentFrame);
    if (!decoded) return null;

    // Convert to VideoFrame if needed
    return this.convertToVideoFrame(decoded);
  }

  /**
   * Subscribe to playback events
   */
  on<T extends PlaybackEventType>(event: T, callback: PlaybackEventCallback<T>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  /**
   * Unsubscribe from playback events
   */
  off<T extends PlaybackEventType>(event: T, callback: PlaybackEventCallback<T>): void {
    this.listeners.get(event)?.delete(callback);
  }

  /**
   * Dispose of the controller
   */
  dispose(): void {
    this.cleanup();
    this.storage.dispose();
    this.listeners.clear();
  }

  // Private methods

  private setState(state: PlaybackState): void {
    if (this.state === state) return;

    const previousState = this.state;
    this.state = state;
    this.emit('statechange', { state, previousState });
  }

  private emit<T extends PlaybackEventType>(event: T, data: PlaybackEventMap[T]): void {
    this.listeners.get(event)?.forEach((cb) => cb(data));
  }

  private cleanup(): void {
    this.stopDisplayLoop();
    this.stopDecodeLoop();

    if (this.frameBuffer) {
      const handles = this.frameBuffer.clear();
      this.storage.releaseMany(handles);
      this.frameBuffer.free();
      this.frameBuffer = null;
    }

    if (this.avSync) {
      this.avSync.free();
      this.avSync = null;
    }
  }

  private async waitForBuffer(): Promise<void> {
    const targetFrames = Math.floor(this.config.bufferCapacity * this.config.targetBufferFill);

    return new Promise((resolve) => {
      const check = () => {
        const stats = this.frameBuffer?.get_stats();
        const frameCount = stats?.frame_count ?? 0;
        const progress = frameCount / targetFrames;

        this.emit('buffering', { progress: Math.min(1, progress) });

        if (frameCount >= targetFrames || !this.frameBuffer?.needs_frames()) {
          resolve();
        } else {
          setTimeout(check, 16);
        }
      };
      check();
    });
  }

  private startDecodeLoop(): void {
    if (this.decodeLoopId !== null) return;

    const decode = async () => {
      if (!this.source || !this.frameBuffer || this.isDecoding) {
        this.decodeLoopId = requestAnimationFrame(() => decode());
        return;
      }

      // Check if buffer needs frames
      if (!this.frameBuffer.needs_frames()) {
        this.decodeLoopId = requestAnimationFrame(() => decode());
        return;
      }

      this.isDecoding = true;

      try {
        // Get next frame to decode
        const frameNumber = this.frameBuffer.get_next_decode_frame();

        if (frameNumber >= this.totalFrames) {
          // End of video
          this.isDecoding = false;
          return;
        }

        // Decode frame
        const decoded = await this.source.getVideoFrameByNumber(frameNumber);
        if (!decoded) {
          this.isDecoding = false;
          this.decodeLoopId = requestAnimationFrame(() => decode());
          return;
        }

        // Convert to VideoFrame
        const videoFrame = await this.convertToVideoFrame(decoded);
        if (!videoFrame) {
          this.isDecoding = false;
          this.decodeLoopId = requestAnimationFrame(() => decode());
          return;
        }

        // Store frame and get handle
        const handle = this.storage.store(videoFrame, frameNumber);

        // Create FrameInfo for Rust
        const frameInfo = createFrameInfo(
          frameNumber,
          decoded.timestampMs,
          decoded.durationMs,
          decoded.width,
          decoded.height,
          handle,
          decoded.isKeyframe
        );

        // Push to Rust buffer
        const evictedHandle = this.frameBuffer.push_frame(frameInfo);

        // Release evicted frame if any
        if (evictedHandle !== undefined) {
          this.storage.release(evictedHandle);
        }
      } catch (error) {
        console.error('[Playback] Decode error:', error);
        this.emit('error', {
          message: 'Decode error',
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }

      this.isDecoding = false;
      this.decodeLoopId = requestAnimationFrame(() => decode());
    };

    decode();
  }

  private stopDecodeLoop(): void {
    if (this.decodeLoopId !== null) {
      cancelAnimationFrame(this.decodeLoopId);
      this.decodeLoopId = null;
    }
    this.isDecoding = false;
  }

  private startDisplayLoop(): void {
    if (this.displayLoopId !== null) return;

    const display = () => {
      if (this.state !== 'playing' || !this.frameBuffer) {
        return;
      }

      const now = performance.now();
      const ptsMs = this.frameBuffer.get_presentation_time(now);

      // Get frame for current time
      const frameInfo = this.frameBuffer.get_frame_for_time(ptsMs);

      if (frameInfo) {
        const frame = this.storage.get(frameInfo.js_handle);

        if (frame) {
          // Update A/V sync
          if (this.avSync) {
            this.avSync.set_video_time(frameInfo.pts_ms);
          }

          // Determine sync action
          let shouldDrop = false;
          let shouldRepeat = false;

          if (this.avSync) {
            const action = this.avSync.get_sync_action();
            shouldDrop = action === -1;
            shouldRepeat = action === 1;
          }

          // Emit frame event
          this.emit('frame', {
            frame,
            frameNumber: frameInfo.frame_number,
            ptsMs: frameInfo.pts_ms,
            shouldDrop,
            shouldRepeat,
          });

          this.currentFrame = frameInfo.frame_number;

          // Release frame after display (it's been removed from buffer)
          // Note: Don't release here if frame is being used by GPU
          // The renderer should call release when done
        }
      }

      // Check for end of video
      const stats = this.frameBuffer.get_stats();
      if (
        this.currentFrame >= this.totalFrames - 1 &&
        stats.frame_count === 0
      ) {
        this.setState('ended');
        this.emit('ended', {});
        return;
      }

      // Check for buffer underrun
      const BufferState = getBufferStateEnum();
      if (stats.state === BufferState.Starving && this.currentFrame < this.totalFrames - 1) {
        this.setState('buffering');
        this.waitForBuffer().then(() => {
          if (this.state === 'buffering') {
            this.setState('playing');
            this.startDisplayLoop();
          }
        });
        return;
      }

      this.displayLoopId = requestAnimationFrame(display);
    };

    this.displayLoopId = requestAnimationFrame(display);
  }

  private stopDisplayLoop(): void {
    if (this.displayLoopId !== null) {
      cancelAnimationFrame(this.displayLoopId);
      this.displayLoopId = null;
    }
  }

  private async convertToVideoFrame(decoded: DecodedVideoFrame): Promise<VideoFrame | null> {
    // If already a VideoFrame, return it
    if ('codedWidth' in decoded && typeof (decoded as any).close === 'function') {
      return decoded as unknown as VideoFrame;
    }

    // If it's raw pixel data, create VideoFrame
    if (decoded.data instanceof Uint8Array) {
      try {
        const frame = new VideoFrame(decoded.data, {
          format: decoded.format === 'rgba' ? 'RGBA' : 'I420',
          codedWidth: decoded.width,
          codedHeight: decoded.height,
          timestamp: decoded.timestampMs * 1000, // VideoFrame uses microseconds
        });
        return frame;
      } catch (error) {
        console.error('[Playback] Failed to create VideoFrame:', error);
        return null;
      }
    }

    return null;
  }
}

/**
 * Create a new BufferedPlaybackController
 */
export async function createBufferedPlaybackController(
  config?: PlaybackConfig
): Promise<BufferedPlaybackController> {
  const controller = new BufferedPlaybackController(config);
  await controller.init();
  return controller;
}
