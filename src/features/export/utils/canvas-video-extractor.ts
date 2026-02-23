/**
 * Video frame extractor using mediabunny for precise frame access.
 *
 * This replaces HTML5 video element seeking which is slow and imprecise.
 * Benefits:
 * - Precise frame-by-frame access (no seek delays)
 * - Pre-decoded frames for instant access
 * - No 500ms timeout fallbacks needed
 */

import { createLogger } from '@/lib/logger';

const log = createLogger('VideoFrameExtractor');

/** Types for dynamically imported mediabunny module */
interface MediabunnySink {
  samples(startTimestamp?: number, endTimestamp?: number): AsyncGenerator<MediabunnySample, void, unknown>;
}

interface MediabunnySample {
  timestamp: number;
  toVideoFrame(): VideoFrame | null;
  close(): void;
}

interface MediabunnyInput {
  getPrimaryVideoTrack(): Promise<MediabunnyVideoTrack | null>;
  computeDuration(): Promise<number>;
  dispose(): void;
}

interface MediabunnyVideoTrack {
  duration: number;
  displayWidth: number;
  displayHeight: number;
  canDecode?: () => Promise<boolean>;
}

export class VideoFrameExtractor {
  private static readonly TIMESTAMP_EPSILON = 1e-4;
  private static readonly LOOKAHEAD_TOLERANCE_SECONDS = 0.05;
  private static readonly STREAM_BACKTRACK_SECONDS = 1.0;

  private sink: MediabunnySink | null = null;
  private input: MediabunnyInput | null = null;
  private videoTrack: MediabunnyVideoTrack | null = null;
  private duration: number = 0;
  private ready: boolean = false;
  private drawFailureCount = 0;
  private sampleIterator: AsyncGenerator<MediabunnySample, void, unknown> | null = null;
  private currentSample: MediabunnySample | null = null;
  private nextSample: MediabunnySample | null = null;
  private iteratorDone = false;
  private lastRequestedTimestamp: number | null = null;
  private sampleLoopError: unknown = null;
  private lastFailureKind: 'none' | 'no-sample' | 'decode-error' = 'none';
  /**
   * Cached VideoFrame from the current sample.  Kept alive between draws so
   * that repeated draws of the same sample (common during transitions past the
   * clip's timeline end) reuse the same VideoFrame instead of calling
   * toVideoFrame() after a previous close() has invalidated the sample data.
   */
  private cachedVideoFrame: VideoFrame | null = null;
  private cachedVideoFrameSample: MediabunnySample | null = null;

  constructor(
    private src: string,
    private itemId: string
  ) {}

  /**
   * Initialize the extractor - must be called before drawFrame()
   */
  async init(): Promise<boolean> {
    try {
      const mb = await import('mediabunny');

      // Fetch the video data from blob URL
      const response = await fetch(this.src);
      const blob = await response.blob();

      // Create input from blob
      this.input = new mb.Input({
        formats: mb.ALL_FORMATS,
        source: new mb.BlobSource(blob),
      }) as unknown as MediabunnyInput;

      // Get video track
      this.videoTrack = await this.input!.getPrimaryVideoTrack();
      if (!this.videoTrack) {
        log.warn('No video track found', { itemId: this.itemId });
        return false;
      }

      if (typeof this.videoTrack.canDecode === 'function') {
        const decodable = await this.videoTrack.canDecode();
        if (!decodable) {
          log.warn('Video track is not decodable via mediabunny/WebCodecs', {
            itemId: this.itemId,
          });
          return false;
        }
      }

      // Get duration
      this.duration = await this.input!.computeDuration();

      // Create video sample sink for frame extraction
      this.sink = new mb.VideoSampleSink(
        this.videoTrack as unknown as ConstructorParameters<typeof mb.VideoSampleSink>[0]
      );

      this.ready = true;
      log.debug('Initialized', {
        itemId: this.itemId,
        duration: this.duration,
        width: this.videoTrack.displayWidth,
        height: this.videoTrack.displayHeight,
      });

      return true;
    } catch (error) {
      log.error('Failed to initialize', { itemId: this.itemId, error });
      return false;
    }
  }

