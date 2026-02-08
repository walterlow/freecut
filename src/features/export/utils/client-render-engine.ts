/**
 * Client Render Engine (Enhanced)
 *
 * Core rendering logic that captures frames from an OffscreenCanvas-based
 * composition and encodes them using mediabunny.
 *
 * This enhanced module handles:
 * - Frame-by-frame canvas capture with full feature support
 * - Effects (CSS filters, glitch, halftone, vignette)
 * - Masks (clip and alpha masks with feathering)
 * - Transitions (fade, wipe, slide, flip, clockWipe, iris)
 * - Keyframe animations
 * - Adjustment layer effects
 * - Audio extraction and mixing
 * - Video encoding via mediabunny VideoSampleSource
 * - Progress reporting and cancellation
 */

import type { CompositionInputProps } from '@/types/export';
import type {
  TimelineItem,
  VideoItem,
  ImageItem,
  TextItem,
  ShapeItem,
  AdjustmentItem,
} from '@/types/timeline';
import type { ItemKeyframes } from '@/types/keyframe';
import type { ClientExportSettings, RenderProgress, ClientRenderResult } from './client-renderer';
import { createOutputFormat, getMimeType } from './client-renderer';
import { createLogger } from '@/lib/logger';

// Import subsystems
import { getAnimatedTransform, buildKeyframesMap } from './canvas-keyframes';
import { renderShape } from './canvas-shapes';
import {
  applyAllEffects,
  getAdjustmentLayerEffects,
  combineEffects,
  type AdjustmentLayerWithTrackOrder,
} from './canvas-effects';
import { prepareMasks, applyMasks, type MaskCanvasSettings } from './canvas-masks';
import {
  findActiveTransitions,
  renderTransition,
  buildClipMap,
  getTransitionClipIds,
  type ActiveTransition,
  type TransitionCanvasSettings,
} from './canvas-transitions';
import { processAudio, createAudioBuffer, hasAudioContent, clearAudioDecodeCache } from './canvas-audio';
import { gifFrameCache, type CachedGifFrames } from '../../timeline/services/gif-frame-cache';
import { isGifUrl } from '@/utils/media-utils';
import { CanvasPool, TextMeasurementCache } from './canvas-pool';
import { VideoFrameExtractor } from './canvas-video-extractor';

const log = createLogger('ClientRenderEngine');

/**
 * Check if an image item is an animated GIF
 */
function isAnimatedGif(item: ImageItem): boolean {
  return isGifUrl(item.src) || item.label.toLowerCase().endsWith('.gif');
}

// Font weight mapping to match preview (same as FONT_WEIGHT_MAP in fonts.ts)
const FONT_WEIGHT_MAP: Record<string, number> = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

// Type for mediabunny module (dynamically imported)
type MediabunnyModule = typeof import('mediabunny');

// CanvasPool, TextMeasurementCache, and VideoFrameExtractor are imported from separate modules

export interface RenderEngineOptions {
  settings: ClientExportSettings;
  composition: CompositionInputProps;
  onProgress: (progress: RenderProgress) => void;
  signal?: AbortSignal;
}

/**
 * Main render function - orchestrates the entire client-side render
 */
