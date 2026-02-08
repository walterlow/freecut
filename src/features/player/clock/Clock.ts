/**
 * Clock.ts - Central timing system for the video player
 *
 * The Clock is the single source of truth for playback timing.
 * It manages:
 * - Current frame/time position
 * - Play/pause state
 * - Playback rate
 * - Frame change events
 *
 * Design principles:
 * - Independent of React render cycle for performance
 * - Event-driven updates to minimize re-renders
 * - Supports both frame-based and time-based operations
 * - Handles variable playback rates
 */

type ClockEventType =
  | 'framechange'
  | 'play'
  | 'pause'
  | 'seek'
  | 'ratechange'
  | 'ended'
  | 'timeupdate';

interface ClockEvent {
  type: ClockEventType;
  frame: number;
  time: number;
  isPlaying: boolean;
  playbackRate: number;
}

type ClockEventCallback = (event: ClockEvent) => void;

export interface ClockConfig {
  fps: number;
  durationInFrames: number;
  initialFrame?: number;
  loop?: boolean;
  onEnded?: () => void;
}

/**
 * Clock class - manages playback timing independent of React
 */
export class Clock {
  // Configuration
  private _fps: number;
  private _durationInFrames: number;
  private _loop: boolean;
  private _onEnded?: () => void;

  // State
  private _currentFrame: number;
  private _isPlaying: boolean = false;
  private _playbackRate: number = 1;

  // Animation loop
  private _animationFrameId: number | null = null;
  private _playbackStartTime: number = 0;
  private _playbackStartFrame: number = 0;

  // In/out points for range playback
  private _inFrame: number | null = null;
  private _outFrame: number | null = null;

  // Event listeners
  private _listeners: Map<ClockEventType, Set<ClockEventCallback>> = new Map();

  // Throttling for timeupdate events
  private _lastTimeUpdateEmit: number = 0;
  private readonly TIME_UPDATE_INTERVAL_MS = 100;

  constructor(config: ClockConfig) {
    this._fps = config.fps;
    this._durationInFrames = config.durationInFrames;
    this._currentFrame = config.initialFrame ?? 0;
    this._loop = config.loop ?? false;
    this._onEnded = config.onEnded;

    // Initialize listener maps
    const eventTypes: ClockEventType[] = [
      'framechange',
      'play',
      'pause',
      'seek',
      'ratechange',
      'ended',
      'timeupdate',
    ];
    eventTypes.forEach((type) => {
      this._listeners.set(type, new Set());
    });
  }

  // ============================================
  // Getters
  // ============================================

  get fps(): number {
    return this._fps;
  }

  get durationInFrames(): number {
    return this._durationInFrames;
  }

  get durationInSeconds(): number {
    return this._durationInFrames / this._fps;
  }

  get currentFrame(): number {
    return this._currentFrame;
  }

