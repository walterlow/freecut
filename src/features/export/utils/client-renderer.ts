/**
 * Client-side video renderer using mediabunny
 *
 * Renders the Composition composition to a canvas and encodes it to video
 * using mediabunny's WebCodecs-based encoder.
 *
 * Architecture:
 * 1. Mount a hidden Composition Player at the export resolution
 * 2. For each frame, seek to that frame and capture to canvas
 * 3. Feed canvas frames to mediabunny CanvasSource for encoding
 * 4. Collect audio from media items and encode with AudioDataSource
 * 5. Finalize and return the video blob
 */

import type { ExportSettings } from '@/types/export';

// Codec mapping for mediabunny
export type ClientVideoCodec = 'avc' | 'hevc' | 'vp8' | 'vp9' | 'av1';
export type ClientAudioCodec = 'aac' | 'opus' | 'mp3' | 'flac' | 'pcm-s16';
export type ClientCodec = ClientVideoCodec; // Alias for backwards compatibility

// Video containers
export type ClientVideoContainer = 'mp4' | 'webm' | 'mov' | 'mkv';
// Audio-only containers
export type ClientAudioContainer = 'mp3' | 'aac' | 'wav';
// All containers
export type ClientContainer = ClientVideoContainer | ClientAudioContainer;

// Export mode
export type ExportMode = 'video' | 'audio';

export interface ClientExportSettings {
  mode: ExportMode;
  codec: ClientCodec;
  audioCodec?: ClientAudioCodec;
  container: ClientContainer;
  quality: 'low' | 'medium' | 'high' | 'ultra';
  resolution: { width: number; height: number };
  fps: number;
  audioBitrate?: number;
  videoBitrate?: number;
  sampleRate?: number; // For audio exports (default: 48000)
}

export interface RenderProgress {
  phase: 'preparing' | 'rendering' | 'encoding' | 'finalizing';
  progress: number; // 0-100
  currentFrame?: number;
  totalFrames?: number;
  message?: string;
}

export interface ClientRenderResult {
  blob: Blob;
  mimeType: string;
  duration: number;
  fileSize: number;
}

/**
 * Maps export settings to client-compatible settings
 */
export function mapToClientSettings(settings: ExportSettings, fps: number): ClientExportSettings {
  // Map codec to mediabunny codec
  const codecMap: Record<ExportSettings['codec'], ClientCodec> = {
    h264: 'avc',
    h265: 'hevc',
    vp8: 'vp8',
    vp9: 'vp9',
    prores: 'avc', // ProRes not supported client-side, fallback to H.264
  };

  // Map codec to container
  const containerMap: Record<ClientCodec, ClientVideoContainer> = {
    avc: 'mp4',
    hevc: 'mp4',
    vp8: 'webm',
    vp9: 'webm',
    av1: 'webm',
  };

  // Map quality to bitrate (in bits per second)
  const bitrateMap: Record<ExportSettings['quality'], number> = {
    low: 2_000_000, // 2 Mbps
    medium: 5_000_000, // 5 Mbps
    high: 10_000_000, // 10 Mbps
    ultra: 20_000_000, // 20 Mbps
  };

  const codec = codecMap[settings.codec];
  const container = containerMap[codec];

  return {
    mode: 'video',
    codec,
    container,
    quality: settings.quality,
    resolution: settings.resolution,
    fps,
    videoBitrate: bitrateMap[settings.quality],
    audioBitrate: 192_000, // 192 kbps
  };
}

/**
 * Get default audio codec for a container
 */
export function getDefaultAudioCodec(container: ClientContainer): ClientAudioCodec {
  switch (container) {
    case 'mp4':
    case 'mov':
      return 'aac';
    case 'webm':
    case 'mkv':
      return 'opus';
    case 'mp3':
      return 'mp3';
    case 'wav':
      return 'pcm-s16';
    default:
      return 'aac';
  }
}

/**
 * Check if a container is audio-only
 */
export function isAudioOnlyContainer(container: ClientContainer): container is ClientAudioContainer {
  return ['mp3', 'wav', 'flac', 'aac'].includes(container);
}

/**
 * Check if a codec is supported by WebCodecs in this browser
 */
export async function isCodecSupported(codec: ClientCodec, width: number, height: number): Promise<boolean> {
  if (!('VideoEncoder' in window)) {
    return false;
  }

  const codecStrings: Record<ClientCodec, string> = {
    avc: 'avc1.42E01E', // H.264 Baseline
    hevc: 'hvc1.1.6.L93.B0', // HEVC Main
    vp8: 'vp8',
    vp9: 'vp09.00.10.08',
    av1: 'av01.0.04M.08',
  };

  try {
    const support = await VideoEncoder.isConfigSupported({
      codec: codecStrings[codec],
      width,
      height,
      bitrate: 5_000_000,
    });
    return support.supported ?? false;
  } catch {
    return false;
  }
}

/**
 * Get list of supported codecs for client-side rendering
 */
export async function getSupportedCodecs(width: number, height: number): Promise<ClientCodec[]> {
  const codecs: ClientCodec[] = ['avc', 'hevc', 'vp8', 'vp9', 'av1'];
  const supported: ClientCodec[] = [];

  for (const codec of codecs) {
    if (await isCodecSupported(codec, width, height)) {
      supported.push(codec);
    }
  }

  return supported;
}

