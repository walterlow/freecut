import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition, makeCancelSignal } from '@remotion/renderer';
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
  private activeRenders: Map<string, () => void> = new Map(); // Stores cancel functions from makeCancelSignal

  /**
   * Set Socket.IO instance for emitting progress
   */
  setSocketIO(io: SocketServer): void {
    this.io = io;
  }

  /**
   * Invalidate the cached bundle (forces rebuild on next render)
   * Call this when Remotion composition code changes.
   */
  invalidateBundle(): void {
    if (this.bundleLocation) {
      console.log('[RenderService] Invalidating cached bundle');
      this.bundleLocation = null;
    }
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
      // Path to src directory for @ alias resolution
      const srcDir = path.join(__dirname, '..', '..', 'src');

      this.bundleLocation = await bundle({
        entryPoint,
        // Add @ alias for path resolution (matches Vite's config)
        webpackOverride: (config) => ({
          ...config,
          resolve: {
            ...config.resolve,
            alias: {
              ...config.resolve?.alias,
              '@': srcDir,
            },
          },
        }),
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

    // Create cancel signal using Remotion's makeCancelSignal
    const { cancelSignal, cancel } = makeCancelSignal();
    this.activeRenders.set(jobId, cancel);

    try {
      // Update job status
      jobManager.updateJob(jobId, { status: 'processing' });
      this.emitProgress(jobId, { progress: 0, status: 'processing' });

      // Ensure bundle is ready
      const bundleLocation = await this.bundleProject();

      // Get all uploaded media files to find extensions
      const uploadedFiles = await mediaService.listMediaFiles(jobId);
      const mediaExtensions = new Map<string, string>();
      for (const file of uploadedFiles) {
        // Files are stored as {mediaId}{extension}, e.g., "abc123.mp3"
        const dotIndex = file.lastIndexOf('.');
        if (dotIndex > 0) {
          const mediaId = file.substring(0, dotIndex);
          const ext = file.substring(dotIndex);
          mediaExtensions.set(mediaId, ext);
        }
      }

      // Resolve media paths - replace blob URLs with HTTP URLs served by our server
      // Include file extension in URL so Remotion can detect the container format
      // Also strip out thumbnailUrl which contains blob URLs that don't work on server
      const tracksWithResolvedMedia = composition.tracks.map(track => ({
        ...track,
        items: track.items.map(item => {
          // Strip thumbnailUrl from all items - it's a blob URL that causes errors in Remotion
          const { thumbnailUrl, ...itemWithoutThumbnail } = item as any;

          if (item.mediaId && (item.type === 'video' || item.type === 'audio' || item.type === 'image')) {
            const ext = mediaExtensions.get(item.mediaId) || '';
            // Use HTTP URL to access uploaded media via our server
            const resolvedItem = {
              ...itemWithoutThumbnail,
              src: `http://localhost:3001/api/media/${jobId}/${item.mediaId}${ext}`,
            };
            // Debug: log to find any remaining blob URLs
            const itemStr = JSON.stringify(resolvedItem);
            if (itemStr.includes('blob:')) {
              console.log('[RenderService] WARNING: Item still contains blob URL:', itemStr.substring(0, 500));
            }
            return resolvedItem;
          }
          return itemWithoutThumbnail;
        }),
      }));

      // Verify no blob URLs remain in tracks data
      const tracksStr = JSON.stringify(tracksWithResolvedMedia);
      const blobMatches = tracksStr.match(/blob:[^"]+/g);
      if (blobMatches) {
        console.warn('[RenderService] WARNING: Found blob URLs in tracks:', blobMatches);
      }

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

      // Get the canonical codec first, then derive extension from it
      // This ensures codec and extension are always consistent
      const codec = this.getCodec(settings.codec);

      // Inline extension lookup to avoid any caching issues
      const extMap: Record<string, string> = {
        h264: '.mp4',
        h265: '.mp4',
        vp8: '.webm',
        vp9: '.webm',
        prores: '.mov',
        gif: '.gif',
      };
      const fileExtension = extMap[codec] || '.mp4';

      console.log(`[RenderService] Codec: ${settings.codec} -> ${codec}, Extension: ${fileExtension}, extMap[codec]: ${extMap[codec]}`);

      // Prepare output path with correct extension for codec
      await fs.mkdir(OUTPUT_DIR, { recursive: true });
      const outputFileName = `${jobId}${fileExtension}`;
      const outputPath = path.join(OUTPUT_DIR, outputFileName);

      // Start rendering
      console.log(`[RenderService] Rendering to ${outputPath}`);

      // Prepare render options
      const renderOptions: any = {
        composition: compositionData,
        serveUrl: bundleLocation,
        codec: codec,
        outputLocation: outputPath,
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
        cancelSignal,
      };

      // Add ProRes profile if using ProRes codec
      if (settings.codec === 'prores' && settings.proResProfile) {
        renderOptions.proresProfile = settings.proResProfile;
      }

      // Add GIF-specific options
      if (codec === 'gif') {
        // everyNthFrame: 1 = every frame (smooth but large), 2 = every other frame, etc.
        // Default to 1 for smooth playback matching preview
        renderOptions.everyNthFrame = settings.gifEveryNthFrame || 1;
        // Remove video bitrate for GIF (not applicable)
        delete renderOptions.videoBitrate;
        delete renderOptions.audioBitrate;
      }

      await renderMedia(renderOptions);

      // Mark as completed
      jobManager.completeJob(jobId, outputPath);
      this.emitProgress(jobId, { progress: 100, status: 'completed' });

      console.log(`[RenderService] Job ${jobId} completed successfully`);

      // Clean up media files after successful render
      await mediaService.cleanupJob(jobId);
    } catch (error: any) {
      // Check if cancelled - Remotion throws "Render cancelled" error
      const isCancelled = error?.message?.includes('Render cancelled') ||
                          error?.message?.includes('cancelled');
      if (isCancelled) {
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
    const cancelFn = this.activeRenders.get(jobId);
    if (cancelFn) {
      cancelFn();
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
  private getCodec(codec: string): 'h264' | 'h265' | 'vp8' | 'vp9' | 'prores' | 'gif' {
    const codecMap: Record<string, 'h264' | 'h265' | 'vp8' | 'vp9' | 'prores' | 'gif'> = {
      h264: 'h264',
      h265: 'h265',
      vp8: 'vp8',
      vp9: 'vp9',
      prores: 'prores',
      gif: 'gif',
    };

    return codecMap[codec] || 'h264';
  }

  /**
   * Get file extension for codec
   */
  private getFileExtension(codec: string): string {
    const extensionMap: Record<string, string> = {
      h264: '.mp4',
      h265: '.mp4',
      vp8: '.webm',
      vp9: '.webm',
      prores: '.mov',
      gif: '.gif',
    };

    const ext = extensionMap[codec];
    console.log(`[getFileExtension] codec="${codec}", extensionMap[codec]="${ext}", fallback=".mp4"`);
    return ext || '.mp4';
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
   * Get output file path for a job (checks for any extension)
   */
  async findOutputPath(jobId: string): Promise<string | null> {
    const extensions = ['.mp4', '.gif', '.webm', '.mov'];
    for (const ext of extensions) {
      const filePath = path.join(OUTPUT_DIR, `${jobId}${ext}`);
      try {
        await fs.access(filePath);
        return filePath;
      } catch {
        // File doesn't exist with this extension, try next
      }
    }
    return null;
  }

  /**
   * Get output file path for a job (legacy - use findOutputPath instead)
   */
  getOutputPath(jobId: string): string {
    return path.join(OUTPUT_DIR, `${jobId}.mp4`);
  }

  /**
   * Check if output file exists (checks for any extension)
   */
  async outputExists(jobId: string): Promise<boolean> {
    const outputPath = await this.findOutputPath(jobId);
    if (!outputPath) return false;
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
