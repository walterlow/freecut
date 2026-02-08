/**
 * FFmpeg.wasm Decoder
 *
 * Fallback decoder using FFmpeg.wasm for codecs not supported by WebCodecs.
 * Supports ProRes, DNxHD, HEVC, and other exotic formats.
 */

import type {
  MediaDecoder,
  DecoderConfig,
  DecodedVideoFrame,
  DecodedAudioSamples,
  EncodedVideoChunk,
  EncodedAudioChunk,
  SeekTarget,
  VideoDecoderConfig,
  AudioDecoderConfig,
} from './types';
import type { VideoCodec, AudioCodec, DecoderPath } from './codec-support';
import { getVideoDecoderPath, getAudioDecoderPath } from './codec-support';

/**
 * FFmpeg.wasm loading state
 */
export type FFmpegLoadState = 'unloaded' | 'loading' | 'loaded' | 'error';

/**
 * FFmpeg decoder state
 */
type FFmpegDecoderState = 'unconfigured' | 'configured' | 'closed';

/**
 * FFmpeg load progress event
 */
export interface FFmpegLoadProgress {
  /** Bytes received */
  received: number;
  /** Total bytes (if known) */
  total: number | null;
  /** Progress percentage (0-100, or null if total unknown) */
  percent: number | null;
}

/**
 * FFmpeg load options
 */
export interface FFmpegLoadOptions {
  /** Custom path to ffmpeg-core.wasm */
  corePath?: string;
  /** Custom path to ffmpeg-core.worker.js */
  workerPath?: string;
  /** Progress callback */
  onProgress?: (progress: FFmpegLoadProgress) => void;
  /** Whether to use SharedArrayBuffer (if available) */
  useSharedArrayBuffer?: boolean;
}

/**
 * FFmpeg.wasm instance interface (minimal subset we use)
 */
export interface FFmpegInstance {
  load(config?: { coreURL?: string; wasmURL?: string; workerURL?: string }): Promise<void>;
  isLoaded(): boolean;
  writeFile(name: string, data: Uint8Array): Promise<void>;
  readFile(name: string): Promise<Uint8Array>;
  deleteFile(name: string): Promise<void>;
  exec(args: string[]): Promise<number>;
  terminate(): void;
  on(event: 'log', callback: (log: { type: string; message: string }) => void): void;
}

/**
 * Global FFmpeg instance (singleton for memory efficiency)
 */
let globalFFmpeg: FFmpegInstance | null = null;
let globalLoadState: FFmpegLoadState = 'unloaded';
let globalLoadPromise: Promise<void> | null = null;

/**
 * Factory function for creating FFmpeg instance (allows mocking)
 */
let ffmpegFactory: (() => Promise<FFmpegInstance>) | null = null;

/**
 * Set custom FFmpeg factory for testing
 */
export function setFFmpegFactory(factory: (() => Promise<FFmpegInstance>) | null): void {
  ffmpegFactory = factory;
}

/**
 * Default FFmpeg factory using dynamic imports
 * This function is separated to allow tree-shaking and proper testing
 */
async function defaultFFmpegFactory(options: FFmpegLoadOptions): Promise<FFmpegInstance> {
  // Dynamic import - will fail if @ffmpeg/ffmpeg is not installed
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ffmpegModule = await (Function('return import("@ffmpeg/ffmpeg")')() as Promise<any>);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const utilModule = await (Function('return import("@ffmpeg/util")')() as Promise<any>);

  const ffmpeg = new ffmpegModule.FFmpeg();

  // Set up progress tracking
  if (options.onProgress) {
    options.onProgress({ received: 0, total: null, percent: null });
  }

  // Determine base URL for WASM files
  const baseURL = options.corePath
    ? options.corePath.substring(0, options.corePath.lastIndexOf('/'))
    : 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';

  // Load FFmpeg core
  await ffmpeg.load({
    coreURL: options.corePath || await utilModule.toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await utilModule.toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    workerURL: options.workerPath || await utilModule.toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript'),
  });

  return ffmpeg as unknown as FFmpegInstance;
}

