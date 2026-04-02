/**
 * Media Processor Web Worker
 *
 * Handles heavy media processing off the main thread:
 * - Metadata extraction using mediabunny
 * - Thumbnail generation using mediabunny
 * - Audio codec support checking
 *
 * This prevents UI blocking when importing media files.
 */

import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('MediaProcessorWorker');

// Type definitions for mediabunny module
interface MediabunnyVideoTrack {
  displayWidth: number;
  displayHeight: number;
  codec: string;
  computePacketStats(count: number): Promise<{ averagePacketRate: number } | null>;
}

interface MediabunnyAudioTrack {
  channels?: number;
  sampleRate?: number;
  codec?: string;
  canDecode?: () => Promise<boolean>;
}

interface MediabunnyInput {
  computeDuration(): Promise<number>;
  getPrimaryVideoTrack(): Promise<MediabunnyVideoTrack | null>;
  getPrimaryAudioTrack(): Promise<MediabunnyAudioTrack | null>;
  dispose(): void;
}

interface CanvasWrapper {
  canvas: OffscreenCanvas | HTMLCanvasElement;
}

interface MediabunnyCanvasSink {
  getCanvas(timestamp: number): Promise<CanvasWrapper | null>;
  dispose?(): void;
}

interface MediabunnyPacketRetrievalOptions {
  /** Skip loading packet data — only metadata (timestamp, type) */
  metadataOnly?: boolean;
  /** Verify key packets by inspecting bitstream (cannot combine with metadataOnly) */
  verifyKeyPackets?: boolean;
}

interface MediabunnyEncodedPacket {
  type: 'key' | 'delta';
  timestamp: number;
  duration: number;
  close?(): void;
}

interface MediabunnyEncodedPacketSink {
  getFirstKeyPacket(options?: MediabunnyPacketRetrievalOptions): Promise<MediabunnyEncodedPacket | null>;
  getNextKeyPacket(packet: MediabunnyEncodedPacket, options?: MediabunnyPacketRetrievalOptions): Promise<MediabunnyEncodedPacket | null>;
  packets(startTimestamp?: number, endTimestamp?: number): AsyncIterable<MediabunnyEncodedPacket>;
  dispose?(): void;
}

interface MediabunnyModule {
  Input: new (config: { formats: unknown; source: unknown }) => MediabunnyInput;
  ALL_FORMATS: unknown;
  BlobSource: new (blob: Blob) => unknown;
  CanvasSink: new (track: MediabunnyVideoTrack, options: { width: number; height: number; fit: string }) => MediabunnyCanvasSink;
  EncodedPacketSink: new (track: MediabunnyVideoTrack) => MediabunnyEncodedPacketSink;
}

// Message types
export interface ProcessMediaRequest {
  type: 'process';
  requestId: string;
  file: File;
  mimeType: string;
  options?: {
    thumbnailMaxSize?: number;
    thumbnailQuality?: number;
    thumbnailTimestamp?: number;
    generateThumbnail?: boolean;
  };
}

export interface ProcessMediaResponse {
  type: 'complete' | 'error';
  requestId: string;
  metadata?: VideoMetadata | AudioMetadata | ImageMetadata;
  thumbnail?: Blob;
  error?: string;
}

export interface VideoMetadata {
  type: 'video';
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  bitrate: number;
  audioCodec?: string;
  audioCodecSupported: boolean;
  /** Sorted keyframe timestamps in seconds (undefined if all-intra or extraction failed) */
  keyframeTimestamps?: number[];
  /** Average keyframe interval in seconds (GOP length) */
  gopInterval?: number;
}

export interface AudioMetadata {
  type: 'audio';
  duration: number;
  codec?: string;
  channels?: number;
  sampleRate?: number;
  bitrate?: number;
}

export interface ImageMetadata {
  type: 'image';
  width: number;
  height: number;
}

// Audio codecs that cannot be decoded in browser
// Note: AC-3 and E-AC-3 are supported via @mediabunny/ac3 WASM decoder
const UNSUPPORTED_AUDIO_CODECS = [
  'dts',    // DTS
  'dtsc',   // DTS Coherent Acoustics
  'dtse',   // DTS Express
  'dtsh',   // DTS-HD High Resolution
  'dtsl',   // DTS-HD Master Audio
  'truehd', // Dolby TrueHD
  'mlpa',   // Dolby TrueHD (MLP)
];