  /**
   * Draw a frame at the specified timestamp directly to canvas.
   * Properly manages VideoSample lifecycle by closing immediately after draw.
   */
  async drawFrame(
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    timestamp: number,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<boolean> {
    if (!this.ready || !this.sink) {
      return false;
    }

    const maxTime = Math.max(0, this.duration - 0.001);
    const clampedTime = Math.max(0, Math.min(timestamp, maxTime));
    let lastError: unknown = this.sampleLoopError;

    try {
      await this.ensureSampleForTimestamp(clampedTime);
      const drawOk = this.drawCurrentSample(ctx, x, y, width, height);
      if (drawOk) {
        this.drawFailureCount = 0;
        this.lastFailureKind = 'none';
        return true;
      }

      lastError = this.sampleLoopError;
      return this.reportDrawFailure(timestamp, clampedTime, lastError);
    } catch (error) {
      lastError = error;
      this.sampleLoopError = error;

      const recovered = await this.recoverAndPrime(clampedTime, error);
      if (recovered) {
        const drawOk = this.drawCurrentSample(ctx, x, y, width, height);
        if (drawOk) {
          this.drawFailureCount = 0;
          this.lastFailureKind = 'none';
          return true;
        }
        lastError = this.sampleLoopError;
      }

      this.lastFailureKind = this.lastFailureKind === 'no-sample' ? 'no-sample' : 'decode-error';
      return this.reportDrawFailure(timestamp, clampedTime, lastError);
    }
  }

  private async ensureSampleForTimestamp(timestamp: number): Promise<void> {
    if (!this.sink) return;

    // Use a forward sample stream instead of samplesAtTimestamps/getSample.
    // Mediabunny's timestamp-based path can flush decoders at GOP boundaries;
    // for some files that leads to repeated "key frame required after flush".
    if (!this.sampleIterator) {
      this.resetSampleIterator(timestamp, 'init');
    } else if (
      this.lastRequestedTimestamp !== null
      && timestamp + VideoFrameExtractor.TIMESTAMP_EPSILON < this.lastRequestedTimestamp
    ) {
      // Timeline time moved backward for this clip (rare during export). Restart stream.
      this.resetSampleIterator(timestamp, 'backward');
    }

    this.lastRequestedTimestamp = timestamp;

    while (true) {
      const candidate = await this.peekNextSample();
      if (!candidate) break;
      if (candidate.timestamp <= timestamp + VideoFrameExtractor.TIMESTAMP_EPSILON) {
        // Moving to a new sample — release the cached VideoFrame first
        // so it's closed before the old sample is closed.
        this.closeCachedVideoFrame();
        this.closeSample(this.currentSample);
        this.currentSample = candidate;
        this.nextSample = null;
        continue;
      }

      // If this is the first sample after stream start/restart and it's only
      // slightly ahead of the requested timestamp, use it to avoid false misses
      // caused by timestamp quantization/drift.
      if (
        !this.currentSample
        && candidate.timestamp - timestamp <= VideoFrameExtractor.LOOKAHEAD_TOLERANCE_SECONDS
      ) {
        this.currentSample = candidate;
        this.nextSample = null;
      }
      break;
    }
  }

  private async peekNextSample(): Promise<MediabunnySample | null> {
    if (this.nextSample) {
      return this.nextSample;
    }
    if (!this.sampleIterator || this.iteratorDone) {
      return null;
    }

    const nextResult = await this.sampleIterator.next();
    if (nextResult.done) {
      this.iteratorDone = true;
      return null;
    }

    this.nextSample = nextResult.value;
    return this.nextSample;
  }

  private resetSampleIterator(startTimestamp: number, reason: 'init' | 'backward' | 'recover'): void {
    this.closeStreamState();
    if (!this.sink) return;

    const streamStart = Math.max(0, startTimestamp - VideoFrameExtractor.STREAM_BACKTRACK_SECONDS);
    if (reason !== 'init') {
      log.debug('Restarting mediabunny sample stream', {
        itemId: this.itemId,
        reason,
        startTimestamp,
        streamStart,
      });
    }

    this.sampleIterator = this.sink.samples(streamStart, Infinity);
    this.iteratorDone = false;
    this.lastRequestedTimestamp = null;
  }

  private drawCurrentSample(
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number
  ): boolean {
    const sample = this.currentSample;
    if (!sample) {
      this.lastFailureKind = 'no-sample';
      return false;
    }

    try {
      // Reuse cached VideoFrame if we're drawing the same sample again.
      // This is critical for transitions: the outgoing clip is rendered past
      // its timeline end, which means the sample iterator is exhausted and
      // the same last sample is drawn for many consecutive frames.  Calling
      // toVideoFrame() after a previous VideoFrame was closed can return an
      // empty/invalidated frame because the decoded buffer was released.
      let videoFrame = this.cachedVideoFrame;
      if (!videoFrame || this.cachedVideoFrameSample !== sample) {
        // Different sample — release old cached frame and create new one
        this.closeCachedVideoFrame();
        videoFrame = sample.toVideoFrame();
        if (!videoFrame) {
          this.sampleLoopError = new Error('Decoded sample could not be converted to VideoFrame');
          this.lastFailureKind = 'decode-error';
          return false;
        }
        this.cachedVideoFrame = videoFrame;
        this.cachedVideoFrameSample = sample;
      }

      ctx.drawImage(videoFrame, x, y, width, height);
      return true;
    } catch (error) {
      // Draw failed — discard the cached frame so next attempt gets a fresh one
      this.closeCachedVideoFrame();
      this.sampleLoopError = error;
      this.lastFailureKind = 'decode-error';
      return false;
    }
  }

  private closeCachedVideoFrame(): void {
    if (this.cachedVideoFrame) {
      try {
        this.cachedVideoFrame.close();
      } catch {
        // Ignore close errors
      }
      this.cachedVideoFrame = null;
      this.cachedVideoFrameSample = null;
    }
  }

  private async recoverAndPrime(timestamp: number, error: unknown): Promise<boolean> {
    const message = error instanceof Error ? error.message : String(error);
    const looksRecoverable = /key frame|configure\(\)|flush\(\)|InvalidStateError|decode/i.test(message);
    if (!looksRecoverable) {
      return false;
    }

    try {
      this.resetSampleIterator(timestamp, 'recover');
      await this.ensureSampleForTimestamp(timestamp);
      return this.currentSample !== null;
    } catch (recoveryError) {
      this.sampleLoopError = recoveryError;
      this.lastFailureKind = 'decode-error';
      return false;
    }
  }

  private closeStreamState(): void {
    if (this.sampleIterator) {
      void this.sampleIterator.return?.();
    }
    this.sampleIterator = null;
    this.iteratorDone = true;
    this.lastRequestedTimestamp = null;
    this.sampleLoopError = null;
    // Close cached VideoFrame before closing the sample it references
    this.closeCachedVideoFrame();
    this.closeSample(this.currentSample);
    this.closeSample(this.nextSample);
    this.currentSample = null;
    this.nextSample = null;
  }

  private closeSample(sample: MediabunnySample | null): void {
    if (!sample) return;
    try {
      sample.close();
    } catch {
      // Ignore close errors
    }
  }

  private reportDrawFailure(timestamp: number, clampedTime: number, error: unknown): boolean {
    this.drawFailureCount += 1;
    const shouldWarn = this.drawFailureCount <= 3 || this.drawFailureCount % 20 === 0;
    const logData = {
      itemId: this.itemId,
      timestamp,
      clampedTime,
      duration: this.duration,
      failures: this.drawFailureCount,
      reason: this.lastFailureKind,
      error: error instanceof Error ? error.message : String(error),
    };

    if (shouldWarn) {
      log.warn('Mediabunny frame extraction failed', logData);
    } else {
      log.debug('Mediabunny frame extraction failed', logData);
    }
    return false;
  }

  getLastFailureKind(): 'none' | 'no-sample' | 'decode-error' {
    return this.lastFailureKind;
  }

  /**
   * Get video dimensions
   */
  getDimensions(): { width: number; height: number } {
    if (!this.videoTrack) {
      return { width: 1920, height: 1080 };
    }
    return {
      width: this.videoTrack.displayWidth,
      height: this.videoTrack.displayHeight,
    };
  }

  /**
   * Get video duration in seconds
   */
  getDuration(): number {
    return this.duration;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.closeStreamState();

    try {
      // mediabunny Input lifecycle API is dispose(); close() is not guaranteed.
      this.input?.dispose();
    } catch {
      // Ignore dispose errors
    }
    this.sink = null;
    this.input = null;
    this.videoTrack = null;
    this.ready = false;
    this.drawFailureCount = 0;
    this.lastFailureKind = 'none';
  }
}