/**
 * Load FFmpeg.wasm (lazy, singleton)
 */
export async function loadFFmpeg(options: FFmpegLoadOptions = {}): Promise<void> {
  if (globalLoadState === 'loaded' && globalFFmpeg) {
    return;
  }

  if (globalLoadState === 'loading' && globalLoadPromise) {
    return globalLoadPromise;
  }

  globalLoadState = 'loading';

  globalLoadPromise = (async () => {
    try {
      // Use custom factory if provided (for testing)
      if (ffmpegFactory) {
        globalFFmpeg = await ffmpegFactory();
      } else {
        globalFFmpeg = await defaultFFmpegFactory(options);
      }

      globalLoadState = 'loaded';

      if (options.onProgress) {
        options.onProgress({ received: 100, total: 100, percent: 100 });
      }
    } catch (error) {
      globalLoadState = 'error';
      globalLoadPromise = null;
      throw error;
    }
  })();

  return globalLoadPromise;
}

/**
 * Get FFmpeg load state
 */
export function getFFmpegLoadState(): FFmpegLoadState {
  return globalLoadState;
}

/**
 * Check if FFmpeg is loaded
 */
export function isFFmpegLoaded(): boolean {
  return globalLoadState === 'loaded' && globalFFmpeg !== null;
}

/**
 * Unload FFmpeg (for memory cleanup)
 */
export function unloadFFmpeg(): void {
  if (globalFFmpeg) {
    try {
      globalFFmpeg.terminate();
    } catch {
      // Ignore termination errors
    }
    globalFFmpeg = null;
  }
  globalLoadState = 'unloaded';
  globalLoadPromise = null;
}

/**
 * FFmpeg.wasm-based media decoder
 */
export class FFmpegDecoder implements MediaDecoder {
  readonly type: DecoderPath = 'ffmpeg';

  private _state: FFmpegDecoderState = 'unconfigured';
  private videoConfig: VideoDecoderConfig | null = null;
  private audioConfig: AudioDecoderConfig | null = null;
  private frameCounter = 0;
  private inputCounter = 0;

  get state(): FFmpegDecoderState {
    return this._state;
  }

  /**
   * Check if this decoder can handle the codec
   */
  canDecode(codec: VideoCodec | AudioCodec): boolean {
    // FFmpeg can decode most codecs
    // Check if it's a video codec
    if (['h264', 'h265', 'vp8', 'vp9', 'av1', 'prores', 'dnxhd', 'mjpeg', 'mpeg2', 'mpeg4', 'theora', 'unknown'].includes(codec)) {
      const path = getVideoDecoderPath(codec as VideoCodec);
      return path === 'ffmpeg' || path === 'webcodecs'; // FFmpeg is universal fallback
    }

    // Check if it's an audio codec
    const audioPath = getAudioDecoderPath(codec as AudioCodec);
    return audioPath === 'ffmpeg' || audioPath === 'webcodecs';
  }

  /**
   * Configure the decoder
   */
  async configure(config: DecoderConfig): Promise<void> {
    if (this._state === 'closed') {
      throw new Error('Decoder is closed');
    }

    // Ensure FFmpeg is loaded
    if (!isFFmpegLoaded()) {
      await loadFFmpeg();
    }

    if (config.video) {
      this.videoConfig = config.video;
    }

    if (config.audio) {
      this.audioConfig = config.audio;
    }

    this._state = 'configured';
  }

