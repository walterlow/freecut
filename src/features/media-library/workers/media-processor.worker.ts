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

interface MediabunnyModule {
  Input: new (config: { formats: unknown; source: unknown }) => MediabunnyInput;
  ALL_FORMATS: unknown;
  BlobSource: new (blob: Blob) => unknown;
  CanvasSink: new (track: MediabunnyVideoTrack, options: { width: number; height: number; fit: string }) => MediabunnyCanvasSink;
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

// Lazy load mediabunny + register AC-3 decoder
let mediabunnyModule: MediabunnyModule | null = null;
async function getMediabunny(): Promise<MediabunnyModule> {
  if (!mediabunnyModule) {
    const mb = await import('mediabunny') as unknown as MediabunnyModule;
    const { registerAc3Decoder } = await import('@mediabunny/ac3');
    try {
      registerAc3Decoder();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/already registered/i.test(message)) {
        throw err;
      }
    }
    mediabunnyModule = mb;
  }
  return mediabunnyModule;
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

    // Get FPS from packet stats
    const packetStats = await videoTrack.computePacketStats(50);

    const audioCodec = audioTrack?.codec;
    const audioCodecSupported = isAudioCodecSupported(audioCodec);

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
 * Extract image metadata using createImageBitmap
 */
async function extractImageMetadata(file: File): Promise<ImageMetadata> {
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
  quality: number
): Promise<Blob> {
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
  } = options;

  let metadata: VideoMetadata | AudioMetadata | ImageMetadata;
  let thumbnail: Blob | undefined;

  if (mimeType.startsWith('video/')) {
    // Video: extract metadata and generate thumbnail in parallel after metadata
    metadata = await extractVideoMetadata(file);
    try {
      thumbnail = await generateVideoThumbnail(file, thumbnailMaxSize, thumbnailQuality, thumbnailTimestamp);
    } catch (err) {
      console.warn('[MediaProcessorWorker] Failed to generate video thumbnail:', err);
    }
  } else if (mimeType.startsWith('audio/')) {
    // Audio: metadata and thumbnail are independent
    const [audioMeta, audioThumb] = await Promise.all([
      extractAudioMetadata(file),
      generateAudioThumbnail(file, thumbnailMaxSize, thumbnailQuality).catch(() => undefined),
    ]);
    metadata = audioMeta;
    thumbnail = audioThumb;
  } else if (mimeType.startsWith('image/')) {
    // Image: metadata and thumbnail can run in parallel
    const [imageMeta, imageThumb] = await Promise.all([
      extractImageMetadata(file),
      generateImageThumbnail(file, thumbnailMaxSize, thumbnailQuality).catch(() => undefined),
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
