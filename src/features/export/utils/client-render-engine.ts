/**
 * Client Render Engine
 *
 * Contains the `createCompositionRenderer` factory that builds the per-frame
 * renderer with full support for effects, masks, transitions, and keyframe
 * animations.
 *
 * The top-level render orchestration functions (`renderComposition`,
 * `renderAudioOnly`, `renderSingleFrame`) have been extracted to
 * `canvas-render-orchestrator.ts`.  They are re-exported here so that
 * existing import sites continue to work unchanged.
 *
 * Per-item rendering helpers (video, image, text, shape, transitions) live
 * in `canvas-item-renderer.ts`.
 */

import type { CompositionInputProps } from '@/types/export';
import type {
  TimelineItem,
  VideoItem,
  ImageItem,
  ShapeItem,
  CompositionItem,
} from '@/types/timeline';
import type { ItemKeyframes } from '@/types/keyframe';
import type { ItemEffect } from '@/types/effects';
import type { ResolvedTransform } from '@/types/transform';
import { createLogger } from '@/shared/logging/logger';
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager';
import { resolveMediaUrl } from '@/features/export/deps/media-library';
import { VideoSourcePool } from '@/features/export/deps/player-contract';

// Import subsystems
import { getAnimatedTransform, buildKeyframesMap } from './canvas-keyframes';
import {
  applyAllEffectsAsync,
  getAdjustmentLayerEffects,
  combineEffects,
  type AdjustmentLayerWithTrackOrder,
} from './canvas-effects';
import { EffectsPipeline } from '@/infrastructure/gpu/effects';
import { TransitionPipeline } from '@/infrastructure/gpu/transitions';
import { CompositorPipeline, DEFAULT_LAYER_PARAMS } from '@/infrastructure/gpu/compositor';
import type { CompositeLayer } from '@/infrastructure/gpu/compositor';
import { MaskTextureManager } from '@/infrastructure/gpu/masks';
import {
  applyMasks,
  buildMaskFrameIndex,
  getActiveMasksForFrame,
  type MaskCanvasSettings,
} from './canvas-masks';
import {
  type ActiveTransition,
} from './canvas-transitions';
import { type CachedGifFrames, gifFrameCache } from '@/features/export/deps/timeline';
import { isGifUrl, isWebpUrl } from '@/utils/media-utils';
import { CanvasPool, TextMeasurementCache } from './canvas-pool';
import { SharedVideoExtractorPool, type VideoFrameSource } from './shared-video-extractor';
import { getCompositeOperation } from '@/types/blend-mode-css';
import { useCompositionsStore } from '@/features/export/deps/timeline';
import { doesMaskAffectTrack } from '@/shared/utils/mask-scope';

// Item renderer
import {
  type PreviewPathVerticesOverride,
  resolveFrameCompositionScene,
  resolveCompositionRenderPlan,
  collectFrameVideoCandidates,
  resolveFrameRenderScene,
} from '@/features/export/deps/composition-runtime';
import {
  renderItem,
  renderTransitionToCanvas,
  type CanvasSettings,
  type WorkerLoadedImage,
  type ItemRenderContext,
  type SubCompRenderData,
} from './canvas-item-renderer';
import { ScrubbingCache } from '@/features/export/deps/preview';

// Re-export orchestration functions so existing import sites keep working
export { renderComposition, renderAudioOnly, renderSingleFrame } from './canvas-render-orchestrator';

const log = createLogger('ClientRenderEngine');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if an image item is a potentially animated image (GIF or WebP).
 * Static WebP files will be detected during frame extraction and fall back
 * to regular image rendering.
 */
function isAnimatedImage(item: ImageItem): boolean {
  const label = item.label?.toLowerCase() ?? '';
  return isGifUrl(item.src) || label.endsWith('.gif') ||
         isWebpUrl(item.src) || label.endsWith('.webp');
}

/**
 * Check if an image item is specifically a GIF (for gifuct-js extraction).
 */
function isGifFormat(item: ImageItem): boolean {
  return isGifUrl(item.src) || (item.label?.toLowerCase() ?? '').endsWith('.gif');
}

// WebP frame extraction is handled by gifFrameCache.getWebpFrames() â€”
// the cache service uses the ImageDecoder API and provides the same
// CachedGifFrames structure used for GIF.

// ---------------------------------------------------------------------------
// createCompositionRenderer
// ---------------------------------------------------------------------------

/**
 * Creates a composition renderer that can render frames to a canvas
 * with full support for effects, masks, transitions, and keyframe animations.
 */