  /**
   * Decode a video chunk
   */
  async decodeVideo(chunk: EncodedVideoChunk): Promise<DecodedVideoFrame> {
    if (this._state !== 'configured' || !this.videoConfig) {
      throw new Error('Video decoder not configured');
    }

    if (!globalFFmpeg) {
      throw new Error('FFmpeg not loaded');
    }

    const inputName = `input_${this.inputCounter++}.bin`;
    const outputName = `output_${this.inputCounter}.raw`;

    try {
      // Write encoded data to virtual filesystem
      await globalFFmpeg.writeFile(inputName, new Uint8Array(chunk.data));

      // Determine codec for FFmpeg
      const codecArg = this.getFFmpegCodecArg(this.videoConfig.codec);

      // Decode using FFmpeg
      // Output raw RGBA frames
      const result = await globalFFmpeg.exec([
        '-f', 'rawvideo',
        '-video_size', `${this.videoConfig.codedWidth}x${this.videoConfig.codedHeight}`,
        '-c:v', codecArg,
        '-i', inputName,
        '-f', 'rawvideo',
        '-pix_fmt', 'rgba',
        outputName,
      ]);

      if (result !== 0) {
        throw new Error(`FFmpeg decode failed with code ${result}`);
      }

      // Read decoded frame data
      const frameData = await globalFFmpeg.readFile(outputName);

      // Clean up temp files
      await globalFFmpeg.deleteFile(inputName);
      await globalFFmpeg.deleteFile(outputName);

      const width = this.videoConfig.displayWidth ?? this.videoConfig.codedWidth;
      const height = this.videoConfig.displayHeight ?? this.videoConfig.codedHeight;

      const frame: DecodedVideoFrame = {
        frameNumber: this.frameCounter++,
        timestampMs: chunk.timestamp / 1000,
        width,
        height,
        format: 'rgba',
        data: frameData,
        durationMs: (chunk.duration ?? 0) / 1000,
        isKeyframe: chunk.type === 'key',
        source: 'ffmpeg',
      };

      return frame;
    } catch (error) {
      // Cleanup on error
      try {
        await globalFFmpeg.deleteFile(inputName);
      } catch { /* ignore */ }
      try {
        await globalFFmpeg.deleteFile(outputName);
      } catch { /* ignore */ }

      throw error;
    }
  }

  /**
   * Decode an audio chunk
   */
  async decodeAudio(chunk: EncodedAudioChunk): Promise<DecodedAudioSamples> {
    if (this._state !== 'configured' || !this.audioConfig) {
      throw new Error('Audio decoder not configured');
    }

    if (!globalFFmpeg) {
      throw new Error('FFmpeg not loaded');
    }

    const inputName = `audio_input_${this.inputCounter++}.bin`;
    const outputName = `audio_output_${this.inputCounter}.raw`;

    try {
      // Write encoded data
      await globalFFmpeg.writeFile(inputName, new Uint8Array(chunk.data));

      // Determine codec
      const codecArg = this.getFFmpegAudioCodecArg(this.audioConfig.codec);

      // Decode to raw PCM (planar float)
      const result = await globalFFmpeg.exec([
        '-c:a', codecArg,
        '-i', inputName,
        '-f', 'f32le',
        '-acodec', 'pcm_f32le',
        '-ar', String(this.audioConfig.sampleRate),
        '-ac', String(this.audioConfig.numberOfChannels),
        outputName,
      ]);

      if (result !== 0) {
        throw new Error(`FFmpeg audio decode failed with code ${result}`);
      }

      // Read decoded audio
      const audioData = await globalFFmpeg.readFile(outputName);

      // Cleanup
      await globalFFmpeg.deleteFile(inputName);
      await globalFFmpeg.deleteFile(outputName);

      // Convert to planar float arrays
      const channels = this.audioConfig.numberOfChannels;
      const floatData = new Float32Array(audioData.buffer);
      const samplesPerChannel = Math.floor(floatData.length / channels);
      const planarData: Float32Array[] = [];

      // Interleaved to planar conversion
      for (let ch = 0; ch < channels; ch++) {
        const channelData = new Float32Array(samplesPerChannel);
        for (let i = 0; i < samplesPerChannel; i++) {
          channelData[i] = floatData[i * channels + ch];
        }
        planarData.push(channelData);
      }

      return {
        timestampMs: chunk.timestamp / 1000,
        sampleRate: this.audioConfig.sampleRate,
        channels,
        data: planarData,
        sampleCount: samplesPerChannel,
        durationMs: (chunk.duration ?? 0) / 1000,
      };
    } catch (error) {
      try {
        await globalFFmpeg.deleteFile(inputName);
      } catch { /* ignore */ }
      try {
        await globalFFmpeg.deleteFile(outputName);
      } catch { /* ignore */ }

      throw error;
    }
  }

