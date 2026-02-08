/**
 * Export System - Client-side video export
 *
 * This module provides WebCodecs-based video export without
 * requiring Composition at runtime.
 *
 * Features:
 * - WebCodecs video encoding (H.264, HEVC, VP8, VP9, AV1)
 * - Multiple container formats (MP4, WebM, MOV, MKV)
 * - Progress reporting and cancellation
 * - Quality presets and custom bitrates
 *
 * Example usage:
 *
 * ```tsx
 * // Using the hook
 * const { startExport, isCodecSupported } = useExportComposition({
 *   tracks,
 *   fps: 30,
 *   durationInFrames: 900,
 *   width: 1920,
 *   height: 1080,
 * });
 *
 * // Or using the class
 * const exporter = new NativeExporter();
 * const result = await exporter.export({ composition, settings });
 * exporter.download(result, 'my-video');
 * ```
 */

// Types
export type {
  CompositionData,
  ExportResolution,
  VideoCodec,
  AudioCodec,
  ContainerFormat,
  QualityPreset,
  NativeExportSettings,
  ExportProgress,
  ExportResult,
  ExportOptions,
} from './types';

// Type utilities
export {
  EXPORT_RESOLUTIONS,
  QUALITY_BITRATES,
  getDefaultExportSettings,
  getMimeTypeForContainer,
  getExtensionForContainer,
  isCodecCompatible,
} from './types';

// Export composition hook
export {
  useExportComposition,
  downloadExportResult,
  revokeExportResult,
  formatFileSize,
  formatDuration,
  type UseExportCompositionOptions,
  type UseExportCompositionReturn,
} from './use-export-composition';

// Native exporter class
export {
  NativeExporter,
  getNativeExporter,
  quickExport,
  isWebCodecsAvailable,
  checkCodecSupport,
  checkAllCodecSupport,
  type CodecSupportStatus,
} from './NativeExporter';
