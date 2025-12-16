/**
 * Client-side video renderer using mediabunny
 *
 * Renders the Remotion composition to a canvas and encodes it to video
 * using mediabunny's WebCodecs-based encoder.
 *
 * Architecture:
 * 1. Mount a hidden Remotion Player at the export resolution
 * 2. For each frame, seek to that frame and capture to canvas
 * 3. Feed canvas frames to mediabunny CanvasSource for encoding
 * 4. Collect audio from media items and encode with AudioDataSource
 * 5. Finalize and return the video blob
 */

import type { ExportSettings } from '@/types/export';

// Codec mapping for mediabunny
export type ClientCodec = 'avc' | 'hevc' | 'vp8' | 'vp9' | 'av1';
export type ClientContainer = 'mp4' | 'webm';

export interface ClientExportSettings {
  codec: ClientCodec;
  container: ClientContainer;
  quality: 'low' | 'medium' | 'high' | 'ultra';
  resolution: { width: number; height: number };
  fps: number;
  audioBitrate?: number;
  videoBitrate?: number;
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
  const containerMap: Record<ClientCodec, ClientContainer> = {
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
  const { Mp4OutputFormat, WebMOutputFormat } = await import('mediabunny');

  if (container === 'mp4') {
    return new Mp4OutputFormat({
      fastStart: options?.fastStart ? 'in-memory' : false,
    });
  } else {
    return new WebMOutputFormat();
  }
}

/**
 * Get the file extension for a container type
 */
export function getFileExtension(container: ClientContainer): string {
  return container === 'mp4' ? '.mp4' : '.webm';
}

/**
 * Get the MIME type for a container/codec combination
 */
export function getMimeType(container: ClientContainer, codec: ClientCodec): string {
  if (container === 'mp4') {
    if (codec === 'avc') return 'video/mp4; codecs="avc1.42E01E"';
    if (codec === 'hevc') return 'video/mp4; codecs="hvc1.1.6.L93.B0"';
  }
  if (container === 'webm') {
    if (codec === 'vp8') return 'video/webm; codecs="vp8"';
    if (codec === 'vp9') return 'video/webm; codecs="vp09.00.10.08"';
    if (codec === 'av1') return 'video/webm; codecs="av01.0.04M.08"';
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
  const videoBits = (settings.videoBitrate ?? 5_000_000) * durationSeconds;
  const audioBits = (settings.audioBitrate ?? 192_000) * durationSeconds;
  const totalBytes = (videoBits + audioBits) / 8;

  // Add ~10% overhead for container
  return Math.round(totalBytes * 1.1);
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