  /**
   * Get FFmpeg codec argument for video
   */
  private getFFmpegCodecArg(codecString: string): string {
    const lower = codecString.toLowerCase();

    if (lower.includes('avc') || lower.includes('h264')) {
      return 'h264';
    }
    if (lower.includes('hevc') || lower.includes('hvc') || lower.includes('h265')) {
      return 'hevc';
    }
    if (lower.includes('vp8')) {
      return 'vp8';
    }
    if (lower.includes('vp9') || lower.includes('vp09')) {
      return 'vp9';
    }
    if (lower.includes('av1') || lower.includes('av01')) {
      return 'av1';
    }
    if (lower.includes('prores') || lower.includes('apc')) {
      return 'prores';
    }
    if (lower.includes('dnxh') || lower.includes('avdh')) {
      return 'dnxhd';
    }
    if (lower.includes('mjpeg') || lower.includes('mjpg')) {
      return 'mjpeg';
    }

    // Default - let FFmpeg auto-detect
    return 'rawvideo';
  }

  /**
   * Get FFmpeg codec argument for audio
   */
  private getFFmpegAudioCodecArg(codecString: string): string {
    const lower = codecString.toLowerCase();

    if (lower.includes('aac') || lower.includes('mp4a')) {
      return 'aac';
    }
    if (lower.includes('mp3')) {
      return 'mp3';
    }
    if (lower.includes('opus')) {
      return 'opus';
    }
    if (lower.includes('vorbis')) {
      return 'vorbis';
    }
    if (lower.includes('flac')) {
      return 'flac';
    }
    if (lower.includes('ac3') || lower.includes('ac-3')) {
      return 'ac3';
    }
    if (lower.includes('eac3') || lower.includes('ec-3')) {
      return 'eac3';
    }
    if (lower.includes('alac')) {
      return 'alac';
    }

    return 'pcm_s16le';
  }

  /**
   * Seek to a position
   */
  async seek(_target: SeekTarget): Promise<void> {
    void _target;
    // FFmpeg doesn't maintain state between frames,
    // so seek is essentially a no-op for the decoder itself
    // The media source handles seeking at the demuxer level
    this.frameCounter = 0;
  }

  /**
   * Flush pending frames
   */
  async flush(): Promise<void> {
    // No buffered state to flush in FFmpeg decoder
  }

  /**
   * Reset the decoder
   */
  reset(): void {
    this.videoConfig = null;
    this.audioConfig = null;
    this.frameCounter = 0;
    this._state = 'unconfigured';
  }

  /**
   * Close and release resources
   */
  close(): void {
    this.reset();
    this._state = 'closed';
  }

  /**
   * Get decoder queue size
   */
  getQueueSize(): { video: number; audio: number } {
    // FFmpeg processes synchronously
    return { video: 0, audio: 0 };
  }

  /**
   * Check if hardware accelerated
   */
  isHardwareAccelerated(): boolean {
    // FFmpeg.wasm runs in WASM, not hardware accelerated
    return false;
  }
}

/**
 * Create a new FFmpeg decoder
 */
export function createFFmpegDecoder(): FFmpegDecoder {
  return new FFmpegDecoder();
}

/**
 * Estimate FFmpeg.wasm download size
 */
export function getFFmpegDownloadSize(): number {
  // Approximate size of ffmpeg-core.wasm
  return 25 * 1024 * 1024; // ~25MB
}

/**
 * Check if FFmpeg.wasm can be loaded (checks for required APIs)
 */
export function canLoadFFmpeg(): boolean {
  // Check for WebAssembly support
  if (typeof WebAssembly === 'undefined') {
    return false;
  }

  // Check for required features
  try {
    // SharedArrayBuffer is preferred but not required
    return true;
  } catch {
    return false;
  }
}
