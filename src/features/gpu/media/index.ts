/**
 * @module features/gpu/media
 *
 * Media Processing Module for FreeCut Video Editor
 *
 * This module provides a complete media processing pipeline with:
 *
 * ## Hybrid Decoding Architecture
 * - **WebCodecs (fast path)**: Hardware-accelerated decoding for H.264, VP8/VP9, AV1
 * - **FFmpeg.wasm (fallback)**: Software decoding for ProRes, DNxHD, HEVC, and exotic codecs
 *
 * ## Key Components
 *
 * ### Codec Support Detection
 * ```typescript
 * import { detectCodec, getDecoderPath, isCodecSupported } from './media';
 *
 * const codec = detectCodec(file);
 * const decoder = getDecoderPath(codec);
 * ```
 *
 * ### Media Source Management
 * ```typescript
 * import { createMediaSourceManager } from './media';
 *
 * const manager = createMediaSourceManager({ defaultCacheSizeMB: 500 });
 * const source = await manager.createSource('video.mp4');
 * const frame = await source.getVideoFrame(1000); // Get frame at 1 second
 * ```
 *
 * ### Frame Caching
 * ```typescript
 * import { createFrameCache } from './media';
 *
 * const cache = createFrameCache(200); // 200MB cache
 * cache.setFrame('source-id', frame);
 * const cached = cache.getFrame('source-id', frameNumber);
 * ```
 *
 * ### Frame Prefetching
 * ```typescript
 * import { createPrefetcher } from './media';
 *
 * const prefetcher = createPrefetcher({ defaultAheadFrames: 30 });
 * prefetcher.registerSource(source);
 * prefetcher.start();
 * prefetcher.updatePlayhead(sourceId, frameNumber);
 * ```
 *
 * ### GPU Texture Import
 * ```typescript
 * import { createTextureImporter } from './media';
 *
 * const importer = createTextureImporter();
 * importer.setBackend(renderBackend);
 * const texture = importer.import(decodedFrame);
 * // ... use texture for rendering ...
 * importer.release(texture);
 * ```
 *
 * ## Performance Characteristics
 *
 * | Feature | WebCodecs | FFmpeg.wasm |
 * |---------|-----------|-------------|
 * | H.264   | ~60fps    | ~30fps      |
 * | VP9     | ~45fps    | ~20fps      |
 * | ProRes  | N/A       | ~15fps      |
 * | HEVC    | ~30fps*   | ~15fps      |
 *
 * *HEVC via WebCodecs requires browser support and potentially licensing
 *
 * ## Memory Management
 *
 * The module implements several memory management strategies:
 * - LRU/LFU/FIFO eviction policies for frame cache
 * - Automatic VideoFrame.close() on cache eviction
 * - Texture pooling with idle cleanup
 * - Memory pressure detection with adaptive cache sizing
 *
 * @see {@link CodecSupport} for codec detection
 * @see {@link MediaSourceManager} for unified media handling
 * @see {@link FrameCache} for frame caching
 * @see {@link FramePrefetcher} for intelligent prefetching
 * @see {@link TextureImporter} for GPU texture management
 */

// Types - Core type definitions for the media system
export type {
  MediaSourceState,
  PixelFormat,
  TrackType,
  ProbeResult,
  VideoTrackInfo,
  AudioTrackInfo,
  DecodedVideoFrame,
  DecodedAudioSamples,
  SeekTarget,
  DecoderConfig,
  VideoDecoderConfig,
  AudioDecoderConfig,
  FrameRequest,
  PrefetchConfig,
  MediaSourceEvent,
} from './types';

// Codec Support - Detection and capability checking
export type { VideoCodec, AudioCodec, DecoderPath } from './codec-support';
export {
  checkWebCodecsSupport,
  checkVideoCodecSupport,
  checkAudioCodecSupport,
  getVideoDecoderPath,
  getAudioDecoderPath,
  parseVideoCodec,
  parseAudioCodec,
  checkAllCodecSupport,
} from './codec-support';

// WebCodecs Decoder - Hardware-accelerated decoding
export {
  WebCodecsDecoder,
  createWebCodecsDecoder,
  type WebCodecsDecoderConfig,
  type WebCodecsDecoderState,
} from './webcodecs-decoder';

// FFmpeg.wasm Decoder - Software fallback decoding
export {
  FFmpegDecoder,
  createFFmpegDecoder,
  setFFmpegFactory,
  type FFmpegDecoderConfig,
  type FFmpegDecoderState,
  type FFmpegLoadProgress,
} from './ffmpeg-decoder';

// Frame Cache - LRU caching with memory management
export {
  FrameCache,
  createFrameCache,
  type FrameCacheConfig,
  type FrameCacheStats,
  type EvictionPolicy,
} from './frame-cache';

// Media Source Manager - Unified source handling
export {
  ManagedMediaSource,
  MediaSourceManager,
  createMediaSourceManager,
  type MediaSourceConfig,
  type MediaSourceManagerConfig,
} from './media-source-manager';

// Prefetch - Intelligent frame prefetching
export {
  FramePrefetcher,
  createPrefetcher,
  type PrefetchRequest,
  type PrefetchStats,
  type PrefetcherConfig,
  type PrefetchPriority,
} from './prefetch';

// GPU Texture Import - Bridge to GPU rendering
export {
  TextureImporter,
  createTextureImporter,
  type ImportedTexture,
  type TextureImporterConfig,
} from './texture-import';
