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

      // Debug: count items per track for first few frames
      if (frame < 3) {
        const allItems = sortedTracks.flatMap(t => t.items ?? []);
        const videoItems = allItems.filter(i => i.type === 'video');
        log.info(`FRAME ${frame}: totalItems=${allItems.length} videoItems=${videoItems.length}`);
        for (const vi of videoItems) {
          const visible = frame >= vi.from && frame < vi.from + vi.durationInFrames;
          log.info(`  VIDEO id=${vi.id.substring(0,8)} from=${vi.from} dur=${vi.durationInFrames} visible=${visible}`);
        }
      }

      // Render each track
      for (const track of sortedTracks) {
        if (track.visible === false) continue;

        for (const item of track.items ?? []) {
          // Skip items not visible at this frame
          if (frame < item.from || frame >= item.from + item.durationInFrames) {
            continue;
          }

          // Skip items being handled by transitions
          if (transitionClipIds.has(item.id)) {
            if (frame === activeTransitions[0]?.transitionStart) {
              log.info(`SKIPPING clip ${item.id.substring(0,8)} - handled by transition`);
            }
            continue;
          }

          // Skip audio items (handled separately)
          if (item.type === 'audio') continue;

          // Skip adjustment items (they apply effects, not render content)
          if (item.type === 'adjustment') continue;

          // Skip mask shapes (handled by mask system)
          if (item.type === 'shape' && (item as ShapeItem).isMask) continue;

          // Get animated transform
          const itemKeyframes = keyframesMap.get(item.id);
          const transform = getAnimatedTransform(item, itemKeyframes, frame, canvasSettings);

          // Debug logging for first frame only
          if (frame === 0) {
            const localFrame = frame - item.from;
            // Log each keyframe property separately for clarity
            if (itemKeyframes) {
              for (const prop of itemKeyframes.properties) {
                if (prop.keyframes.length > 0) {
                  const kfDetails = prop.keyframes.map(k => `frame=${k.frame}, value=${k.value}`).join(' | ');
                  log.debug(`Keyframes [${prop.property}]: ${kfDetails}`);
                }
              }
            }
            log.debug('Transform at frame 0', {
              localFrame,
              itemFrom: item.from,
              itemId: item.id.substring(0, 8),
              x: transform.x,
              y: transform.y,
              width: transform.width,
              height: transform.height,
              opacity: transform.opacity,
              rotation: transform.rotation,
            });
          }

          // Get effects (item effects + adjustment layer effects)
          const adjEffects = getAdjustmentLayerEffects(
            track.order ?? 0,
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
            const hasContent = imageData.data.some((v, i) => i % 4 !== 3 && v > 0); // Check if any non-alpha pixel is non-zero
            const hasAlpha = imageData.data.some((v, i) => i % 4 === 3 && v > 0); // Check if any alpha is non-zero
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
        }
      }

      // Render transitions
      // Note: Transitions should be rendered at the appropriate layer position
      // For now, we render them after all regular items
      for (const activeTransition of activeTransitions) {
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
          log.info(`TRANSITION RENDERED: frame=${frame} progress=${activeTransition.progress.toFixed(3)} centerPixel=(${afterData[0]},${afterData[1]},${afterData[2]},${afterData[3]})`);
        }
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
    const adjustedSourceStart = Math.max(0, sourceStart + sourceFrameOffset);
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
   * Render text item
   */
  function renderTextItem(
    ctx: OffscreenCanvasRenderingContext2D,
    item: TextItem,
    transform: { x: number; y: number },
    canvas: CanvasSettings
  ): void {
    const fontSize = item.fontSize ?? 48;
    const fontFamily = item.fontFamily ?? 'Inter, sans-serif';
    const fontWeight = item.fontWeight ?? 'normal';

    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.fillStyle = item.color ?? '#ffffff';
    ctx.textAlign = (item.textAlign as CanvasTextAlign) ?? 'center';
    ctx.textBaseline = 'middle';

    const x = transform.x + canvas.width / 2;
    const y = transform.y + canvas.height / 2;

    // Text shadow (check for extended properties via any cast)
    const textItem = item as TextItem & { shadowColor?: string; shadowBlur?: number; shadowOffsetX?: number; shadowOffsetY?: number; strokeColor?: string; strokeWidth?: number };
    if (textItem.shadowColor && textItem.shadowBlur) {
      ctx.shadowColor = textItem.shadowColor;
      ctx.shadowBlur = textItem.shadowBlur;
      ctx.shadowOffsetX = textItem.shadowOffsetX ?? 0;
      ctx.shadowOffsetY = textItem.shadowOffsetY ?? 0;
    }

    // Text stroke
    if (textItem.strokeColor && textItem.strokeWidth) {
      ctx.strokeStyle = textItem.strokeColor;
      ctx.lineWidth = textItem.strokeWidth;
      ctx.strokeText(item.text ?? '', x, y);
    }

    ctx.fillText(item.text ?? '', x, y);
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

    // For left clip: apply content offset to show ending frames during transition
    // Matches Remotion's leftClipContentOffset = -(leftClip.durationInFrames - transition.durationInFrames)
    // This ensures left clip shows its last N frames during transition, ending at its final frame
    const leftContentOffset = -(leftClip.durationInFrames - transition.durationInFrames);
    // Convert content offset to source frame offset
    const leftSourceOffset = leftContentOffset;

    const leftCanvas = new OffscreenCanvas(canvas.width, canvas.height);
    const leftCtx = leftCanvas.getContext('2d')!;
    const leftKeyframes = keyframesMap.get(leftClip.id);
    const leftTransform = getAnimatedTransform(leftClip, leftKeyframes, frame, canvas);
    await renderItem(leftCtx, leftClip, leftTransform, frame, canvas, videoElements, imageElements, leftSourceOffset);

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
      const leftLocalFrame = frame - leftClip.from;
      const leftSourceStart = (leftClip as any).sourceStart ?? (leftClip as any).trimStart ?? 0;
      const leftAdjustedStart = Math.max(0, leftSourceStart + leftSourceOffset);
      const leftSourceTime = leftAdjustedStart / fps + leftLocalFrame / fps;

      const rightLocalFrame = rightEffectiveFrame - rightClip.from;
      const rightSourceStart = (rightClip as any).sourceStart ?? (rightClip as any).trimStart ?? 0;
      const rightAdjustedStart = Math.max(0, rightSourceStart + rightSourceOffset);
      const rightSourceTime = rightAdjustedStart / fps + rightLocalFrame / fps;

      console.log(`[TRANSITION-FRAMES] progress=${progress.toFixed(2)} frame=${frame} | LEFT: sourceTime=${leftSourceTime.toFixed(2)}s (offset=${leftSourceOffset}) | RIGHT: sourceTime=${rightSourceTime.toFixed(2)}s (offset=${rightSourceOffset})`);
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
