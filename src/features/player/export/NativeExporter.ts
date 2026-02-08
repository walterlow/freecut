/**
 * NativeExporter.ts - Standalone export class without Composition dependency
 *
 * This class provides a clean interface for exporting compositions
 * using the existing canvas-based render engine and mediabunny.
 *
 * Features:
 * - WebCodecs-based video encoding
 * - Multiple codec support (H.264, HEVC, VP8, VP9, AV1)
 * - Multiple container support (MP4, WebM, MOV, MKV)
 * - Progress reporting
 * - Cancellation support
 * - No Composition runtime dependency
 */

import type {
  CompositionData,
  NativeExportSettings,
  ExportProgress,
  ExportResult,
  VideoCodec,
} from './types';
import {
  getDefaultExportSettings,
  QUALITY_BITRATES,
  getMimeTypeForContainer,
  getExtensionForContainer,
} from './types';

/**
 * Codec support status
 */
export interface CodecSupportStatus {
  avc: boolean;
  hevc: boolean;
  vp8: boolean;
  vp9: boolean;
  av1: boolean;
}

/**
 * WebCodecs codec strings
 */
const CODEC_STRINGS: Record<VideoCodec, string> = {
  avc: 'avc1.42E01E', // H.264 Baseline
  hevc: 'hvc1.1.6.L93.B0', // HEVC Main
  vp8: 'vp8',
  vp9: 'vp09.00.10.08',
  av1: 'av01.0.04M.08',
};

/**
 * Check if WebCodecs API is available
 */
export function isWebCodecsAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof VideoEncoder !== 'undefined' &&
    typeof AudioEncoder !== 'undefined'
  );
}

/**
 * Check if a specific video codec is supported
 */