function isAudioCodecSupported(codec: string | undefined): boolean {
  if (!codec) return true;
  const normalizedCodec = codec.toLowerCase().trim();
  return !UNSUPPORTED_AUDIO_CODECS.some(unsupported =>
    normalizedCodec.includes(unsupported)
  );
}

// Lazy load mediabunny only.
// Metadata extraction and video thumbnails do not require AC-3 decoder registration.
let mediabunnyModule: MediabunnyModule | null = null;
async function getMediabunny(): Promise<MediabunnyModule> {
  if (!mediabunnyModule) {
    mediabunnyModule = await import('mediabunny') as unknown as MediabunnyModule;
  }
  return mediabunnyModule;
}

/**
 * Extract keyframe timestamps using mediabunny's EncodedPacketSink.
 *
 * Uses getFirstKeyPacket/getNextKeyPacket chain with metadataOnly: true
 * to jump directly from keyframe to keyframe without loading packet data.
 * This is O(K) where K = number of keyframes, vs O(N) for iterating all
 * packets. For a 1-hour video: ~1800 keyframe hops vs ~108,000 packet reads.
 *
 * Returns undefined if extraction fails or all frames are keyframes
 * (all-intra content where no seek optimization is needed).
 */
async function extractKeyframeTimestamps(
  mb: MediabunnyModule,
  videoTrack: MediabunnyVideoTrack,
): Promise<number[] | undefined> {
  let sink: MediabunnyEncodedPacketSink | null = null;
  try {
    sink = new mb.EncodedPacketSink(videoTrack);
    const timestamps: number[] = [];
    const metadataOnly = { metadataOnly: true } as const;

    // Jump keyframe-to-keyframe — skips all delta packets entirely
    let packet = await sink.getFirstKeyPacket(metadataOnly);
    while (packet) {
      timestamps.push(packet.timestamp);
      packet = await sink.getNextKeyPacket(packet, metadataOnly);
    }

    if (timestamps.length === 0) {
      return undefined;
    }

    return timestamps;
  } catch (error) {
    logger.warn('Keyframe extraction failed (non-fatal):', error);
    return undefined;
  } finally {
    sink?.dispose?.();
  }
}

/**
 * Extract video metadata using mediabunny
 */
async function extractVideoMetadata(file: File): Promise<VideoMetadata> {
  const mb = await getMediabunny();

  const input = new mb.Input({
    formats: mb.ALL_FORMATS,
    source: new mb.BlobSource(file),
  });

  try {
    // Get all metadata in one pass (no duplicate parsing!)
    const [duration, videoTrack, audioTrack] = await Promise.all([
      input.computeDuration(),
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
    ]);

    if (!videoTrack) {
      throw new Error('No video track found in file');
    }

    // Get FPS and keyframe index in parallel with packet stats
    const [packetStats, keyframeTimestamps] = await Promise.all([
      videoTrack.computePacketStats(50),
      extractKeyframeTimestamps(mb, videoTrack),
    ]);

    const audioCodec = audioTrack?.codec;
    const audioCodecSupported = isAudioCodecSupported(audioCodec);

    // Compute average GOP interval from keyframe timestamps
    let gopInterval: number | undefined;
    if (keyframeTimestamps && keyframeTimestamps.length >= 2) {
      const totalSpan = keyframeTimestamps[keyframeTimestamps.length - 1]! - keyframeTimestamps[0]!;
      gopInterval = totalSpan / (keyframeTimestamps.length - 1);
    }

    return {
      type: 'video',
      duration: duration || 0,
      width: videoTrack.displayWidth || 1920,
      height: videoTrack.displayHeight || 1080,
      fps: packetStats?.averagePacketRate || 30,
      codec: videoTrack.codec || 'unknown',
      bitrate: 0,
      audioCodec,
      audioCodecSupported,
      keyframeTimestamps,
      gopInterval,
    };
  } finally {
    input.dispose();
  }
}

/**
 * Extract audio metadata using mediabunny
 */
