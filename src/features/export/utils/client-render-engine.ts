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
 * - Video encoding via mediabunny CanvasSource
 * - Progress reporting and cancellation
 */

import type { RemotionInputProps } from '@/types/export';
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
import { processAudio, createAudioBuffer, hasAudioContent } from './canvas-audio';

const log = createLogger('ClientRenderEngine');

// Font weight mapping to match preview (same as FONT_WEIGHT_MAP in fonts.ts)
const FONT_WEIGHT_MAP: Record<string, number> = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

// Type for mediabunny module (dynamically imported)
type MediabunnyModule = typeof import('mediabunny');

export interface RenderEngineOptions {
  settings: ClientExportSettings;
  composition: RemotionInputProps;
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
  const { Output, BufferTarget, CanvasSource, AudioBufferSource } = mediabunny;

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

  // Create canvas for rendering frames
  const renderCanvas = new OffscreenCanvas(settings.resolution.width, settings.resolution.height);
  const ctx = renderCanvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to create OffscreenCanvas 2D context');
  }

  onProgress({
    phase: 'preparing',
    progress: 20,
    totalFrames,
    message: 'Setting up video encoder...',
  });

  // Create video source
  const videoSource = new CanvasSource(renderCanvas as unknown as HTMLCanvasElement, {
    codec: settings.codec,
    bitrate: settings.videoBitrate ?? 10_000_000,
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
      
      // Create audio source for encoding
      audioSource = new AudioBufferSource({
        codec: 'aac',
        bitrate: settings.audioBitrate ?? 192000,
      });
      
      // Add audio track to output (audio data fed after start())
      output.addAudioTrack(audioSource);
      log.info('Audio track added to output', {
        duration: audioBuffer.duration,
        channels: audioBuffer.numberOfChannels,
        sampleRate: audioBuffer.sampleRate,
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
  const frameRenderer = await createCompositionRenderer(composition, renderCanvas, ctx, settings);

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

      // Render frame to canvas
      await frameRenderer.renderFrame(frame);

      // Ensure canvas operations are flushed before capturing
      // This forces the browser to complete all pending draw operations
      ctx.getImageData(0, 0, 1, 1);

      // Calculate timestamp in seconds
      const timestamp = frame / fps;
      const frameDuration = 1 / fps;

      // Add frame to video source
      videoSource.add(timestamp, frameDuration);

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

    return {
      blob,
      mimeType: getMimeType(settings.container, settings.codec),
      duration: durationSeconds,
      fileSize: blob.size,
    };
  } catch (error) {
    // Cleanup on error
    frameRenderer.dispose();

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
  composition: RemotionInputProps,
  canvas: OffscreenCanvas,
  ctx: OffscreenCanvasRenderingContext2D,
  _settings: ClientExportSettings
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

  // Build lookup maps
  const keyframesMap = buildKeyframesMap(keyframes);

  // Pre-load video elements
  const videoElements = new Map<string, HTMLVideoElement>();
  for (const track of tracks) {
    for (const item of track.items ?? []) {
      if (item.type === 'video') {
        const videoItem = item as VideoItem;
        if (videoItem.src) {
          log.debug('Creating video element', {
            itemId: item.id,
            src: videoItem.src.substring(0, 80),
          });
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

  for (const track of tracks) {
    for (const item of track.items ?? []) {
      if (item.type === 'image' && (item as ImageItem).src) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const loadPromise = new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error(`Failed to load image: ${(item as ImageItem).src}`));
        });
        img.src = (item as ImageItem).src;
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

  return {
    async preload() {
      log.debug('Preloading media', {
        videoCount: videoElements.size,
        imageCount: imageElements.size,
      });

      // Wait for images
      await Promise.all(imageLoadPromises);

      // Wait for videos
      const videoLoadPromises = Array.from(videoElements.entries()).map(
        ([itemId, video]) =>
          new Promise<void>((resolve) => {
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
          })
      );

      await Promise.all(videoLoadPromises);
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
      
      // Debug: Log transition state at key frames
      if (activeTransitions.length > 0 && (frame === activeTransitions[0]?.transitionStart || frame % 30 === 0)) {
        log.info(`TRANSITION STATE: frame=${frame} activeTransitions=${activeTransitions.length} skippedClipIds=${Array.from(transitionClipIds).map(id => id.substring(0,8)).join(',')}`);
      }

      // Sort tracks for rendering (bottom to top)
      const sortedTracks = [...tracks].sort((a, b) => (b.order ?? 0) - (a.order ?? 0));

      // Log periodically
      if (frame % 30 === 0) {
        log.debug('Rendering frame', {
          frame,
          tracksCount: sortedTracks.length,
          activeMasks: activeMasks.length,
          activeTransitions: activeTransitions.length,
        });
      }

      // Create content canvas for mask application
      const contentCanvas = new OffscreenCanvas(canvas.width, canvas.height);
      const contentCtx = contentCanvas.getContext('2d')!;
      contentCtx.fillStyle = 'transparent';
      contentCtx.clearRect(0, 0, canvas.width, canvas.height);


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

        // Render item to temporary canvas for effect application
        const itemCanvas = new OffscreenCanvas(canvas.width, canvas.height);
        const itemCtx = itemCanvas.getContext('2d')!;

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

        // Debug: check if itemCanvas has content
        if (frame === 0) {
          const imageData = itemCtx.getImageData(0, 0, 100, 100);
          const hasContent = imageData.data.some((v, i) => i % 4 !== 3 && v > 0);
          const hasAlpha = imageData.data.some((v, i) => i % 4 === 3 && v > 0);
          log.info(`ITEM CANVAS CHECK: hasContent=${hasContent} hasAlpha=${hasAlpha} itemType=${item.type}`);
        }

        // Apply effects
        if (combinedEffects.length > 0) {
          const effectCanvas = new OffscreenCanvas(canvas.width, canvas.height);
          const effectCtx = effectCanvas.getContext('2d')!;
          applyAllEffects(effectCtx, itemCanvas, combinedEffects, frame, canvasSettings);
          contentCtx.drawImage(effectCanvas, 0, 0);
        } else {
          contentCtx.drawImage(itemCanvas, 0, 0);
        }
      };

      // Helper to check if item should be rendered
      const shouldRenderItem = (item: TimelineItem): boolean => {
        // Skip items not visible at this frame
        if (frame < item.from || frame >= item.from + item.durationInFrames) {
          return false;
        }
        // Skip items being handled by transitions
        if (transitionClipIds.has(item.id)) {
          if (frame === activeTransitions[0]?.transitionStart) {
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
              (effect as any).opacity !== undefined && (effect as any).opacity < 1) {
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
              adjustmentLayers
            );

            // Debug: Check content after transition
            if (frame === activeTransition.transitionStart) {
              const afterData = contentCtx.getImageData(Math.floor(canvas.width/2), Math.floor(canvas.height/2), 1, 1).data;
              log.info(`TRANSITION RENDERED: frame=${frame} trackOrder=${trackOrder} progress=${activeTransition.progress.toFixed(3)} centerPixel=(${afterData[0]},${afterData[1]},${afterData[2]},${afterData[3]})`);
            }
          }
        }
      }

      // Log occlusion culling stats periodically
      if (skippedTracks > 0 && frame % 30 === 0) {
        log.debug(`Occlusion culling: skipped ${skippedTracks} tracks at frame ${frame}`);
      }

      // Apply masks to content
      if (activeMasks.length > 0) {
        applyMasks(ctx, contentCanvas, activeMasks, maskSettings);
      } else {
        ctx.drawImage(contentCanvas, 0, 0);
      }
      
      // Debug: Check final output during transitions
      if (activeTransitions.length > 0 && frame === activeTransitions[0]?.transitionStart) {
        const finalData = ctx.getImageData(Math.floor(canvas.width/2), Math.floor(canvas.height/2), 1, 1).data;
        log.info(`FINAL OUTPUT CHECK: frame=${frame} alpha=${finalData[3]} RGB=(${finalData[0]},${finalData[1]},${finalData[2]})`);
      }
    },

    dispose() {
      for (const video of videoElements.values()) {
        video.pause();
        video.onerror = null;
        video.removeAttribute('src');
        video.load();
      }
      videoElements.clear();
      imageElements.clear();
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
        renderImageItem(ctx, item as ImageItem, transform, canvas, imageElements);
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
   * Render video item
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
    const video = videoElements.get(item.id);
    if (!video) {
      if (frame === 0) log.warn('Video element not found', { itemId: item.id });
      return;
    }

    // Calculate source time
    // Use sourceStart as primary - it contains the full source offset including:
    // 1. Original position from split operations
    // 2. Additional trim from IO markers
    const localFrame = frame - item.from;
    const localTime = localFrame / fps;
    const sourceStart = item.sourceStart ?? item.trimStart ?? 0;
    const speed = item.speed ?? 1;
    // Apply source frame offset (used for transitions to center playback)
    // Don't clamp adjustedSourceStart - allow negative values and let final clamp handle it
    // This ensures the offset takes effect even for clips with low sourceStart
    const adjustedSourceStart = sourceStart + sourceFrameOffset;
    const sourceTime = adjustedSourceStart / fps + localTime * speed;
    const clampedTime = Math.max(0, Math.min(sourceTime, video.duration - 0.01));

    // Debug: log source time for transition clips
    if (sourceFrameOffset !== 0) {
      console.log(`[VIDEO-SOURCE] id=${item.id.substring(0,8)} frame=${frame} localFrame=${localFrame} sourceStart=${sourceStart} offset=${sourceFrameOffset} adjustedStart=${adjustedSourceStart} sourceTime=${sourceTime.toFixed(3)}s clampedTime=${clampedTime.toFixed(3)}s`);
    }

    // Seek to the correct time and wait for seek to complete
    const needsSeek = Math.abs(video.currentTime - clampedTime) > 0.01;
    if (needsSeek) {
      video.currentTime = clampedTime;

      // Always wait for seeked event when we've requested a seek
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
        // Timeout fallback
        setTimeout(() => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        }, 500);
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
        // Also check immediately in case it's already ready
        checkReady();
        // Timeout fallback
        setTimeout(() => {
          video.removeEventListener('canplay', checkReady);
          video.removeEventListener('loadeddata', checkReady);
          resolve();
        }, 1000);
      });
    }
    
    // Final check - skip if still not ready
    if (video.readyState < 2) {
      if (frame < 5) log.warn(`Video not ready after waiting: frame=${frame} readyState=${video.readyState}`);
      return;
    }

    // Calculate draw dimensions
    const drawDimensions = calculateMediaDrawDimensions(
      video.videoWidth,
      video.videoHeight,
      transform,
      canvas
    );

    // Debug logging
    if (frame < 5 || frame % 10 === 0) {
      log.debug(`VIDEO DRAW frame=${frame} sourceTime=${clampedTime.toFixed(2)}s readyState=${video.readyState} videoW=${video.videoWidth}`);
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
   * Render image item
   */
  function renderImageItem(
    ctx: OffscreenCanvasRenderingContext2D,
    item: ImageItem,
    transform: { x: number; y: number; width: number; height: number },
    canvas: CanvasSettings,
    imageElements: Map<string, HTMLImageElement>
  ): void {
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
   */
  function measureTextWidth(
    ctx: OffscreenCanvasRenderingContext2D,
    text: string,
    letterSpacing: number
  ): number {
    const baseWidth = ctx.measureText(text).width;
    // Letter spacing adds space between each character (n-1 spaces for n characters)
    const spacingWidth = Math.max(0, text.length - 1) * letterSpacing;
    return baseWidth + spacingWidth;
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
    _adjustmentLayers: AdjustmentLayerWithTrackOrder[]
  ): Promise<void> {
    const { leftClip, rightClip, progress, transition, transitionStart } = activeTransition;

    // Debug: Log transition progress at start and periodically
    const isFirstFrame = frame === transitionStart;
    if (isFirstFrame) {
      log.info(`TRANSITION START: frame=${frame} progress=${progress.toFixed(3)} presentation=${transition.presentation} duration=${transition.durationInFrames} leftClip=${leftClip.id.substring(0,8)} rightClip=${rightClip.id.substring(0,8)}`);
    }

    // Calculate the frame position within the transition (0 to durationInFrames)
    const transitionLocalFrame = frame - transitionStart;
    const halfDuration = Math.floor(transition.durationInFrames / 2);

    // For left clip: calculate effective frame to show ending frames during transition
    // At transitionLocalFrame 0, show leftClip's (durationInFrames - transition.durationInFrames)th frame
    // This matches Remotion's approach where left clip Sequence uses from={leftClipContentOffset}
    const leftLocalFrameInClip = leftClip.durationInFrames - transition.durationInFrames + transitionLocalFrame;
    const leftEffectiveFrame = leftClip.from + leftLocalFrameInClip;

    const leftCanvas = new OffscreenCanvas(canvas.width, canvas.height);
    const leftCtx = leftCanvas.getContext('2d')!;
    const leftKeyframes = keyframesMap.get(leftClip.id);
    const leftTransform = getAnimatedTransform(leftClip, leftKeyframes, leftEffectiveFrame, canvas);
    await renderItem(leftCtx, leftClip, leftTransform, leftEffectiveFrame, canvas, videoElements, imageElements, 0);

    // For right clip: use effective frame for timeline position
    // Apply -halfDuration offset to source time to prevent rewind at transition end
    // Matches Remotion's rightClipSourceOffset = -halfDuration
    const rightEffectiveFrame = rightClip.from + transitionLocalFrame;
    const rightSourceOffset = -halfDuration;

    const rightCanvas = new OffscreenCanvas(canvas.width, canvas.height);
    const rightCtx = rightCanvas.getContext('2d')!;
    const rightKeyframes = keyframesMap.get(rightClip.id);
    const rightTransform = getAnimatedTransform(rightClip, rightKeyframes, rightEffectiveFrame, canvas);
    await renderItem(rightCtx, rightClip, rightTransform, rightEffectiveFrame, canvas, videoElements, imageElements, rightSourceOffset);

    // Debug: Log both clips' timing at key progress points
    if (isFirstFrame || Math.abs(progress - 0.5) < 0.02 || progress >= 0.99) {
      const leftLocalFrame = leftEffectiveFrame - leftClip.from;
      const leftSourceStart = (leftClip as any).sourceStart ?? (leftClip as any).trimStart ?? 0;
      const leftSourceTime = leftSourceStart / fps + leftLocalFrame / fps;

      const rightLocalFrame = rightEffectiveFrame - rightClip.from;
      const rightSourceStart = (rightClip as any).sourceStart ?? (rightClip as any).trimStart ?? 0;
      const rightAdjustedStart = rightSourceStart + rightSourceOffset; // No clamping for debug
      const rightSourceTime = rightAdjustedStart / fps + rightLocalFrame / fps;

      console.log(`[TRANSITION-FRAMES] progress=${progress.toFixed(2)} frame=${frame} transitionLocal=${transitionLocalFrame} | LEFT: localInClip=${leftLocalFrameInClip} effectiveFrame=${leftEffectiveFrame} sourceTime=${leftSourceTime.toFixed(2)}s | RIGHT: localFrame=${rightLocalFrame} sourceTime=${rightSourceTime.toFixed(2)}s (offset=${rightSourceOffset})`);
    }

    // Render transition
    const transitionSettings: TransitionCanvasSettings = canvas;
    renderTransition(ctx, activeTransition, leftCanvas, rightCanvas, transitionSettings);
  }

  /**
   * Calculate draw dimensions for media items
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

    // Otherwise, fit to canvas maintaining aspect ratio
    const sourceAspect = sourceWidth / sourceHeight;
    const canvasAspect = canvas.width / canvas.height;

    let drawWidth: number;
    let drawHeight: number;

    if (sourceAspect > canvasAspect) {
      drawHeight = canvas.height;
      drawWidth = canvas.height * sourceAspect;
    } else {
      drawWidth = canvas.width;
      drawHeight = canvas.width / sourceAspect;
    }

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
  composition: RemotionInputProps;
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
  const renderCtx = renderCanvas.getContext('2d');
  if (!renderCtx) {
    throw new Error('Failed to get 2d context');
  }

  // Use the SAME renderer as export - single source of truth
  const dummySettings: ClientExportSettings = {
    resolution: { width: compositionWidth, height: compositionHeight },
    codec: 'avc',
    container: 'mp4',
    videoBitrate: 8000000,
    audioBitrate: 128000,
    quality: 'high',
    fps: composition.fps || 30,
  };

  const renderer = await createCompositionRenderer(composition, renderCanvas, renderCtx, dummySettings);
  await renderer.preload();
  await renderer.renderFrame(frame);

  // Scale down to thumbnail size
  const thumbnailCanvas = new OffscreenCanvas(width, height);
  const thumbnailCtx = thumbnailCanvas.getContext('2d');
  if (!thumbnailCtx) {
    throw new Error('Failed to get thumbnail 2d context');
  }

  thumbnailCtx.drawImage(renderCanvas, 0, 0, width, height);

  const blob = await thumbnailCanvas.convertToBlob({ type: format, quality });
  return blob;
}