export async function createCompositionRenderer(
  composition: CompositionInputProps,
  canvas: OffscreenCanvas,
  ctx: OffscreenCanvasRenderingContext2D,
  options: {
    mode?: 'export' | 'preview';
    getPreviewTransformOverride?: (itemId: string) => Partial<ResolvedTransform> | undefined;
    getPreviewEffectsOverride?: (itemId: string) => ItemEffect[] | undefined;
    getPreviewCornerPinOverride?: (itemId: string) => TimelineItem['cornerPin'] | undefined;
    getPreviewPathVerticesOverride?: PreviewPathVerticesOverride;
    domVideoElementProvider?: (itemId: string) => HTMLVideoElement | null;
  } = {},
) {
  const {
    fps,
    tracks = [],
    transitions = [],
    backgroundColor = '#000000',
    keyframes = [],
  } = composition;
  const renderMode = options.mode ?? 'export';
  const getPreviewTransformOverride = options.getPreviewTransformOverride;
  const getPreviewEffectsOverride = options.getPreviewEffectsOverride;
  const getPreviewCornerPinOverride = options.getPreviewCornerPinOverride;
  const getPreviewPathVerticesOverride = options.getPreviewPathVerticesOverride;
  const domVideoElementProvider = options.domVideoElementProvider;
  const hasDom = typeof document !== 'undefined';
  const previewStrictDecode = renderMode === 'preview';

  const canvasSettings: CanvasSettings = {
    width: canvas.width,
    height: canvas.height,
    fps,
  };

  const renderPlan = resolveCompositionRenderPlan({ tracks, transitions });
  const { trackRenderState } = renderPlan;
  const {
    visibleTrackIds,
    visibleTracksByOrderDesc: sortedTracks,
    visibleTracksByOrderAsc: tracksTopToBottom,
    trackOrderMap,
  } = trackRenderState;

  // === PERFORMANCE OPTIMIZATION: Canvas Pool ===
  // Pre-allocate reusable canvases instead of creating new ones per frame
  // Initial size: 10 (1 content + ~5 items + 2 effects + 2 transitions)
  const canvasPool = new CanvasPool(canvas.width, canvas.height, 10, 20);

  // === PERFORMANCE OPTIMIZATION: Text Measurement Cache ===
  const textMeasureCache = new TextMeasurementCache();

  // === 3-TIER SCRUBBING CACHE (preview only) ===
  // Tier 1: GPU textures in VRAM for instant scrub (~0.1ms blit)
  // Tier 2: Per-video last-frame for instant clip boundary display
  // Tier 3: Deep RAM ImageBitmap buffer (~900 frames) with GPU promotion
  // When all tiers are warm, scrubbing doesn't decode at all.
  const FRAME_CACHE_ENABLED = renderMode === 'preview';
  const scrubbingCache = FRAME_CACHE_ENABLED
    ? new ScrubbingCache()
    : null;
  let lastRenderedFrame = -1;

  // === GPU Effects Pipeline ===
  // Lazily initialized on first use to avoid blocking startup
  let gpuPipeline: EffectsPipeline | null = null;
  let gpuPipelineInitPromise: Promise<EffectsPipeline | null> | null = null;
  const ensureGpuPipeline = async (): Promise<EffectsPipeline | null> => {
    if (gpuPipeline) return gpuPipeline;
    if (gpuPipelineInitPromise) return gpuPipelineInitPromise;
    gpuPipelineInitPromise = EffectsPipeline.create().then((p) => {
      gpuPipeline = p;
      gpuPipelineInitPromise = null;
      return p;
    });
    return gpuPipelineInitPromise;
  };

  // === GPU Transition Pipeline ===
  // Shares the GPU device with the effects pipeline
  let gpuTransitionPipeline: TransitionPipeline | null = null;

  function ensureGpuTransitionPipeline(): boolean {
    if (gpuTransitionPipeline) return true;
    if (!gpuPipeline) return false;
    gpuTransitionPipeline = TransitionPipeline.create(gpuPipeline.getDevice());
    return gpuTransitionPipeline !== null;
  }

  // === GPU Compositor (for pixel-perfect blend modes) ===
  // Lazily created from the effects pipeline's GPU device
  let gpuCompositor: CompositorPipeline | null = null;
  let gpuMaskManager: MaskTextureManager | null = null;
  let gpuCompositeCanvas: OffscreenCanvas | null = null;
  let gpuCompositeCtx: GPUCanvasContext | null = null;
  let gpuCompositeW = 0;
  let gpuCompositeH = 0;
  let gpuCompositeConfigureFailed = false;

  function ensureGpuCompositor(): boolean {
    if (gpuCompositor) return true;
    if (!gpuPipeline) return false;
    const device = gpuPipeline.getDevice();
    gpuCompositor = new CompositorPipeline(device);
    gpuMaskManager = new MaskTextureManager(device);
    return true;
  }

  function ensureGpuCompositeOutput(
    width: number,
    height: number,
  ): { canvas: OffscreenCanvas; ctx: GPUCanvasContext } | null {
    if (!gpuPipeline) return null;

    const dimensionsChanged = gpuCompositeW !== width || gpuCompositeH !== height;
    if (dimensionsChanged) {
      gpuCompositeConfigureFailed = false;
    }

    if (gpuCompositeConfigureFailed && gpuCompositeW === width && gpuCompositeH === height) {
      return null;
    }

    if (!gpuCompositeCanvas) {
      gpuCompositeCanvas = new OffscreenCanvas(width, height);
    }

    if (!gpuCompositeCtx || dimensionsChanged) {
      if (gpuCompositeCanvas.width !== width || gpuCompositeCanvas.height !== height) {
        gpuCompositeCanvas.width = width;
        gpuCompositeCanvas.height = height;
      }
      gpuCompositeCtx = gpuPipeline.configureCanvas(gpuCompositeCanvas);
      gpuCompositeW = width;
      gpuCompositeH = height;
      if (!gpuCompositeCtx) {
        gpuCompositeConfigureFailed = true;
        return null;
      }
      gpuCompositeConfigureFailed = false;
    }

    return { canvas: gpuCompositeCanvas, ctx: gpuCompositeCtx };
  }

  // Build lookup maps
  const keyframesMap = buildKeyframesMap(keyframes);

  // === PERFORMANCE OPTIMIZATION: Use mediabunny for video decoding ===
  // VideoFrameExtractor provides precise frame access without seek delays
  const sharedVideoExtractors = new SharedVideoExtractorPool({
    // Same-source transitions and overlaps can require multiple concurrent decode
    // timelines. Keep a small fixed lane cap to prevent per-clip duplication.
    maxLanesPerSource: 4,
  });
  const videoExtractors = new Map<string, VideoFrameSource>();
  const videoSourceByItemId = new Map<string, string>();
  const videoItemIdsBySource = new Map<string, Set<string>>();
  // Keep video elements as fallback if mediabunny fails
  const videoElements = new Map<string, HTMLVideoElement>();
  const fallbackVideoPool = hasDom && !previewStrictDecode ? new VideoSourcePool() : null;
  const fallbackVideoBySrc = new Set<string>();
  const fallbackVideoClipIdByItem = new Map<string, string>();
  let fallbackVideoClipCounter = 0;

  const registerVideoItem = (itemId: string, src: string): void => {
    if (!src) return;
    const prevSrc = videoSourceByItemId.get(itemId);
    if (prevSrc && prevSrc !== src) {
      const prevSet = videoItemIdsBySource.get(prevSrc);
      prevSet?.delete(itemId);
      if (prevSet && prevSet.size === 0) {
        videoItemIdsBySource.delete(prevSrc);
      }
      sharedVideoExtractors.releaseItem(itemId);
    }
    videoSourceByItemId.set(itemId, src);
    let ids = videoItemIdsBySource.get(src);
    if (!ids) {
      ids = new Set<string>();
      videoItemIdsBySource.set(src, ids);
    }
    ids.add(itemId);
    videoExtractors.set(itemId, sharedVideoExtractors.getOrCreateItemExtractor(itemId, src));
  };

  const bindFallbackVideoElement = (itemId: string, src: string): void => {
    if (!fallbackVideoPool) return;

    let clipId = fallbackVideoClipIdByItem.get(itemId);
    if (!clipId) {
      clipId = `export-fallback-${++fallbackVideoClipCounter}-${itemId}`;
      fallbackVideoClipIdByItem.set(itemId, clipId);
    }

    const element = fallbackVideoPool.acquireForClip(clipId, src);
    if (!element) return;

    // Configure element immediately after acquire, then warm shared source preload.
    element.crossOrigin = 'anonymous';
    element.muted = true;
    element.preload = 'auto';

    if (!fallbackVideoBySrc.has(src)) {
      fallbackVideoBySrc.add(src);
      fallbackVideoPool.preloadSource(src).catch(() => {});
    }

    videoElements.set(itemId, element);
  };

  for (const track of tracks) {
    for (const item of track.items ?? []) {
      if (item.type === 'video') {
        const videoItem = item as VideoItem;
        if (videoItem.src) {
          log.debug('Registering shared video extractor', {
            itemId: item.id,
            src: videoItem.src.substring(0, 80),
          });

          // Create item-bound wrapper backed by a shared per-source extractor pool.
          registerVideoItem(item.id, videoItem.src);

          // Also create fallback video element in case mediabunny fails (main thread only).
          if (hasDom && !previewStrictDecode) {
            bindFallbackVideoElement(item.id, videoItem.src);
          }
        }
      }
    }
  }

  // Pre-load image elements
  const imageElements = new Map<string, WorkerLoadedImage>();
  const imageLoadPromises: Promise<void>[] = [];

  // Track animated image items for frame extraction (GIF + animated WebP)
  const gifItems: ImageItem[] = [];
  const webpItems: ImageItem[] = [];
  const gifFramesMap = new Map<string, CachedGifFrames>();

  for (const track of tracks) {
    for (const item of track.items ?? []) {
      if (item.type === 'image' && (item as ImageItem).src) {
        const imageItem = item as ImageItem;

        // Check if this is a potentially animated image
        if (isAnimatedImage(imageItem)) {
          if (isGifFormat(imageItem)) {
            gifItems.push(imageItem);
          } else {
            webpItems.push(imageItem);
          }
          // Still load as regular image for fallback
        }

        if (hasDom && typeof Image !== 'undefined') {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          const loadPromise = new Promise<void>((resolve, reject) => {
            img.onload = () => {
              imageElements.set(item.id, {
                source: img,
                width: img.naturalWidth,
                height: img.naturalHeight,
              });
              resolve();
            };
            img.onerror = () => reject(new Error(`Failed to load image: ${imageItem.src}`));
          });
          img.src = imageItem.src;
          imageLoadPromises.push(loadPromise);
        } else {
          const loadPromise = (async () => {
            if (typeof createImageBitmap !== 'function') {
              throw new Error('WORKER_REQUIRES_MAIN_THREAD:imagebitmap');
            }
            const response = await fetch(imageItem.src);
            if (!response.ok) {
              throw new Error(`Failed to load image: ${imageItem.src}`);
            }
            const blob = await response.blob();
            const bitmap = await createImageBitmap(blob);
            imageElements.set(item.id, {
              source: bitmap,
              width: bitmap.width,
              height: bitmap.height,
            });
          })();
          imageLoadPromises.push(loadPromise);
        }
      }
    }
  }

  // Collect adjustment layers
  const adjustmentLayers = renderPlan.visibleAdjustmentLayers as AdjustmentLayerWithTrackOrder[];

  const transitionTrackOrderById = new Map<string, number>();
  for (const window of renderPlan.transitionWindows) {
    const transitionTrackId = window.transition.trackId;
    const trackOrder = transitionTrackId
      ? (trackOrderMap.get(transitionTrackId) ?? 0)
      : 0;
    transitionTrackOrderById.set(window.transition.id, trackOrder);
  }

  const maskSettings: MaskCanvasSettings = canvasSettings;
  const maskFrameIndex = buildMaskFrameIndex(tracks, maskSettings);

  // Track which videos successfully use mediabunny (for render decisions)
  const useMediabunny = new Set<string>();
  // Track persistent mediabunny failures and disable extractor after repeated errors.
  const mediabunnyFailureCountByItem = new Map<string, number>();
  const mediabunnyInitFailureCountByItem = new Map<string, number>();
  const mediabunnyDisabledItems = new Set<string>();
  const MEDIABUNNY_DISABLE_THRESHOLD = 4;
  const PREWARM_FAILURE_DISABLE_THRESHOLD = 3;
  const inFlightInitByItem = new Map<string, Promise<boolean>>();
  let isDisposed = false;

  // Pre-computed sub-composition render data (populated during preload)
  const subCompRenderData = new Map<string, SubCompRenderData>();
  const PREWARM_DECODE_MAX_ITEMS = 6;
  let prewarmCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  let prewarmCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  let prewarmAttempted = false;

  // Build the shared ItemRenderContext used by canvas-item-renderer functions
  const itemRenderContext: ItemRenderContext = {
    fps,
    canvasSettings,
    canvasPool,
    textMeasureCache,
    renderMode,
    scrubbingCache,
    videoExtractors,
    videoElements,
    useMediabunny,
    mediabunnyDisabledItems,
    mediabunnyFailureCountByItem,
    imageElements,
    gifFramesMap,
    keyframesMap,
    adjustmentLayers,
    getPreviewEffectsOverride,
    getPreviewPathVerticesOverride,
    subCompRenderData,
    gpuPipeline: null,
    gpuTransitionPipeline: null,
    domVideoElementProvider,
  };

  const getPrewarmContext = (): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null => {
    if (prewarmAttempted) return prewarmCtx;
    prewarmAttempted = true;

    if (typeof OffscreenCanvas !== 'undefined') {
      prewarmCanvas = new OffscreenCanvas(1, 1);
      prewarmCtx = prewarmCanvas.getContext('2d');
      return prewarmCtx;
    }

    if (typeof document !== 'undefined') {
      const canvasEl = document.createElement('canvas');
      canvasEl.width = 1;
      canvasEl.height = 1;
      prewarmCanvas = canvasEl;
      prewarmCtx = canvasEl.getContext('2d');
      return prewarmCtx;
    }

    return null;
  };

  const initializeMediabunnyForItems = async (itemIds: string[]): Promise<Map<string, boolean>> => {
    const itemResult = new Map<string, boolean>();
    if (itemIds.length === 0) return itemResult;

    const bySource = new Map<string, string[]>();
    for (const itemId of itemIds) {
      const src = videoSourceByItemId.get(itemId);
      if (!src) {
        itemResult.set(itemId, false);
        continue;
      }
      let ids = bySource.get(src);
      if (!ids) {
        ids = [];
        bySource.set(src, ids);
      }
      ids.push(itemId);
    }

    await Promise.all([...bySource.entries()].map(async ([src, ids]) => {
        const success = await sharedVideoExtractors.initSource(src);
        if (isDisposed) return;
        // Intentional side effect: decode readiness is tracked per shared source,
        // while itemResult only reports back for the explicitly requested ids.
        const allItemsForSource = videoItemIdsBySource.get(src) ?? new Set(ids);
        for (const itemId of allItemsForSource) {
          if (success) {
            useMediabunny.add(itemId);
          } else {
            useMediabunny.delete(itemId);
          }
        }
        for (const itemId of ids) {
          itemResult.set(itemId, success);
        }
      }));

    return itemResult;
  };

  const collectPriorityVideoItemIds = (
    targetFrame: number,
    windowFrames: number
  ): string[] => {
    const minFrame = targetFrame - windowFrames;
    const maxFrame = targetFrame + windowFrames;
    const ids: string[] = [];

    for (const track of tracks) {
      if (!visibleTrackIds.has(track.id)) continue;
      for (const item of track.items ?? []) {
        if (item.type !== 'video') continue;
        const start = item.from;
        const end = item.from + item.durationInFrames;
        if (end < minFrame || start > maxFrame) continue;
        if (videoExtractors.has(item.id)) {
          ids.push(item.id);
        }
      }
    }

    return ids;
  };

  const ensureVideoItemReady = async (itemId: string): Promise<boolean> => {
    if (useMediabunny.has(itemId)) return true;
    if (mediabunnyDisabledItems.has(itemId)) return false;
    if (!videoExtractors.has(itemId)) return false;

    const existing = inFlightInitByItem.get(itemId);
    if (existing) return existing;

    const promise = initializeMediabunnyForItems([itemId]).then((result) => {
      if (isDisposed) return false;
      const ok = result.get(itemId) === true;
      if (ok) {
        mediabunnyInitFailureCountByItem.delete(itemId);
        return true;
      }

      const failures = (mediabunnyInitFailureCountByItem.get(itemId) ?? 0) + 1;
      mediabunnyInitFailureCountByItem.set(itemId, failures);
      if (failures >= MEDIABUNNY_DISABLE_THRESHOLD) {
        mediabunnyDisabledItems.add(itemId);
      }
      return false;
    }).finally(() => {
      inFlightInitByItem.delete(itemId);
    });

    inFlightInitByItem.set(itemId, promise);
    return promise;
  };
  itemRenderContext.ensureVideoItemReady = ensureVideoItemReady;

  // Wire up pre-decoded bitmap cache from the decoder prewarm worker.
  // Import eagerly so it's available before the first render.
  if (renderMode === 'preview') {
    void import('@/features/export/deps/preview-contract').then(({ getCachedPredecodedBitmap }) => {
      itemRenderContext.getCachedPredecodedBitmap = getCachedPredecodedBitmap;
    }).catch(() => {});
  }

  const assertPreviewStrictDecode = () => {
    if (previewStrictDecode && useMediabunny.size !== videoExtractors.size) {
      const failedItemIds = [...videoExtractors.keys()].filter((id) => !useMediabunny.has(id));
      throw new Error(
        `PREVIEW_REQUIRES_MEDIABUNNY: ${failedItemIds.length} video item(s) are not decodable (failed: ${failedItemIds.join(', ')})`
      );
    }
  };

  return {
    async preload(options: { priorityFrame?: number; priorityWindowFrames?: number } = {}) {
      // Composition items require the compositions store which only exists on main thread.
      // Workers get a fresh, empty Zustand store, so sub-comp data can never be resolved.
      // Bail early to trigger the main-thread fallback path.
      const hasCompositionItems = tracks.some(
        t => (t.items ?? []).some(i => i.type === 'composition')
      );
      if (!hasDom && hasCompositionItems) {
        throw new Error('WORKER_REQUIRES_MAIN_THREAD:composition');
      }

      const priorityFrame = Number.isFinite(options.priorityFrame)
        ? Math.round(options.priorityFrame!)
        : null;
      const priorityWindowFrames = Math.max(
        4,
        Math.round(options.priorityWindowFrames ?? fps * 4)
      );
      const prioritizedMainVideoIds = priorityFrame === null
        ? []
        : collectPriorityVideoItemIds(priorityFrame, priorityWindowFrames);

      log.debug('Preloading media', {
        videoCount: videoExtractors.size,
        videoSourceCount: new Set(videoSourceByItemId.values()).size,
        imageCount: imageElements.size,
      });

      // Wait for images
      await Promise.all(imageLoadPromises);

      if (!hasDom && (gifItems.length > 0 || webpItems.length > 0)) {
        throw new Error('WORKER_REQUIRES_MAIN_THREAD:animated-image');
      }

      // === Initialize mediabunny video extractors (primary method) ===
      if (prioritizedMainVideoIds.length > 0) {
        await initializeMediabunnyForItems(prioritizedMainVideoIds);
      }
      const prioritizedMainSet = new Set(prioritizedMainVideoIds);
      const remainingMainVideoIds = [...videoExtractors.keys()].filter(
        (itemId) => !prioritizedMainSet.has(itemId)
      );
      if (remainingMainVideoIds.length > 0) {
        await initializeMediabunnyForItems(remainingMainVideoIds);
      }

      log.info('Video initialization complete', {
        mediabunny: useMediabunny.size,
        fallback: videoExtractors.size - useMediabunny.size,
        uniqueSources: new Set(videoSourceByItemId.values()).size,
      });

      assertPreviewStrictDecode();

      // === Preload ALL fallback video elements ===
      // Load every video element (not just those that failed mediabunny init)
      // so the HTML5 fallback is ready if mediabunny fails mid-export.
      // This is critical for transitions where the outgoing clip's extractor
      // may fail past the source duration boundary.
      const allVideoIds = Array.from(videoElements.keys());

      if (!hasDom && allVideoIds.some(id => !useMediabunny.has(id))) {
        throw new Error('WORKER_REQUIRES_MAIN_THREAD:video-fallback');
      }

      if (hasDom && !previewStrictDecode && allVideoIds.length > 0) {
        const uniqueVideoEntries = new Map<HTMLVideoElement, string>();
        for (const [itemId, video] of videoElements.entries()) {
          if (!uniqueVideoEntries.has(video)) {
            uniqueVideoEntries.set(video, itemId);
          }
        }

        const videoLoadPromises = Array.from(uniqueVideoEntries.entries()).map(
          ([video, itemId]) => new Promise<void>((resolve) => {
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
      }

      // Load GIF frames for animated GIFs (main thread only)
      if (hasDom && gifItems.length > 0) {
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

      // Load animated WebP frames via cache service (main thread only)
      if (hasDom && webpItems.length > 0) {
        log.debug('Preloading animated WebP frames', { webpCount: webpItems.length });

        const webpLoadPromises = webpItems.map(async (webpItem) => {
          try {
            const mediaId = webpItem.mediaId ?? webpItem.id;
            const cachedFrames = await gifFrameCache.getWebpFrames(mediaId, webpItem.src);
            gifFramesMap.set(webpItem.id, cachedFrames);
            log.debug('Animated WebP frames loaded', {
              itemId: webpItem.id.substring(0, 8),
              frameCount: cachedFrames.frames.length,
              totalDuration: cachedFrames.totalDuration,
            });
          } catch (err) {
            log.error('Failed to load WebP frames', { itemId: webpItem.id, error: err });
            // WebP will fallback to static image rendering
          }
        });

        await Promise.all(webpLoadPromises);
      }

      // === PRELOAD SUB-COMPOSITION MEDIA & BUILD RENDER DATA ===
      // CompositionItem references sub-compositions with their own media items.
      // We preload media AND build pre-computed render data to avoid per-frame
      // sorting, filtering, and linear searches in renderCompositionItem.
      const subCompMediaItems: Array<{ subItem: TimelineItem; src: string }> = [];
      const pendingResolutions: Array<{ subItem: TimelineItem; mediaId: string }> = [];
      const prioritySubCompVideoItemIds = new Set<string>();

      for (const track of tracks) {
        for (const item of track.items ?? []) {
          if (item.type !== 'composition') continue;
          const compItem = item as CompositionItem;
          log.info('Found composition item in export tracks', {
            itemId: compItem.id.substring(0, 8),
            compositionId: compItem.compositionId.substring(0, 8),
            from: compItem.from,
            duration: compItem.durationInFrames,
          });
          const subComp = useCompositionsStore.getState().getComposition(compItem.compositionId);
          if (!subComp) {
            log.warn('Sub-composition not found in store!', {
              compositionId: compItem.compositionId,
              storeCompositionCount: useCompositionsStore.getState().compositions.length,
              storeCompositionIds: useCompositionsStore.getState().compositions.map(c => c.id.substring(0, 8)),
            });
            continue;
          }
          log.info('Sub-composition loaded', {
            compositionId: subComp.id.substring(0, 8),
            name: subComp.name,
            items: subComp.items.length,
            tracks: subComp.tracks.length,
            fps: subComp.fps,
            durationInFrames: subComp.durationInFrames,
          });

          // Build pre-computed render data for this sub-composition (once)
          if (!subCompRenderData.has(compItem.compositionId)) {
            // Sort tracks once (bottom-to-top: highest order first)
            const sorted = [...subComp.tracks].sort(
              (a, b) => (b.order ?? 0) - (a.order ?? 0)
            );

            // Pre-assign items to tracks and filter out audio/adjustment
            const sortedWithItems = sorted.map(t => ({
              order: t.order ?? 0,
              visible: t.visible !== false,
              items: subComp.items.filter(
                i => i.trackId === t.id && i.type !== 'audio' && i.type !== 'adjustment'
              ),
            }));

            // Build keyframes map for O(1) lookup
            const subKfMap = new Map<string, ItemKeyframes>();
            for (const kf of subComp.keyframes ?? []) {
              subKfMap.set(kf.itemId, kf);
            }

            subCompRenderData.set(compItem.compositionId, {
              fps: subComp.fps,
              durationInFrames: subComp.durationInFrames,
              sortedTracks: sortedWithItems,
              keyframesMap: subKfMap,
            });
          }

          // Collect media items for preloading.
          // Sub-comp items were moved out of the main timeline, so resolveMediaUrls
          // (which runs on main comp tracks) never acquires their blob URLs.
          // We must resolve via blobUrlManager (shared mediaId) or resolveMediaUrl (OPFS).
          const subCompIsPriority = priorityFrame !== null
            && (compItem.from <= priorityFrame + priorityWindowFrames)
            && (compItem.from + compItem.durationInFrames >= priorityFrame - priorityWindowFrames);
          for (const subItem of subComp.items) {
            if (subItem.type !== 'video' && subItem.type !== 'image') continue;
            if (subCompIsPriority && subItem.type === 'video') {
              prioritySubCompVideoItemIds.add(subItem.id);
            }
            if (subItem.mediaId) {
              // Prefer fresh blob URL from manager (may already be acquired for shared media)
              const src = blobUrlManager.get(subItem.mediaId);
              if (src) {
                subCompMediaItems.push({ subItem, src });
              } else {
                pendingResolutions.push({ subItem, mediaId: subItem.mediaId });
              }
            } else {
              // No mediaId â€” use stored src as last resort
              const src = (subItem as VideoItem | ImageItem).src ?? '';
              if (src) subCompMediaItems.push({ subItem, src });
            }
          }
        }
      }

      // Resolve pending sub-comp URLs from OPFS in parallel
      if (pendingResolutions.length > 0) {
        log.debug('Resolving sub-comp media URLs from OPFS', { count: pendingResolutions.length });
        const resolved = await Promise.all(
          pendingResolutions.map(async ({ subItem, mediaId }) => {
            const src = await resolveMediaUrl(mediaId);
            return { subItem, src };
          })
        );
        for (const { subItem, src } of resolved) {
          if (src) subCompMediaItems.push({ subItem, src });
        }
      }

      if (subCompMediaItems.length > 0) {
        log.debug('Preloading sub-composition media', { count: subCompMediaItems.length });

        // Preload sub-comp video extractors
        const subVideoItemIds: string[] = [];
        for (const { subItem, src } of subCompMediaItems) {
          if (subItem.type === 'video' && !videoExtractors.has(subItem.id)) {
            registerVideoItem(subItem.id, src);
            subVideoItemIds.push(subItem.id);
            if (hasDom && !previewStrictDecode) {
              bindFallbackVideoElement(subItem.id, src);
            }
          }
        }
        const prioritizedSubVideoItemIds = subVideoItemIds.filter((itemId) =>
          prioritySubCompVideoItemIds.has(itemId)
        );
        if (prioritizedSubVideoItemIds.length > 0) {
          await initializeMediabunnyForItems(prioritizedSubVideoItemIds);
        }
        const remainingSubVideoItemIds = subVideoItemIds.filter(
          (itemId) => !prioritySubCompVideoItemIds.has(itemId)
        );
        if (remainingSubVideoItemIds.length > 0) {
          await initializeMediabunnyForItems(remainingSubVideoItemIds);
        }

        assertPreviewStrictDecode();

        // Load fallback video elements for sub-comp items that failed mediabunny init
        if (hasDom && !previewStrictDecode) {
          const subFallbackVideoIds = subCompMediaItems
            .filter(({ subItem }) => subItem.type === 'video' && !useMediabunny.has(subItem.id))
            .map(({ subItem }) => subItem.id);

          if (subFallbackVideoIds.length > 0) {
            const uniqueSubVideos = new Map<HTMLVideoElement, string>();
            for (const itemId of subFallbackVideoIds) {
              const video = videoElements.get(itemId);
              if (video && !uniqueSubVideos.has(video)) {
                uniqueSubVideos.set(video, itemId);
              }
            }

            const subVideoLoadPromises = Array.from(uniqueSubVideos.entries()).map(([video, itemId]) =>
              new Promise<void>((resolve) => {
                const timeout = setTimeout(() => {
                  log.warn('Sub-comp video load timeout', { itemId });
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
                    log.error('Sub-comp video load error', { itemId });
                    resolve();
                  }, { once: true });
                  video.load();
                }
              })
            );
            await Promise.all(subVideoLoadPromises);
          }
        }

        // Preload sub-comp images
        const subImagePromises: Promise<void>[] = [];
        const subGifItems: ImageItem[] = [];
        const subWebpItems: ImageItem[] = [];

        for (const { subItem, src } of subCompMediaItems) {
          if (subItem.type === 'image' && !imageElements.has(subItem.id)) {
            const imageItem = subItem as ImageItem;
            const itemWithSrc = { ...imageItem, src } as ImageItem;
            // Check for animated image (GIF or WebP)
            if (isAnimatedImage(itemWithSrc)) {
              if (isGifFormat(itemWithSrc)) {
                subGifItems.push(itemWithSrc);
              } else {
                subWebpItems.push(itemWithSrc);
              }
            }

            if (hasDom && typeof Image !== 'undefined') {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              subImagePromises.push(new Promise<void>((resolve) => {
                img.onload = () => {
                  imageElements.set(subItem.id, {
                    source: img,
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                  });
                  resolve();
                };
                img.onerror = () => {
                  log.error('Failed to load sub-comp image', { itemId: subItem.id });
                  resolve();
                };
              }));
              img.src = src;
            } else {
              subImagePromises.push((async () => {
                if (typeof createImageBitmap !== 'function') {
                  throw new Error('WORKER_REQUIRES_MAIN_THREAD:imagebitmap');
                }
                const response = await fetch(src);
                if (!response.ok) {
                  log.error('Failed to fetch sub-comp image', { itemId: subItem.id });
                  return;
                }
                const blob = await response.blob();
                const bitmap = await createImageBitmap(blob);
                imageElements.set(subItem.id, {
                  source: bitmap,
                  width: bitmap.width,
                  height: bitmap.height,
                });
              })());
            }
          }
        }
        await Promise.all(subImagePromises);

        // Load sub-comp GIF frames
        if (hasDom && subGifItems.length > 0) {
          const subGifPromises = subGifItems.map(async (gifItem) => {
            try {
              const mediaId = gifItem.mediaId ?? gifItem.id;
              const cachedFrames = await gifFrameCache.getGifFrames(mediaId, gifItem.src);
              gifFramesMap.set(gifItem.id, cachedFrames);
              log.debug('Sub-comp GIF frames loaded', {
                itemId: gifItem.id.substring(0, 8),
                frameCount: cachedFrames.frames.length,
              });
            } catch (err) {
              log.error('Failed to load sub-comp GIF frames', { itemId: gifItem.id, error: err });
            }
          });
          await Promise.all(subGifPromises);
        }

        // Load sub-comp animated WebP frames via cache service
        if (hasDom && subWebpItems.length > 0) {
          const subWebpPromises = subWebpItems.map(async (webpItem) => {
            try {
              const mediaId = webpItem.mediaId ?? webpItem.id;
              const cachedFrames = await gifFrameCache.getWebpFrames(mediaId, webpItem.src);
              gifFramesMap.set(webpItem.id, cachedFrames);
              log.debug('Sub-comp animated WebP frames loaded', {
                itemId: webpItem.id.substring(0, 8),
                frameCount: cachedFrames.frames.length,
              });
            } catch (err) {
              log.error('Failed to load sub-comp WebP frames', { itemId: webpItem.id, error: err });
            }
          });
          await Promise.all(subWebpPromises);
        }

        log.debug('Sub-composition media loaded', {
          videos: subCompMediaItems.filter(s => s.subItem.type === 'video').length,
          images: subCompMediaItems.filter(s => s.subItem.type === 'image').length,
          gifs: subGifItems.length,
          webps: subWebpItems.length,
        });
      }

      log.debug('All media loaded');
    },

    async renderFrame(frame: number) {
      // 3-tier cache lookup (preview only)
      // Tier 1 (GPU texture) → Tier 3 (RAM ImageBitmap) → miss → full render
      if (scrubbingCache) {
        const cached = scrubbingCache.getFrame(frame);
        if (cached) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(cached, 0, 0);
          return;
        }
      }

      // Clear canvas
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Prepare masks for this frame
      const activeMasks = getActiveMasksForFrame(
        maskFrameIndex,
        frame,
        maskSettings,
        keyframesMap,
        renderMode === 'preview' ? getPreviewTransformOverride : undefined,
        renderMode === 'preview' ? getPreviewPathVerticesOverride : undefined,
      );

      const frameScene = resolveFrameCompositionScene({
        renderPlan,
        frame,
        canvas: canvasSettings,
        getKeyframes: (itemId) => keyframesMap.get(itemId),
        getPreviewTransform: renderMode === 'preview' ? getPreviewTransformOverride : undefined,
        getPreviewPathVertices: renderMode === 'preview' ? getPreviewPathVerticesOverride : undefined,
      });
      const { activeTransitions, transitionClipIds } = frameScene.transitionFrameState;

      // Debug: Log transition state at key frames (only in development)
      if (import.meta.env.DEV && activeTransitions.length > 0 && (frame === activeTransitions[0]?.transitionStart || frame % 30 === 0)) {
        log.info(`TRANSITION STATE: frame=${frame} activeTransitions=${activeTransitions.length} skippedClipIds=${Array.from(transitionClipIds).map(id => id.substring(0,8)).join(',')}`);
      }


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


      // GPU batch mode: each item's GPU effects submit immediately via pooled
      // output canvases, but we defer compositing so the GPU can pipeline work.
      let useBatch = false;

      // Check if any active items have GPU effects
      // and eagerly init the pipeline + start batch before processing items
      {
        let hasAnyGpuEffects = false;
        for (const track of sortedTracks) {
          if (!visibleTrackIds.has(track.id)) continue;
          for (const item of track.items ?? []) {
            if (frame < item.from || frame >= item.from + item.durationInFrames) continue;
            if (item.effects?.some((e) => e.enabled && e.effect.type === 'gpu-effect')) {
              hasAnyGpuEffects = true;
              break;
            }
          }
          if (hasAnyGpuEffects) break;
        }
        if (hasAnyGpuEffects || activeTransitions.length > 0) {
          if (!itemRenderContext.gpuPipeline) {
            itemRenderContext.gpuPipeline = await ensureGpuPipeline();
          }
          if (itemRenderContext.gpuPipeline) {
            if (hasAnyGpuEffects) {
              itemRenderContext.gpuPipeline.beginBatch();
              useBatch = true;
            }
            // Initialize GPU transition pipeline (shares device with effects pipeline)
            if (activeTransitions.length > 0 && !itemRenderContext.gpuTransitionPipeline) {
              ensureGpuTransitionPipeline();
              itemRenderContext.gpuTransitionPipeline = gpuTransitionPipeline;
            }
          }
        }
      }

      /**
       * Render a single item with effects. Returns the canvas to composite
       * (and canvases to release) for deferred compositing, or composites
       * immediately in export mode.
       */
      const renderItemWithEffects = async (
        item: TimelineItem,
        trackOrder: number,
        deferred: boolean,
      ): Promise<{ source: OffscreenCanvas; poolCanvases: OffscreenCanvas[] } | null> => {
        // Get animated transform
        const itemKeyframes = keyframesMap.get(item.id);
        let transform = getAnimatedTransform(item, itemKeyframes, frame, canvasSettings);
        if (renderMode === 'preview') {
          const previewOverride = getPreviewTransformOverride?.(item.id);
          if (previewOverride) {
            transform = {
              ...transform,
              ...previewOverride,
              cornerRadius: previewOverride.cornerRadius ?? transform.cornerRadius,
            };
          }
        }

        // Apply corner pin preview override during interactive drag
        let effectiveItem = item;
        if (renderMode === 'preview') {
          const cornerPinOverride = getPreviewCornerPinOverride?.(item.id);
          if (cornerPinOverride !== undefined) {
            effectiveItem = { ...item, cornerPin: cornerPinOverride };
          }
        }

        // Get effects (preview override → item effects + adjustment layer effects)
        const itemEffects = (renderMode === 'preview' ? getPreviewEffectsOverride?.(item.id) : undefined) ?? effectiveItem.effects;
        const adjEffects = getAdjustmentLayerEffects(
          trackOrder,
          adjustmentLayers,
          frame,
          renderMode === 'preview' ? getPreviewEffectsOverride : undefined,
        );
        const combinedEffects = combineEffects(itemEffects, adjEffects);

        // NOTE: The importExternalTexture zero-copy path is disabled because
        // textureSampleBaseClampToEdge produces subtly different edge pixel values
        // compared to canvas 2D's drawImage (different YUV→RGB conversion at
        // chroma subsampling boundaries). Spatial effects like halftone amplify
        // this into a visible bright edge. The standard canvas 2D → GPU path
        // below handles video correctly with negligible extra cost (~1-2ms).

        // === PERFORMANCE: Use pooled canvas instead of creating new one ===
        const { canvas: itemCanvas, ctx: itemCtx } = canvasPool.acquire();

        // Render based on item type
        await renderItem(
          itemCtx,
          effectiveItem,
          transform,
          frame,
          itemRenderContext
        );

        // Apply effects (per-item — GPU effects applied here for both preview and export)
        if (combinedEffects.length > 0) {
          const hasGpu = combinedEffects.some((e) => e.enabled && e.effect.type === 'gpu-effect');
          if (hasGpu && !itemRenderContext.gpuPipeline) {
            itemRenderContext.gpuPipeline = await ensureGpuPipeline();
            if (!itemRenderContext.gpuPipeline) {
              log.warn('GPU pipeline init failed — GPU effects will be skipped');
            }
          }
          const { canvas: effectCanvas, ctx: effectCtx } = canvasPool.acquire();
          const deferredGpuCanvas = await applyAllEffectsAsync(effectCtx, itemCanvas, combinedEffects, frame, canvasSettings, itemRenderContext.gpuPipeline);
          canvasPool.release(itemCanvas);

          const source = deferredGpuCanvas ?? effectCanvas;
          if (deferred) {
            return { source, poolCanvases: [effectCanvas] };
          }
          contentCtx.drawImage(source, 0, 0);
          canvasPool.release(effectCanvas);
          return null;
        }

        if (deferred) {
          return { source: itemCanvas, poolCanvases: [itemCanvas] };
        }
        contentCtx.drawImage(itemCanvas, 0, 0);
        canvasPool.release(itemCanvas);
        return null;
      };

      // Helper to check if item should be rendered
      const shouldRenderItem = (item: TimelineItem): boolean => {
        // Skip items not visible at this frame
        if (frame < item.from || frame >= item.from + item.durationInFrames) {
          return false;
        }
        // Skip items being handled by transitions
        if (transitionClipIds.has(item.id)) {
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
      // === OCCLUSION CULLING OPTIMIZATION ===
      // Find the topmost (lowest order) track with a fully occluding item.
      // Skip rendering all tracks below it (higher order) since they'll be fully covered.
      //
      // An item is fully occluding if:
      // - Covers entire canvas (after transform/keyframes)
      // - Opacity = 1 (after keyframe animation)
      // - No rotation (or 0/180 that still covers)
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

        // Non-normal blend modes interact with layers below
        if (item.blendMode && item.blendMode !== 'normal') return false;

        // Corner pin warps the shape, exposing content below
        if (item.cornerPin) return false;

        // Get animated transform at current frame
        const itemKeyframes = keyframesMap.get(item.id);
        const transform = getAnimatedTransform(item, itemKeyframes, frame, canvasSettings);

        // Check opacity (must be 1.0)
        if (transform.opacity < 1) return false;

        // Check rotation (only 0 or 180 can fully cover without exposing corners)
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
        const adjEffects = getAdjustmentLayerEffects(
          trackOrder,
          adjustmentLayers,
          frame,
          renderMode === 'preview' ? getPreviewEffectsOverride : undefined,
        );
        const allEffects = [...itemEffects, ...adjEffects];

        for (const effectWrapper of allEffects) {
          if (!effectWrapper.enabled) continue;
          const effect = effectWrapper.effect;
          // Effects that could add transparency
          if ('opacity' in effect && typeof effect.opacity === 'number' && effect.opacity < 1) {
            return false;
          }
        }

        return true;
      };

      // Find occlusion cutoff â€“ the lowest track order with a fully occluding item
      // If masks are active, disable occlusion culling (masks could reveal content)
      const {
        occlusionCutoffOrder,
        renderTasks,
      } = resolveFrameRenderScene<ActiveTransition>({
        tracksByOrderDesc: sortedTracks,
        tracksByOrderAsc: tracksTopToBottom,
        visibleTrackIds,
        activeTransitions,
        getTransitionTrackOrder: (activeTransition) => (
          transitionTrackOrderById.get(activeTransition.transition.id) ?? 0
        ),
        disableOcclusion: activeMasks.length > 0,
        shouldRenderItem,
        isFullyOccluding,
      });

      if (occlusionCutoffOrder !== null && import.meta.env.DEV && frame % 30 === 0) {
        const occludingTask = sortedTracks
          .filter((track) => visibleTrackIds.has(track.id) && (track.order ?? 0) === occlusionCutoffOrder)
          .flatMap((track) => track.items ?? [])
          .find((item) => shouldRenderItem(item) && isFullyOccluding(item, occlusionCutoffOrder));
        if (occludingTask) {
          log.debug(`Occlusion culling: item ${occludingTask.id.substring(0, 8)} on track order ${occlusionCutoffOrder} fully occludes canvas`);
        }
      }

      // Render tracks in order (bottom to top), with transitions at their track position
      // Track order: higher values render first (behind), lower values render last (on top)
      let skippedTracks = 0;
      let finalCompositeSource: OffscreenCanvas = contentCanvas;

      // Parallelize item rendering (video decode is the bottleneck).
      // Collect all renderable items in z-order, fire all renders concurrently,
      // then composite results in z-order.
      {
        if (occlusionCutoffOrder !== null) {
          skippedTracks = sortedTracks.filter((track) => (
            visibleTrackIds.has(track.id) && (track.order ?? 0) > occlusionCutoffOrder
          )).length;
        }

        const applyTrackScopedMasks = (
          result: { source: OffscreenCanvas; poolCanvases: OffscreenCanvas[] } | null,
          trackOrder: number,
        ): { source: OffscreenCanvas; poolCanvases: OffscreenCanvas[] } | null => {
          if (!result) return null;

          const applicableMasks = activeMasks.filter((mask) => doesMaskAffectTrack(mask.trackOrder, trackOrder));
          if (applicableMasks.length === 0) {
            return result;
          }

          const { canvas: maskedCanvas, ctx: maskedCtx } = canvasPool.acquire();
          applyMasks(maskedCtx, result.source, applicableMasks, maskSettings);
          return {
            source: maskedCanvas,
            poolCanvases: [...result.poolCanvases, maskedCanvas],
          };
        };


        // Fire all item renders in parallel (video decodes run concurrently)
        const results = await Promise.all(
          renderTasks.map(async (task) => {
            if (task.type === 'item') {
              return renderItemWithEffects(task.item, task.trackOrder, true);
            }
            // Transitions: render to a dedicated canvas
            const { canvas: trCanvas, ctx: trCtx } = canvasPool.acquire();
            await renderTransitionToCanvas(trCtx, task.transition, frame, itemRenderContext, task.trackOrder);
            return { source: trCanvas, poolCanvases: [trCanvas] } as { source: OffscreenCanvas; poolCanvases: OffscreenCanvas[] };
          }),
        );


        // End GPU pool mode before compositing
        if (useBatch && itemRenderContext.gpuPipeline) {
          itemRenderContext.gpuPipeline.endBatch();
        }

        // Composite all results in z-order (preserved by renderTasks ordering)
        // Use GPU compositor for pixel-perfect blend modes when available
        const hasNonNormalBlend = renderTasks.some(
          (t) => t.type === 'item' && t.item.blendMode && t.item.blendMode !== 'normal',
        );
        const useGpuCompositor = hasNonNormalBlend && gpuPipeline && ensureGpuCompositor();
        const gpuCompositeOutput = useGpuCompositor
          ? ensureGpuCompositeOutput(canvasSettings.width, canvasSettings.height)
          : null;

        if (useGpuCompositor && gpuCompositor && gpuMaskManager && gpuCompositeOutput) {
          // GPU compositing path — pixel-perfect blend modes via WebGPU
          const device = gpuPipeline!.getDevice();
          const w = canvasSettings.width;
          const h = canvasSettings.height;
          const layers: CompositeLayer[] = [];
          const layerTextures: GPUTexture[] = [];
          const compositedResults: Array<{
            task: typeof renderTasks[number];
            result: { source: OffscreenCanvas; poolCanvases: OffscreenCanvas[] };
          }> = [];

          for (let i = 0; i < results.length; i++) {
            const task = renderTasks[i]!;
            const result = applyTrackScopedMasks(results[i] ?? null, task.trackOrder);
            if (!result) continue;
            compositedResults.push({ task, result });

            const blendMode = task.type === 'item' ? (task.item.blendMode ?? 'normal') : 'normal';

            // Upload item canvas to GPU texture
            const tex = device.createTexture({
              size: [w, h],
              format: 'rgba8unorm',
              usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            });
            device.queue.copyExternalImageToTexture(
              { source: result.source, flipY: false },
              { texture: tex },
              { width: w, height: h },
            );
            layerTextures.push(tex);

            layers.push({
              params: { ...DEFAULT_LAYER_PARAMS, blendMode, sourceAspect: w / h, outputAspect: w / h },
              textureView: tex.createView(),
              maskView: gpuMaskManager.getFallbackView(),
            });
          }

          const compositedToGpuCanvas = layers.length > 0
            && gpuCompositor.compositeToCanvas(layers, w, h, gpuCompositeOutput.ctx);

          if (compositedToGpuCanvas) {
            finalCompositeSource = gpuCompositeOutput.canvas;
          } else {
            // Fall back to the established Canvas2D compositor if the GPU target
            // isn't available for this frame. This preserves feature parity and
            // avoids dropping content when WebGPU canvas presentation fails.
            for (const { task, result } of compositedResults) {
              const blendMode = task.type === 'item' ? task.item.blendMode : undefined;
              if (blendMode && blendMode !== 'normal') {
                contentCtx.globalCompositeOperation = getCompositeOperation(blendMode);
              }

              contentCtx.drawImage(result.source, 0, 0);

              if (blendMode && blendMode !== 'normal') {
                contentCtx.globalCompositeOperation = 'source-over';
              }
            }
          }

          for (const { result } of compositedResults) {
            for (const c of result.poolCanvases) canvasPool.release(c);
          }

          // Destroy per-frame textures
          for (const tex of layerTextures) tex.destroy();
        } else {
          // Canvas2D compositing fallback
          for (let i = 0; i < results.length; i++) {
            const task = renderTasks[i]!;
            const result = applyTrackScopedMasks(results[i] ?? null, task.trackOrder);
            if (!result) continue;

            const blendMode = task.type === 'item' ? task.item.blendMode : undefined;
            if (blendMode && blendMode !== 'normal') {
              contentCtx.globalCompositeOperation = getCompositeOperation(blendMode);
            }

            contentCtx.drawImage(result.source, 0, 0);

            if (blendMode && blendMode !== 'normal') {
              contentCtx.globalCompositeOperation = 'source-over';
            }

            for (const c of result.poolCanvases) canvasPool.release(c);
          }
        }
      }

      // Log occlusion culling stats periodically (only in development)
      if (import.meta.env.DEV && skippedTracks > 0 && frame % 30 === 0) {
        log.debug(`Occlusion culling: skipped ${skippedTracks} tracks at frame ${frame}`);
      }

      ctx.drawImage(finalCompositeSource, 0, 0);

      // Release content canvas back to pool
      canvasPool.release(contentCanvas);

      // Cache the rendered frame into Tier 1 (GPU) + Tier 3 (RAM).
      // Skip during rapid forward skimming (frame = last+1..+3) — mediabunny
      // sequential decode is ~1ms/frame, faster than cache write overhead.
      // Cache on backward seeks (mediabunny stream restart = seconds), jumps,
      // and non-sequential access where the cache actually helps.
      // Tier 1 uploads from canvas synchronously (<1ms). Tier 3 bitmap
      // creation runs in the background asynchronously.
      if (scrubbingCache) {
        const delta = frame - lastRenderedFrame;
        const isSequentialForward = delta > 0 && delta <= 3;
        lastRenderedFrame = frame;
        if (!isSequentialForward) {
          if (gpuPipeline) {
            scrubbingCache.setGpuDevice(gpuPipeline.getDevice(), canvas.width, canvas.height);
          }
          scrubbingCache.cacheFrame(frame, canvas);
        }
      }
    },

    async prewarmFrame(frame: number) {
      // Lightweight decoder warm-up path for scrubbing:
      // decode only nearby video items into a 1x1 target without running full composition.
      const ctx2d = getPrewarmContext();
      if (!ctx2d) return;

      const minFrame = frame - 1;
      const maxFrame = frame + 1;
      const candidates = collectFrameVideoCandidates({
        tracksByOrderAsc: tracksTopToBottom,
        visibleTrackIds,
        minFrame,
        maxFrame,
        maxItems: PREWARM_DECODE_MAX_ITEMS,
      });

      const missingCandidateItemIds = candidates
        .map((item) => item.id)
        .filter((itemId) => !useMediabunny.has(itemId) && !mediabunnyDisabledItems.has(itemId));
      if (missingCandidateItemIds.length > 0) {
        await initializeMediabunnyForItems(missingCandidateItemIds);
      }

      for (const item of candidates) {
        if (!useMediabunny.has(item.id) || mediabunnyDisabledItems.has(item.id)) continue;
        const extractor = videoExtractors.get(item.id);
        if (!extractor) continue;

        const localFrame = frame - item.from;
        const sourceStart = item.sourceStart ?? item.trimStart ?? 0;
        const sourceFps = item.sourceFps ?? fps;
        const speed = item.speed ?? 1;
        const sourceTime = (sourceStart / sourceFps) + (localFrame / fps) * speed;
        const clampedTime = Math.max(0, Math.min(sourceTime, extractor.getDuration() - 0.01));

        try {
          const success = await extractor.drawFrame(
            ctx2d,
            clampedTime,
            0,
            0,
            1,
            1,
          );
          if (success) {
            mediabunnyFailureCountByItem.set(item.id, 0);
          } else {
            // Skip transient "no-sample" misses (same guard as renderVideoItem).
            const failureKind = extractor.getLastFailureKind();
            if (failureKind !== 'no-sample') {
              const failures = (mediabunnyFailureCountByItem.get(item.id) ?? 0) + 1;
              mediabunnyFailureCountByItem.set(item.id, failures);
              if (failures >= PREWARM_FAILURE_DISABLE_THRESHOLD) {
                mediabunnyDisabledItems.add(item.id);
                useMediabunny.delete(item.id);
              }
            }
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') continue;
          const failures = (mediabunnyFailureCountByItem.get(item.id) ?? 0) + 1;
          mediabunnyFailureCountByItem.set(item.id, failures);
          log.warn('Prewarm decode failed', { itemId: item.id, frame, failures, error });
          if (failures >= PREWARM_FAILURE_DISABLE_THRESHOLD) {
            mediabunnyDisabledItems.add(item.id);
            useMediabunny.delete(item.id);
          }
        }
      }
    },

    setDomVideoElementProvider(provider: ((itemId: string) => HTMLVideoElement | null) | undefined) {
      itemRenderContext.domVideoElementProvider = provider;
    },

    /**
     * Pre-initialize mediabunny decoders for specific item IDs and optionally
     * seek them to a target frame. This warms up the WASM decoder and positions
     * the decode cursor so the first real render is fast (~1ms instead of 300-500ms).
     *
     * For variable-speed clips, also advances the decoder up to ~2.5s ahead of
     * the target frame in sequential 0.5s steps. This ensures the decoder cursor
     * is within the 3s forward-jump threshold of any frame that might be rendered
     * in the near future — preventing 400-500ms keyframe seeks when occluded clips
     * become visible mid-playback.
     */
    async prewarmItems(itemIds: string[], targetFrame?: number) {
      const unready = itemIds.filter(
        (id) => videoExtractors.has(id) && !useMediabunny.has(id) && !mediabunnyDisabledItems.has(id),
      );
      if (unready.length > 0) {
        await initializeMediabunnyForItems(unready);
      }
      // Seek decoders to the target frame position using a 1x1 draw.
      // Run all clips in parallel — each has its own decoder lane.
      if (targetFrame !== undefined) {
        const ctx2d = getPrewarmContext();
        if (!ctx2d) return;
        await Promise.all(itemIds.map(async (itemId) => {
          if (isDisposed) return;
          const extractor = videoExtractors.get(itemId);
          if (!extractor || !useMediabunny.has(itemId)) return;
          const item = sortedTracks.flatMap((t) => t.items ?? []).find((i) => i.id === itemId);
          if (!item || item.type !== 'video') return;
          const localFrame = targetFrame - item.from;
          if (localFrame < 0 || localFrame >= item.durationInFrames) return;
          const sourceStart = item.sourceStart ?? item.trimStart ?? 0;
          const sourceFps = item.sourceFps ?? fps;
          const speed = item.speed ?? 1;
          const baseSourceTime = (sourceStart / sourceFps) + (localFrame / fps) * speed;
          try {
            await extractor.drawFrame(ctx2d, Math.max(0, baseSourceTime), 0, 0, 1, 1);
          } catch {
            // Best-effort prewarm — ignore failures.
          }
        }));
      }
    },


    /** Evict specific frames from the render cache (e.g. after effect param changes). */
    invalidateFrameCache(frames?: number[]) {
      scrubbingCache?.invalidate(frames);
    },

    /** Get the scrubbing cache instance for stats/GPU wiring. */
    getScrubbingCache(): ScrubbingCache | null {
      return scrubbingCache;
    },

    /**
     * Eagerly initialize the GPU effects + transition pipelines so the first
     * transition frame doesn't pay the ~100-150ms WebGPU device + shader
     * compilation cost. Safe to call multiple times — no-ops if already warm.
     */
    async warmGpuPipeline(): Promise<void> {
      const pipeline = await ensureGpuPipeline();
      if (pipeline) {
        ensureGpuTransitionPipeline();
        itemRenderContext.gpuPipeline = pipeline;
        itemRenderContext.gpuTransitionPipeline = gpuTransitionPipeline;
      }
    },

    dispose() {
      isDisposed = true;
      inFlightInitByItem.clear();

      // Clean up mediabunny video extractors
      for (const itemId of videoExtractors.keys()) {
        sharedVideoExtractors.releaseItem(itemId);
      }
      sharedVideoExtractors.dispose();
      videoExtractors.clear();
      videoSourceByItemId.clear();
      videoItemIdsBySource.clear();
      useMediabunny.clear();
      mediabunnyFailureCountByItem.clear();
      mediabunnyInitFailureCountByItem.clear();
      mediabunnyDisabledItems.clear();

      // Clean up fallback video pool and references.
      // In this renderer, fallback video elements are only bound when a DOM is
      // available, which is also when fallbackVideoPool exists.
      if (fallbackVideoPool) {
        for (const clipId of fallbackVideoClipIdByItem.values()) {
          fallbackVideoPool.releaseClip(clipId);
        }
        fallbackVideoPool.dispose();
      }
      fallbackVideoBySrc.clear();
      fallbackVideoClipIdByItem.clear();
      videoElements.clear();
      for (const image of imageElements.values()) {
        if ('close' in image.source && typeof image.source.close === 'function') {
          image.source.close();
        }
      }
      imageElements.clear();
      gifFramesMap.clear(); // Clear GIF frame references (actual frames are managed by gifFrameCache)
      subCompRenderData.clear(); // Release sub-composition render data references
      prewarmCtx = null;
      prewarmCanvas = null;
      prewarmAttempted = false;

      // === PERFORMANCE: Clean up optimization resources ===
      scrubbingCache?.dispose();

      gpuCompositor?.destroy();
      gpuCompositor = null;
      gpuMaskManager?.destroy();
      gpuMaskManager = null;
      gpuCompositeCtx = null;
      gpuCompositeCanvas = null;
      gpuCompositeW = 0;
      gpuCompositeH = 0;
      gpuCompositeConfigureFailed = false;
      gpuTransitionPipeline?.destroy();
      gpuTransitionPipeline = null;
      gpuPipeline?.destroy();
      gpuPipeline = null;
      canvasPool.dispose();
      textMeasureCache.clear();

      // Log pool stats in development
      if (import.meta.env.DEV) {
        log.debug('Canvas pool disposed', canvasPool.getStats());
      }
    },
  };
}