  get currentTime(): number {
    return this._currentFrame / this._fps;
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  get playbackRate(): number {
    return this._playbackRate;
  }

  get loop(): boolean {
    return this._loop;
  }

  get inFrame(): number {
    return this._inFrame ?? 0;
  }

  get outFrame(): number {
    return this._outFrame ?? this._durationInFrames - 1;
  }

  get actualFirstFrame(): number {
    return this._inFrame ?? 0;
  }

  get actualLastFrame(): number {
    return this._outFrame ?? this._durationInFrames - 1;
  }

  // ============================================
  // Setters
  // ============================================

  set fps(value: number) {
    if (value <= 0) {
      throw new Error('FPS must be positive');
    }
    this._fps = value;
  }

  set durationInFrames(value: number) {
    if (value <= 0) {
      throw new Error('Duration must be positive');
    }
    this._durationInFrames = value;
    // Clamp current frame if it exceeds new duration
    if (this._currentFrame >= value) {
      this.seekToFrame(value - 1);
    }
  }

  set loop(value: boolean) {
    this._loop = value;
  }

  set playbackRate(value: number) {
    if (value === 0) {
      throw new Error('Playback rate cannot be zero');
    }
    const oldRate = this._playbackRate;
    this._playbackRate = value;

    // If playing, reset the playback start point to maintain continuity
    if (this._isPlaying) {
      this._playbackStartTime = performance.now();
      this._playbackStartFrame = this._currentFrame;
    }

    if (oldRate !== value) {
      this._emit('ratechange');
    }
  }

  // ============================================
  // In/Out Point Methods
  // ============================================

  setInPoint(frame: number | null): void {
    if (frame !== null) {
      this._inFrame = Math.max(0, Math.min(frame, this._durationInFrames - 1));
    } else {
      this._inFrame = null;
    }
  }

  setOutPoint(frame: number | null): void {
    if (frame !== null) {
      this._outFrame = Math.max(0, Math.min(frame, this._durationInFrames - 1));
    } else {
      this._outFrame = null;
    }
  }

  clearInOutPoints(): void {
    this._inFrame = null;
    this._outFrame = null;
  }

  // ============================================
  // Playback Control Methods
  // ============================================

  play(): void {
    if (this._isPlaying) {
      return;
    }

    // If at the end, restart from beginning (or in point)
    if (this._currentFrame >= this.actualLastFrame) {
      this._currentFrame = this.actualFirstFrame;
    }

    this._isPlaying = true;
    this._playbackStartTime = performance.now();
    this._playbackStartFrame = this._currentFrame;

    this._emit('play');
    this._startAnimationLoop();
  }

  pause(): void {
    if (!this._isPlaying) {
      return;
    }

    this._isPlaying = false;
    this._stopAnimationLoop();
    this._emit('pause');
  }

  toggle(): void {
    if (this._isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  /**
   * Seek to a specific frame
   */
  seekToFrame(frame: number): void {
    const clampedFrame = this._clampFrame(frame);
    const frameChanged = clampedFrame !== this._currentFrame;

    this._currentFrame = clampedFrame;

    // Reset playback reference point if playing
    if (this._isPlaying) {
      this._playbackStartTime = performance.now();
      this._playbackStartFrame = clampedFrame;
    }

    if (frameChanged) {
      this._emit('seek');
      this._emit('framechange');
    }
  }

  /**
   * Seek to a specific time in seconds
   */
  seekToTime(time: number): void {
    const frame = Math.round(time * this._fps);
    this.seekToFrame(frame);
  }

  /**
   * Move forward by a number of frames
   */
  stepForward(frames: number = 1): void {
    if (this._isPlaying) return;
    this.seekToFrame(this._currentFrame + frames);
  }

  /**
   * Move backward by a number of frames
   */
  stepBackward(frames: number = 1): void {
    if (this._isPlaying) return;
    this.seekToFrame(this._currentFrame - frames);
  }

  /**
   * Go to the first frame (or in point)
   */
  goToStart(): void {
    this.seekToFrame(this.actualFirstFrame);
  }

  /**
   * Go to the last frame (or out point)
   */
  goToEnd(): void {
    this.seekToFrame(this.actualLastFrame);
  }

  // ============================================
  // Event System
  // ============================================

  addEventListener(type: ClockEventType, callback: ClockEventCallback): void {
    const listeners = this._listeners.get(type);
    if (listeners) {
      listeners.add(callback);
    }
  }

  removeEventListener(type: ClockEventType, callback: ClockEventCallback): void {
    const listeners = this._listeners.get(type);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  /**
   * Subscribe to frame changes - returns unsubscribe function
   */
  onFrameChange(callback: (frame: number) => void): () => void {
    const wrappedCallback: ClockEventCallback = (event) => {
      callback(event.frame);
    };
    this.addEventListener('framechange', wrappedCallback);
    return () => this.removeEventListener('framechange', wrappedCallback);
  }

  /**
   * Subscribe to play state changes - returns unsubscribe function
   */
  onPlayStateChange(callback: (isPlaying: boolean) => void): () => void {
    const playCallback: ClockEventCallback = () => callback(true);
    const pauseCallback: ClockEventCallback = () => callback(false);

    this.addEventListener('play', playCallback);
    this.addEventListener('pause', pauseCallback);

    return () => {
      this.removeEventListener('play', playCallback);
      this.removeEventListener('pause', pauseCallback);
    };
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Convert frame number to time in seconds
   */
  frameToTime(frame: number): number {
    return frame / this._fps;
  }

  /**
   * Convert time in seconds to frame number
   */
  timeToFrame(time: number): number {
    return Math.round(time * this._fps);
  }

  /**
   * Check if a frame is within the current in/out range
   */
  isFrameInRange(frame: number): boolean {
    return frame >= this.actualFirstFrame && frame <= this.actualLastFrame;
  }

  /**
   * Get the current state as an object
   */
  getState(): ClockEvent {
    return {
      type: 'timeupdate',
      frame: this._currentFrame,
      time: this.currentTime,
      isPlaying: this._isPlaying,
      playbackRate: this._playbackRate,
    };
  }

  /**
   * Dispose of the clock and clean up resources
   */
  dispose(): void {
    this._stopAnimationLoop();
    this._listeners.forEach((listeners) => listeners.clear());
  }

  // ============================================
  // Private Methods
  // ============================================

  private _clampFrame(frame: number): number {
    const minFrame = this.actualFirstFrame;
    const maxFrame = this.actualLastFrame;
    return Math.max(minFrame, Math.min(Math.round(frame), maxFrame));
  }

  private _emit(type: ClockEventType): void {
    const event: ClockEvent = {
      type,
      frame: this._currentFrame,
      time: this.currentTime,
      isPlaying: this._isPlaying,
      playbackRate: this._playbackRate,
    };

    const listeners = this._listeners.get(type);
    if (listeners) {
      listeners.forEach((callback) => {
        try {
          callback(event);
        } catch (error) {
          console.error(`Error in clock event listener (${type}):`, error);
        }
      });
    }
  }

  private _startAnimationLoop(): void {
    if (this._animationFrameId !== null) {
      return;
    }

    const tick = (): void => {
      if (!this._isPlaying) {
        this._animationFrameId = null;
        return;
      }

      const now = performance.now();
      const elapsedMs = now - this._playbackStartTime;
      const elapsedSeconds = elapsedMs / 1000;

      // Calculate new frame based on elapsed time and playback rate
      const framesElapsed = elapsedSeconds * this._fps * this._playbackRate;
      let newFrame: number;

      if (this._playbackRate >= 0) {
        newFrame = Math.floor(this._playbackStartFrame + framesElapsed);
      } else {
        newFrame = Math.ceil(this._playbackStartFrame + framesElapsed);
      }

      // Check boundaries
      const hasReachedEnd =
        this._playbackRate >= 0
          ? newFrame > this.actualLastFrame
          : newFrame < this.actualFirstFrame;

      if (hasReachedEnd) {
        if (this._loop) {
          // Loop back to start/end
          const targetFrame =
            this._playbackRate >= 0 ? this.actualFirstFrame : this.actualLastFrame;
          this._currentFrame = targetFrame;
          this._playbackStartTime = now;
          this._playbackStartFrame = targetFrame;
          this._emit('framechange');
        } else {
          // Stop at boundary
          this._currentFrame =
            this._playbackRate >= 0 ? this.actualLastFrame : this.actualFirstFrame;
          this._isPlaying = false;
          this._emit('framechange');
          this._emit('ended');
          this._onEnded?.();
          this._animationFrameId = null;
          return;
        }
      } else if (newFrame !== this._currentFrame) {
        this._currentFrame = newFrame;
        this._emit('framechange');
      }

      // Emit throttled timeupdate events
      if (now - this._lastTimeUpdateEmit >= this.TIME_UPDATE_INTERVAL_MS) {
        this._lastTimeUpdateEmit = now;
        this._emit('timeupdate');
      }

      // Continue the loop
      this._animationFrameId = requestAnimationFrame(tick);
    };

    this._animationFrameId = requestAnimationFrame(tick);
  }

  private _stopAnimationLoop(): void {
    if (this._animationFrameId !== null) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }
  }
}

/**
 * Factory function to create a Clock instance
 */
export function createClock(config: ClockConfig): Clock {
  return new Clock(config);
}
