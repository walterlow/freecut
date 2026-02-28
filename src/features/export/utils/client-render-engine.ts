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
  AdjustmentItem,
  CompositionItem,
} from '@/types/timeline';
import type { ItemKeyframes } from '@/types/keyframe';
import { createLogger } from '@/shared/logging/logger';
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager';
import { resolveMediaUrl } from '@/features/export/deps/media-library';
import { VideoSourcePool } from '@/features/export/deps/player-contract';

// Import subsystems
import { getAnimatedTransform, buildKeyframesMap } from './canvas-keyframes';
import {
  applyAllEffects,
  getAdjustmentLayerEffects,
  combineEffects,
  type AdjustmentLayerWithTrackOrder,
} from './canvas-effects';
import {
  applyMasks,
  buildMaskFrameIndex,
  getActiveMasksForFrame,
  type MaskCanvasSettings,
} from './canvas-masks';
import {
  createTransitionFrameIndex,
  getTransitionFrameState,
  buildClipMap,
  type ActiveTransition,
} from './canvas-transitions';
import { type CachedGifFrames, gifFrameCache } from '@/features/export/deps/timeline';
import { isGifUrl, isWebpUrl } from '@/utils/media-utils';
import { CanvasPool, TextMeasurementCache } from './canvas-pool';
import { SharedVideoExtractorPool, type VideoFrameSource } from './shared-video-extractor';
import { useCompositionsStore } from '@/features/export/deps/timeline';

// Item renderer
import {
  renderItem,
  renderTransitionToCanvas,
  type CanvasSettings,
  type WorkerLoadedImage,
  type ItemRenderContext,
  type SubCompRenderData,
} from './canvas-item-renderer';

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
  options: { mode?: 'export' | 'preview' } = {},
) {
  const {
    fps,
    tracks = [],
    transitions = [],
    backgroundColor = '#000000',
    keyframes = [],
  } = composition;
  const renderMode = options.mode ?? 'export';
  const hasDom = typeof document !== 'undefined';
  const previewStrictDecode = renderMode === 'preview';

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

  // Precompute frame-invariant render metadata.
  const sortedTracks = [...tracks].sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
  const tracksTopToBottom = [...sortedTracks].reverse();
  const trackOrderMap = new Map<string, number>();
  for (const track of tracks) {
    trackOrderMap.set(track.id, track.order ?? 0);
  }

  const transitionFrameIndex = createTransitionFrameIndex(transitions, clipMap);
  const transitionTrackOrderById = new Map<string, number>();
  for (const window of transitionFrameIndex.windows) {
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
    videoExtractors,
    videoElements,
    useMediabunny,
    mediabunnyDisabledItems,
    mediabunnyFailureCountByItem,
    imageElements,
    gifFramesMap,
    keyframesMap,
    adjustmentLayers,
    subCompRenderData,
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
      if (track.visible === false) continue;
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
      // Clear canvas
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Prepare masks for this frame
      const activeMasks = getActiveMasksForFrame(maskFrameIndex, frame);

      // Find active transitions
      const { activeTransitions, transitionClipIds } = getTransitionFrameState(
        transitionFrameIndex,
        frame,
        fps
      );

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
          itemRenderContext
        );

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
      // Group transitions by their track order
      const transitionsByTrackOrder = new Map<number, ActiveTransition[]>();
      for (const activeTransition of activeTransitions) {
        const trackOrder = transitionTrackOrderById.get(activeTransition.transition.id) ?? 0;

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

      // Find occlusion cutoff â€“ the lowest track order with a fully occluding item
      // If masks are active, disable occlusion culling (masks could reveal content)
      let occlusionCutoffOrder: number | null = null;

      if (activeMasks.length === 0) {
        // Scan tracks from top to bottom (lowest order first) to find first occluding item
        for (const track of tracksTopToBottom) {
          if (track.visible === false) continue;
          const trackOrder = track.order ?? 0;

          for (const item of track.items ?? []) {
            if (!shouldRenderItem(item)) continue;

            if (isFullyOccluding(item, trackOrder)) {
              occlusionCutoffOrder = trackOrder;
              if (import.meta.env.DEV && frame % 30 === 0) {
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
              itemRenderContext,
              trackOrder
            );
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
    },

    async prewarmFrame(frame: number) {
      // Lightweight decoder warm-up path for scrubbing:
      // decode only nearby video items into a 1x1 target without running full composition.
      const ctx2d = getPrewarmContext();
      if (!ctx2d) return;

      const candidates: VideoItem[] = [];
      const minFrame = frame - 1;
      const maxFrame = frame + 1;

      for (const track of tracksTopToBottom) {
        if (track.visible === false) continue;
        for (const item of track.items ?? []) {
          if (item.type !== 'video') continue;
          if (item.from > maxFrame || (item.from + item.durationInFrames) <= minFrame) continue;
          candidates.push(item as VideoItem);
          if (candidates.length >= PREWARM_DECODE_MAX_ITEMS) break;
        }
        if (candidates.length >= PREWARM_DECODE_MAX_ITEMS) break;
      }

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
      canvasPool.dispose();
      textMeasureCache.clear();

      // Log pool stats in development
      if (import.meta.env.DEV) {
        log.debug('Canvas pool disposed', canvasPool.getStats());
      }
    },
  };
}