/**
 * Create mediabunny output format based on container type
 */
export async function createOutputFormat(container: ClientContainer, options?: { fastStart?: boolean }) {
  const mediabunny = await import('mediabunny');
  const {
    Mp4OutputFormat,
    WebMOutputFormat,
    MovOutputFormat,
    MkvOutputFormat,
    Mp3OutputFormat,
    WavOutputFormat,
    AdtsOutputFormat,
  } = mediabunny;

  switch (container) {
    case 'mp4':
      return new Mp4OutputFormat({
        fastStart: options?.fastStart ? 'in-memory' : false,
      });
    case 'mov':
      return new MovOutputFormat({
        fastStart: options?.fastStart ? 'in-memory' : false,
      });
    case 'webm':
      return new WebMOutputFormat();
    case 'mkv':
      return new MkvOutputFormat();
    case 'mp3':
      return new Mp3OutputFormat();
    case 'aac':
      return new AdtsOutputFormat();
    case 'wav':
      return new WavOutputFormat();
    default:
      return new Mp4OutputFormat({
        fastStart: options?.fastStart ? 'in-memory' : false,
      });
  }
}

/**
 * Get the file extension for a container type
 */
export function getFileExtension(container: ClientContainer): string {
  const extensionMap: Record<ClientContainer, string> = {
    mp4: '.mp4',
    mov: '.mov',
    webm: '.webm',
    mkv: '.mkv',
    mp3: '.mp3',
    aac: '.aac',
    wav: '.wav',
  };
  return extensionMap[container] ?? '.mp4';
}

/**
 * Get the MIME type for a container/codec combination
 */
export function getMimeType(container: ClientContainer, codec?: ClientCodec): string {
  // Audio-only containers
  if (container === 'mp3') return 'audio/mpeg';
  if (container === 'aac') return 'audio/aac';
  if (container === 'wav') return 'audio/wav';

  // Video containers
  if (container === 'mp4' || container === 'mov') {
    if (codec === 'avc') return `video/${container}; codecs="avc1.42E01E"`;
    if (codec === 'hevc') return `video/${container}; codecs="hvc1.1.6.L93.B0"`;
    return `video/${container}`;
  }
  if (container === 'webm' || container === 'mkv') {
    const mimeBase = container === 'webm' ? 'video/webm' : 'video/x-matroska';
    if (codec === 'vp8') return `${mimeBase}; codecs="vp8"`;
    if (codec === 'vp9') return `${mimeBase}; codecs="vp09.00.10.08"`;
    if (codec === 'av1') return `${mimeBase}; codecs="av01.0.04M.08"`;
    return mimeBase;
  }
  return 'video/mp4';
}

/**
 * Validate client export settings
 */
export function validateSettings(settings: ClientExportSettings): { valid: boolean; error?: string } {
  if (settings.resolution.width <= 0 || settings.resolution.height <= 0) {
    return { valid: false, error: 'Invalid resolution' };
  }

  if (settings.fps <= 0 || settings.fps > 120) {
    return { valid: false, error: 'Invalid frame rate (must be 1-120)' };
  }

  // Check for even dimensions (required by most codecs)
  if (settings.resolution.width % 2 !== 0 || settings.resolution.height % 2 !== 0) {
    return { valid: false, error: 'Resolution must have even dimensions' };
  }

  return { valid: true };
}

/**
 * Estimate file size based on settings and duration
 */
export function estimateFileSize(settings: ClientExportSettings, durationSeconds: number): number {
  if (settings.mode === 'audio' || isAudioOnlyContainer(settings.container)) {
    // Audio-only estimation
    const audioBits = (settings.audioBitrate ?? 192_000) * durationSeconds;
    const totalBytes = audioBits / 8;
    return Math.round(totalBytes * 1.05); // 5% overhead for container
  }

  const videoBits = (settings.videoBitrate ?? 5_000_000) * durationSeconds;
  const audioBits = (settings.audioBitrate ?? 192_000) * durationSeconds;
  const totalBytes = (videoBits + audioBits) / 8;

  // Add ~10% overhead for container
  return Math.round(totalBytes * 1.1);
}

/**
 * Get available video codecs for a container
 */
export function getVideoCodecsForContainer(container: ClientVideoContainer): ClientVideoCodec[] {
  switch (container) {
    case 'mp4':
    case 'mov':
      return ['avc', 'hevc'];
    case 'webm':
      return ['vp8', 'vp9', 'av1'];
    case 'mkv':
      return ['avc', 'hevc', 'vp8', 'vp9', 'av1'];
    default:
      return ['avc'];
  }
}

/**
 * Get audio bitrate options based on quality
 */
export function getAudioBitrateForQuality(quality: ClientExportSettings['quality']): number {
  const bitrateMap: Record<ClientExportSettings['quality'], number> = {
    low: 96_000, // 96 kbps
    medium: 192_000, // 192 kbps
    high: 256_000, // 256 kbps
    ultra: 320_000, // 320 kbps
  };
  return bitrateMap[quality];
}

// Re-export formatBytes from central location
export { formatBytes } from '@/utils/format-utils';