export async function renderComposition(options: RenderEngineOptions): Promise<ClientRenderResult> {
  const { settings, composition, onProgress, signal } = options;
  const { fps, durationInFrames = 0 } = composition;

  log.info('Starting enhanced client render', {
    fps,
    durationInFrames,
    durationSeconds: durationInFrames / fps,
    width: settings.resolution.width,
    height: settings.resolution.height,
    codec: settings.codec,
    tracksCount: composition.tracks?.length ?? 0,
    hasTransitions: (composition.transitions?.length ?? 0) > 0,
    hasKeyframes: (composition.keyframes?.length ?? 0) > 0,
  });

  // Validate inputs
  if (durationInFrames <= 0) {
    throw new Error('Composition has no duration');
  }

  const totalFrames = durationInFrames;
  const durationSeconds = totalFrames / fps;

  onProgress({
    phase: 'preparing',
    progress: 0,
    totalFrames,
    message: 'Loading encoder...',
  });

  // Check for abort
  if (signal?.aborted) {
    throw new DOMException('Render cancelled', 'AbortError');
  }

  // Dynamically import mediabunny
  const mediabunny: MediabunnyModule = await import('mediabunny');
  const { Output, BufferTarget, VideoSampleSource, VideoSample, AudioBufferSource } = mediabunny;

  onProgress({
    phase: 'preparing',
    progress: 5,
    totalFrames,
    message: 'Processing audio...',
  });

  // Process audio in parallel with setup
  let audioData: { samples: Float32Array[]; sampleRate: number; channels: number } | null = null;
  if (hasAudioContent(composition)) {
    try {
      audioData = await processAudio(composition, signal);
      log.info('Audio processed', {
        hasAudio: !!audioData,
        sampleRate: audioData?.sampleRate,
        channels: audioData?.channels,
      });
    } catch (error) {
      log.error('Audio processing failed, continuing without audio', { error });
    }
  }

  onProgress({
    phase: 'preparing',
    progress: 15,
    totalFrames,
    message: 'Creating encoder...',
  });

  // Create output format
  const format = await createOutputFormat(settings.container, { fastStart: true });

  // Create buffer target to collect the output
  const target = new BufferTarget();

  // Create output
  const output = new Output({
    format,
    target,
  });

  // Get composition (project) resolution - this is what we render at
  const compositionWidth = composition.width ?? settings.resolution.width;
  const compositionHeight = composition.height ?? settings.resolution.height;

  // Export resolution - this is what we output (may be different from composition)
  const exportWidth = settings.resolution.width;
  const exportHeight = settings.resolution.height;

  // Check if we need to scale (export resolution differs from composition)
  const needsScaling = exportWidth !== compositionWidth || exportHeight !== compositionHeight;

  log.info('Resolution settings', {
    composition: { width: compositionWidth, height: compositionHeight },
    export: { width: exportWidth, height: exportHeight },
    needsScaling,
  });

  // Create canvas for rendering frames at COMPOSITION resolution
  // This ensures all positioning/transforms are calculated correctly
  const renderCanvas = new OffscreenCanvas(compositionWidth, compositionHeight);
  // Use willReadFrequently for better performance with frequent getImageData calls
  const ctx = renderCanvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    throw new Error('Failed to create OffscreenCanvas 2D context');
  }

  // Create output canvas at EXPORT resolution (for encoding)
  // If no scaling needed, we'll use renderCanvas directly
  const outputCanvas = needsScaling
    ? new OffscreenCanvas(exportWidth, exportHeight)
    : renderCanvas;
  const outputCtx = needsScaling
    ? outputCanvas.getContext('2d', { willReadFrequently: true })!
    : ctx;

  onProgress({
    phase: 'preparing',
    progress: 20,
    totalFrames,
    message: 'Setting up video encoder...',
  });

  // Create video source for explicit frame capture (at export resolution)
  // VideoSampleSource lets us control frame capture timing precisely with VideoSample
  // Use 'quality' latencyMode to enable B-frames and better rate control for offline encoding
  const videoSource = new VideoSampleSource({
    codec: settings.codec,
    bitrate: settings.videoBitrate ?? 10_000_000,
    keyFrameInterval: 2, // Keyframe every 2 seconds for better seeking
    latencyMode: 'quality', // Enables B-frames and consistent frame quality for offline encoding
  });

  // Add video track
  output.addVideoTrack(videoSource, {
    frameRate: fps,
  });

  // Prepare audio source and buffer (stored outside try block for access after start)
  let audioSource: InstanceType<typeof AudioBufferSource> | null = null;
  let audioBuffer: AudioBuffer | null = null;

  if (audioData) {
    try {
      // Create audio buffer from processed samples
      audioBuffer = createAudioBuffer(audioData);

      // Select audio codec based on container
      // WebM only supports opus/vorbis, MP4 supports aac
      const audioCodec = settings.container === 'webm' ? 'opus' : 'aac';

      // Create audio source for encoding
      audioSource = new AudioBufferSource({
        codec: audioCodec,
        bitrate: settings.audioBitrate ?? 192000,
      });

      // Add audio track to output (audio data fed after start())
      output.addAudioTrack(audioSource);
      log.info('Audio track added to output', {
        duration: audioBuffer.duration,
        channels: audioBuffer.numberOfChannels,
        sampleRate: audioBuffer.sampleRate,
        codec: audioCodec,
      });
    } catch (error) {
      log.error('Failed to setup audio track', { error });
      audioSource = null;
      audioBuffer = null;
    }
  }

  // Start the output
  await output.start();

  // Feed audio buffer after output has started
  // AudioBufferSource.add() must be called after output.start()
  if (audioSource && audioBuffer) {
    try {
      await audioSource.add(audioBuffer);
      log.info('Audio buffer fed to encoder', {
        duration: audioBuffer.duration,
        samples: audioBuffer.length,
      });
    } catch (error) {
      log.error('Failed to feed audio to encoder', { error });
    }
  }

  onProgress({
    phase: 'rendering',
    progress: 0,
    currentFrame: 0,
    totalFrames,
    message: 'Rendering frames...',
  });

  // Create a composition renderer
  const frameRenderer = await createCompositionRenderer(composition, renderCanvas, ctx);

  try {
    // Preload media
    await frameRenderer.preload();

    // Render each frame
    for (let frame = 0; frame < totalFrames; frame++) {
      // Check for abort
      if (signal?.aborted) {
        await output.cancel();
        throw new DOMException('Render cancelled', 'AbortError');
      }

      // Render frame to canvas (at composition resolution)
      await frameRenderer.renderFrame(frame);

      // Scale to output resolution if needed
      if (needsScaling) {
        // Clear output canvas and draw scaled version
        outputCtx.clearRect(0, 0, exportWidth, exportHeight);
        outputCtx.drawImage(renderCanvas, 0, 0, exportWidth, exportHeight);
      }
      // NOTE: Removed getImageData() flush calls - they caused GPU→CPU stalls.
      // mediabunny's CanvasSource.add() handles frame capture correctly without
      // requiring explicit flush. This optimization improves render time by ~10-15%.

      // Calculate timestamp in seconds
      const timestamp = frame / fps;
      const frameDuration = 1 / fps;

      // Explicitly snapshot canvas pixels into a VideoSample
      // VideoSample constructor copies pixel data immediately, preventing any race
      const sample = new VideoSample(outputCanvas, { timestamp, duration: frameDuration });

      // Add frame to video source, then release GPU memory
      // Force first frame to be a keyframe to ensure proper GOP structure
      // IMPORTANT: Must await to ensure frames are processed in order
      try {
        if (frame === 0) {
          await videoSource.add(sample, { keyFrame: true });
        } else {
          await videoSource.add(sample);
        }
      } finally {
        // VideoSampleSource does NOT close samples (unlike CanvasSource).
        // We must close to release the underlying VideoFrame's GPU memory,
        // otherwise the browser throttles after ~8-16 outstanding frames.
        sample.close();
      }

      // Report progress
      const progress = Math.round((frame / totalFrames) * 100);
      onProgress({
        phase: 'rendering',
        progress,
        currentFrame: frame,
        totalFrames,
        message: `Rendering frame ${frame + 1}/${totalFrames}`,
      });
    }

    onProgress({
      phase: 'finalizing',
      progress: 95,
      currentFrame: totalFrames,
      totalFrames,
      message: 'Finalizing video...',
    });

    // Close audio source before finalizing (signals no more audio data)
    if (audioSource) {
      try {
        audioSource.close();
        log.info('Audio source closed');
      } catch (error) {
        log.error('Failed to close audio source', { error });
      }
    }

    // Finalize output
    await output.finalize();

    // Get the buffer
    const buffer = target.buffer;
    if (!buffer) {
      throw new Error('No output buffer generated');
    }

    const blob = new Blob([buffer], { type: getMimeType(settings.container, settings.codec) });

    onProgress({
      phase: 'finalizing',
      progress: 100,
      currentFrame: totalFrames,
      totalFrames,
      message: 'Complete!',
    });

    // Cleanup
    frameRenderer.dispose();
    clearAudioDecodeCache();

    return {
      blob,
      mimeType: getMimeType(settings.container, settings.codec),
      duration: durationSeconds,
      fileSize: blob.size,
    };
  } catch (error) {
    // Cleanup on error
    frameRenderer.dispose();
    clearAudioDecodeCache();

    // Attempt to cancel the output on error
    try {
      if (output.state === 'started') {
        await output.cancel();
      }
    } catch {
      // Ignore cancel errors
    }
    throw error;
  }
}

/**
 * Canvas settings for rendering
 */
interface CanvasSettings {
  width: number;
  height: number;
  fps: number;
}

/**
 * Creates a composition renderer that can render frames to a canvas
 * with full support for effects, masks, transitions, and keyframe animations.
 */
