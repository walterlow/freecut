/**
 * types.ts - Export-related types for the custom player
 *
 * These types define the composition data structure needed for export.
 * They are compatible with the existing client-render-engine but
 * provide a Composition-independent interface.
 */

import type { TimelineTrack } from '@/types/timeline';
import type { Transition } from '@/types/transition';
import type { ItemKeyframes } from '@/types/keyframe';

/**
 * Composition data for export
 *
 * This is equivalent to CompositionInputProps but with a clearer name
 * that doesn't imply Composition dependency.
 */
export interface CompositionData {
  /** Frames per second */
  fps: number;
  /** Total duration in frames */
  durationInFrames: number;
  /** Canvas width in pixels */
  width: number;
  /** Canvas height in pixels */
  height: number;
  /** Timeline tracks containing all items */
  tracks: TimelineTrack[];
  /** Transitions between clips */
  transitions?: Transition[];
  /** Background color (hex) */
  backgroundColor?: string;
  /** Keyframe animations */
  keyframes?: ItemKeyframes[];
}

/**
 * Export resolution presets
 */
export interface ExportResolution {
  width: number;
  height: number;
  label: string;
}

/**
 * Common export resolutions
 */
export const EXPORT_RESOLUTIONS: ExportResolution[] = [
  { width: 3840, height: 2160, label: '4K (3840x2160)' },
  { width: 2560, height: 1440, label: '1440p (2560x1440)' },
  { width: 1920, height: 1080, label: '1080p (1920x1080)' },
  { width: 1280, height: 720, label: '720p (1280x720)' },
  { width: 854, height: 480, label: '480p (854x480)' },
];

/**
 * Video codec options
 */
export type VideoCodec = 'avc' | 'hevc' | 'vp8' | 'vp9' | 'av1';

/**
 * Audio codec options
 */
export type AudioCodec = 'aac' | 'opus' | 'mp3' | 'flac' | 'pcm';

/**
 * Container format options
 */
export type ContainerFormat = 'mp4' | 'webm' | 'mov' | 'mkv';

/**
 * Quality presets
 */
export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

/**
 * Bitrate settings for quality presets (in bits per second)
 */
export const QUALITY_BITRATES: Record<QualityPreset, { video: number; audio: number }> = {
  low: { video: 2_000_000, audio: 96_000 },
  medium: { video: 5_000_000, audio: 192_000 },
  high: { video: 10_000_000, audio: 256_000 },
  ultra: { video: 20_000_000, audio: 320_000 },
};

/**
 * Export settings for the native exporter
 */
export interface NativeExportSettings {
  /** Video codec */
  videoCodec: VideoCodec;
  /** Audio codec */
  audioCodec: AudioCodec;
  /** Container format */
  container: ContainerFormat;
  /** Quality preset */
  quality: QualityPreset;
  /** Output resolution */
  resolution: ExportResolution;
  /** Custom video bitrate (overrides quality preset) */
  videoBitrate?: number;
  /** Custom audio bitrate (overrides quality preset) */
  audioBitrate?: number;
  /** Output filename (without extension) */
  filename?: string;
  /** In point (frame to start export) */
  inPoint?: number;
  /** Out point (frame to end export) */
  outPoint?: number;
}

/**
 * Export progress information
 */
export interface ExportProgress {
  /** Current phase of export */
  phase: 'preparing' | 'encoding' | 'muxing' | 'finalizing' | 'complete' | 'error';
  /** Progress percentage (0-100) */
  progress: number;
  /** Current frame being processed */
  currentFrame?: number;
  /** Total frames to process */
  totalFrames?: number;
  /** Estimated time remaining in seconds */
  estimatedTimeRemaining?: number;
  /** Human-readable status message */
  message: string;
}

/**
 * Export result
 */
export interface ExportResult {
  /** Whether export was successful */
  success: boolean;
  /** Output blob (if successful) */
  blob?: Blob;
  /** Output URL (if successful) */
  url?: string;
  /** MIME type of the output */
  mimeType?: string;
  /** Duration of export in milliseconds */
  exportDuration?: number;
  /** File size in bytes */
  fileSize?: number;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Export options for the render function
 */
export interface ExportOptions {
  /** Composition data to export */
  composition: CompositionData;
  /** Export settings */
  settings: NativeExportSettings;
  /** Progress callback */
  onProgress?: (progress: ExportProgress) => void;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Get default export settings
 */
export function getDefaultExportSettings(
  composition: CompositionData
): NativeExportSettings {
  return {
    videoCodec: 'avc',
    audioCodec: 'aac',
    container: 'mp4',
    quality: 'high',
    resolution: {
      width: composition.width,
      height: composition.height,
      label: `${composition.width}x${composition.height}`,
    },
  };
}

/**
 * Get MIME type for container format
 */
export function getMimeTypeForContainer(container: ContainerFormat): string {
  const mimeTypes: Record<ContainerFormat, string> = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
  };
  return mimeTypes[container];
}

/**
 * Get file extension for container format
 */
export function getExtensionForContainer(container: ContainerFormat): string {
  return `.${container}`;
}

/**
 * Validate codec compatibility with container
 */
export function isCodecCompatible(
  videoCodec: VideoCodec,
  audioCodec: AudioCodec,
  container: ContainerFormat
): boolean {
  const compatibility: Record<ContainerFormat, { video: VideoCodec[]; audio: AudioCodec[] }> = {
    mp4: {
      video: ['avc', 'hevc', 'av1'],
      audio: ['aac', 'mp3', 'flac'],
    },
    webm: {
      video: ['vp8', 'vp9', 'av1'],
      audio: ['opus', 'pcm'],
    },
    mov: {
      video: ['avc', 'hevc'],
      audio: ['aac', 'mp3', 'pcm'],
    },
    mkv: {
      video: ['avc', 'hevc', 'vp8', 'vp9', 'av1'],
      audio: ['aac', 'opus', 'mp3', 'flac', 'pcm'],
    },
  };

  const compat = compatibility[container];
  return compat.video.includes(videoCodec) && compat.audio.includes(audioCodec);
}