export async function checkCodecSupport(
  codec: VideoCodec,
  width: number = 1920,
  height: number = 1080
): Promise<boolean> {
  if (!isWebCodecsAvailable()) return false;

  const codecString = CODEC_STRINGS[codec];
  if (!codecString) return false;

  try {
    const support = await VideoEncoder.isConfigSupported({
      codec: codecString,
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
 * Check support for all codecs
 */
export async function checkAllCodecSupport(
  width: number = 1920,
  height: number = 1080
): Promise<CodecSupportStatus> {
  const [avc, hevc, vp8, vp9, av1] = await Promise.all([
    checkCodecSupport('avc', width, height),
    checkCodecSupport('hevc', width, height),
    checkCodecSupport('vp8', width, height),
    checkCodecSupport('vp9', width, height),
    checkCodecSupport('av1', width, height),
  ]);

  return { avc, hevc, vp8, vp9, av1 };
}

/**
 * NativeExporter class
 *
 * Provides a simple interface for exporting compositions without
 * requiring Composition at runtime.
 *
 * @example
 * ```typescript
 * const exporter = new NativeExporter();
 *
 * // Check what's supported
 * const support = await exporter.getCodecSupport();
 * console.log('H.264 supported:', support.avc);
 *
 * // Export a composition
 * const result = await exporter.export({
 *   composition,
 *   settings: {
 *     videoCodec: 'avc',
 *     audioCodec: 'aac',
 *     container: 'mp4',
 *     quality: 'high',
 *     resolution: { width: 1920, height: 1080, label: '1080p' },
 *   },
 *   onProgress: (progress) => console.log(progress),
 * });
 *
 * if (result.success) {
 *   // Download the result
 *   exporter.download(result, 'my-video');
 * }
 * ```
 */
export class NativeExporter {
  private abortController: AbortController | null = null;
  private codecSupport: CodecSupportStatus | null = null;

  /**
   * Check if WebCodecs is available
   */
  isAvailable(): boolean {
    return isWebCodecsAvailable();
  }

  /**
   * Get codec support status (cached after first call)
   */
  async getCodecSupport(
    width: number = 1920,
    height: number = 1080
  ): Promise<CodecSupportStatus> {
    if (!this.codecSupport) {
      this.codecSupport = await checkAllCodecSupport(width, height);
    }
    return this.codecSupport;
  }

  /**
   * Clear cached codec support (call if resolution changes significantly)
   */
  clearCodecCache(): void {
    this.codecSupport = null;
  }

  /**
   * Get default export settings for a composition
   */
  getDefaultSettings(composition: CompositionData): NativeExportSettings {
    return getDefaultExportSettings(composition);
  }

  /**
   * Export a composition
   */
  async export(options: {
    composition: CompositionData;
    settings: NativeExportSettings;
    onProgress?: (progress: ExportProgress) => void;
  }): Promise<ExportResult> {
    const { composition, settings, onProgress } = options;
    const startTime = performance.now();

    // Create abort controller for this export
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    // Report initial progress
    onProgress?.({
      phase: 'preparing',
      progress: 0,
      message: 'Preparing export...',
    });

    try {
      // Check WebCodecs support
      if (!this.isAvailable()) {
        throw new Error('WebCodecs API is not supported in this browser');
      }

      // Check if aborted
      if (signal.aborted) {
        throw new DOMException('Export cancelled', 'AbortError');
      }

      // Check codec support
      const codecSupported = await checkCodecSupport(
        settings.videoCodec,
        settings.resolution.width,
        settings.resolution.height
      );

      if (!codecSupported) {
        throw new Error(
          `Video codec "${settings.videoCodec}" is not supported at ${settings.resolution.width}x${settings.resolution.height}`
        );
      }

      onProgress?.({
        phase: 'preparing',
        progress: 5,
        message: 'Loading render engine...',
      });

      // Dynamically import the render engine
      const { renderComposition } = await import(
        '@/features/export/utils/client-render-engine'
      );

      // Get bitrates
      const bitrates = QUALITY_BITRATES[settings.quality];
      const videoBitrate = settings.videoBitrate ?? bitrates.video;
      const audioBitrate = settings.audioBitrate ?? bitrates.audio;

      // Map settings to client-render-engine format
      const clientSettings = {
        mode: 'video' as const,
        codec: settings.videoCodec,
        container: settings.container,
        quality: settings.quality,
        resolution: {
          width: settings.resolution.width,
          height: settings.resolution.height,
        },
        videoBitrate,
        audioBitrate,
        fps: composition.fps,
      };

      // Calculate frames to render
      const inPoint = settings.inPoint ?? 0;
      const outPoint = settings.outPoint ?? composition.durationInFrames;
      const framesToRender = outPoint - inPoint;

      // Adjust composition for in/out points
      const exportComposition = this.adjustCompositionForInOut(
        composition,
        inPoint,
        outPoint
      );

      // Start render
      const result = await renderComposition({
        settings: clientSettings,
        composition: exportComposition,
        onProgress: (progress) => {
          onProgress?.({
            phase: progress.phase as ExportProgress['phase'],
            progress: progress.progress,
            currentFrame: progress.currentFrame,
            totalFrames: progress.totalFrames ?? framesToRender,
            message: progress.message ?? `${progress.phase}...`,
          });
        },
        signal,
      });

      const exportDuration = performance.now() - startTime;

      // renderComposition returns ClientRenderResult directly (throws on error)
      const url = URL.createObjectURL(result.blob);

      onProgress?.({
        phase: 'complete',
        progress: 100,
        totalFrames: framesToRender,
        currentFrame: framesToRender,
        message: 'Export complete!',
      });

      return {
        success: true,
        blob: result.blob,
        url,
        mimeType: getMimeTypeForContainer(settings.container),
        exportDuration,
        fileSize: result.fileSize,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown export error';

      onProgress?.({
        phase: 'error',
        progress: 0,
        message: `Export failed: ${message}`,
      });

      return {
        success: false,
        error: message,
        exportDuration: performance.now() - startTime,
      };
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Cancel the current export
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Check if an export is currently in progress
   */
  isExporting(): boolean {
    return this.abortController !== null;
  }

  /**
   * Download an export result
   */
  download(
    result: ExportResult,
    filename: string = 'export',
    container?: string
  ): void {
    if (!result.success || !result.url) {
      throw new Error('Cannot download: export was not successful');
    }

    const extension = container
      ? getExtensionForContainer(container as any)
      : '';
    const fullFilename = extension
      ? `${filename}${extension}`
      : filename;

    const link = document.createElement('a');
    link.href = result.url;
    link.download = fullFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Revoke an export result URL to free memory
   */
  revokeUrl(result: ExportResult): void {
    if (result.url) {
      URL.revokeObjectURL(result.url);
    }
  }

  /**
   * Adjust composition for in/out point export
   */
  private adjustCompositionForInOut(
    composition: CompositionData,
    inPoint: number,
    outPoint: number
  ): CompositionData {
    const framesToRender = outPoint - inPoint;

    // If no adjustment needed, return as-is
    if (inPoint === 0 && outPoint === composition.durationInFrames) {
      return composition;
    }

    // Offset all items by in point
    return {
      ...composition,
      durationInFrames: framesToRender,
      tracks: composition.tracks.map((track) => ({
        ...track,
        items: track.items
          .filter((item) => {
            // Filter out items completely outside the range
            const itemEnd = item.from + item.durationInFrames;
            return itemEnd > inPoint && item.from < outPoint;
          })
          .map((item) => ({
            ...item,
            from: item.from - inPoint,
            // Clamp duration if item extends past out point
            durationInFrames: Math.min(
              item.durationInFrames,
              outPoint - item.from
            ),
          })),
      })),
      // Transitions are keyed by clip IDs, so we keep them as-is
      // The rendering engine will determine which transitions are active
      // based on the clips that remain after filtering
      transitions: composition.transitions,
      // Keyframes are stored per-item and frames are relative to item start
      // They don't need frame adjustment since they're item-relative
      keyframes: composition.keyframes,
    };
  }
}

/**
 * Singleton instance for convenience
 */
let exporterInstance: NativeExporter | null = null;

/**
 * Get the singleton NativeExporter instance
 */
export function getNativeExporter(): NativeExporter {
  if (!exporterInstance) {
    exporterInstance = new NativeExporter();
  }
  return exporterInstance;
}

/**
 * Quick export function for simple use cases
 */
export async function quickExport(
  composition: CompositionData,
  settings?: Partial<NativeExportSettings>,
  onProgress?: (progress: ExportProgress) => void
): Promise<ExportResult> {
  const exporter = getNativeExporter();
  const defaultSettings = exporter.getDefaultSettings(composition);
  const mergedSettings = { ...defaultSettings, ...settings };

  return exporter.export({
    composition,
    settings: mergedSettings,
    onProgress,
  });
}