async function createCompositionRenderer(
  composition: CompositionInputProps,
  canvas: OffscreenCanvas,
  ctx: OffscreenCanvasRenderingContext2D
) {
  const {
    fps,
    tracks = [],
    transitions = [],
    backgroundColor = '#000000',
    keyframes = [],
  } = composition;

  const canvasSettings: CanvasSettings = {
    width: canvas.width,
    height: canvas.height,
    fps,
  };

  // === PERFORMANCE OPTIMIZATION: Canvas Pool ===
  // Pre-allocate reusable canvases instead of creating new ones per frame
  // Initial size: 10 (1 content + ~5 items + 2 effects + 2 transitions)
  const canvasPool = new CanvasPool(canvas.width, canvas.height, 10, 20);

  // === PERFORMANCE OPTIMIZATION: Text Measurement Cache ===
  const textMeasureCache = new TextMeasurementCache();

  // Build lookup maps
  const keyframesMap = buildKeyframesMap(keyframes);

  // === PERFORMANCE OPTIMIZATION: Use mediabunny for video decoding ===
  // VideoFrameExtractor provides precise frame access without seek delays
  const videoExtractors = new Map<string, VideoFrameExtractor>();
  // Keep video elements as fallback if mediabunny fails
  const videoElements = new Map<string, HTMLVideoElement>();

  for (const track of tracks) {
    for (const item of track.items ?? []) {
      if (item.type === 'video') {
        const videoItem = item as VideoItem;
        if (videoItem.src) {
          log.debug('Creating VideoFrameExtractor', {
            itemId: item.id,
            src: videoItem.src.substring(0, 80),
          });

          // Create mediabunny extractor (primary)
          const extractor = new VideoFrameExtractor(videoItem.src, item.id);
          videoExtractors.set(item.id, extractor);

          // Also create fallback video element in case mediabunny fails
          const video = document.createElement('video');
          video.src = videoItem.src;
          video.muted = true;
          video.preload = 'auto';
          video.crossOrigin = 'anonymous';
          videoElements.set(item.id, video);
        }
      }
    }
  }

  // Pre-load image elements
  const imageElements = new Map<string, HTMLImageElement>();
  const imageLoadPromises: Promise<void>[] = [];

  // Track GIF items for animated frame extraction
  const gifItems: ImageItem[] = [];
  const gifFramesMap = new Map<string, CachedGifFrames>();

  for (const track of tracks) {
    for (const item of track.items ?? []) {
      if (item.type === 'image' && (item as ImageItem).src) {
        const imageItem = item as ImageItem;

        // Check if this is an animated GIF
        if (isAnimatedGif(imageItem)) {
          gifItems.push(imageItem);
          // Still load as regular image for fallback
        }

        const img = new Image();
        img.crossOrigin = 'anonymous';
        const loadPromise = new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error(`Failed to load image: ${imageItem.src}`));
        });
        img.src = imageItem.src;
        imageElements.set(item.id, img);
        imageLoadPromises.push(loadPromise);
      }
    }
  }

  // Collect adjustment layers
  const adjustmentLayers: AdjustmentLayerWithTrackOrder[] = [];
  for (const track of tracks) {
    for (const item of track.items) {
      if (item.type === 'adjustment') {
        adjustmentLayers.push({
          layer: item as AdjustmentItem,
          trackOrder: track.order ?? 0,
        });
      }
    }
  }

  // Build clip map for transitions
  const allClips: TimelineItem[] = [];
  for (const track of tracks) {
    for (const item of track.items) {
      if (item.type === 'video' || item.type === 'image') {
        allClips.push(item);
      }
    }
  }
  const clipMap = buildClipMap(allClips);

  // Track which videos successfully use mediabunny (for render decisions)
  const useMediabunny = new Set<string>();

  return {
    async preload() {
      log.debug('Preloading media', {
        videoCount: videoExtractors.size,
        imageCount: imageElements.size,
      });

      // Wait for images
      await Promise.all(imageLoadPromises);

      // === Initialize mediabunny video extractors (primary method) ===
      const extractorInitPromises = Array.from(videoExtractors.entries()).map(
        async ([itemId, extractor]) => {
          const success = await extractor.init();
          if (success) {
            useMediabunny.add(itemId);
            log.info('Using mediabunny for video', { itemId: itemId.substring(0, 8) });
          } else {
            log.warn('Falling back to HTML5 video', { itemId: itemId.substring(0, 8) });
          }
        }
      );

      await Promise.all(extractorInitPromises);

      log.info('Video initialization complete', {
        mediabunny: useMediabunny.size,
        fallback: videoExtractors.size - useMediabunny.size,
      });

      // === Load fallback video elements for items that failed mediabunny ===
      const fallbackVideoIds = Array.from(videoElements.keys()).filter(id => !useMediabunny.has(id));

      if (fallbackVideoIds.length > 0) {
        const videoLoadPromises = fallbackVideoIds.map(
          (itemId) => {
            const video = videoElements.get(itemId)!;
            return new Promise<void>((resolve) => {
              const timeout = setTimeout(() => {
                log.warn('Video load timeout', { itemId });
                resolve();
              }, 10000);

              if (video.readyState >= 2) {
                clearTimeout(timeout);
                resolve();
              } else {
                video.addEventListener('loadeddata', () => {
                  clearTimeout(timeout);
                  resolve();
                }, { once: true });
                video.addEventListener('error', () => {
                  clearTimeout(timeout);
                  log.error('Video load error', { itemId });
                  resolve();
                }, { once: true });
                video.load();
              }
            });
          }
        );

        await Promise.all(videoLoadPromises);
      }

      // Load GIF frames for animated GIFs
      if (gifItems.length > 0) {
        log.debug('Preloading GIF frames', { gifCount: gifItems.length });

        const gifLoadPromises = gifItems.map(async (gifItem) => {
          try {
            // Use mediaId if available, otherwise use item id
            const mediaId = gifItem.mediaId ?? gifItem.id;
            const cachedFrames = await gifFrameCache.getGifFrames(mediaId, gifItem.src);
            gifFramesMap.set(gifItem.id, cachedFrames);
            log.debug('GIF frames loaded', {
              itemId: gifItem.id.substring(0, 8),
              frameCount: cachedFrames.frames.length,
              totalDuration: cachedFrames.totalDuration,
            });
          } catch (err) {
            log.error('Failed to load GIF frames', { itemId: gifItem.id, error: err });
            // GIF will fallback to static image rendering
          }
        });

        await Promise.all(gifLoadPromises);
        log.debug('All GIF frames loaded', { loadedCount: gifFramesMap.size });
      }

      log.debug('All media loaded');
    },

    async renderFrame(frame: number) {
      // Clear canvas
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Prepare masks for this frame
      const maskSettings: MaskCanvasSettings = canvasSettings;
      const activeMasks = prepareMasks(tracks, frame, maskSettings);

      // Find active transitions
      const activeTransitions = findActiveTransitions(transitions, clipMap, frame, fps);
      const transitionClipIds = getTransitionClipIds(transitions, clipMap, frame);

      // Debug: Log transition state at key frames (only in development)
      if (import.meta.env.DEV && activeTransitions.length > 0 && (frame === activeTransitions[0]?.transitionStart || frame % 30 === 0)) {
        log.info(`TRANSITION STATE: frame=${frame} activeTransitions=${activeTransitions.length} skippedClipIds=${Array.from(transitionClipIds).map(id => id.substring(0,8)).join(',')}`);
      }

      // Sort tracks for rendering (bottom to top)
      const sortedTracks = [...tracks].sort((a, b) => (b.order ?? 0) - (a.order ?? 0));

      // Log periodically (only in development)
      if (import.meta.env.DEV && frame % 30 === 0) {
        log.debug('Rendering frame', {
          frame,
          tracksCount: sortedTracks.length,
          activeMasks: activeMasks.length,
          activeTransitions: activeTransitions.length,
        });
      }

      // === PERFORMANCE: Use pooled canvas instead of creating new one each frame ===
      const { canvas: contentCanvas, ctx: contentCtx } = canvasPool.acquire();


      // Helper function to render a single item with effects
      const renderItemWithEffects = async (
        item: TimelineItem,
        trackOrder: number
      ) => {
        // Get animated transform
        const itemKeyframes = keyframesMap.get(item.id);
        const transform = getAnimatedTransform(item, itemKeyframes, frame, canvasSettings);

        // Get effects (item effects + adjustment layer effects)
        const adjEffects = getAdjustmentLayerEffects(
          trackOrder,
          adjustmentLayers,
          frame
        );
        const combinedEffects = combineEffects(item.effects, adjEffects);

        // === PERFORMANCE: Use pooled canvas instead of creating new one ===
        const { canvas: itemCanvas, ctx: itemCtx } = canvasPool.acquire();

        // Render based on item type
        await renderItem(
          itemCtx,
          item,
          transform,
          frame,
          canvasSettings,
          videoElements,
          imageElements
        );

        // Debug: check if itemCanvas has content (only in development, expensive operation)
        if (import.meta.env.DEV && frame === 0) {
          const imageData = itemCtx.getImageData(0, 0, 100, 100);
          const hasContent = imageData.data.some((v, i) => i % 4 !== 3 && v > 0);
          const hasAlpha = imageData.data.some((v, i) => i % 4 === 3 && v > 0);
          log.info(`ITEM CANVAS CHECK: hasContent=${hasContent} hasAlpha=${hasAlpha} itemType=${item.type}`);
        }

        // Apply effects
        if (combinedEffects.length > 0) {
          const { canvas: effectCanvas, ctx: effectCtx } = canvasPool.acquire();
          applyAllEffects(effectCtx, itemCanvas, combinedEffects, frame, canvasSettings);
          contentCtx.drawImage(effectCanvas, 0, 0);
          canvasPool.release(effectCanvas);
        } else {
          contentCtx.drawImage(itemCanvas, 0, 0);
        }

        // Release item canvas back to pool
        canvasPool.release(itemCanvas);
      };

      // Helper to check if item should be rendered
      const shouldRenderItem = (item: TimelineItem): boolean => {
        // Skip items not visible at this frame
        if (frame < item.from || frame >= item.from + item.durationInFrames) {
          return false;
        }
        // Skip items being handled by transitions
        if (transitionClipIds.has(item.id)) {
          // Debug log only in development
          if (import.meta.env.DEV && frame === activeTransitions[0]?.transitionStart) {
            log.info(`SKIPPING clip ${item.id.substring(0,8)} - handled by transition`);
          }
          return false;
        }
        // Skip audio items (handled separately)
        if (item.type === 'audio') return false;
        // Skip adjustment items (they apply effects, not render content)
        if (item.type === 'adjustment') return false;
        // Skip mask shapes (handled by mask system)
        if (item.type === 'shape' && (item as ShapeItem).isMask) return false;
        return true;
      };

      // Build map of track ID → track order for transition lookup
      const trackOrderMap = new Map<string, number>();
      for (const track of tracks) {
        trackOrderMap.set(track.id, track.order ?? 0);
      }

      // Group transitions by their track order
      const transitionsByTrackOrder = new Map<number, ActiveTransition[]>();
      for (const activeTransition of activeTransitions) {
        // Get track order from the transition's trackId or from the clips
        const transitionTrackId = activeTransition.transition.trackId;
        const trackOrder = transitionTrackId
          ? (trackOrderMap.get(transitionTrackId) ?? 0)
          : 0;

        if (!transitionsByTrackOrder.has(trackOrder)) {
          transitionsByTrackOrder.set(trackOrder, []);
        }
        transitionsByTrackOrder.get(trackOrder)!.push(activeTransition);
      }

      // === OCCLUSION CULLING OPTIMIZATION ===
      // Find the topmost (lowest order) track with a fully occluding item.
      // Skip rendering all tracks below it (higher order) since they'll be fully covered.
      //
      // An item is fully occluding if:
      // - Covers entire canvas (after transform/keyframes)
      // - Opacity = 1 (after keyframe animation)
      // - No rotation (or 0°/180° that still covers)
      // - No corner radius
      // - Is video/image (opaque content)
      // - Not in a transition
      // - No transparency effects
      // - No active masks (masks could reveal content below)

      const isFullyOccluding = (item: TimelineItem, trackOrder: number): boolean => {
        // Only videos and images can be fully opaque
        if (item.type !== 'video' && item.type !== 'image') return false;

        // Items in transitions are blended, not fully occluding
        if (transitionClipIds.has(item.id)) return false;

        // Get animated transform at current frame
        const itemKeyframes = keyframesMap.get(item.id);
        const transform = getAnimatedTransform(item, itemKeyframes, frame, canvasSettings);

        // Check opacity (must be 1.0)
        if (transform.opacity < 1) return false;

        // Check rotation (only 0° or 180° can fully cover without exposing corners)
        const rotation = transform.rotation % 360;
        if (rotation !== 0 && rotation !== 180 && rotation !== -180) return false;

        // Check corner radius (rounded corners expose content)
        if (transform.cornerRadius > 0) return false;

        // Check if item covers entire canvas
        const itemLeft = canvas.width / 2 + transform.x - transform.width / 2;
        const itemTop = canvas.height / 2 + transform.y - transform.height / 2;
        const itemRight = itemLeft + transform.width;
        const itemBottom = itemTop + transform.height;

        // Must cover entire canvas (with small tolerance for floating point)
        const tolerance = 1;
        if (itemLeft > tolerance || itemTop > tolerance) return false;
        if (itemRight < canvas.width - tolerance || itemBottom < canvas.height - tolerance) return false;

        // Check for effects that might add transparency
        const itemEffects = item.effects ?? [];
        const adjEffects = getAdjustmentLayerEffects(trackOrder, adjustmentLayers, frame);
        const allEffects = [...itemEffects, ...adjEffects];

        for (const effectWrapper of allEffects) {
          if (!effectWrapper.enabled) continue;
          const effect = effectWrapper.effect;
          // Effects that could add transparency
          if (effect.type === 'glitch' ||
              effect.type === 'canvas-effect' ||
              ('opacity' in effect && typeof effect.opacity === 'number' && effect.opacity < 1)) {
            return false;
          }
        }

        return true;
      };

      // Find occlusion cutoff - the lowest track order with a fully occluding item
      // If masks are active, disable occlusion culling (masks could reveal content)
      let occlusionCutoffOrder: number | null = null;

      if (activeMasks.length === 0) {
        // Scan tracks from top to bottom (lowest order first) to find first occluding item
        const tracksTopToBottom = [...sortedTracks].reverse();

        for (const track of tracksTopToBottom) {
          if (track.visible === false) continue;
          const trackOrder = track.order ?? 0;

          for (const item of track.items ?? []) {
            if (!shouldRenderItem(item)) continue;

            if (isFullyOccluding(item, trackOrder)) {
              occlusionCutoffOrder = trackOrder;
              if (frame % 30 === 0) {
                log.debug(`Occlusion culling: item ${item.id.substring(0, 8)} on track order ${trackOrder} fully occludes canvas`);
              }
              break;
            }
          }

          if (occlusionCutoffOrder !== null) break;
        }
      }

      // Render tracks in order (bottom to top), with transitions at their track position
      // Track order: higher values render first (behind), lower values render last (on top)
      let skippedTracks = 0;

      for (const track of sortedTracks) {
        if (track.visible === false) continue;
        const trackOrder = track.order ?? 0;

        // OCCLUSION CULLING: Skip tracks that are fully occluded by higher tracks
        if (occlusionCutoffOrder !== null && trackOrder > occlusionCutoffOrder) {
          skippedTracks++;
          continue;
        }

        // Render all items on this track (respecting track order as primary)
        for (const item of track.items ?? []) {
          if (!shouldRenderItem(item)) continue;
          await renderItemWithEffects(item, trackOrder);
        }

        // Render transitions that belong to this track (after the track's items)
        const trackTransitions = transitionsByTrackOrder.get(trackOrder);
        if (trackTransitions) {
          for (const activeTransition of trackTransitions) {
            await renderTransitionToCanvas(
              contentCtx,
              activeTransition,
              frame,
              canvasSettings,
              videoElements,
              imageElements,
              keyframesMap,
              adjustmentLayers,
              trackOrder
            );

            // Debug: Check content after transition (only in development - expensive getImageData)
            if (import.meta.env.DEV && frame === activeTransition.transitionStart) {
              const afterData = contentCtx.getImageData(Math.floor(canvas.width/2), Math.floor(canvas.height/2), 1, 1).data;
              log.info(`TRANSITION RENDERED: frame=${frame} trackOrder=${trackOrder} progress=${activeTransition.progress.toFixed(3)} centerPixel=(${afterData[0]},${afterData[1]},${afterData[2]},${afterData[3]})`);
            }
          }
        }
      }

      // Log occlusion culling stats periodically (only in development)
      if (import.meta.env.DEV && skippedTracks > 0 && frame % 30 === 0) {
        log.debug(`Occlusion culling: skipped ${skippedTracks} tracks at frame ${frame}`);
      }

      // Apply masks to content
      if (activeMasks.length > 0) {
        applyMasks(ctx, contentCanvas, activeMasks, maskSettings);
      } else {
        ctx.drawImage(contentCanvas, 0, 0);
      }

      // Release content canvas back to pool
      canvasPool.release(contentCanvas);

      // Debug: Check final output during transitions (only in development - expensive getImageData)
      if (import.meta.env.DEV && activeTransitions.length > 0 && frame === activeTransitions[0]?.transitionStart) {
        const finalData = ctx.getImageData(Math.floor(canvas.width/2), Math.floor(canvas.height/2), 1, 1).data;
        log.info(`FINAL OUTPUT CHECK: frame=${frame} alpha=${finalData[3]} RGB=(${finalData[0]},${finalData[1]},${finalData[2]})`);
      }
    },

    dispose() {
      // Clean up mediabunny video extractors
      for (const extractor of videoExtractors.values()) {
        extractor.dispose();
      }
      videoExtractors.clear();
      useMediabunny.clear();

      // Clean up fallback video elements
      for (const video of videoElements.values()) {
        video.pause();
        video.onerror = null;
        video.removeAttribute('src');
        video.load();
      }
      videoElements.clear();
      imageElements.clear();
      gifFramesMap.clear(); // Clear GIF frame references (actual frames are managed by gifFrameCache)

      // === PERFORMANCE: Clean up optimization resources ===
      canvasPool.dispose();
      textMeasureCache.clear();

      // Log pool stats in development
      if (import.meta.env.DEV) {
        log.debug('Canvas pool disposed', canvasPool.getStats());
      }
    },
  };

  /**
   * Render a single item to canvas
   * @param sourceFrameOffset - Optional offset to add to the source frame for video items (in frames)
   */
  async function renderItem(
    ctx: OffscreenCanvasRenderingContext2D,
    item: TimelineItem,
    transform: { x: number; y: number; width: number; height: number; rotation: number; opacity: number; cornerRadius: number },
    frame: number,
    canvas: CanvasSettings,
    videoElements: Map<string, HTMLVideoElement>,
    imageElements: Map<string, HTMLImageElement>,
    sourceFrameOffset: number = 0
  ): Promise<void> {
    ctx.save();

    // Apply opacity only if it's not the default value (1.0)
    // This prevents inherited/errant keyframe values from making clips transparent
    // while still allowing intentional opacity changes
    if (transform.opacity !== 1) {
      ctx.globalAlpha = transform.opacity;
    }

    // Apply rotation
    if (transform.rotation !== 0) {
      const centerX = canvas.width / 2 + transform.x;
      const centerY = canvas.height / 2 + transform.y;
      ctx.translate(centerX, centerY);
      ctx.rotate((transform.rotation * Math.PI) / 180);
      ctx.translate(-centerX, -centerY);
    }

    switch (item.type) {
      case 'video':
        await renderVideoItem(ctx, item as VideoItem, transform, frame, canvas, videoElements, sourceFrameOffset);
        break;
      case 'image':
        renderImageItem(ctx, item as ImageItem, transform, canvas, imageElements, frame, gifFramesMap);
        break;
      case 'text':
        renderTextItem(ctx, item as TextItem, transform, canvas);
        break;
      case 'shape':
        renderShape(ctx, item as ShapeItem, transform, { width: canvas.width, height: canvas.height });
        break;
    }

    ctx.restore();
  }

  /**
   * Render video item using mediabunny (fast) or HTML5 video element (fallback)
   * @param sourceFrameOffset - Optional offset to add to the source frame (in frames, not seconds)
   */
  async function renderVideoItem(
    ctx: OffscreenCanvasRenderingContext2D,
    item: VideoItem,
    transform: { x: number; y: number; width: number; height: number; rotation: number; opacity: number },
    frame: number,
    canvas: CanvasSettings,
    videoElements: Map<string, HTMLVideoElement>,
    sourceFrameOffset: number = 0
  ): Promise<void> {
    // Calculate source time
    const localFrame = frame - item.from;
    const localTime = localFrame / fps;
    const sourceStart = item.sourceStart ?? item.trimStart ?? 0;
    const speed = item.speed ?? 1;
    const adjustedSourceStart = sourceStart + sourceFrameOffset;
    const sourceTime = adjustedSourceStart / fps + localTime * speed;

    // === TRY MEDIABUNNY FIRST (fast, precise frame access) ===
    if (useMediabunny.has(item.id)) {
      const extractor = videoExtractors.get(item.id);
      if (extractor) {
        const clampedTime = Math.max(0, Math.min(sourceTime, extractor.getDuration() - 0.01));
        const dims = extractor.getDimensions();
        const drawDimensions = calculateMediaDrawDimensions(
          dims.width,
          dims.height,
          transform,
          canvas
        );

        // Draw frame directly to canvas (handles sample lifecycle properly)
        const success = await extractor.drawFrame(
          ctx,
          clampedTime,
          drawDimensions.x,
          drawDimensions.y,
          drawDimensions.width,
          drawDimensions.height
        );

        if (success) {
          // Debug logging (only in development)
          if (import.meta.env.DEV && (frame < 5 || frame % 60 === 0)) {
            log.debug(`VIDEO DRAW (mediabunny) frame=${frame} sourceTime=${clampedTime.toFixed(2)}s`);
          }
          return;
        }
        // If frame draw failed, fall through to HTML5 fallback
        log.warn('Mediabunny frame draw failed, using fallback', { itemId: item.id, frame });
      }
    }

    // === FALLBACK TO HTML5 VIDEO ELEMENT (slower, seeks required) ===
    const video = videoElements.get(item.id);
    if (!video) {
      if (frame === 0) log.warn('Video element not found', { itemId: item.id });
      return;
    }

    const clampedTime = Math.max(0, Math.min(sourceTime, video.duration - 0.01));

    // Optimized seek tolerance and timeouts
    const SEEK_TOLERANCE = 0.034;
    const SEEK_TIMEOUT = 150;
    const READY_TIMEOUT = 300;

    const needsSeek = Math.abs(video.currentTime - clampedTime) > SEEK_TOLERANCE;
    if (needsSeek) {
      video.currentTime = clampedTime;

      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
        setTimeout(() => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        }, SEEK_TIMEOUT);
      });
    }

    // Wait for video to have enough data to draw
    if (video.readyState < 2) {
      await new Promise<void>((resolve) => {
        const checkReady = () => {
          if (video.readyState >= 2) {
            video.removeEventListener('canplay', checkReady);
            video.removeEventListener('loadeddata', checkReady);
            resolve();
          }
        };
        video.addEventListener('canplay', checkReady);
        video.addEventListener('loadeddata', checkReady);
        checkReady();
        setTimeout(() => {
          video.removeEventListener('canplay', checkReady);
          video.removeEventListener('loadeddata', checkReady);
          resolve();
        }, READY_TIMEOUT);
      });
    }

    if (video.readyState < 2) {
      if (import.meta.env.DEV && frame < 5) log.warn(`Video not ready after waiting: frame=${frame} readyState=${video.readyState}`);
      return;
    }

    const drawDimensions = calculateMediaDrawDimensions(
      video.videoWidth,
      video.videoHeight,
      transform,
      canvas
    );

    // Debug logging (only in development)
    if (import.meta.env.DEV && (frame < 5 || frame % 30 === 0)) {
      log.debug(`VIDEO DRAW (fallback) frame=${frame} sourceTime=${clampedTime.toFixed(2)}s readyState=${video.readyState}`);
    }

    ctx.drawImage(
      video,
      drawDimensions.x,
      drawDimensions.y,
      drawDimensions.width,
      drawDimensions.height
    );
  }

  /**
   * Render image item (supports animated GIFs)
   */
  function renderImageItem(
    ctx: OffscreenCanvasRenderingContext2D,
    item: ImageItem,
    transform: { x: number; y: number; width: number; height: number },
    canvas: CanvasSettings,
    imageElements: Map<string, HTMLImageElement>,
    frame: number,
    gifFramesMap: Map<string, CachedGifFrames>
  ): void {
    // Check if this is an animated GIF with cached frames
    const cachedGif = gifFramesMap.get(item.id);

    if (cachedGif && cachedGif.frames.length > 0) {
      // Calculate GIF frame based on current timeline frame
      const localFrame = frame - item.from;
      const playbackRate = item.speed ?? 1;
      const timeMs = (localFrame / fps) * 1000 * playbackRate;

      // Get the correct GIF frame for this time
      const { frame: gifFrame } = gifFrameCache.getFrameAtTime(cachedGif, timeMs);

      const drawDimensions = calculateMediaDrawDimensions(
        cachedGif.width,
        cachedGif.height,
        transform,
        canvas
      );

      ctx.drawImage(
        gifFrame,
        drawDimensions.x,
        drawDimensions.y,
        drawDimensions.width,
        drawDimensions.height
      );
      return;
    }

    // Fallback to static image rendering
    const img = imageElements.get(item.id);
    if (!img) return;

    const drawDimensions = calculateMediaDrawDimensions(
      img.naturalWidth,
      img.naturalHeight,
      transform,
      canvas
    );

    ctx.drawImage(
      img,
      drawDimensions.x,
      drawDimensions.y,
      drawDimensions.width,
      drawDimensions.height
    );
  }

  /**
   * Render text item with clipping and word wrapping to match preview (WYSIWYG)
   */
  function renderTextItem(
    ctx: OffscreenCanvasRenderingContext2D,
    item: TextItem,
    transform: { x: number; y: number; width: number; height: number },
    canvas: CanvasSettings
  ): void {
    // Match preview defaults exactly (see item.tsx TextContent)
    const fontSize = item.fontSize ?? 60;
    const fontFamily = item.fontFamily ?? 'Inter';
    const fontWeightName = item.fontWeight ?? 'normal';
    const fontWeight = FONT_WEIGHT_MAP[fontWeightName] ?? 400;
    const lineHeight = item.lineHeight ?? 1.2;
    const letterSpacing = item.letterSpacing ?? 0;
    const textAlign = item.textAlign ?? 'center';
    const verticalAlign = item.verticalAlign ?? 'middle';
    const padding = 16; // Matches preview padding

    // Calculate item bounds (centered in canvas)
    const itemLeft = canvas.width / 2 + transform.x - transform.width / 2;
    const itemTop = canvas.height / 2 + transform.y - transform.height / 2;

    // Apply clipping to item bounds (matches preview overflow: hidden behavior)
    ctx.save();
    ctx.beginPath();
    ctx.rect(itemLeft, itemTop, transform.width, transform.height);
    ctx.clip();

    // Set up font - use numeric weight for consistency with CSS
    ctx.font = `${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`;
    ctx.fillStyle = item.color ?? '#ffffff';

    // Calculate available width for text (accounting for padding)
    const availableWidth = transform.width - padding * 2;
    const lineHeightPx = fontSize * lineHeight;

    // Get actual font metrics for precise baseline positioning
    const metrics = ctx.measureText('Hg');
    const ascent = metrics.fontBoundingBoxAscent ?? fontSize * 0.8;
    const descent = metrics.fontBoundingBoxDescent ?? fontSize * 0.2;
    const fontHeight = ascent + descent;

    // CSS line-height centers the font's content area within the line box
    // Content area = ascent + descent (actual font height, not em-square)
    const halfLeading = (lineHeightPx - fontHeight) / 2;

    // Use alphabetic baseline for precise CSS-like positioning
    ctx.textBaseline = 'alphabetic';

    // Baseline position from line box top = half-leading + ascent
    const baselineOffset = halfLeading + ascent;

    // Wrap text into lines
    const text = item.text ?? '';
    const lines = wrapText(ctx, text, availableWidth, letterSpacing);

    // Calculate total text block height (matches CSS inline-block height)
    const totalTextHeight = lines.length * lineHeightPx;
    const availableHeight = transform.height - padding * 2;

    // Calculate vertical start position based on alignment
    // This matches CSS flexbox alignItems behavior
    let textBlockTop: number;
    switch (verticalAlign) {
      case 'top':
        textBlockTop = itemTop + padding;
        break;
      case 'bottom':
        textBlockTop = itemTop + transform.height - padding - totalTextHeight;
        break;
      case 'middle':
      default:
        textBlockTop = itemTop + padding + (availableHeight - totalTextHeight) / 2;
        break;
    }

    // Text shadow support - use item.textShadow (matches preview)
    if (item.textShadow) {
      ctx.shadowColor = item.textShadow.color;
      ctx.shadowBlur = item.textShadow.blur;
      ctx.shadowOffsetX = item.textShadow.offsetX;
      ctx.shadowOffsetY = item.textShadow.offsetY;
    }

    // Draw each line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      // Position baseline at: line box top + baselineOffset
      // This matches CSS line-height behavior exactly
      const lineY = textBlockTop + i * lineHeightPx + baselineOffset;

      // Calculate x position based on text alignment
      let lineX: number;
      switch (textAlign) {
        case 'left':
          ctx.textAlign = 'left';
          lineX = itemLeft + padding;
          break;
        case 'right':
          ctx.textAlign = 'right';
          lineX = itemLeft + transform.width - padding;
          break;
        case 'center':
        default:
          ctx.textAlign = 'center';
          lineX = itemLeft + transform.width / 2;
          break;
      }

      // Draw stroke first if present (matches preview which uses text-shadow workaround)
      // Canvas can do proper stroke, so we use strokeText
      if (item.stroke && item.stroke.width > 0) {
        ctx.strokeStyle = item.stroke.color;
        ctx.lineWidth = item.stroke.width * 2; // Double width because strokeText draws half inside/half outside
        ctx.lineJoin = 'round';
        drawTextWithLetterSpacing(ctx, line, lineX, lineY, letterSpacing, true);
      }

      // Draw fill
      drawTextWithLetterSpacing(ctx, line, lineX, lineY, letterSpacing, false);
    }

    ctx.restore();
  }

  /**
   * Wrap text into lines that fit within maxWidth
   */
  function wrapText(
    ctx: OffscreenCanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    letterSpacing: number
  ): string[] {
    const lines: string[] = [];

    // First split by explicit newlines
    const paragraphs = text.split('\n');

    for (const paragraph of paragraphs) {
      if (paragraph === '') {
        lines.push('');
        continue;
      }

      const words = paragraph.split(' ');
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = measureTextWidth(ctx, testLine, letterSpacing);

        if (testWidth > maxWidth && currentLine) {
          // Current line is full, push it and start new line with current word
          lines.push(currentLine);
          currentLine = word;

          // Check if single word exceeds width (need to break word)
          if (measureTextWidth(ctx, word, letterSpacing) > maxWidth) {
            const brokenLines = breakWord(ctx, word, maxWidth, letterSpacing);
            // Add all but last broken segment as lines
            for (let j = 0; j < brokenLines.length - 1; j++) {
              lines.push(brokenLines[j] ?? '');
            }
            // Last segment becomes current line
            currentLine = brokenLines[brokenLines.length - 1] ?? '';
          }
        } else {
          currentLine = testLine;
        }
      }

      // Push remaining text
      if (currentLine) {
        lines.push(currentLine);
      }
    }

    return lines.length > 0 ? lines : [''];
  }

  /**
   * Break a single word into segments that fit within maxWidth
   */
  function breakWord(
    ctx: OffscreenCanvasRenderingContext2D,
    word: string,
    maxWidth: number,
    letterSpacing: number
  ): string[] {
    const segments: string[] = [];
    let current = '';

    for (const char of word) {
      const test = current + char;
      if (measureTextWidth(ctx, test, letterSpacing) > maxWidth && current) {
        segments.push(current);
        current = char;
      } else {
        current = test;
      }
    }

    if (current) {
      segments.push(current);
    }

    return segments;
  }

  /**
   * Measure text width accounting for letter spacing
   * === PERFORMANCE: Uses text measurement cache to avoid repeated measureText() calls ===
   */
  function measureTextWidth(
    ctx: OffscreenCanvasRenderingContext2D,
    text: string,
    letterSpacing: number
  ): number {
    return textMeasureCache.measure(ctx, text, letterSpacing);
  }

  /**
   * Draw text with letter spacing applied
   */
  function drawTextWithLetterSpacing(
    ctx: OffscreenCanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    letterSpacing: number,
    isStroke: boolean
  ): void {
    if (letterSpacing === 0) {
      // No letter spacing, draw normally
      if (isStroke) {
        ctx.strokeText(text, x, y);
      } else {
        ctx.fillText(text, x, y);
      }
      return;
    }

    // With letter spacing, we need to adjust x based on text alignment
    const totalWidth = measureTextWidth(ctx, text, letterSpacing);
    const currentAlign = ctx.textAlign;

    let startX: number;
    switch (currentAlign) {
      case 'center':
        startX = x - totalWidth / 2;
        break;
      case 'right':
        startX = x - totalWidth;
        break;
      case 'left':
      default:
        startX = x;
        break;
    }

    // Draw each character individually with spacing
    ctx.textAlign = 'left';
    let currentX = startX;

    for (const char of text) {
      if (isStroke) {
        ctx.strokeText(char, currentX, y);
      } else {
        ctx.fillText(char, currentX, y);
      }
      currentX += ctx.measureText(char).width + letterSpacing;
    }

    // Restore alignment
    ctx.textAlign = currentAlign;
  }

  /**
   * Render transition to canvas
   */
  async function renderTransitionToCanvas(
    ctx: OffscreenCanvasRenderingContext2D,
    activeTransition: ActiveTransition,
    frame: number,
    canvas: CanvasSettings,
    videoElements: Map<string, HTMLVideoElement>,
    imageElements: Map<string, HTMLImageElement>,
    keyframesMap: Map<string, ItemKeyframes>,
    adjustmentLayers: AdjustmentLayerWithTrackOrder[],
    trackOrder: number
  ): Promise<void> {
    const { leftClip, rightClip, progress, transition, transitionStart } = activeTransition;

    // Debug: Log transition progress at start (only in development)
    if (import.meta.env.DEV && frame === transitionStart) {
      log.info(`TRANSITION START: frame=${frame} progress=${progress.toFixed(3)} presentation=${transition.presentation} duration=${transition.durationInFrames} leftClip=${leftClip.id.substring(0,8)} rightClip=${rightClip.id.substring(0,8)}`);
    }

    // Render transition clips at the global timeline frame.
    // This preserves chronological playback across overlap windows and chain transitions.
    const leftEffectiveFrame = frame;
    const rightEffectiveFrame = frame;

    // === PERFORMANCE: Use pooled canvases for transition rendering ===
    const { canvas: leftCanvas, ctx: leftCtx } = canvasPool.acquire();
    const leftKeyframes = keyframesMap.get(leftClip.id);
    const leftTransform = getAnimatedTransform(leftClip, leftKeyframes, leftEffectiveFrame, canvas);
    await renderItem(leftCtx, leftClip, leftTransform, leftEffectiveFrame, canvas, videoElements, imageElements, 0);

    // Apply effects to left (outgoing) clip
    const leftAdjEffects = getAdjustmentLayerEffects(trackOrder, adjustmentLayers, leftEffectiveFrame);
    const leftCombinedEffects = combineEffects(leftClip.effects, leftAdjEffects);
    let leftFinalCanvas: OffscreenCanvas = leftCanvas;

    if (leftCombinedEffects.length > 0) {
      const { canvas: leftEffectCanvas, ctx: leftEffectCtx } = canvasPool.acquire();
      applyAllEffects(leftEffectCtx, leftCanvas, leftCombinedEffects, leftEffectiveFrame, canvas);
      leftFinalCanvas = leftEffectCanvas;
    }

    const { canvas: rightCanvas, ctx: rightCtx } = canvasPool.acquire();
    const rightKeyframes = keyframesMap.get(rightClip.id);
    const rightTransform = getAnimatedTransform(rightClip, rightKeyframes, rightEffectiveFrame, canvas);
    await renderItem(rightCtx, rightClip, rightTransform, rightEffectiveFrame, canvas, videoElements, imageElements, 0);

    // Apply effects to right (incoming) clip
    const rightAdjEffects = getAdjustmentLayerEffects(trackOrder, adjustmentLayers, rightEffectiveFrame);
    const rightCombinedEffects = combineEffects(rightClip.effects, rightAdjEffects);
    let rightFinalCanvas: OffscreenCanvas = rightCanvas;

    if (rightCombinedEffects.length > 0) {
      const { canvas: rightEffectCanvas, ctx: rightEffectCtx } = canvasPool.acquire();
      applyAllEffects(rightEffectCtx, rightCanvas, rightCombinedEffects, rightEffectiveFrame, canvas);
      rightFinalCanvas = rightEffectCanvas;
    }

    // Render transition with effect-applied canvases
    const transitionSettings: TransitionCanvasSettings = canvas;
    renderTransition(ctx, activeTransition, leftFinalCanvas, rightFinalCanvas, transitionSettings);

    // Release all canvases back to pool
    if (leftFinalCanvas !== leftCanvas) canvasPool.release(leftFinalCanvas);
    canvasPool.release(leftCanvas);
    if (rightFinalCanvas !== rightCanvas) canvasPool.release(rightFinalCanvas);
    canvasPool.release(rightCanvas);
  }

  /**
   * Calculate draw dimensions for media items
   * Uses "contain" mode - fits content within canvas bounds while maintaining aspect ratio.
   * This allows background color to show in letterbox (top/bottom) or pillarbox (left/right) areas.
   */
  function calculateMediaDrawDimensions(
    sourceWidth: number,
    sourceHeight: number,
    transform: { x: number; y: number; width: number; height: number },
    canvas: CanvasSettings
  ): { x: number; y: number; width: number; height: number } {
    // If transform has explicit dimensions, use them
    if (transform.width && transform.height) {
      return {
        x: canvas.width / 2 + transform.x - transform.width / 2,
        y: canvas.height / 2 + transform.y - transform.height / 2,
        width: transform.width,
        height: transform.height,
      };
    }

    // Otherwise, fit to canvas maintaining aspect ratio ("contain" mode)
    // This matches transform-resolver.ts behavior for consistency between preview and export
    const scaleX = canvas.width / sourceWidth;
    const scaleY = canvas.height / sourceHeight;
    const fitScale = Math.min(scaleX, scaleY); // Use min for "contain" (not max for "cover")

    const drawWidth = sourceWidth * fitScale;
    const drawHeight = sourceHeight * fitScale;

    return {
      x: (canvas.width - drawWidth) / 2 + transform.x,
      y: (canvas.height - drawHeight) / 2 + transform.y,
      width: drawWidth,
      height: drawHeight,
    };
  }
}

