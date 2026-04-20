import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { createCompositionRenderer } from '@/features/preview/deps/export';
import type { CompositionInputProps } from '@/types/export';
import type { ItemEffect } from '@/types/effects';
import type { ItemKeyframes } from '@/types/keyframe';
import type { TimelineItem } from '@/types/timeline';
import type { ResolvedTransform } from '@/types/transform';
import type { CaptureOptions } from '@/shared/state/playback';
import { usePlaybackStore } from '@/shared/state/playback';
import {
  useCompositionNavigationStore,
  useCompositionsStore,
  useItemsStore,
  type SubComposition,
} from '@/features/preview/deps/timeline-store';
import { usePreviewBridgeStore, type PostEditWarmRequest } from '@/shared/state/preview-bridge';
import { createLogger } from '@/shared/logging/logger';
import type { PreviewPathVerticesOverride } from '../deps/composition-runtime';
import { getPreviewRuntimeSnapshotFromPlaybackState } from '../utils/preview-state-coordinator';
import {
  FAST_SCRUB_PRELOAD_BUDGET_MS,
  FAST_SCRUB_RENDERER_ENABLED,
  blobToDataUrl,
} from '../utils/preview-constants';
import { setActivePreviewScrubbingCache } from '../utils/preview-scrubbing-cache-bridge';
import { collectVisualInvalidationRanges } from '../utils/preview-frame-invalidation';
import {
  isFrameInRanges,
  normalizeFrameRanges,
  type FrameInvalidationRequest,
  type FrameRange,
} from '@/shared/utils/frame-invalidation';
import { usePreviewCaptureBridge } from './use-preview-capture-bridge';

const logger = createLogger('VideoPreview');

export type PreviewCompositionRenderer = Awaited<ReturnType<typeof createCompositionRenderer>>;

interface UsePreviewRendererControllerParams {
  fps: number;
  isResolving: boolean;
  forceFastScrubOverlay: boolean;
  items: TimelineItem[];
  playerRenderSize: { width: number; height: number };
  renderSize: { width: number; height: number };
  fastScrubInputProps: CompositionInputProps;
  fastScrubScaledTracks: CompositionInputProps['tracks'];
  fastScrubScaledKeyframes: CompositionInputProps['keyframes'];
  fastScrubRendererStructureKey: string;
  isGizmoInteractingRef: MutableRefObject<boolean>;
  bypassPreviewSeekRef: MutableRefObject<boolean>;
  showFastScrubOverlayRef: MutableRefObject<boolean>;
  showPlaybackTransitionOverlayRef: MutableRefObject<boolean>;
  scrubCanvasRef: RefObject<HTMLCanvasElement | null>;
  scrubRendererRef: MutableRefObject<PreviewCompositionRenderer | null>;
  ensureFastScrubRendererRef: MutableRefObject<() => Promise<PreviewCompositionRenderer | null>>;
  scrubInitPromiseRef: MutableRefObject<Promise<PreviewCompositionRenderer | null> | null>;
  scrubPreloadPromiseRef: MutableRefObject<Promise<void> | null>;
  scrubOffscreenCanvasRef: MutableRefObject<OffscreenCanvas | null>;
  scrubOffscreenCtxRef: MutableRefObject<OffscreenCanvasRenderingContext2D | null>;
  scrubRendererStructureKeyRef: MutableRefObject<string | null>;
  scrubRenderInFlightRef: MutableRefObject<boolean>;
  scrubRequestedFrameRef: MutableRefObject<number | null>;
  bgTransitionRendererRef: MutableRefObject<PreviewCompositionRenderer | null>;
  bgTransitionInitPromiseRef: MutableRefObject<Promise<PreviewCompositionRenderer | null> | null>;
  bgTransitionRendererStructureKeyRef: MutableRefObject<string | null>;
  bgTransitionRenderInFlightRef: MutableRefObject<boolean>;
  scrubPrewarmQueueRef: MutableRefObject<number[]>;
  scrubPrewarmQueuedSetRef: MutableRefObject<Set<number>>;
  scrubPrewarmedFramesRef: MutableRefObject<number[]>;
  scrubPrewarmedFrameSetRef: MutableRefObject<Set<number>>;
  scrubPrewarmedSourcesRef: MutableRefObject<Set<string>>;
  scrubPrewarmedSourceOrderRef: MutableRefObject<string[]>;
  scrubPrewarmedSourceTouchFrameRef: MutableRefObject<Map<string, number>>;
  scrubOffscreenRenderedFrameRef: MutableRefObject<number | null>;
  playbackTransitionPreparePromiseRef: MutableRefObject<Promise<boolean> | null>;
  playbackTransitionPreparingFrameRef: MutableRefObject<number | null>;
  deferredPlaybackTransitionPrepareFrameRef: MutableRefObject<number | null>;
  transitionPrepareTimeoutRef: MutableRefObject<number | null>;
  transitionSessionBufferedFramesRef: MutableRefObject<Map<number, OffscreenCanvas>>;
  captureCanvasSourceInFlightRef: MutableRefObject<Promise<OffscreenCanvas | HTMLCanvasElement | null> | null>;
  captureInFlightRef: MutableRefObject<Promise<string | null> | null>;
  captureImageDataInFlightRef: MutableRefObject<Promise<ImageData | null> | null>;
  captureScaleCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  resumeScrubLoopRef: MutableRefObject<() => void>;
  scrubMountedRef: MutableRefObject<boolean>;
  lastPausedPrearmTargetRef: MutableRefObject<number | null>;
  previewPerfRef: MutableRefObject<{
    fastScrubPrewarmedSources: number;
  }>;
  getPreviewTransformOverride: (itemId: string) => Partial<ResolvedTransform> | undefined;
  getPreviewEffectsOverride: (itemId: string) => ItemEffect[] | undefined;
  getPreviewCornerPinOverride: (itemId: string) => TimelineItem['cornerPin'] | undefined;
  getPreviewPathVerticesOverride: PreviewPathVerticesOverride;
  getLiveItemSnapshot: (itemId: string) => TimelineItem | undefined;
  getLiveKeyframes: (itemId: string) => ItemKeyframes | undefined;
  clearPendingFastScrubHandoff: () => void;
  clearTransitionPlaybackSession: () => void;
  resetResolveRetryState: () => void;
  setCaptureFrame: (fn: ((options?: CaptureOptions) => Promise<string | null>) | null) => void;
  setCaptureFrameImageData: (fn: ((options?: CaptureOptions) => Promise<ImageData | null>) | null) => void;
  setCaptureCanvasSource: (fn: (() => Promise<OffscreenCanvas | HTMLCanvasElement | null>) | null) => void;
  setDisplayedFrame: (frame: number | null) => void;
}