async function extractAudioMetadata(file: File): Promise<AudioMetadata> {
  const mb = await getMediabunny();

  const input = new mb.Input({
    formats: mb.ALL_FORMATS,
    source: new mb.BlobSource(file),
  });

  try {
    const [duration, audioTrack] = await Promise.all([
      input.computeDuration(),
      input.getPrimaryAudioTrack(),
    ]);

    return {
      type: 'audio',
      duration: duration || 0,
      codec: audioTrack?.codec,
      channels: audioTrack?.channels,
      sampleRate: audioTrack?.sampleRate,
      bitrate: 0,
    };
  } finally {
    input.dispose();
  }
}

/**
 * Parse SVG dimensions from XML content.
 * Tries width/height attributes first, then viewBox.
 */
function parseSvgDimensions(svgText: string): { width: number; height: number } | null {
  const svgMatch = svgText.match(/<svg[^>]*>/i);
  if (!svgMatch) return null;

  const tag = svgMatch[0];

  // Match numeric lengths only (with optional "px" unit), reject %, em, etc.
  const wAttr = tag.match(/\bwidth=["'](\d+(?:\.\d+)?)\s*(?:px)?["']/);
  const hAttr = tag.match(/\bheight=["'](\d+(?:\.\d+)?)\s*(?:px)?["']/);
  if (wAttr && hAttr) {
    return { width: Math.round(parseFloat(wAttr[1]!)), height: Math.round(parseFloat(hAttr[1]!)) };
  }

  // viewBox: allow negative min-x/min-y, flexible whitespace (spaces or commas)
  const vb = tag.match(/viewBox=["']\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (vb) {
    return { width: Math.round(parseFloat(vb[3]!)), height: Math.round(parseFloat(vb[4]!)) };
  }

  return null;
}

/**
 * Extract image metadata using createImageBitmap.
 * Falls back to SVG XML parsing for SVG files (createImageBitmap
 * doesn't support SVGs in web workers).
 */
async function extractImageMetadata(file: File, mimeType: string): Promise<ImageMetadata> {
  if (mimeType === 'image/svg+xml') {
    const text = await file.text();
    const dims = parseSvgDimensions(text);
    return {
      type: 'image',
      width: dims?.width ?? 800,
      height: dims?.height ?? 600,
    };
  }

  const bitmap = await createImageBitmap(file);
  const metadata: ImageMetadata = {
    type: 'image',
    width: bitmap.width,
    height: bitmap.height,
  };
  bitmap.close();
  return metadata;
}

/**
 * Generate video thumbnail using mediabunny
 */
async function generateVideoThumbnail(
  file: File,
  maxSize: number,
  quality: number,
  timestamp: number
): Promise<Blob> {
  const mb = await getMediabunny();

  const input = new mb.Input({
    source: new mb.BlobSource(file),
    formats: mb.ALL_FORMATS,
  });
  let sink: MediabunnyCanvasSink | null = null;

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new Error('No video track found');
    }

    // Calculate dimensions preserving aspect ratio
    const dw = videoTrack.displayWidth || 1;
    const dh = videoTrack.displayHeight || 1;
    const width = dw > dh
      ? maxSize
      : Math.floor(maxSize * dw / dh);
    const height = dh > dw
      ? maxSize
      : Math.floor(maxSize * dh / dw);

    sink = new mb.CanvasSink(videoTrack, {
      width,
      height,
      fit: 'fill',
    });

    // Clamp timestamp to valid range
    const duration = await input.computeDuration();
    const clampedTimestamp = Math.min(timestamp, Math.max(0, duration - 0.1));

    const wrapped = await sink.getCanvas(clampedTimestamp);
    if (!wrapped) {
      throw new Error('Failed to extract frame from video');
    }

    const canvas = wrapped.canvas as OffscreenCanvas;
    return canvas.convertToBlob({ type: 'image/webp', quality });
  } finally {
    sink?.dispose?.();
    input.dispose();
  }
}

/**
 * Generate image thumbnail using OffscreenCanvas
 */
async function generateImageThumbnail(
  file: File,
  maxSize: number,
  quality: number,
  mimeType: string
): Promise<Blob> {
  // SVG thumbnails can't be generated in workers (createImageBitmap doesn't
  // support SVGs here). The main thread handles SVG thumbnail fallback.
  if (mimeType === 'image/svg+xml') {
    throw new Error('SVG thumbnail generation not supported in worker');
  }

  const bitmap = await createImageBitmap(file);

  // Calculate dimensions preserving aspect ratio
  const width = bitmap.width > bitmap.height
    ? maxSize
    : Math.floor(maxSize * bitmap.width / bitmap.height);
  const height = bitmap.height > bitmap.width
    ? maxSize
    : Math.floor(maxSize * bitmap.height / bitmap.width);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Failed to get canvas context');
  }

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return canvas.convertToBlob({ type: 'image/webp', quality });
}

/**
 * Generate audio thumbnail (waveform placeholder)
 */
async function generateAudioThumbnail(
  file: File,
  maxSize: number,
  quality: number
): Promise<Blob> {
  const width = maxSize;
  const height = Math.round(maxSize * (9 / 16));

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // Gradient background
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#1a1a1a');
  gradient.addColorStop(1, '#0a0a0a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Waveform visualization
  ctx.strokeStyle = '#00ff88';
  ctx.lineWidth = 2;
  ctx.beginPath();
  const amplitude = height * 0.3;
  const centerY = height / 2;
  for (let x = 0; x < width; x++) {
    const y = centerY + Math.sin(x * 0.02) * amplitude;
    if (x === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  // Filename
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const displayName = file.name.length > 30 ? file.name.substring(0, 27) + '...' : file.name;
  ctx.fillText(displayName, width / 2, height - 20);

  return canvas.convertToBlob({ type: 'image/webp', quality });
}

/**
 * Process a media file - extract metadata and generate thumbnail
 */
async function processMedia(
  file: File,
  mimeType: string,
  options: ProcessMediaRequest['options'] = {}
): Promise<{ metadata: VideoMetadata | AudioMetadata | ImageMetadata; thumbnail?: Blob }> {
  const {
    thumbnailMaxSize = 320,
    thumbnailQuality = 0.6,
    thumbnailTimestamp = 1,
    generateThumbnail = true,
  } = options;

  let metadata: VideoMetadata | AudioMetadata | ImageMetadata;
  let thumbnail: Blob | undefined;

  if (mimeType.startsWith('video/')) {
    // Video: extract metadata and generate thumbnail in parallel after metadata
    metadata = await extractVideoMetadata(file);
    if (generateThumbnail) {
      try {
        thumbnail = await generateVideoThumbnail(file, thumbnailMaxSize, thumbnailQuality, thumbnailTimestamp);
      } catch (err) {
        logger.warn('Failed to generate video thumbnail:', err);
      }
    }
  } else if (mimeType.startsWith('audio/')) {
    // Audio: metadata and thumbnail are independent
    const [audioMeta, audioThumb] = await Promise.all([
      extractAudioMetadata(file),
      generateThumbnail
        ? generateAudioThumbnail(file, thumbnailMaxSize, thumbnailQuality).catch(() => undefined)
        : Promise.resolve(undefined),
    ]);
    metadata = audioMeta;
    thumbnail = audioThumb;
  } else if (mimeType.startsWith('image/')) {
    // Image: metadata and thumbnail can run in parallel
    const [imageMeta, imageThumb] = await Promise.all([
      extractImageMetadata(file, mimeType),
      generateThumbnail
        ? generateImageThumbnail(file, thumbnailMaxSize, thumbnailQuality, mimeType).catch(() => undefined)
        : Promise.resolve(undefined),
    ]);
    metadata = imageMeta;
    thumbnail = imageThumb;
  } else {
    throw new Error(`Unsupported media type: ${mimeType}`);
  }

  return { metadata, thumbnail };
}

// Message handler
self.onmessage = async (e: MessageEvent<ProcessMediaRequest>) => {
  const msg = e.data;

  if (msg.type === 'process') {
    try {
      const result = await processMedia(msg.file, msg.mimeType, msg.options);

      const response: ProcessMediaResponse = {
        type: 'complete',
        requestId: msg.requestId,
        metadata: result.metadata,
        thumbnail: result.thumbnail,
      };

      self.postMessage(response);
    } catch (error) {
      const response: ProcessMediaResponse = {
        type: 'error',
        requestId: msg.requestId,
        error: error instanceof Error ? error.message : String(error),
      };
      self.postMessage(response);
    }
  }
};

export {};