// =============================================================================
// SINGLE FRAME RENDERING (for thumbnails)
// =============================================================================

export interface SingleFrameOptions {
  composition: CompositionInputProps;
  frame: number;
  width?: number;
  height?: number;
  quality?: number;
  format?: 'image/jpeg' | 'image/png' | 'image/webp';
}

/**
 * Render a single frame from a composition to a Blob.
 * Reuses the same createCompositionRenderer as full export for consistency.
 * Includes all layers: video, images, text, shapes, effects, transitions.
 */
export async function renderSingleFrame(options: SingleFrameOptions): Promise<Blob> {
  const {
    composition,
    frame,
    width = 320,
    height = 180,
    quality = 0.85,
    format = 'image/jpeg',
  } = options;

  const compositionWidth = composition.width || 1920;
  const compositionHeight = composition.height || 1080;

  log.debug('Rendering single frame', { frame, width, height, compositionWidth, compositionHeight });

  // Create canvas at full composition size
  const renderCanvas = new OffscreenCanvas(compositionWidth, compositionHeight);
  const renderCtx = renderCanvas.getContext('2d', { willReadFrequently: true });
  if (!renderCtx) {
    throw new Error('Failed to get 2d context');
  }

  // Use the SAME renderer as export - single source of truth
  const renderer = await createCompositionRenderer(composition, renderCanvas, renderCtx);
  await renderer.preload();
  await renderer.renderFrame(frame);

  // Scale down to thumbnail size
  const thumbnailCanvas = new OffscreenCanvas(width, height);
  const thumbnailCtx = thumbnailCanvas.getContext('2d', { willReadFrequently: true });
  if (!thumbnailCtx) {
    throw new Error('Failed to get thumbnail 2d context');
  }

  thumbnailCtx.drawImage(renderCanvas, 0, 0, width, height);

  const blob = await thumbnailCanvas.convertToBlob({ type: format, quality });
  return blob;
}