export function usePreviewRendererController({
  fps,
  isResolving,
  forceFastScrubOverlay,
  items,
  playerRenderSize,
  renderSize,
  fastScrubInputProps,
  fastScrubScaledTracks,
  fastScrubScaledKeyframes,
  fastScrubRendererStructureKey,
  isGizmoInteractingRef,
  bypassPreviewSeekRef,
  showFastScrubOverlayRef,
  showPlaybackTransitionOverlayRef,
  scrubCanvasRef,
  scrubRendererRef,
  ensureFastScrubRendererRef,
  scrubInitPromiseRef,
  scrubPreloadPromiseRef,
  scrubOffscreenCanvasRef,
  scrubOffscreenCtxRef,
  scrubRendererStructureKeyRef,
  scrubRenderInFlightRef,
  scrubRequestedFrameRef,
  bgTransitionRendererRef,
  bgTransitionInitPromiseRef,
  bgTransitionRendererStructureKeyRef,
  bgTransitionRenderInFlightRef,
  scrubPrewarmQueueRef,
  scrubPrewarmQueuedSetRef,
  scrubPrewarmedFramesRef,
  scrubPrewarmedFrameSetRef,
  scrubPrewarmedSourcesRef,
  scrubPrewarmedSourceOrderRef,
  scrubPrewarmedSourceTouchFrameRef,
  scrubOffscreenRenderedFrameRef,
  playbackTransitionPreparePromiseRef,
  playbackTransitionPreparingFrameRef,
  deferredPlaybackTransitionPrepareFrameRef,
  transitionPrepareTimeoutRef,
  transitionSessionBufferedFramesRef,
  captureCanvasSourceInFlightRef,
  captureInFlightRef,
  captureImageDataInFlightRef,
  captureScaleCanvasRef,
  resumeScrubLoopRef,
  scrubMountedRef,
  lastPausedPrearmTargetRef,
  previewPerfRef,
  getPreviewTransformOverride,
  getPreviewEffectsOverride,
  getPreviewCornerPinOverride,
  getPreviewPathVerticesOverride,
  getLiveItemSnapshot,
  getLiveKeyframes,
  clearPendingFastScrubHandoff,
  clearTransitionPlaybackSession,
  resetResolveRetryState,
  setCaptureFrame,
  setCaptureFrameImageData,
  setCaptureCanvasSource,
  setDisplayedFrame,
}: UsePreviewRendererControllerParams) {
  const previousVisualStateRef = useRef<{
    tracks: CompositionInputProps['tracks'];
    keyframes: CompositionInputProps['keyframes'];
  }>({
    tracks: fastScrubScaledTracks,
    keyframes: fastScrubScaledKeyframes,
  });
  const previousItemsRef = useRef(items);
  const previousIsResolvingRef = useRef(isResolving);
  const pendingPostEditWarmRequestRef = useRef<PostEditWarmRequest | null>(null);
  const postEditWarmInFlightRef = useRef(false);

  useLayoutEffect(() => {
    const canvas = scrubCanvasRef.current;
    if (!canvas) return;
    if (canvas.width !== playerRenderSize.width) canvas.width = playerRenderSize.width;
    if (canvas.height !== playerRenderSize.height) canvas.height = playerRenderSize.height;
  }, [playerRenderSize.height, playerRenderSize.width, scrubCanvasRef]);

  const disposeFastScrubRenderer = useCallback(() => {
    clearPendingFastScrubHandoff();
    scrubInitPromiseRef.current = null;
    scrubPreloadPromiseRef.current = null;
    scrubRequestedFrameRef.current = null;
    scrubRenderInFlightRef.current = false;
    scrubPrewarmQueueRef.current = [];
    scrubPrewarmQueuedSetRef.current.clear();
    scrubPrewarmedFramesRef.current = [];
    scrubPrewarmedFrameSetRef.current.clear();
    scrubPrewarmedSourcesRef.current.clear();
    scrubPrewarmedSourceOrderRef.current = [];
    scrubPrewarmedSourceTouchFrameRef.current.clear();
    scrubOffscreenRenderedFrameRef.current = null;
    playbackTransitionPreparePromiseRef.current = null;
    playbackTransitionPreparingFrameRef.current = null;
    deferredPlaybackTransitionPrepareFrameRef.current = null;
    if (transitionPrepareTimeoutRef.current !== null) {
      clearTimeout(transitionPrepareTimeoutRef.current);
      transitionPrepareTimeoutRef.current = null;
    }
    clearTransitionPlaybackSession();
    captureCanvasSourceInFlightRef.current = null;
    previewPerfRef.current.fastScrubPrewarmedSources = 0;
    bypassPreviewSeekRef.current = false;

    if (scrubRendererRef.current) {
      try {
        scrubRendererRef.current.dispose();
      } catch (error) {
        logger.warn('Failed to dispose renderer:', error);
      }
      scrubRendererRef.current = null;
      setActivePreviewScrubbingCache(null);
    }
    scrubRendererStructureKeyRef.current = null;

    scrubOffscreenCanvasRef.current = null;
    scrubOffscreenCtxRef.current = null;

    if (bgTransitionRendererRef.current) {
      try {
        bgTransitionRendererRef.current.dispose();
      } catch {
        // Best effort.
      }
      bgTransitionRendererRef.current = null;
    }
    bgTransitionRendererStructureKeyRef.current = null;
    bgTransitionInitPromiseRef.current = null;
    bgTransitionRenderInFlightRef.current = false;
  }, [
    bgTransitionInitPromiseRef,
    bgTransitionRenderInFlightRef,
    bgTransitionRendererRef,
    bgTransitionRendererStructureKeyRef,
    bypassPreviewSeekRef,
    captureCanvasSourceInFlightRef,
    clearPendingFastScrubHandoff,
    clearTransitionPlaybackSession,
    deferredPlaybackTransitionPrepareFrameRef,
    playbackTransitionPreparePromiseRef,
    playbackTransitionPreparingFrameRef,
    previewPerfRef,
    scrubInitPromiseRef,
    scrubOffscreenCanvasRef,
    scrubOffscreenCtxRef,
    scrubOffscreenRenderedFrameRef,
    scrubPreloadPromiseRef,
    scrubPrewarmQueueRef,
    scrubPrewarmQueuedSetRef,
    scrubPrewarmedFrameSetRef,
    scrubPrewarmedFramesRef,
    scrubPrewarmedSourceOrderRef,
    scrubPrewarmedSourceTouchFrameRef,
    scrubPrewarmedSourcesRef,
    scrubRenderInFlightRef,
    scrubRendererRef,
    scrubRendererStructureKeyRef,
    scrubRequestedFrameRef,
    transitionPrepareTimeoutRef,
  ]);

  const ensureBgTransitionRenderer = useCallback(async (): Promise<PreviewCompositionRenderer | null> => {
    if (!FAST_SCRUB_RENDERER_ENABLED || typeof OffscreenCanvas === 'undefined' || isResolving) return null;
    if (
      bgTransitionRendererRef.current
      && bgTransitionRendererStructureKeyRef.current !== fastScrubRendererStructureKey
    ) {
      disposeFastScrubRenderer();
    }
    if (bgTransitionRendererRef.current) return bgTransitionRendererRef.current;
    if (bgTransitionInitPromiseRef.current) return bgTransitionInitPromiseRef.current;

    bgTransitionInitPromiseRef.current = (async () => {
      try {
        const canvas = new OffscreenCanvas(renderSize.width, renderSize.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const renderer = await createCompositionRenderer(fastScrubInputProps, canvas, ctx, {
          mode: 'preview',
          getPreviewTransformOverride,
          getPreviewEffectsOverride,
          getPreviewCornerPinOverride,
          getPreviewPathVerticesOverride,
          getLiveItemSnapshot,
          getLiveKeyframes,
        });
        if ('warmGpuPipeline' in renderer) {
          void renderer.warmGpuPipeline();
        }
        bgTransitionRendererRef.current = renderer;
        bgTransitionRendererStructureKeyRef.current = fastScrubRendererStructureKey;
        return renderer;
      } catch {
        return null;
      } finally {
        bgTransitionInitPromiseRef.current = null;
      }
    })();
    return bgTransitionInitPromiseRef.current;
  }, [
    bgTransitionInitPromiseRef,
    bgTransitionRendererRef,
    bgTransitionRendererStructureKeyRef,
    disposeFastScrubRenderer,
    fastScrubInputProps,
    fastScrubRendererStructureKey,
    getLiveItemSnapshot,
    getLiveKeyframes,
    getPreviewCornerPinOverride,
    getPreviewEffectsOverride,
    getPreviewPathVerticesOverride,
    getPreviewTransformOverride,
    isResolving,
    renderSize.height,
    renderSize.width,
  ]);

  const ensureFastScrubRenderer = useCallback(async (): Promise<PreviewCompositionRenderer | null> => {
    if (!FAST_SCRUB_RENDERER_ENABLED) return null;
    if (typeof OffscreenCanvas === 'undefined') return null;
    if (isResolving) return null;
    if (
      scrubRendererRef.current
      && scrubRendererStructureKeyRef.current !== fastScrubRendererStructureKey
    ) {
      disposeFastScrubRenderer();
    }
    if (scrubRendererRef.current) return scrubRendererRef.current;
    if (scrubInitPromiseRef.current) return scrubInitPromiseRef.current;

    scrubInitPromiseRef.current = (async () => {
      try {
        const offscreen = new OffscreenCanvas(renderSize.width, renderSize.height);
        const offscreenCtx = offscreen.getContext('2d');
        if (!offscreenCtx) return null;

        const renderer = await createCompositionRenderer(fastScrubInputProps, offscreen, offscreenCtx, {
          mode: 'preview',
          getPreviewTransformOverride,
          getPreviewEffectsOverride,
          getPreviewCornerPinOverride,
          getPreviewPathVerticesOverride,
          getLiveItemSnapshot,
          getLiveKeyframes,
        });
        scrubOffscreenCanvasRef.current = offscreen;
        scrubOffscreenCtxRef.current = offscreenCtx;
        scrubOffscreenRenderedFrameRef.current = null;
        scrubRendererRef.current = renderer;
        scrubRendererStructureKeyRef.current = fastScrubRendererStructureKey;
        setActivePreviewScrubbingCache(
          'getScrubbingCache' in renderer ? renderer.getScrubbingCache() : null,
        );
        if ('warmGpuPipeline' in renderer) {
          void renderer.warmGpuPipeline();
        }

        const playbackState = usePlaybackStore.getState();
        const runtimeSnapshot = getPreviewRuntimeSnapshotFromPlaybackState(
          playbackState,
          isGizmoInteractingRef.current,
        );
        const preloadPriorityFrame = runtimeSnapshot.anchorFrame;
        // Invalidate the current frame and re-request a render. Used both
        // after priority media is ready (earlier, partial preload) and after
        // full preload completes, so the real video + GPU effects appear
        // without needing a manual scrub. Idempotent.
        const kickRerender = () => {
          if (scrubRendererRef.current !== renderer) return;
          const playbackState = usePlaybackStore.getState();
          const targetFrame = playbackState.previewFrame ?? playbackState.currentFrame;
          try {
            renderer.invalidateFrameCache({ frames: [targetFrame] });
          } catch {
            return;
          }
          if (scrubOffscreenRenderedFrameRef.current === targetFrame) {
            scrubOffscreenRenderedFrameRef.current = null;
          }
          scrubRequestedFrameRef.current = targetFrame;
          void resumeScrubLoopRef.current();
        };

        const preloadPromise = renderer.preload({
          priorityFrame: preloadPriorityFrame,
          priorityWindowFrames: Math.max(12, Math.round(fps * 4)),
          onPriorityMediaReady: kickRerender,
        })
          .catch((error) => {
            logger.warn('Renderer preload failed:', error);
          })
          .finally(() => {
            if (scrubPreloadPromiseRef.current === preloadPromise) {
              scrubPreloadPromiseRef.current = null;
            }
            kickRerender();
          });
        scrubPreloadPromiseRef.current = preloadPromise;
        void Promise.race([
          preloadPromise,
          new Promise<void>((resolve) => {
            setTimeout(resolve, FAST_SCRUB_PRELOAD_BUDGET_MS);
          }),
        ]);
        return renderer;
      } catch (error) {
        logger.warn('Failed to initialize renderer, falling back to Player seeks:', error);
        scrubRendererRef.current = null;
        setActivePreviewScrubbingCache(null);
        scrubOffscreenCanvasRef.current = null;
        scrubOffscreenCtxRef.current = null;
        scrubOffscreenRenderedFrameRef.current = null;
        return null;
      } finally {
        scrubInitPromiseRef.current = null;
      }
    })();

    return scrubInitPromiseRef.current;
  }, [
    disposeFastScrubRenderer,
    fastScrubInputProps,
    fastScrubRendererStructureKey,
    fps,
    getLiveItemSnapshot,
    getLiveKeyframes,
    getPreviewCornerPinOverride,
    getPreviewEffectsOverride,
    getPreviewPathVerticesOverride,
    getPreviewTransformOverride,
    isGizmoInteractingRef,
    isResolving,
    renderSize.height,
    renderSize.width,
    scrubInitPromiseRef,
    scrubOffscreenCanvasRef,
    scrubOffscreenCtxRef,
    scrubOffscreenRenderedFrameRef,
    scrubPreloadPromiseRef,
    scrubRendererRef,
    scrubRendererStructureKeyRef,
  ]);
  ensureFastScrubRendererRef.current = ensureFastScrubRenderer;

  const renderOffscreenFrame = useCallback(async (targetFrame: number): Promise<OffscreenCanvas | null> => {
    const offscreen = scrubOffscreenCanvasRef.current;
    if (offscreen && scrubOffscreenRenderedFrameRef.current === targetFrame) {
      return offscreen;
    }

    const renderer = await ensureFastScrubRenderer();
    const nextOffscreen = scrubOffscreenCanvasRef.current;
    if (!renderer || !nextOffscreen) return null;

    if (scrubOffscreenRenderedFrameRef.current !== targetFrame) {
      await renderer.renderFrame(targetFrame);
      scrubOffscreenRenderedFrameRef.current = targetFrame;
    }

    return nextOffscreen;
  }, [ensureFastScrubRenderer, scrubOffscreenCanvasRef, scrubOffscreenRenderedFrameRef]);

  useEffect(() => {
    const hadRenderer = scrubRendererRef.current !== null || bgTransitionRendererRef.current !== null;
    disposeFastScrubRenderer();

    if (!hadRenderer) {
      return;
    }

    const playbackState = usePlaybackStore.getState();
    const targetFrame = playbackState.previewFrame ?? playbackState.currentFrame;
    if (
      forceFastScrubOverlay
      || playbackState.previewFrame !== null
      || showFastScrubOverlayRef.current
      || showPlaybackTransitionOverlayRef.current
    ) {
      // Defer the kick to a microtask so it fires after the render-pump
      // useEffect has re-assigned resumeScrubLoopRef to the new closure.
      // Without this, the cleanup order (pump cleanup sets ref to no-op
      // before the new pump effect runs) silently drops the resume.
      queueMicrotask(() => {
        scrubRequestedFrameRef.current = targetFrame;
        void resumeScrubLoopRef.current();
      });
    }
  }, [
    bgTransitionRendererRef,
    disposeFastScrubRenderer,
    fastScrubRendererStructureKey,
    forceFastScrubOverlay,
    renderSize.height,
    renderSize.width,
    resumeScrubLoopRef,
    scrubRendererRef,
    scrubRequestedFrameRef,
    showFastScrubOverlayRef,
    showPlaybackTransitionOverlayRef,
  ]);

  useEffect(() => {
    const previousVisualState = previousVisualStateRef.current;
    previousVisualStateRef.current = {
      tracks: fastScrubScaledTracks,
      keyframes: fastScrubScaledKeyframes,
    };

    const visualInvalidationRanges = collectVisualInvalidationRanges({
      previousTracks: previousVisualState.tracks,
      nextTracks: fastScrubScaledTracks,
      previousKeyframes: previousVisualState.keyframes,
      nextKeyframes: fastScrubScaledKeyframes,
    });
    if (visualInvalidationRanges.length === 0) {
      return;
    }

    const scrubRenderer = scrubRendererRef.current;
    const bgRenderer = bgTransitionRendererRef.current;
    const scrubRendererMatchesStructure = (
      scrubRendererStructureKeyRef.current === fastScrubRendererStructureKey
    );
    const bgRendererMatchesStructure = (
      bgTransitionRendererStructureKeyRef.current === fastScrubRendererStructureKey
    );

    if (!scrubRendererMatchesStructure && !bgRendererMatchesStructure) {
      return;
    }

    const invalidationRequest = { ranges: visualInvalidationRanges };
    if (scrubRenderer && scrubRendererMatchesStructure) {
      scrubRenderer.invalidateFrameCache(invalidationRequest);
    }
    if (bgRenderer && bgRendererMatchesStructure) {
      bgRenderer.invalidateFrameCache(invalidationRequest);
    }

    const playbackState = usePlaybackStore.getState();
    const targetFrame = playbackState.previewFrame ?? playbackState.currentFrame;
    const currentFrameInvalidated = isFrameInRanges(targetFrame, visualInvalidationRanges);

    if (
      scrubOffscreenRenderedFrameRef.current !== null
      && isFrameInRanges(scrubOffscreenRenderedFrameRef.current, visualInvalidationRanges)
    ) {
      scrubOffscreenRenderedFrameRef.current = null;
    }

    let removedBufferedFrame = false;
    for (const frame of [...transitionSessionBufferedFramesRef.current.keys()]) {
      if (!isFrameInRanges(frame, visualInvalidationRanges)) continue;
      transitionSessionBufferedFramesRef.current.delete(frame);
      removedBufferedFrame = true;
    }
    if (removedBufferedFrame) {
      lastPausedPrearmTargetRef.current = null;
    }

    if (
      scrubRenderer
      && scrubRendererMatchesStructure
      && currentFrameInvalidated
      && (
        forceFastScrubOverlay
        || playbackState.previewFrame !== null
        || showFastScrubOverlayRef.current
        || showPlaybackTransitionOverlayRef.current
      )
    ) {
      scrubRequestedFrameRef.current = targetFrame;
      void resumeScrubLoopRef.current();
    }
  }, [
    bgTransitionRendererRef,
    bgTransitionRendererStructureKeyRef,
    fastScrubRendererStructureKey,
    fastScrubScaledKeyframes,
    fastScrubScaledTracks,
    forceFastScrubOverlay,
    lastPausedPrearmTargetRef,
    resumeScrubLoopRef,
    scrubOffscreenRenderedFrameRef,
    scrubRendererRef,
    scrubRendererStructureKeyRef,
    scrubRequestedFrameRef,
    showFastScrubOverlayRef,
    showPlaybackTransitionOverlayRef,
    transitionSessionBufferedFramesRef,
  ]);

  useEffect(() => {
    const wasResolving = previousIsResolvingRef.current;
    previousIsResolvingRef.current = isResolving;

    if (isResolving || !wasResolving) {
      return;
    }

    const playbackState = usePlaybackStore.getState();
    const targetFrame = playbackState.previewFrame ?? playbackState.currentFrame;
    const needsRenderedFrame = (
      forceFastScrubOverlay
      || playbackState.previewFrame !== null
      || showFastScrubOverlayRef.current
      || showPlaybackTransitionOverlayRef.current
    );

    if (!needsRenderedFrame) {
      return;
    }

    scrubRequestedFrameRef.current = targetFrame;
    void resumeScrubLoopRef.current();
  }, [
    forceFastScrubOverlay,
    isResolving,
    resumeScrubLoopRef,
    scrubRequestedFrameRef,
    showFastScrubOverlayRef,
    showPlaybackTransitionOverlayRef,
  ]);

  useEffect(() => {
    const previousItems = previousItemsRef.current;
    previousItemsRef.current = items;

    if (previousItems === items) {
      return;
    }

    const scrubRenderer = scrubRendererRef.current;
    const scrubRendererMatchesStructure = (
      scrubRendererStructureKeyRef.current === fastScrubRendererStructureKey
    );
    if (!scrubRenderer || !scrubRendererMatchesStructure) {
      return;
    }

    const playbackState = usePlaybackStore.getState();
    const targetFrame = playbackState.previewFrame ?? playbackState.currentFrame;
    const needsRenderedFrame = (
      forceFastScrubOverlay
      || playbackState.previewFrame !== null
      || showFastScrubOverlayRef.current
      || showPlaybackTransitionOverlayRef.current
    );

    if (!needsRenderedFrame) {
      return;
    }

    scrubRenderer.invalidateFrameCache({ frames: [targetFrame] });
    if (scrubOffscreenRenderedFrameRef.current === targetFrame) {
      scrubOffscreenRenderedFrameRef.current = null;
    }
    scrubRequestedFrameRef.current = targetFrame;
    void resumeScrubLoopRef.current();
  }, [
    fastScrubRendererStructureKey,
    forceFastScrubOverlay,
    items,
    resumeScrubLoopRef,
    scrubOffscreenRenderedFrameRef,
    scrubRendererRef,
    scrubRendererStructureKeyRef,
    scrubRequestedFrameRef,
    showFastScrubOverlayRef,
    showPlaybackTransitionOverlayRef,
  ]);

  useEffect(() => {
    const computeChangedCompositionIds = (
      nextById: Record<string, SubComposition>,
      prevById: Record<string, SubComposition>,
    ): Set<string> => {
      const changed = new Set<string>();
      for (const id of Object.keys(nextById)) {
        if (nextById[id] !== prevById[id]) changed.add(id);
      }
      for (const id of Object.keys(prevById)) {
        if (!(id in nextById)) changed.add(id);
      }
      return changed;
    };

    const invalidateForChangedCompositions = (changedIds: Set<string>) => {
      const scrubRenderer = scrubRendererRef.current;
      const bgRenderer = bgTransitionRendererRef.current;
      const scrubRendererMatchesStructure = (
        scrubRendererStructureKeyRef.current === fastScrubRendererStructureKey
      );
      const bgRendererMatchesStructure = (
        bgTransitionRendererStructureKeyRef.current === fastScrubRendererStructureKey
      );
      if (!scrubRenderer && !bgRenderer) return;

      const playbackState = usePlaybackStore.getState();
      const targetFrame = playbackState.previewFrame ?? playbackState.currentFrame;

      // Read the latest items directly — when exitComposition fires, this
      // subscription runs synchronously inside saveCurrentToComposition,
      // before restoreTimeline updates the items store. Reading from the
      // closure would see stale sub-comp items. The microtask defer below
      // handles the ordering, but we still read live to be safe.
      const currentItems = useItemsStore.getState().items;
      const ranges: FrameRange[] = [];
      for (const compItem of currentItems) {
        if (compItem.type !== 'composition') continue;
        if (!changedIds.has(compItem.compositionId)) continue;
        ranges.push({
          startFrame: compItem.from,
          endFrame: compItem.from + compItem.durationInFrames,
        });
      }

      const normalized = normalizeFrameRanges(ranges);
      const request: FrameInvalidationRequest = normalized.length > 0
        ? { ranges: normalized }
        : { frames: [targetFrame] };

      if (scrubRenderer && scrubRendererMatchesStructure) {
        scrubRenderer.invalidateFrameCache(request);
      }
      if (bgRenderer && bgRendererMatchesStructure) {
        bgRenderer.invalidateFrameCache(request);
      }

      const currentFrameInvalidated = normalized.length === 0
        || isFrameInRanges(targetFrame, normalized);
      if (
        currentFrameInvalidated
        && scrubOffscreenRenderedFrameRef.current === targetFrame
      ) {
        scrubOffscreenRenderedFrameRef.current = null;
      }

      const needsRenderedFrame = (
        forceFastScrubOverlay
        || playbackState.previewFrame !== null
        || showFastScrubOverlayRef.current
        || showPlaybackTransitionOverlayRef.current
      );
      if (!needsRenderedFrame || !currentFrameInvalidated) return;

      scrubRequestedFrameRef.current = targetFrame;
      void resumeScrubLoopRef.current();
    };

    let pendingMicrotask = false;
    const pendingChangedIds = new Set<string>();

    const unsubCompositions = useCompositionsStore.subscribe((state, prev) => {
      if (state.compositionById === prev.compositionById) return;
      const changedIds = computeChangedCompositionIds(state.compositionById, prev.compositionById);
      if (changedIds.size === 0) return;
      for (const id of changedIds) pendingChangedIds.add(id);

      if (pendingMicrotask) return;
      pendingMicrotask = true;
      queueMicrotask(() => {
        pendingMicrotask = false;
        const batchedIds = new Set(pendingChangedIds);
        pendingChangedIds.clear();
        if (batchedIds.size === 0) return;
        invalidateForChangedCompositions(batchedIds);
      });
    });

    // On composition navigation (enter/exit/navigate), the tracks topology
    // swaps wholesale. The dispose useEffect recreates the renderer on the
    // structure-key change, but its render pump can race with Zustand's
    // batched items/tracks updates. Queue an explicit invalidation in a
    // microtask so the pump sees the fully restored timeline before it
    // re-renders the current frame.
    const unsubNav = useCompositionNavigationStore.subscribe((state, prev) => {
      if (state.activeCompositionId === prev.activeCompositionId
        && state.breadcrumbs === prev.breadcrumbs) {
        return;
      }
      queueMicrotask(() => {
        const scrubRenderer = scrubRendererRef.current;
        const bgRenderer = bgTransitionRendererRef.current;
        const playbackState = usePlaybackStore.getState();
        const targetFrame = playbackState.previewFrame ?? playbackState.currentFrame;

        if (scrubRenderer
          && scrubRendererStructureKeyRef.current === fastScrubRendererStructureKey) {
          scrubRenderer.invalidateFrameCache({ frames: [targetFrame] });
        }
        if (bgRenderer
          && bgTransitionRendererStructureKeyRef.current === fastScrubRendererStructureKey) {
          bgRenderer.invalidateFrameCache({ frames: [targetFrame] });
        }
        if (scrubOffscreenRenderedFrameRef.current === targetFrame) {
          scrubOffscreenRenderedFrameRef.current = null;
        }

        const needsRenderedFrame = (
          forceFastScrubOverlay
          || playbackState.previewFrame !== null
          || showFastScrubOverlayRef.current
          || showPlaybackTransitionOverlayRef.current
        );
        if (!needsRenderedFrame) return;

        scrubRequestedFrameRef.current = targetFrame;
        void resumeScrubLoopRef.current();
      });
    });

    return () => {
      unsubCompositions();
      unsubNav();
    };
  }, [
    bgTransitionRendererRef,
    bgTransitionRendererStructureKeyRef,
    fastScrubRendererStructureKey,
    forceFastScrubOverlay,
    resumeScrubLoopRef,
    scrubOffscreenRenderedFrameRef,
    scrubRendererRef,
    scrubRendererStructureKeyRef,
    scrubRequestedFrameRef,
    showFastScrubOverlayRef,
    showPlaybackTransitionOverlayRef,
  ]);

  useEffect(() => {
    const flushPostEditWarmRequest = async () => {
      if (postEditWarmInFlightRef.current) {
        return;
      }

      postEditWarmInFlightRef.current = true;
      try {
        while (pendingPostEditWarmRequestRef.current) {
          const request = pendingPostEditWarmRequestRef.current;
          pendingPostEditWarmRequestRef.current = null;

          const playbackState = usePlaybackStore.getState();
          if (isResolving || playbackState.isPlaying || playbackState.previewFrame !== null) {
            continue;
          }

          const renderer = await ensureFastScrubRenderer();
          if (!renderer) {
            continue;
          }

          try {
            const framesToWarm = request.frames.length > 0 ? request.frames : [request.frame];
            const warmRunwayFrames = Array.from(new Set([
              ...framesToWarm,
              request.frame - 2,
              request.frame - 1,
              request.frame + 1,
              request.frame + 2,
            ].filter((frame) => frame >= 0)));

            if ('prewarmFrames' in renderer && warmRunwayFrames.length > 0) {
              await renderer.prewarmFrames?.(warmRunwayFrames);
            }
            if ('prewarmItems' in renderer && request.itemIds.length > 0) {
              await renderer.prewarmItems?.(request.itemIds, request.frame);
            }
            if (scrubOffscreenRenderedFrameRef.current !== request.frame) {
              await renderer.renderFrame(request.frame);
              scrubOffscreenRenderedFrameRef.current = request.frame;
            }
          } catch {
            // Best effort only.
          }
        }
      } finally {
        postEditWarmInFlightRef.current = false;
        if (pendingPostEditWarmRequestRef.current) {
          void flushPostEditWarmRequest();
        }
      }
    };

    return usePreviewBridgeStore.subscribe((state, prev) => {
      if (state.postEditWarmRequest === prev.postEditWarmRequest || !state.postEditWarmRequest) {
        return;
      }
      const request = state.postEditWarmRequest;
      pendingPostEditWarmRequestRef.current = request;
      void flushPostEditWarmRequest();
    });
  }, [ensureFastScrubRenderer, isResolving, scrubOffscreenRenderedFrameRef]);

  const captureCurrentFrame = useCallback(async (options?: CaptureOptions): Promise<string | null> => {
    if (captureInFlightRef.current) {
      return captureInFlightRef.current;
    }

    const task = (async () => {
      try {
        const playback = usePlaybackStore.getState();
        const targetFrame = playback.previewFrame ?? playback.currentFrame;
        const offscreen = await renderOffscreenFrame(targetFrame);
        if (!offscreen) return null;

        const format = options?.format ?? 'image/jpeg';
        const quality = options?.quality ?? 0.9;
        const targetWidth = Math.max(2, Math.round(options?.width ?? offscreen.width));
        const targetHeight = Math.max(2, Math.round(options?.height ?? offscreen.height));
        const shouldScale = !options?.fullResolution
          && (targetWidth !== offscreen.width || targetHeight !== offscreen.height);

        if (!shouldScale) {
          const blob = await offscreen.convertToBlob({
            type: format,
            quality,
          });
          return blobToDataUrl(blob);
        }

        // Progressive half-downscale to avoid aliasing/moire with
        // high-frequency GPU effects (halftone, pixelate, etc.)
        let srcW = offscreen.width;
        let srcH = offscreen.height;
        let source: CanvasImageSource = offscreen;
        while (srcW > targetWidth * 2 || srcH > targetHeight * 2) {
          const halfW = Math.max(targetWidth, Math.ceil(srcW / 2));
          const halfH = Math.max(targetHeight, Math.ceil(srcH / 2));
          const step = document.createElement('canvas');
          step.width = halfW;
          step.height = halfH;
          const stepCtx = step.getContext('2d');
          if (!stepCtx) break;
          stepCtx.drawImage(source, 0, 0, halfW, halfH);
          source = step;
          srcW = halfW;
          srcH = halfH;
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx2d = canvas.getContext('2d');
        if (!ctx2d) return null;

        ctx2d.drawImage(source, 0, 0, targetWidth, targetHeight);
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, format, quality);
        });
        if (!blob) return null;
        return blobToDataUrl(blob);
      } catch (error) {
        logger.warn('Failed to capture frame:', error);
        return null;
      } finally {
        captureInFlightRef.current = null;
      }
    })();

    captureInFlightRef.current = task;
    return task;
  }, [captureInFlightRef, renderOffscreenFrame]);

  const captureCurrentFrameImageData = useCallback(async (options?: CaptureOptions): Promise<ImageData | null> => {
    if (captureImageDataInFlightRef.current) {
      return captureImageDataInFlightRef.current;
    }

    const task = (async () => {
      try {
        const playback = usePlaybackStore.getState();
        const targetFrame = playback.previewFrame ?? playback.currentFrame;
        const offscreen = await renderOffscreenFrame(targetFrame);
        if (!offscreen) return null;

        const targetWidth = Math.max(2, Math.round(options?.width ?? offscreen.width));
        const targetHeight = Math.max(2, Math.round(options?.height ?? offscreen.height));
        const shouldScale = !options?.fullResolution
          && (targetWidth !== offscreen.width || targetHeight !== offscreen.height);

        if (!shouldScale) {
          const offscreenCtx = scrubOffscreenCtxRef.current
            ?? offscreen.getContext('2d', { willReadFrequently: true });
          if (!offscreenCtx) return null;
          return offscreenCtx.getImageData(0, 0, offscreen.width, offscreen.height);
        }

        let scaleCanvas = captureScaleCanvasRef.current;
        if (!scaleCanvas) {
          scaleCanvas = document.createElement('canvas');
          captureScaleCanvasRef.current = scaleCanvas;
        }
        if (scaleCanvas.width !== targetWidth || scaleCanvas.height !== targetHeight) {
          scaleCanvas.width = targetWidth;
          scaleCanvas.height = targetHeight;
        }
        const scaleCtx = scaleCanvas.getContext('2d', { willReadFrequently: true });
        if (!scaleCtx) return null;

        scaleCtx.clearRect(0, 0, targetWidth, targetHeight);
        scaleCtx.drawImage(offscreen, 0, 0, targetWidth, targetHeight);
        return scaleCtx.getImageData(0, 0, targetWidth, targetHeight);
      } catch (error) {
        logger.warn('Failed to capture raw frame:', error);
        return null;
      } finally {
        captureImageDataInFlightRef.current = null;
      }
    })();

    captureImageDataInFlightRef.current = task;
    return task;
  }, [
    captureImageDataInFlightRef,
    captureScaleCanvasRef,
    renderOffscreenFrame,
    scrubOffscreenCtxRef,
  ]);

  const captureCanvasSource = useCallback(async (): Promise<OffscreenCanvas | HTMLCanvasElement | null> => {
    if (captureCanvasSourceInFlightRef.current) {
      return captureCanvasSourceInFlightRef.current;
    }

    const task = (async () => {
      try {
        const playback = usePlaybackStore.getState();
        const targetFrame = playback.previewFrame ?? playback.currentFrame;
        return await renderOffscreenFrame(targetFrame);
      } catch (error) {
        logger.warn('Failed to capture canvas source:', error);
        return null;
      } finally {
        captureCanvasSourceInFlightRef.current = null;
      }
    })();

    captureCanvasSourceInFlightRef.current = task;
    return task;
  }, [captureCanvasSourceInFlightRef, renderOffscreenFrame]);

  usePreviewCaptureBridge({
    captureCurrentFrame,
    captureCurrentFrameImageData,
    captureCanvasSource,
    setCaptureFrame,
    setCaptureFrameImageData,
    setCaptureCanvasSource,
    setDisplayedFrame,
    captureInFlightRef,
    captureImageDataInFlightRef,
    captureScaleCanvasRef,
  });

  useEffect(() => {
    if (!FAST_SCRUB_RENDERER_ENABLED) return;
    void (async () => {
      try {
        const { EffectsPipeline } = await import('@/infrastructure/gpu/effects');
        const device = await EffectsPipeline.requestCachedDevice();
        if (device) {
          const warmPipeline = await EffectsPipeline.create();
          if (warmPipeline) {
            try {
              const { TransitionPipeline } = await import('@/infrastructure/gpu/transitions');
              TransitionPipeline.create(device)?.destroy();
            } finally {
              warmPipeline.destroy();
            }
          }
        }
      } catch {
        // GPU not available, the renderer will fall back to the CPU path.
      }
    })();
  }, []);

  useEffect(() => {
    if (!FAST_SCRUB_RENDERER_ENABLED || isResolving) return;
    if (scrubRendererRef.current || scrubInitPromiseRef.current) return;

    let cancelled = false;
    const warmup = () => {
      if (cancelled || scrubRendererRef.current || scrubInitPromiseRef.current) return;
      void ensureFastScrubRenderer();
    };

    let idleId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = (
        window as Window & {
          requestIdleCallback: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number;
        }
      ).requestIdleCallback(() => warmup(), { timeout: 400 });
    } else {
      timeoutId = setTimeout(warmup, 120);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        (
          window as Window & { cancelIdleCallback: (id: number) => void }
        ).cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, [ensureFastScrubRenderer, isResolving, scrubInitPromiseRef, scrubRendererRef]);

  useEffect(() => {
    return () => {
      scrubMountedRef.current = false;
      resetResolveRetryState();
      disposeFastScrubRenderer();
    };
  }, [disposeFastScrubRenderer, resetResolveRetryState, scrubMountedRef]);

  return {
    disposeFastScrubRenderer,
    ensureFastScrubRenderer,
    ensureBgTransitionRenderer,
  };
}
