import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { Server as SocketServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import type { RenderRequest, RenderProgress } from '../types.js';
import { jobManager } from './job-manager.js';
import { mediaService } from './media-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.join(__dirname, '..', 'temp', 'output');

export class RenderService {
  private io: SocketServer | null = null;
  private bundleLocation: string | null = null;
  private activeRenders: Map<string, AbortController> = new Map();

  /**
   * Set Socket.IO instance for emitting progress
   */
  setSocketIO(io: SocketServer): void {
    this.io = io;
  }

  /**
   * Bundle the Remotion project (call once on startup)
   */
  async bundleProject(): Promise<string> {
    if (this.bundleLocation) {
      return this.bundleLocation;
    }

    console.log('[RenderService] Bundling Remotion project...');

    // Point to the Remotion entry point
    const entryPoint = path.join(__dirname, '..', '..', 'src', 'lib', 'remotion', 'root.tsx');

    try {
      this.bundleLocation = await bundle({
        entryPoint,
        // Use a consistent output directory
        webpackOverride: (config) => config,
      });

      console.log('[RenderService] Bundle created at:', this.bundleLocation);
      return this.bundleLocation;
    } catch (error) {
      console.error('[RenderService] Bundle error:', error);
      throw new Error(`Failed to bundle Remotion project: ${error}`);
    }
  }

  /**
   * Start rendering a video
   */
  async startRender(request: RenderRequest): Promise<void> {
    const { jobId, composition, settings } = request;

    console.log(`[RenderService] Starting render for job ${jobId}`);

    // Create abort controller for cancellation
    const abortController = new AbortController();
    this.activeRenders.set(jobId, abortController);

    try {
      // Update job status
      jobManager.updateJob(jobId, { status: 'processing' });
      this.emitProgress(jobId, { progress: 0, status: 'processing' });

      // Ensure bundle is ready
      const bundleLocation = await this.bundleProject();

      // Resolve media paths - replace blob URLs with HTTP URLs served by our server
      const tracksWithResolvedMedia = composition.tracks.map(track => ({
        ...track,
        items: track.items.map(item => {
          if (item.mediaId && (item.type === 'video' || item.type === 'audio' || item.type === 'image')) {
            // Use HTTP URL to access uploaded media via our server
            return {
              ...item,
              src: `http://localhost:3001/api/media/${jobId}/${item.mediaId}`,
            };
          }
          return item;
        }),
      }));

      // Select composition with all properties from export settings
      const compositionData = await selectComposition({
        serveUrl: bundleLocation,
        id: 'MainComposition',
        inputProps: {
          fps: composition.fps,
          durationInFrames: composition.durationInFrames,
          width: composition.width,
          height: composition.height,
          tracks: tracksWithResolvedMedia,
        },
      });

      console.log('[RenderService] Composition selected:', compositionData);
      console.log('[RenderService] Duration:', compositionData.durationInFrames, 'frames at', compositionData.fps, 'fps');
      console.log('[RenderService] Resolution:', compositionData.width, 'x', compositionData.height);

      // Update total frames from composition
      jobManager.updateJob(jobId, { totalFrames: compositionData.durationInFrames });

      // Prepare output path
      await fs.mkdir(OUTPUT_DIR, { recursive: true });
      const outputFileName = `${jobId}.mp4`;
      const outputPath = path.join(OUTPUT_DIR, outputFileName);

      // Start rendering
      console.log(`[RenderService] Rendering to ${outputPath}`);

      // Prepare render options
      const renderOptions: any = {
        composition: compositionData,
        serveUrl: bundleLocation,
        codec: this.getCodec(settings.codec),
        outputLocation: outputPath,
        hardwareAcceleration: 'if-possible',
        videoBitrate: this.getVideoBitrate(settings, composition.width, composition.height),
        audioBitrate: settings.audioBitrate || '192k',
        inputProps: {
          fps: composition.fps,
          durationInFrames: composition.durationInFrames,
          width: composition.width,
          height: composition.height,
          tracks: tracksWithResolvedMedia,
        },
        onProgress: ({ renderedFrames, encodedFrames }) => {
          const progress = Math.round((renderedFrames / compositionData.durationInFrames) * 100);

          jobManager.updateProgress(jobId, {
            progress,
            renderedFrames,
            totalFrames: compositionData.durationInFrames,
            status: 'processing',
          });

          this.emitProgress(jobId, {
            progress,
            renderedFrames,
            totalFrames: compositionData.durationInFrames,
            status: 'processing',
          });

          if (renderedFrames % 30 === 0) {
            console.log(`[RenderService] Job ${jobId}: ${renderedFrames}/${compositionData.durationInFrames} frames (${progress}%)`);
          }
        },
        cancelSignal: () => abortController.signal.aborted,
      };

      // Add ProRes profile if using ProRes codec
      if (settings.codec === 'prores' && settings.proResProfile) {
        renderOptions.proresProfile = settings.proResProfile;
      }

      await renderMedia(renderOptions);

      // Mark as completed
      jobManager.completeJob(jobId, outputPath);
      this.emitProgress(jobId, { progress: 100, status: 'completed' });

      console.log(`[RenderService] Job ${jobId} completed successfully`);

      // Clean up media files after successful render
      await mediaService.cleanupJob(jobId);
    } catch (error: any) {
      // Check if cancelled
      if (error.name === 'AbortError' || abortController.signal.aborted) {
        jobManager.cancelJob(jobId);
        this.emitProgress(jobId, { progress: 0, status: 'cancelled' });
        console.log(`[RenderService] Job ${jobId} was cancelled`);
      } else {
        const errorMessage = error?.message || String(error);
        jobManager.failJob(jobId, errorMessage);
        this.emitProgress(jobId, { progress: 0, status: 'failed' });
        console.error(`[RenderService] Job ${jobId} failed:`, error);
      }

      // Clean up media files on error
      await mediaService.cleanupJob(jobId);
    } finally {
      this.activeRenders.delete(jobId);
    }
  }

  /**
   * Cancel an active render
   */
  cancelRender(jobId: string): boolean {
    const abortController = this.activeRenders.get(jobId);
    if (abortController) {
      abortController.abort();
      console.log(`[RenderService] Cancelling job ${jobId}`);
      return true;
    }
    return false;
  }

  /**
   * Emit progress update via Socket.IO
   */
  private emitProgress(jobId: string, progress: Partial<RenderProgress>): void {
    if (this.io) {
      this.io.emit('render:progress', {
        jobId,
        ...progress,
      });
    }
  }

  /**
   * Map export codec to Remotion codec
   */
  private getCodec(codec: string): 'h264' | 'h265' | 'vp8' | 'vp9' | 'prores' {
    const codecMap: Record<string, 'h264' | 'h265' | 'vp8' | 'vp9' | 'prores'> = {
      h264: 'h264',
      h265: 'h265',
      vp8: 'vp8',
      vp9: 'vp9',
      prores: 'prores',
    };

    return codecMap[codec] || 'h264';
  }

  /**
   * Calculate video bitrate based on quality and resolution
   * User-provided bitrate takes precedence
   */
  private getVideoBitrate(settings: any, width: number, height: number): string {
    // Use user-provided bitrate if available
    if (settings.bitrate) {
      return settings.bitrate;
    }

    // Calculate based on resolution and quality
    const pixelCount = width * height;
    const is4K = pixelCount >= 3840 * 2160 * 0.8; // ~4K (allow some variance)
    const is1080p = pixelCount >= 1920 * 1080 * 0.8; // ~1080p
    const is720p = pixelCount >= 1280 * 720 * 0.8; // ~720p

    // Quality multipliers
    const qualityMap: Record<string, number> = {
      low: 0.5,
      medium: 1.0,
      high: 1.5,
      ultra: 2.0,
    };

    const multiplier = qualityMap[settings.quality] || 1.0;

    // Base bitrates for medium quality
    let baseBitrate: number;
    if (is4K) {
      baseBitrate = 25; // 25 Mbps for 4K
    } else if (is1080p) {
      baseBitrate = 8; // 8 Mbps for 1080p
    } else if (is720p) {
      baseBitrate = 5; // 5 Mbps for 720p
    } else {
      baseBitrate = 2.5; // 2.5 Mbps for lower resolutions
    }

    const finalBitrate = Math.round(baseBitrate * multiplier);
    return `${finalBitrate}M`;
  }

  /**
   * Get output file path for a job
   */
  getOutputPath(jobId: string): string {
    return path.join(OUTPUT_DIR, `${jobId}.mp4`);
  }

  /**
   * Check if output file exists
   */
  async outputExists(jobId: string): Promise<boolean> {
    const outputPath = this.getOutputPath(jobId);
    try {
      await fs.access(outputPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up output file
   */
  async cleanupOutput(jobId: string): Promise<void> {
    const outputPath = this.getOutputPath(jobId);
    try {
      await fs.unlink(outputPath);
      console.log(`[RenderService] Cleaned up output for job ${jobId}`);
    } catch (error) {
      console.error(`[RenderService] Error cleaning up output for job ${jobId}:`, error);
    }
  }

  /**
   * Extract file extension from a filename or URL
   */
  private getFileExtension(filename: string): string {
    // Handle blob URLs and regular filenames
    const name = filename.split('/').pop() || '';
    const match = name.match(/\.([^.]+)$/);
    return match ? match[0] : '';
  }
}

export const renderService = new RenderService();