// =============================================================================
// AUDIO-ONLY RENDERING
// =============================================================================

export interface AudioRenderOptions {
  settings: ClientExportSettings;
  composition: CompositionInputProps;
  onProgress: (progress: RenderProgress) => void;
  signal?: AbortSignal;
}

/**
 * Render audio-only export (no video frames)
 * Extracts and mixes all audio from the composition and encodes to the specified format.
 */
export async function renderAudioOnly(options: AudioRenderOptions): Promise<ClientRenderResult> {
  const { settings, composition, onProgress, signal } = options;
  const { fps, durationInFrames = 0 } = composition;

  log.info('Starting audio-only render', {
    fps,
    durationInFrames,
    durationSeconds: durationInFrames / fps,
    container: settings.container,
    audioCodec: settings.audioCodec,
    audioBitrate: settings.audioBitrate,
  });

  // Validate inputs
  if (durationInFrames <= 0) {
    throw new Error('Composition has no duration');
  }

  const durationSeconds = durationInFrames / fps;

  onProgress({
    phase: 'preparing',
    progress: 0,
    totalFrames: durationInFrames,
    message: 'Loading encoder...',
  });

  // Check for abort
  if (signal?.aborted) {
    throw new DOMException('Render cancelled', 'AbortError');
  }

  // Dynamically import mediabunny
  const mediabunny = await import('mediabunny');
  const { Output, BufferTarget, AudioBufferSource } = mediabunny;

  // Register MP3 encoder if exporting to MP3
  if (settings.container === 'mp3') {
    try {
      const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder');
      registerMp3Encoder();
      log.info('MP3 encoder registered');
    } catch (err) {
      log.warn('Failed to load MP3 encoder extension', err);
    }
  }

  onProgress({
    phase: 'preparing',
    progress: 10,
    totalFrames: durationInFrames,
    message: 'Processing audio...',
  });

  // Process audio
  if (!hasAudioContent(composition)) {
    throw new Error('No audio content found in composition');
  }

  const audioData = await processAudio(composition, signal);
  if (!audioData) {
    throw new Error('Failed to process audio');
  }

  onProgress({
    phase: 'preparing',
    progress: 50,
    totalFrames: durationInFrames,
    message: 'Creating encoder...',
  });

  // Create output format
  const format = await createOutputFormat(settings.container, { fastStart: true });

  // Create buffer target to collect the output
  const target = new BufferTarget();

  // Create output
  const output = new Output({
    format,
    target,
  });

  // Determine audio codec based on container (container = codec for audio-only)
  let audioCodec: 'mp3' | 'aac' | 'pcm-s16';
  switch (settings.container) {
    case 'mp3':
      audioCodec = 'mp3';
      break;
    case 'aac':
      audioCodec = 'aac';
      break;
    default:
      audioCodec = 'pcm-s16';
  }

  // PCM codecs don't need browser encoding support - they're raw samples
  const isPcmCodec = audioCodec === 'pcm-s16';

  if (!isPcmCodec) {
    // Check if codec is supported
    const { canEncodeAudio } = mediabunny;
    const isSupported = await canEncodeAudio(audioCodec, {
      bitrate: settings.audioBitrate ?? 192000,
      numberOfChannels: 2,
      sampleRate: 48000,
    });

    if (!isSupported) {
      throw new Error(
        `${audioCodec.toUpperCase()} encoding is not supported in this browser. ` +
        `Try exporting as WAV (lossless) instead.`
      );
    }
    log.info(`Using ${audioCodec.toUpperCase()} codec`);
  }

  // Create audio buffer from processed samples
  const audioBuffer = createAudioBuffer(audioData);

  // Create audio source for encoding
  const audioSource = new AudioBufferSource({
    codec: audioCodec,
    bitrate: settings.audioBitrate ?? 192000,
  });

  // Add audio track to output
  output.addAudioTrack(audioSource);

  log.info('Audio track configured', {
    duration: audioBuffer.duration,
    channels: audioBuffer.numberOfChannels,
    sampleRate: audioBuffer.sampleRate,
    codec: audioCodec,
  });

  onProgress({
    phase: 'encoding',
    progress: 60,
    totalFrames: durationInFrames,
    message: 'Encoding audio...',
  });

  // Start the output
  await output.start();

  // Feed audio buffer
  await audioSource.add(audioBuffer);

  onProgress({
    phase: 'finalizing',
    progress: 90,
    totalFrames: durationInFrames,
    message: 'Finalizing audio...',
  });

  // Close audio source
  audioSource.close();

  // Finalize output
  await output.finalize();

  // Get the buffer
  const buffer = target.buffer;
  if (!buffer) {
    throw new Error('No output buffer generated');
  }

  const blob = new Blob([buffer], { type: getMimeType(settings.container) });

  onProgress({
    phase: 'finalizing',
    progress: 100,
    totalFrames: durationInFrames,
    message: 'Complete!',
  });

  return {
    blob,
    mimeType: getMimeType(settings.container),
    duration: durationSeconds,
    fileSize: blob.size,
  };
}
