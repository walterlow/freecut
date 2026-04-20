import { useEffect, type MutableRefObject, type RefObject } from 'react';
import type { PlayerRef } from '@/features/preview/deps/player-core';
import { getGlobalVideoSourcePool } from '@/features/preview/deps/player-pool';
import { usePlaybackStore } from '@/shared/state/playback';
import type { TimelineItem, TimelineTrack } from '@/types/timeline';
import type { ResolvedTransitionWindow } from '@/core/timeline/transitions/transition-planner';
import { useGizmoStore } from '../stores/gizmo-store';
import { useCornerPinStore } from '../stores/corner-pin-store';
import { useMaskEditorStore } from '../stores/mask-editor-store';
import {
  backgroundPreseek as workerBackgroundPreseek,
  backgroundBatchPreseek as workerBackgroundBatchPreseek,
} from '../utils/decoder-prewarm';
import { getDirectionalPrewarmOffsets } from '../utils/fast-scrub-prewarm';
import { shouldShowFastScrubOverlay } from '../utils/fast-scrub-overlay-guard';
import { resolvePlaybackTransitionOverlayState } from '../utils/playback-transition-overlay';
import {
  FAST_SCRUB_DIRECTIONAL_PREWARM_BACKWARD_STEPS,
  FAST_SCRUB_DIRECTIONAL_PREWARM_FORWARD_STEPS,
  FAST_SCRUB_DIRECTIONAL_PREWARM_NEUTRAL_RADIUS,
  FAST_SCRUB_DIRECTIONAL_PREWARM_OPPOSITE_STEPS,
  FAST_SCRUB_MAX_PREWARM_FRAMES,
  FAST_SCRUB_MAX_PREWARM_SOURCES,
  FAST_SCRUB_PREWARM_QUEUE_MAX,
  FAST_SCRUB_PREWARM_RENDER_BUDGET_MS,
  FAST_SCRUB_SOURCE_TOUCH_COOLDOWN_FRAMES,
  type FastScrubBoundarySource,
} from '../utils/preview-constants';
import {
  isAtomicPreviewTarget,
  resolveBackwardScrubFlags,
  resolveBackwardScrubFramePlan,
  resolveRenderPumpTargetFrame,
  resolveScrubDirectionPlan,
  selectBoundaryPrewarmFrames,
  selectBoundarySourcePrewarmSources,
} from '../utils/render-pump-frame-plan';
import {
  collectClipVideoSourceTimesBySrcForFrame,
  collectClipVideoSourceTimesBySrcForFrameRange,
  collectPlaybackStartVariableSpeedPreseekTargets,
  collectPlaybackStartVariableSpeedPrewarmItemIds,
  collectVisibleTrackVideoSourceTimesBySrc,
  getVideoItemSourceTimeSeconds,
  resolvePausedVariableSpeedPrewarmPlan,
} from '../utils/render-pump-preseek';
import type { TransitionPreviewSessionTrace } from './use-preview-transition-session-controller';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('VideoPreview');

type TransitionWindow = ResolvedTransitionWindow<TimelineItem>;
type PlaybackTransitionOverlayWindows = Parameters<typeof resolvePlaybackTransitionOverlayState>[0];
type PlaybackStoreSnapshot = ReturnType<typeof usePlaybackStore.getState>;

type FastScrubRenderer = Awaited<
  ReturnType<(typeof import('@/features/preview/deps/export'))['createCompositionRenderer']>
>;

type PreviewPerfState = {
  fastScrubPrewarmSourceEvictions: number;
  fastScrubPrewarmedSources: number;
  staleScrubOverlayDrops: number;
  scrubDroppedFrames: number;
  scrubUpdates: number;
};

interface UsePreviewRenderPumpParams {
  playerRef: RefObject<PlayerRef | null>;
  fps: number;
  forceFastScrubOverlay: boolean;
  combinedTracks: TimelineTrack[];
  fastScrubBoundaryFrames: number[];
  fastScrubBoundarySources: FastScrubBoundarySource[];
  playbackTransitionOverlayWindows: PlaybackTransitionOverlayWindows;
  playbackTransitionLookaheadFrames: number;
  playbackTransitionCooldownFrames: number;
  playbackTransitionPrerenderRunwayFrames: number;
  previewPerfRef: MutableRefObject<PreviewPerfState>;
  isGizmoInteractingRef: MutableRefObject<boolean>;
  bypassPreviewSeekRef: MutableRefObject<boolean>;
  showFastScrubOverlayRef: MutableRefObject<boolean>;
  pendingFastScrubHandoffFrameRef: MutableRefObject<number | null>;
  scrubCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  scrubRendererRef: RefObject<FastScrubRenderer | null>;
  scrubMountedRef: MutableRefObject<boolean>;
  scrubRenderInFlightRef: MutableRefObject<boolean>;
  scrubRenderGenerationRef: MutableRefObject<number>;
  scrubDirectionRef: MutableRefObject<-1 | 0 | 1>;
  scrubRequestedFrameRef: MutableRefObject<number | null>;
  scrubPrewarmQueueRef: MutableRefObject<number[]>;
  scrubPrewarmQueuedSetRef: MutableRefObject<Set<number>>;
  scrubPrewarmedFramesRef: MutableRefObject<number[]>;
  scrubPrewarmedFrameSetRef: MutableRefObject<Set<number>>;
  scrubPrewarmedSourcesRef: MutableRefObject<Set<string>>;
  scrubPrewarmedSourceOrderRef: MutableRefObject<string[]>;
  scrubPrewarmedSourceTouchFrameRef: MutableRefObject<Map<string, number>>;
  scrubOffscreenCanvasRef: MutableRefObject<OffscreenCanvas | null>;
  scrubOffscreenRenderedFrameRef: MutableRefObject<number | null>;
  bgTransitionRenderInFlightRef: MutableRefObject<boolean>;
  resumeScrubLoopRef: MutableRefObject<() => void>;
  lastBackwardScrubPreloadAtRef: MutableRefObject<number>;
  lastBackwardScrubRenderAtRef: MutableRefObject<number>;
  lastBackwardRequestedFrameRef: MutableRefObject<number | null>;
  suppressScrubBackgroundPrewarmRef: MutableRefObject<boolean>;
  fallbackToPlayerScrubRef: MutableRefObject<boolean>;
  lastPausedPrearmTargetRef: MutableRefObject<number | null>;
  lastPlayingPrearmTargetRef: MutableRefObject<number | null>;
  deferredPlaybackTransitionPrepareFrameRef: MutableRefObject<number | null>;
  transitionPrepareTimeoutRef: MutableRefObject<number | null>;
  transitionSessionWindowRef: MutableRefObject<TransitionWindow | null>;
  transitionSessionPinnedElementsRef: MutableRefObject<Map<string, HTMLVideoElement | null>>;
  transitionSessionStallCountRef: MutableRefObject<Map<string, { ct: number; count: number }>>;
  transitionSessionBufferedFramesRef: MutableRefObject<Map<number, OffscreenCanvas>>;
  transitionPrewarmPromiseRef: MutableRefObject<Promise<void> | null>;
  transitionSessionTraceRef: MutableRefObject<TransitionPreviewSessionTrace | null>;
  setDisplayedFrame: (frame: number | null) => void;
  clearPendingFastScrubHandoff: () => void;
  hideFastScrubOverlay: () => void;
  hidePlaybackTransitionOverlay: () => void;
  maybeCompleteFastScrubHandoff: (resolvedFrame?: number | null) => boolean;
  scheduleFastScrubHandoffCheck: () => void;
  beginFastScrubHandoff: (targetFrame: number) => void;
  showFastScrubOverlayForFrame: () => void;
  showPlaybackTransitionOverlayForFrame: () => void;
  shouldPreferPlayerForPreview: (previewFrame: number | null) => boolean;
  shouldPreserveHighFidelityBackwardPreview: (targetFrame: number | null) => boolean;
  getTransitionWindowByStartFrame: (startFrame: number | null) => TransitionWindow | null;
  getTransitionWindowForFrame: (frame: number) => TransitionWindow | null;
  getPlayingAnyTransitionPrewarmStartFrame: (frame: number) => number | null;
  getPausedTransitionPrewarmStartFrame: (frame: number) => number | null;
  getPinnedTransitionElementForItem: (itemId: string) => HTMLVideoElement | null;
  pinTransitionPlaybackSession: (window: TransitionWindow | null) => TransitionWindow | null;
  clearTransitionPlaybackSession: () => void;
  cacheTransitionSessionFrame: (frame: number) => void;
  preparePlaybackTransitionFrame: (frame: number) => Promise<boolean>;
  disposeFastScrubRenderer: () => void;
  ensureFastScrubRenderer: () => Promise<FastScrubRenderer | null>;
  ensureBgTransitionRenderer: () => Promise<FastScrubRenderer | null>;
  pushTransitionTrace: (phase: string, data?: Record<string, unknown>) => void;
  isPausedTransitionOverlayActive: (
    frame: number,
    playbackState: { isPlaying: boolean; previewFrame: number | null },
  ) => boolean;
  trackPlayerSeek: (targetFrame: number) => void;
  recordRenderFrameJitter?: (
    frame: number,
    renderMs: number,
    inTransition: boolean,
    transitionId: string | null,
    progress: number | null,
  ) => void;
}

export function usePreviewRenderPump({
  playerRef,
  fps,
  forceFastScrubOverlay,
  combinedTracks,
  fastScrubBoundaryFrames,
  fastScrubBoundarySources,
  playbackTransitionOverlayWindows,
  playbackTransitionLookaheadFrames,
  playbackTransitionCooldownFrames,
  playbackTransitionPrerenderRunwayFrames,
  previewPerfRef,
  isGizmoInteractingRef,
  bypassPreviewSeekRef,
  showFastScrubOverlayRef,
  pendingFastScrubHandoffFrameRef,
  scrubCanvasRef,
  scrubRendererRef,
  scrubMountedRef,
  scrubRenderInFlightRef,
  scrubRenderGenerationRef,
  scrubDirectionRef,
  scrubRequestedFrameRef,
  scrubPrewarmQueueRef,
  scrubPrewarmQueuedSetRef,
  scrubPrewarmedFramesRef,
  scrubPrewarmedFrameSetRef,
  scrubPrewarmedSourcesRef,
  scrubPrewarmedSourceOrderRef,
  scrubPrewarmedSourceTouchFrameRef,
  scrubOffscreenCanvasRef,
  scrubOffscreenRenderedFrameRef,
  bgTransitionRenderInFlightRef,
  resumeScrubLoopRef,
  lastBackwardScrubPreloadAtRef,
  lastBackwardScrubRenderAtRef,
  lastBackwardRequestedFrameRef,
  suppressScrubBackgroundPrewarmRef,
  fallbackToPlayerScrubRef,
  lastPausedPrearmTargetRef,
  lastPlayingPrearmTargetRef,
  deferredPlaybackTransitionPrepareFrameRef,
  transitionPrepareTimeoutRef,
  transitionSessionWindowRef,
  transitionSessionPinnedElementsRef,
  transitionSessionStallCountRef,
  transitionSessionBufferedFramesRef,
  transitionPrewarmPromiseRef,
  transitionSessionTraceRef,
  setDisplayedFrame,
  clearPendingFastScrubHandoff,
  hideFastScrubOverlay,
  hidePlaybackTransitionOverlay,
  maybeCompleteFastScrubHandoff,
  scheduleFastScrubHandoffCheck,
  beginFastScrubHandoff,
  showFastScrubOverlayForFrame,
  showPlaybackTransitionOverlayForFrame,
  shouldPreferPlayerForPreview,
  shouldPreserveHighFidelityBackwardPreview,
  getTransitionWindowByStartFrame,
  getTransitionWindowForFrame,
  getPlayingAnyTransitionPrewarmStartFrame,
  getPausedTransitionPrewarmStartFrame,
  getPinnedTransitionElementForItem,
  pinTransitionPlaybackSession,
  clearTransitionPlaybackSession,
  cacheTransitionSessionFrame,
  preparePlaybackTransitionFrame,
  disposeFastScrubRenderer,
  ensureFastScrubRenderer,
  ensureBgTransitionRenderer,
  pushTransitionTrace,
  isPausedTransitionOverlayActive,
  trackPlayerSeek,
  recordRenderFrameJitter,
}: UsePreviewRenderPumpParams) {
  useEffect(() => {
    scrubMountedRef.current = true;

    const drawSourceToDisplay = (source: OffscreenCanvas | HTMLCanvasElement, renderedFrame: number) => {
      const displayCanvas = scrubCanvasRef.current;
      if (!displayCanvas) return;
      const displayCtx = displayCanvas.getContext('2d');
      if (!displayCtx) return;
      displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
      displayCtx.drawImage(source, 0, 0, displayCanvas.width, displayCanvas.height);
      setDisplayedFrame(renderedFrame);
    };

    const drawToDisplay = (renderedFrame: number) => {
      const offscreen = scrubOffscreenCanvasRef.current;
      if (!offscreen) return;
      drawSourceToDisplay(offscreen, renderedFrame);
    };

    const getPlaybackTransitionStateForFrame = (frame: number) => (
      resolvePlaybackTransitionOverlayState(
        playbackTransitionOverlayWindows,
        frame,
        playbackTransitionLookaheadFrames,
        playbackTransitionCooldownFrames,
      )
    );

    const tryShowPreparedPlaybackTransitionOverlay = (frame: number) => {
      const bufferedFrame = transitionSessionBufferedFramesRef.current.get(frame);
      if (bufferedFrame) {
        const trace = transitionSessionTraceRef.current;
        if (trace && trace.enteredAtMs === null) {
          trace.enteredAtMs = performance.now();
          pushTransitionTrace('entry_show', {
            opId: trace.opId,
            frame,
            via: 'buffer',
            bufferedFrames: transitionSessionBufferedFramesRef.current.size,
          });
        }
        drawSourceToDisplay(bufferedFrame, frame);
        showPlaybackTransitionOverlayForFrame();
        return true;
      }
      if (scrubOffscreenRenderedFrameRef.current !== frame) {
        return false;
      }
      const trace = transitionSessionTraceRef.current;
      if (trace && trace.enteredAtMs === null) {
        trace.enteredAtMs = performance.now();
        pushTransitionTrace('entry_show', {
          opId: trace.opId,
          frame,
          via: 'offscreen',
          bufferedFrames: transitionSessionBufferedFramesRef.current.size,
        });
      }
      drawToDisplay(frame);
      showPlaybackTransitionOverlayForFrame();
      return true;
    };

    const schedulePlaybackTransitionPrepare = (frame: number | null) => {
      if (frame === null) {
        deferredPlaybackTransitionPrepareFrameRef.current = null;
        if (transitionPrepareTimeoutRef.current !== null) {
          clearTimeout(transitionPrepareTimeoutRef.current);
          transitionPrepareTimeoutRef.current = null;
        }
        return;
      }
      deferredPlaybackTransitionPrepareFrameRef.current = frame;
      if (!scrubRenderInFlightRef.current) {
        void preparePlaybackTransitionFrame(frame);
      }
    };

    const clearScheduledTransitionPrepare = () => {
      if (transitionPrepareTimeoutRef.current !== null) {
        clearTimeout(transitionPrepareTimeoutRef.current);
        transitionPrepareTimeoutRef.current = null;
      }
    };

    const clearPrewarmQueue = () => {
      scrubPrewarmQueueRef.current = [];
      scrubPrewarmQueuedSetRef.current.clear();
    };

    const hideAllOverlays = () => {
      hideFastScrubOverlay();
      hidePlaybackTransitionOverlay();
    };

    const resetScrubLoopState = () => {
      scrubRequestedFrameRef.current = null;
      scrubDirectionRef.current = 0;
      suppressScrubBackgroundPrewarmRef.current = false;
      fallbackToPlayerScrubRef.current = false;
      lastBackwardScrubPreloadAtRef.current = 0;
      lastBackwardScrubRenderAtRef.current = 0;
      lastBackwardRequestedFrameRef.current = null;
      clearPrewarmQueue();
    };

    const runBatchPreseek = (bySource: Map<string, number[]>) => {
      for (const [src, timestamps] of bySource) {
        void workerBackgroundBatchPreseek(src, timestamps);
      }
    };

    const runPreseekTargets = (targets: Array<{ src: string; time: number }>) => {
      for (const target of targets) {
        void workerBackgroundPreseek(target.src, target.time);
      }
    };

    const scheduleOpportunisticTransitionPrepare = () => {
      const deferredFrame = deferredPlaybackTransitionPrepareFrameRef.current;
      if (deferredFrame === null) {
        clearScheduledTransitionPrepare();
        return;
      }
      if (transitionPrepareTimeoutRef.current !== null) {
        return;
      }

      transitionPrepareTimeoutRef.current = window.setTimeout(() => {
        transitionPrepareTimeoutRef.current = null;
        if (!scrubMountedRef.current) return;

        const playbackState = usePlaybackStore.getState();
        if (!playbackState.isPlaying) return;

        const playbackTransitionState = getPlaybackTransitionStateForFrame(playbackState.currentFrame);
        if (!playbackTransitionState.shouldPrewarm || playbackTransitionState.nextTransitionStartFrame !== deferredFrame) {
          return;
        }

        if (scrubRenderInFlightRef.current) {
          scheduleOpportunisticTransitionPrepare();
          return;
        }

        const trace = transitionSessionTraceRef.current;
        if (trace) {
          pushTransitionTrace('prepare_opportunistic', {
            opId: trace.opId,
            targetFrame: deferredFrame,
          });
        }

        deferredPlaybackTransitionPrepareFrameRef.current = null;
        void preparePlaybackTransitionFrame(deferredFrame);
      }, 0);
    };

    // Single-owner async pump for scrub rendering. Callers never spawn a
    // second worker; they only replace `scrubRequestedFrameRef` and let the
    // current owner pick up the newest request on the next loop iteration.
    const pumpRenderLoop = async () => {
      if (scrubRenderInFlightRef.current) return;
      scrubRenderInFlightRef.current = true;
      const generation = scrubRenderGenerationRef.current;
      // Fast bail-out: check if this pump has been superseded by a newer
      // seek/play cycle. Checked after every await to abandon stale work
      // as early as possible, freeing GPU/decoder resources for the new frame.
      const isStale = () => scrubRenderGenerationRef.current !== generation;

      try {
        const enqueuePrewarmFrame = (frame: number) => {
          if (frame < 0) return;
          if (scrubPrewarmQueuedSetRef.current.has(frame)) return;
          if (scrubPrewarmedFrameSetRef.current.has(frame)) return;
          scrubPrewarmQueuedSetRef.current.add(frame);
          scrubPrewarmQueueRef.current.push(frame);
          while (scrubPrewarmQueueRef.current.length > FAST_SCRUB_PREWARM_QUEUE_MAX) {
            const dropped = scrubPrewarmQueueRef.current.shift();
            if (dropped !== undefined) {
              scrubPrewarmQueuedSetRef.current.delete(dropped);
            }
          }
        };

        const markPrewarmed = (frame: number) => {
          if (scrubPrewarmedFrameSetRef.current.has(frame)) return;
          scrubPrewarmedFrameSetRef.current.add(frame);
          scrubPrewarmedFramesRef.current.push(frame);

          if (scrubPrewarmedFramesRef.current.length > FAST_SCRUB_MAX_PREWARM_FRAMES) {
            const dropped = scrubPrewarmedFramesRef.current.shift();
            if (dropped !== undefined) {
              scrubPrewarmedFrameSetRef.current.delete(dropped);
            }
          }
        };

        const enqueueBoundaryPrewarm = (targetFrame: number) => {
          const selectedFrames = selectBoundaryPrewarmFrames({
            boundaryFrames: fastScrubBoundaryFrames,
            targetFrame,
            direction: scrubDirectionRef.current,
            fps,
          });
          for (const frame of selectedFrames) {
            enqueuePrewarmFrame(frame);
          }
        };

        const enqueueBoundarySourcePrewarm = (targetFrame: number) => {
          if (fastScrubBoundarySources.length === 0) return;

          const pool = getGlobalVideoSourcePool();
          const touchFrameMap = scrubPrewarmedSourceTouchFrameRef.current;
          const markBoundarySourcePrewarmed = (src: string, currentFrame: number): boolean => {
            const lastTouchedFrame = touchFrameMap.get(src);
            if (
              lastTouchedFrame !== undefined
              && Math.abs(currentFrame - lastTouchedFrame) < FAST_SCRUB_SOURCE_TOUCH_COOLDOWN_FRAMES
            ) {
              return false;
            }
            touchFrameMap.set(src, currentFrame);
            const prewarmedSet = scrubPrewarmedSourcesRef.current;
            const prewarmedOrder = scrubPrewarmedSourceOrderRef.current;
            const existingIndex = prewarmedOrder.indexOf(src);
            if (existingIndex >= 0) {
              prewarmedOrder.splice(existingIndex, 1);
            } else {
              prewarmedSet.add(src);
            }
            prewarmedOrder.push(src);

            while (prewarmedOrder.length > FAST_SCRUB_MAX_PREWARM_SOURCES) {
              const evicted = prewarmedOrder.shift();
              if (evicted === undefined) break;
              if (prewarmedSet.delete(evicted)) {
                touchFrameMap.delete(evicted);
                previewPerfRef.current.fastScrubPrewarmSourceEvictions += 1;
              }
            }

            previewPerfRef.current.fastScrubPrewarmedSources = prewarmedSet.size;
            return true;
          };
          const selectedSources = selectBoundarySourcePrewarmSources({
            boundarySources: fastScrubBoundarySources,
            targetFrame,
            direction: scrubDirectionRef.current,
            fps,
          });

          for (const src of selectedSources) {
            const wasPrewarmed = scrubPrewarmedSourcesRef.current.has(src);
            const touched = markBoundarySourcePrewarmed(src, targetFrame);
            if (!touched) continue;
            if (!wasPrewarmed) {
              pool.preloadSource(src).catch(() => {});
            }
          }
        };

        const enqueueDirectionalPrewarm = (targetFrame: number) => {
          const offsets = getDirectionalPrewarmOffsets(scrubDirectionRef.current, {
            forwardSteps: FAST_SCRUB_DIRECTIONAL_PREWARM_FORWARD_STEPS,
            backwardSteps: FAST_SCRUB_DIRECTIONAL_PREWARM_BACKWARD_STEPS,
            oppositeSteps: FAST_SCRUB_DIRECTIONAL_PREWARM_OPPOSITE_STEPS,
            neutralRadius: FAST_SCRUB_DIRECTIONAL_PREWARM_NEUTRAL_RADIUS,
          });
          for (const offset of offsets) {
            enqueuePrewarmFrame(targetFrame + offset);
          }
        };

        let prewarmBudgetStart = 0;
        while (scrubMountedRef.current) {
          if (shouldPreferPlayerForPreview(usePlaybackStore.getState().previewFrame)) {
            hideFastScrubOverlay();
            hidePlaybackTransitionOverlay();
            scrubRequestedFrameRef.current = null;
            break;
          }
          if (fallbackToPlayerScrubRef.current) {
            scrubRequestedFrameRef.current = null;
            clearPrewarmQueue();
            hideAllOverlays();
            break;
          }

          const targetFrame = scrubRequestedFrameRef.current;
          const isPriorityFrame = targetFrame !== null;
          const frameToRender = isPriorityFrame
            ? targetFrame
            : (scrubPrewarmQueueRef.current.shift() ?? null);

          if (frameToRender === null) break;

          if (isPriorityFrame) {
            scrubRequestedFrameRef.current = null;
            prewarmBudgetStart = 0; // Reset budget for prewarm after this priority frame
          } else {
            scrubPrewarmQueuedSetRef.current.delete(frameToRender);
            // Skip stale prewarm if a newer scrub frame is pending.
            if (scrubRequestedFrameRef.current !== null) {
              continue;
            }
            if (suppressScrubBackgroundPrewarmRef.current) {
              continue;
            }
            // Skip prewarm during playback — WASM decode prewarm renders
            // (40-80ms each) block the loop from processing priority frames,
            // causing the overlay to fall behind and show stale content.
            if (usePlaybackStore.getState().isPlaying) {
              break;
            }
            // Time-budget prewarm renders to keep scrubbing responsive.
            // After exhausting the budget, yield so new priority frames aren't delayed.
            if (prewarmBudgetStart > 0 && performance.now() - prewarmBudgetStart > FAST_SCRUB_PREWARM_RENDER_BUDGET_MS) {
              break;
            }
          }

          const renderer = await ensureFastScrubRenderer();
          if (!renderer || !scrubMountedRef.current) {
            hideFastScrubOverlay();
            break;
          }
          // For background prewarm frames, bail if a newer scrub target arrived.
          // Priority frames proceed regardless — their rendered content is always useful.
          if (!isPriorityFrame && isStale()) break;

          // Enable DOM video element provider during playback for zero-copy rendering.
          // During playback, the Player's <video> elements are already at
          // the correct frame — reading from them avoids mediabunny decode entirely.
          if ('setDomVideoElementProvider' in renderer) {
            const playbackNow = usePlaybackStore.getState();
            if (playbackNow.isPlaying) {
              // Only pin/clear the transition session when the rendered frame is
              // actually inside a transition window. Passing null for pre-transition
              // frames would destroy sessions that the prearm subscription just
              // pinned, causing churn and losing the DOM video element provider
              // needed for smooth transition entry.
              const windowForFrame = getTransitionWindowForFrame(frameToRender);
              if (windowForFrame) {
                const prevSession = transitionSessionWindowRef.current;
                const isNewSession = !prevSession || prevSession.transition.id !== windowForFrame.transition.id;
                pinTransitionPlaybackSession(windowForFrame);
                // Await the prearm prewarm so mediabunny decoders are positioned
                // at the correct source time before rendering. The prearm fires
                // ~2s ahead so this resolves near-instantly in the common case.
                // Without this, decoders may be at a stale position from a prior
                // playback, causing 100-300ms backward keyframe seeks per frame.
                if (transitionPrewarmPromiseRef.current) {
                  await transitionPrewarmPromiseRef.current;
                  transitionPrewarmPromiseRef.current = null;
                }
                // When entering a transition mid-playback (no prearm happened),
                // await the prewarm synchronously to position decoders.
                if (isNewSession && 'prewarmItems' in renderer) {
                  await renderer.prewarmItems?.(
                    [windowForFrame.leftClip.id, windowForFrame.rightClip.id],
                    frameToRender,
                  );
                }
              }
              renderer.setDomVideoElementProvider?.(getPinnedTransitionElementForItem);
            } else {
              renderer.setDomVideoElementProvider?.(undefined);
            }
          }

          if (isPriorityFrame) {
            // Visible scrub targets still use full composition rendering.
            const renderStartMs = performance.now();
            await renderer.renderFrame(frameToRender);
            // Don't check isStale() here — the priority frame is fully rendered
            // and should always be displayed. Discarding it wastes the decode work
            // and reduces scrub hit rate.
            const renderMs = performance.now() - renderStartMs;
            scrubOffscreenRenderedFrameRef.current = frameToRender;
            // Dev: capture ALL frame times to window global for jitter debugging
            if (import.meta.env.DEV) {
              const log = (window as unknown as Record<string, unknown>).__ALL_FRAME_TIMES__ as Array<{ f: number; ms: number }> | undefined;
              if (log && log.length < 300) {
                log.push({ f: frameToRender, ms: Math.round(renderMs * 100) / 100 });
              }
              // Feed the frame jitter monitor with transition context
              const tw = transitionSessionWindowRef.current;
              const inTrans = tw !== null
                && frameToRender >= tw.startFrame
                && frameToRender < tw.endFrame;
              recordRenderFrameJitter?.(
                frameToRender,
                renderMs,
                inTrans,
                tw?.transition.id ?? null,
                inTrans && tw ? (frameToRender - tw.startFrame) / (tw.endFrame - tw.startFrame) : null,
              );
            }
            // Log transition-area frame timing for diagnostics.
            if (import.meta.env.DEV && transitionSessionWindowRef.current) {
              const tw = transitionSessionWindowRef.current;
              if (frameToRender >= tw.startFrame - 10 && frameToRender <= tw.endFrame + 5) {
                pushTransitionTrace(renderMs > 16 ? 'render_frame_slow' : 'render_frame', {
                  frame: frameToRender,
                  renderMs: Math.round(renderMs * 100) / 100,
                  inTransition: frameToRender >= tw.startFrame && frameToRender < tw.endFrame,
                });
              }
            }
          } else {
            // Background scrub prewarm: collect eligible frames into a batch
            // for samplesAtTimestamps() optimized pipeline, then dispatch.
            const prewarmBatch: number[] = [frameToRender];
            // Drain more frames from the queue while within budget and not stale
            while (scrubPrewarmQueueRef.current.length > 0) {
              if (scrubRequestedFrameRef.current !== null) break;
              if (suppressScrubBackgroundPrewarmRef.current) break;
              if (usePlaybackStore.getState().isPlaying) break;
              if (prewarmBudgetStart > 0 && performance.now() - prewarmBudgetStart > FAST_SCRUB_PREWARM_RENDER_BUDGET_MS) break;
              const next = scrubPrewarmQueueRef.current.shift()!;
              scrubPrewarmQueuedSetRef.current.delete(next);
              prewarmBatch.push(next);
            }
            // Batch prewarm via samplesAtTimestamps — each packet decoded at most
            // once across the batch. Falls back to sequential drawFrame internally
            // for sources where batch mode has been disabled.
            await renderer.prewarmFrames(prewarmBatch);
            for (const f of prewarmBatch) {
              markPrewarmed(f);
            }
          }
          if (!scrubMountedRef.current || isStale()) break;

          if (isPriorityFrame) {

            const playbackState = usePlaybackStore.getState();
            const playbackTransitionState = getPlaybackTransitionStateForFrame(frameToRender);
            const shouldShowPlaybackTransitionOverlay = (
              playbackState.isPlaying
              && playbackState.previewFrame === null
              && (playbackTransitionState.hasActiveTransition || playbackTransitionState.shouldHoldOverlay)
              && !forceFastScrubOverlay
            );
            if (fallbackToPlayerScrubRef.current) {
              hideAllOverlays();
              continue;
            }
            // Guard against stale in-flight renders that finish after scrub has ended.
            // Without this, a completed old render can re-show the overlay and hide
            // live Player updates (e.g. ruler click + gizmo interaction).
            const isPausedOnTransitionFrame = (
              frameToRender === playbackState.currentFrame
              && isPausedTransitionOverlayActive(frameToRender, playbackState)
            );
            if (
              !shouldShowPlaybackTransitionOverlay
              && !forceFastScrubOverlay
              && !isPausedOnTransitionFrame
              && !shouldShowFastScrubOverlay({
                isGizmoInteracting: isGizmoInteractingRef.current,
                isPlaying: playbackState.isPlaying,
                currentFrame: playbackState.currentFrame,
                previewFrame: playbackState.previewFrame,
                renderedFrame: frameToRender,
              })
            ) {
              previewPerfRef.current.staleScrubOverlayDrops += 1;
              hideAllOverlays();
              continue;
            }

            drawToDisplay(frameToRender);
            if (shouldShowPlaybackTransitionOverlay) {
              showPlaybackTransitionOverlayForFrame();
            } else {
              showFastScrubOverlayForFrame();
            }
            if (!shouldShowPlaybackTransitionOverlay && !suppressScrubBackgroundPrewarmRef.current) {
              enqueueDirectionalPrewarm(frameToRender);
              enqueueBoundaryPrewarm(frameToRender);
              enqueueBoundarySourcePrewarm(frameToRender);
            }
            if (deferredPlaybackTransitionPrepareFrameRef.current !== null) {
              scheduleOpportunisticTransitionPrepare();
            }
            prewarmBudgetStart = performance.now();
          } else {
            markPrewarmed(frameToRender);
          }
        }
      } catch (error) {
        logger.warn('Render failed, using Player seek fallback:', error);
        hideAllOverlays();
        disposeFastScrubRenderer();
      } finally {
        if (scrubRenderGenerationRef.current === generation) {
          // Current generation — this pump owns the lock. Release normally.
          scrubRenderInFlightRef.current = false;
          const deferredPrepareFrame = deferredPlaybackTransitionPrepareFrameRef.current;
          if (deferredPrepareFrame !== null) {
            scheduleOpportunisticTransitionPrepare();
          }
          if (scrubRequestedFrameRef.current !== null) {
            void pumpRenderLoop();
          }
        }
        // Stale generation — a newer seek/play bumped the generation while
        // we were in-flight. DON'T release the lock here; the playback-start
        // force-clear or the new pump's finally handles it. Releasing would
        // allow a concurrent pump to start and share mutable canvas state.
      }
    };

    resumeScrubLoopRef.current = () => {
      void pumpRenderLoop();
    };

    // rAF-driven render pump for playback — fires at display vsync (60Hz+),
    // catching frames the Zustand subscription misses due to event loop
    // contention from React renders, GC pauses, etc. This reduces the ~9%
    // frame drop rate during playback to near zero.
    let playbackRafId: number | null = null;
    let lastRafRenderedFrame = -1;
    // Playback start can wait on variable-speed decoder prewarm. While that
    // work is pending, subscription updates can retarget state but must not
    // start a competing async pump ahead of the rAF handoff.
    let playbackPrewarmInFlight = false;
    const pausePrewarmedItemIds = new Set<string>();

    let lastRafPresentedFrame = -1;

    // The rAF loop keeps playback aligned to display cadence, but it still
    // preserves the single-owner invariant: it only presents buffered frames
    // synchronously or queues the latest target for `pumpRenderLoop`.
    const playbackRafPump = () => {
      playbackRafId = null;
      if (!scrubMountedRef.current) return;
      const playbackState = usePlaybackStore.getState();
      if (!playbackState.isPlaying || !forceFastScrubOverlay) return;
      const currentFrame = playbackState.currentFrame;

      if (currentFrame !== lastRafRenderedFrame) {
        lastRafRenderedFrame = currentFrame;
        // Check if this frame was pre-rendered by the transition prepare.
        // If so, present it immediately (0ms) instead of going through the
        // async pumpRenderLoop (which would take 180-240ms for the first
        // transition frame due to mediabunny decode).
        const buffered = transitionSessionBufferedFramesRef.current.get(currentFrame);
        if (buffered) {
          drawSourceToDisplay(buffered, currentFrame);
          scrubOffscreenRenderedFrameRef.current = currentFrame;
          lastRafPresentedFrame = currentFrame;
          // Pre-start the render loop for the next uncached frame so the
          // GPU + decode pipeline is already warm when the buffer runs out.
          // Without this, the first post-cache frame stalls 100-200ms.
          const nextFrame = currentFrame + 1;
          if (!transitionSessionBufferedFramesRef.current.has(nextFrame)
            && !scrubRenderInFlightRef.current) {
            scrubRequestedFrameRef.current = nextFrame;
            void pumpRenderLoop();
          }
        } else {
          scrubRequestedFrameRef.current = currentFrame;
          if (!scrubRenderInFlightRef.current) {
            void pumpRenderLoop();
          }
        }
      } else if (
        lastRafPresentedFrame !== currentFrame
        && scrubOffscreenRenderedFrameRef.current === currentFrame
      ) {
        // Frame hasn't advanced but the async render completed since the
        // last vsync. Present it now synchronously to eliminate 3:2 pulldown
        // judder (50ms/16ms alternating intervals on 30fps@60Hz displays).
        drawToDisplay(currentFrame);
        lastRafPresentedFrame = currentFrame;
      }

      playbackRafId = requestAnimationFrame(playbackRafPump);
    };

    // Threshold for triggering background worker preseek on large jumps.
    // Below this threshold, mediabunny sequential advance is fast (~1ms).
    // Above it, a keyframe seek is needed (300-600ms) — the worker does it off-thread.
    const JUMP_PRESEEK_THRESHOLD_FRAMES = Math.round(fps * 3);

    // Playback store handlers are kept separate so the subscription reads like
    // the runtime state machine: preseek, lifecycle, transition upkeep,
    // paused prewarm, then target-frame routing. That ordering matters because
    // later handlers intentionally build on side effects from earlier ones.
    const handleLargeJumpPreseek = (
      state: PlaybackStoreSnapshot,
      prev: PlaybackStoreSnapshot,
    ) => {
      if (
        state.currentFrame === prev.currentFrame
        || Math.abs(state.currentFrame - prev.currentFrame) < JUMP_PRESEEK_THRESHOLD_FRAMES
        || state.isPlaying
      ) {
        return;
      }

      runBatchPreseek(collectVisibleTrackVideoSourceTimesBySrc(
        combinedTracks,
        state.currentFrame,
        fps,
        { requireExplicitSourceFps: true },
      ));
    };

    const handlePlaybackLifecycleUpdate = (
      state: PlaybackStoreSnapshot,
      prev: PlaybackStoreSnapshot,
    ) => {
      if (state.isPlaying && forceFastScrubOverlay && !prev.isPlaying) {
        if (playbackRafId !== null) {
          return;
        }

        lastRafRenderedFrame = -1;
        // Render-pump invariant: playback takeover is the one path allowed to
        // force-clear the lock. It bumps generation first so any stale pump
        // finishing later cannot release the new owner's lock.
        scrubRenderGenerationRef.current += 1;
        scrubRenderInFlightRef.current = false;
        clearPrewarmQueue();

        const frame = state.currentFrame;
        const prewarmItemIds = collectPlaybackStartVariableSpeedPrewarmItemIds(
          combinedTracks,
          frame,
        );
        runPreseekTargets(collectPlaybackStartVariableSpeedPreseekTargets(
          combinedTracks,
          frame,
          fps,
          Math.round(fps * 3),
        ));

        if (prewarmItemIds.length > 0) {
          playbackPrewarmInFlight = true;
          void (async () => {
            const renderer = await ensureFastScrubRenderer();
            if (renderer && 'prewarmItems' in renderer) {
              const needsPrewarm = prewarmItemIds.filter(
                (id) => !pausePrewarmedItemIds.has(id),
              );
              if (needsPrewarm.length > 0) {
                await renderer.prewarmItems?.(needsPrewarm, frame);
              }
            }
            pausePrewarmedItemIds.clear();
            playbackPrewarmInFlight = false;
            if (playbackRafId === null && usePlaybackStore.getState().isPlaying) {
              playbackRafId = requestAnimationFrame(playbackRafPump);
            }
          })();
          return;
        }

        playbackRafId = requestAnimationFrame(playbackRafPump);
        return;
      }

      if (!state.isPlaying && playbackRafId !== null) {
        cancelAnimationFrame(playbackRafId);
        playbackRafId = null;
        lastPlayingPrearmTargetRef.current = null;
        clearTransitionPlaybackSession();
      }
    };

    const handleActivePlaybackTransitionMaintenance = (
      state: PlaybackStoreSnapshot,
    ) => {
      if (!state.isPlaying || !forceFastScrubOverlay) {
        return;
      }

      const activeTransitionWindow = getTransitionWindowForFrame(state.currentFrame);
      if (activeTransitionWindow && !transitionSessionWindowRef.current) {
        pinTransitionPlaybackSession(activeTransitionWindow);
        lastPlayingPrearmTargetRef.current = activeTransitionWindow.startFrame;
        const renderer = scrubRendererRef.current;
        if (renderer && 'prewarmItems' in renderer) {
          void renderer.prewarmItems?.(
            [activeTransitionWindow.leftClip.id, activeTransitionWindow.rightClip.id],
            state.currentFrame,
          );
        }
        runBatchPreseek(collectClipVideoSourceTimesBySrcForFrame(
          [activeTransitionWindow.leftClip, activeTransitionWindow.rightClip],
          state.currentFrame,
          fps,
          { requireExplicitSourceFps: true },
        ));
      }

      const sessionWindow = transitionSessionWindowRef.current;
      if (sessionWindow && transitionSessionPinnedElementsRef.current.size > 0) {
        for (const clip of [sessionWindow.leftClip, sessionWindow.rightClip]) {
          if (clip.type !== 'video') continue;
          const el = transitionSessionPinnedElementsRef.current.get(clip.id);
          if (!el || el.dataset.transitionHold !== '1') continue;
          const clipSpeed = clip.speed ?? 1;
          const targetTime = getVideoItemSourceTimeSeconds(clip, state.currentFrame, fps);
          if (targetTime === null) continue;

          const stallEntry = transitionSessionStallCountRef.current.get(clip.id);
          if (stallEntry && Math.abs(el.currentTime - stallEntry.ct) < 0.001) {
            const newCount = stallEntry.count + 1;
            transitionSessionStallCountRef.current.set(clip.id, { ct: stallEntry.ct, count: newCount });
            if (newCount >= 3) {
              try { el.currentTime = targetTime; } catch { /* settling */ }
              el.playbackRate = clipSpeed;
              el.play().catch(() => { /* best effort */ });
              transitionSessionStallCountRef.current.set(clip.id, { ct: targetTime, count: 0 });
              continue;
            }
          } else {
            transitionSessionStallCountRef.current.set(clip.id, { ct: el.currentTime, count: 0 });
          }

          const drift = el.currentTime - targetTime;
          if (Math.abs(drift) > 0.2) {
            try { el.currentTime = targetTime; } catch { /* settling */ }
            el.playbackRate = clipSpeed;
          } else if (Math.abs(drift) > 0.016) {
            const correction = -drift * 0.25;
            const maxAdj = Math.max(0.03, clipSpeed * 0.06);
            el.playbackRate = Math.max(
              clipSpeed - maxAdj,
              Math.min(clipSpeed + maxAdj, clipSpeed + correction),
            );
          }
        }
      } else if (transitionSessionStallCountRef.current.size > 0) {
        transitionSessionStallCountRef.current.clear();
      }

      const prearmStartFrame = (!activeTransitionWindow && !transitionSessionWindowRef.current)
        ? getPlayingAnyTransitionPrewarmStartFrame(state.currentFrame)
        : null;
      if (prearmStartFrame !== null) {
        const transitionWindow = getTransitionWindowByStartFrame(prearmStartFrame);
        if (transitionWindow) {
          pinTransitionPlaybackSession(transitionWindow);
        }
        if (lastPlayingPrearmTargetRef.current !== prearmStartFrame) {
          lastPlayingPrearmTargetRef.current = prearmStartFrame;
          if (transitionWindow) {
            const renderer = scrubRendererRef.current;
            if (renderer && 'prewarmItems' in renderer) {
              transitionPrewarmPromiseRef.current = renderer.prewarmItems?.(
                [transitionWindow.leftClip.id, transitionWindow.rightClip.id],
                transitionWindow.startFrame,
              );
            }
            runBatchPreseek(collectClipVideoSourceTimesBySrcForFrameRange(
              [transitionWindow.leftClip, transitionWindow.rightClip],
              transitionWindow.startFrame,
              Math.min(8, transitionWindow.endFrame - transitionWindow.startFrame),
              fps,
              { requireExplicitSourceFps: true },
            ));
          }
          pushTransitionTrace('playing_prearm', {
            targetFrame: prearmStartFrame,
          });
        }
        return;
      }

      lastPlayingPrearmTargetRef.current = null;
      const prevActiveWindow = transitionSessionWindowRef.current;
      if (!activeTransitionWindow && prevActiveWindow && state.currentFrame >= prevActiveWindow.endFrame) {
        clearTransitionPlaybackSession();
      }
    };

    const handlePausedVariableSpeedPrewarm = (
      state: PlaybackStoreSnapshot,
      prev: PlaybackStoreSnapshot,
    ) => {
      if (state.isPlaying || state.previewFrame !== null || prev.currentFrame === state.currentFrame) {
        return;
      }

      const pausedPrewarmPlan = resolvePausedVariableSpeedPrewarmPlan(
        combinedTracks,
        state.currentFrame,
        Math.round(fps * 3),
      );
      if (!pausedPrewarmPlan) {
        return;
      }

      for (const id of pausedPrewarmPlan.itemIds) {
        pausePrewarmedItemIds.add(id);
      }

      const renderer = scrubRendererRef.current;
      if (renderer && 'prewarmItems' in renderer) {
        void renderer.prewarmItems?.(
          pausedPrewarmPlan.itemIds,
          pausedPrewarmPlan.preseekFrame,
        );
      }
    };

    const handlePausedTransitionPrewarm = (
      state: PlaybackStoreSnapshot,
      prev: PlaybackStoreSnapshot,
    ) => {
      if (state.isPlaying || state.previewFrame !== null) {
        return;
      }

      const pausedActiveWindow = getTransitionWindowForFrame(state.currentFrame);
      const pausedPrewarmStartFrame = pausedActiveWindow?.startFrame
        ?? getPausedTransitionPrewarmStartFrame(state.currentFrame);
      if (pausedPrewarmStartFrame !== null) {
        if (forceFastScrubOverlay) {
          const tw = pausedActiveWindow ?? getTransitionWindowByStartFrame(pausedPrewarmStartFrame);
          if (tw) {
            pinTransitionPlaybackSession(tw);
            if (lastPausedPrearmTargetRef.current !== pausedPrewarmStartFrame) {
              void (async () => {
                const mainRenderer = await ensureFastScrubRenderer();
                if (mainRenderer && 'prewarmItems' in mainRenderer) {
                  await mainRenderer.prewarmItems?.(
                    [tw.leftClip.id, tw.rightClip.id],
                    tw.startFrame,
                  );
                }
                runBatchPreseek(collectClipVideoSourceTimesBySrcForFrame(
                  [tw.leftClip, tw.rightClip],
                  tw.startFrame,
                  fps,
                  { requireExplicitSourceFps: true },
                ));
                if (!usePlaybackStore.getState().isPlaying && mainRenderer) {
                  const preRenderCount = Math.min(playbackTransitionPrerenderRunwayFrames, tw.endFrame - tw.startFrame);
                  for (let fi = 0; fi < preRenderCount; fi++) {
                    if (usePlaybackStore.getState().isPlaying) break;
                    const frame = tw.startFrame + fi;
                    try {
                      await mainRenderer.renderFrame(frame);
                      if ('getCanvas' in mainRenderer) {
                        const srcCanvas = (mainRenderer as { getCanvas: () => OffscreenCanvas }).getCanvas();
                        const snapshot = new OffscreenCanvas(srcCanvas.width, srcCanvas.height);
                        const snapshotCtx = snapshot.getContext('2d');
                        if (snapshotCtx) {
                          snapshotCtx.drawImage(srcCanvas, 0, 0);
                          transitionSessionBufferedFramesRef.current.set(frame, snapshot);
                        }
                      }
                    } catch { break; }
                  }
                }
              })();
            }
          }
        } else if (pausedActiveWindow) {
          const tw = pausedActiveWindow;
          pinTransitionPlaybackSession(tw);
          scrubRequestedFrameRef.current = state.currentFrame;
          void pumpRenderLoop();
        } else {
          schedulePlaybackTransitionPrepare(pausedPrewarmStartFrame);
        }

        if (lastPausedPrearmTargetRef.current !== pausedPrewarmStartFrame) {
          lastPausedPrearmTargetRef.current = pausedPrewarmStartFrame;
          pushTransitionTrace('paused_prearm', {
            targetFrame: pausedPrewarmStartFrame,
          });
        }
        return;
      }

      if (prev.currentFrame !== state.currentFrame || prev.isPlaying !== state.isPlaying) {
        lastPausedPrearmTargetRef.current = null;
        schedulePlaybackTransitionPrepare(null);
        // Don't clear the session when stepping out of a paused transition
        // frame — handleScrubTargetUpdate needs the session to render the
        // post-transition frame on the overlay before handing off to the
        // Player. The session will be cleared there after the handoff.
        const wasOnTransition = !prev.isPlaying && getTransitionWindowForFrame(prev.currentFrame) !== null;
        if (!wasOnTransition) {
          clearTransitionPlaybackSession();
        }
      }
    };

    const handleScrubTargetUpdate = (
      state: PlaybackStoreSnapshot,
      prev: PlaybackStoreSnapshot,
    ) => {
      if (shouldPreferPlayerForPreview(state.previewFrame)) {
        resetScrubLoopState();
        hideAllOverlays();
        return;
      }

      if (state.isPlaying && !forceFastScrubOverlay) {
        resetScrubLoopState();
        const playbackTransitionState = getPlaybackTransitionStateForFrame(state.currentFrame);
        if (playbackTransitionState.shouldPrewarm) {
          void ensureFastScrubRenderer();
          if (!playbackTransitionState.hasActiveTransition && playbackTransitionState.nextTransitionStartFrame !== null) {
            schedulePlaybackTransitionPrepare(playbackTransitionState.nextTransitionStartFrame);
          }
        }
        if (!(playbackTransitionState.hasActiveTransition || playbackTransitionState.shouldHoldOverlay)) {
          if (!playbackTransitionState.shouldPrewarm) {
            clearTransitionPlaybackSession();
          }
          hideAllOverlays();
          return;
        }
        clearPendingFastScrubHandoff();
        if (showFastScrubOverlayRef.current) {
          hideFastScrubOverlay();
        }
        if (tryShowPreparedPlaybackTransitionOverlay(state.currentFrame)) {
          return;
        }
        if (playbackTransitionState.hasActiveTransition) {
          const trace = transitionSessionTraceRef.current;
          if (trace && trace.lastEntryMissFrame !== state.currentFrame) {
            trace.entryMisses += 1;
            trace.lastEntryMissFrame = state.currentFrame;
            pushTransitionTrace('entry_miss', {
              opId: trace.opId,
              frame: state.currentFrame,
              bufferedFrames: transitionSessionBufferedFramesRef.current.size,
            });
          }
        }
        scrubRequestedFrameRef.current = state.currentFrame;
        void pumpRenderLoop();
        return;
      }

      const isPausedInsideTransition = isPausedTransitionOverlayActive(state.currentFrame, state);
      const prevIsPausedInsideTransition = isPausedTransitionOverlayActive(prev.currentFrame, prev);
      const targetFrame = resolveRenderPumpTargetFrame({
        state,
        forceFastScrubOverlay,
        isPausedInsideTransition,
      });
      const prevTargetFrame = resolveRenderPumpTargetFrame({
        state: prev,
        forceFastScrubOverlay,
        isPausedInsideTransition: prevIsPausedInsideTransition,
      });
      const playStateChanged = state.isPlaying !== prev.isPlaying;
      const isAtomicScrubTarget = isAtomicPreviewTarget(state);

      if (targetFrame === prevTargetFrame && !playStateChanged) return;

      const scrubDirectionPlan = resolveScrubDirectionPlan({
        state,
        prev,
        targetFrame,
        prevTargetFrame,
      });
      scrubDirectionRef.current = scrubDirectionPlan.direction;
      previewPerfRef.current.scrubUpdates += scrubDirectionPlan.scrubUpdates;
      previewPerfRef.current.scrubDroppedFrames += scrubDirectionPlan.scrubDroppedFrames;

      if (targetFrame !== null && scrubRendererRef.current && 'getScrubbingCache' in scrubRendererRef.current) {
        scrubRendererRef.current.getScrubbingCache()?.setEvictionHint(
          targetFrame,
          scrubDirectionRef.current,
        );
      }

      const preserveHighFidelityBackwardPreview = shouldPreserveHighFidelityBackwardPreview(
        targetFrame,
      );
      const backwardScrubFlags = resolveBackwardScrubFlags({
        scrubDirection: scrubDirectionRef.current,
        forceFastScrubOverlay,
        isAtomicScrubTarget,
        preserveHighFidelityBackwardPreview,
      });
      if (backwardScrubFlags.suppressBackgroundPrewarm !== suppressScrubBackgroundPrewarmRef.current) {
        suppressScrubBackgroundPrewarmRef.current = backwardScrubFlags.suppressBackgroundPrewarm;
        clearPrewarmQueue();
      }
      if (backwardScrubFlags.fallbackToPlayer !== fallbackToPlayerScrubRef.current) {
        fallbackToPlayerScrubRef.current = backwardScrubFlags.fallbackToPlayer;
        scrubRequestedFrameRef.current = null;
        clearPrewarmQueue();
        if (backwardScrubFlags.fallbackToPlayer) {
          hideAllOverlays();
        }
      }
      if (fallbackToPlayerScrubRef.current && targetFrame !== null) {
        hideAllOverlays();
        return;
      }

      if (targetFrame === null) {
        resetScrubLoopState();
        clearPendingFastScrubHandoff();
        bypassPreviewSeekRef.current = false;

        // When leaving a transition frame (e.g. 12714â†’12715), the
        // StableVideoSequence pool lane needs time to re-seek from the
        // stabilized left clip position to the right clip. Render this
        // frame on the fast-scrub overlay so the Player isn't revealed
        // until it has caught up.
        if (prevIsPausedInsideTransition && !isPausedInsideTransition) {
          scrubRequestedFrameRef.current = state.currentFrame;
          void pumpRenderLoop();
          playerRef.current?.seekTo(state.currentFrame);
          beginFastScrubHandoff(state.currentFrame);
          scheduleFastScrubHandoffCheck();
          return;
        }

        try {
          const playerFrame = playerRef.current?.getCurrentFrame();
          const roundedFrame = Number.isFinite(playerFrame)
            ? Math.round(playerFrame as number)
            : null;
          if (roundedFrame === state.currentFrame) {
            playerRef.current?.seekTo(state.currentFrame);
            hideAllOverlays();
            return;
          }
          if (showFastScrubOverlayRef.current && roundedFrame !== state.currentFrame) {
            beginFastScrubHandoff(state.currentFrame);
          }
          if (roundedFrame !== state.currentFrame) {
            trackPlayerSeek(state.currentFrame);
          }
          playerRef.current?.seekTo(state.currentFrame);
          if (!maybeCompleteFastScrubHandoff()) {
            if (pendingFastScrubHandoffFrameRef.current !== null) {
              scheduleFastScrubHandoffCheck();
            } else {
              hideAllOverlays();
            }
          }
        } catch {
          hideAllOverlays();
        }
        return;
      }

      clearPendingFastScrubHandoff();
      if (scrubRequestedFrameRef.current === targetFrame) {
        return;
      }

      const backwardScrubFramePlan = resolveBackwardScrubFramePlan({
        targetFrame,
        scrubDirection: scrubDirectionRef.current,
        isAtomicScrubTarget,
        preserveHighFidelityBackwardPreview,
        nowMs: performance.now(),
        lastBackwardScrubRenderAt: lastBackwardScrubRenderAtRef.current,
        lastBackwardRequestedFrame: lastBackwardRequestedFrameRef.current,
      });
      if (backwardScrubFramePlan.throttleRequest) {
        return;
      }
      lastBackwardScrubRenderAtRef.current = backwardScrubFramePlan.nextLastBackwardScrubRenderAt;
      lastBackwardRequestedFrameRef.current = backwardScrubFramePlan.nextLastBackwardRequestedFrame;

      // Render-pump invariant: scrub updates never force-unlock. They only
      // replace the requested frame and let the current owner pick it up on
      // the next loop iteration, which prevents concurrent pumps.
      clearPrewarmQueue();
      scrubRequestedFrameRef.current = backwardScrubFramePlan.requestedFrame;
      if (playbackRafId === null && !playbackPrewarmInFlight) {
        void pumpRenderLoop();
      }
    };

    const unsubscribe = usePlaybackStore.subscribe((state, prev) => {
      handleLargeJumpPreseek(state, prev);
      handlePlaybackLifecycleUpdate(state, prev);
      handleActivePlaybackTransitionMaintenance(state);
      handlePausedVariableSpeedPrewarm(state, prev);
      handlePausedTransitionPrewarm(state, prev);
      handleScrubTargetUpdate(state, prev);
    });
    // During gizmo drags or live preview changes, trigger re-renders even when
    // the frame is unchanged so the fast-scrub overlay does not reuse a stale
    // cached bitmap for the current frame.
    const unsubscribeGizmo = useGizmoStore.subscribe((state, prev) => {
      if (shouldPreferPlayerForPreview(usePlaybackStore.getState().previewFrame)) return;
      // Without forceFastScrubOverlay, gizmo previews (transform, crop, etc.)
      // are handled by the DOM Player through React props. Activating the
      // overlay here would switch from browser video seek (±1 frame) to
      // mediabunny (exact), causing a visible frame shift — especially at
      // soft-edge crop boundaries where the content difference is amplified.
      if (!forceFastScrubOverlay) return;
      const unifiedPreviewChanged = state.preview !== prev.preview;
      const transformPreviewChanged = state.previewTransform !== prev.previewTransform;
      // Gizmo transform changes require an active gizmo; effect preview changes don't.
      if (!unifiedPreviewChanged && !(transformPreviewChanged && state.activeGizmo)) return;

      const playbackState = usePlaybackStore.getState();
      const currentFrame = playbackState.currentFrame;

      // Preview-only changes don't advance the frame number, so the frame
      // cache would otherwise return the stale bitmap for the current frame.
      // Invalidate before requesting a repaint so gizmo resize/translate and
      // live panel previews re-composite immediately.
      if ((unifiedPreviewChanged || transformPreviewChanged) && scrubRendererRef.current) {
        scrubRendererRef.current.invalidateFrameCache({ frames: [currentFrame] });
      }

      scrubRequestedFrameRef.current = currentFrame;
      void pumpRenderLoop();
    });

    // During corner pin drag, re-render with the live preview values so the
    // scrub overlay reflects the warp in real-time instead of waiting for commit.
    const unsubscribeCornerPin = useCornerPinStore.subscribe((state, prev) => {
      if (state.previewCornerPin === prev.previewCornerPin) return;
      const playbackState = usePlaybackStore.getState();
      if (!forceFastScrubOverlay && !isPausedTransitionOverlayActive(playbackState.currentFrame, playbackState)) return;

      const currentFrame = playbackState.currentFrame;
      if (scrubRendererRef.current) {
        scrubRendererRef.current.invalidateFrameCache({ frames: [currentFrame] });
      }
      scrubRequestedFrameRef.current = currentFrame;
      void pumpRenderLoop();
    });

    const unsubscribeMaskEditor = useMaskEditorStore.subscribe((state, prev) => {
      const previewVerticesChanged = state.previewVertices !== prev.previewVertices;
      const editingItemChanged = state.editingItemId !== prev.editingItemId;
      if (!previewVerticesChanged && !editingItemChanged) return;

      const playbackState = usePlaybackStore.getState();
      if (shouldPreferPlayerForPreview(playbackState.previewFrame)) return;
      const targetFrame = playbackState.previewFrame ?? playbackState.currentFrame;
      if (!forceFastScrubOverlay && playbackState.previewFrame === null && !isPausedTransitionOverlayActive(targetFrame, playbackState)) return;

      if (scrubRendererRef.current) {
        scrubRendererRef.current.invalidateFrameCache({ frames: [targetFrame] });
      }
      scrubRequestedFrameRef.current = targetFrame;
      void pumpRenderLoop();
    });

    const initialPlaybackState = usePlaybackStore.getState();
    if (initialPlaybackState.isPlaying && forceFastScrubOverlay) {
      // Check if playback starts inside an active transition — pin that
      // session immediately so the render pump has the DOM video provider.
      const activeWindow = getTransitionWindowForFrame(initialPlaybackState.currentFrame);
      if (activeWindow) {
        pinTransitionPlaybackSession(activeWindow);
        lastPlayingPrearmTargetRef.current = activeWindow.startFrame;
      } else {
        const prearmStartFrame = getPlayingAnyTransitionPrewarmStartFrame(initialPlaybackState.currentFrame);
        if (prearmStartFrame !== null) {
          lastPlayingPrearmTargetRef.current = prearmStartFrame;
          const transitionWindow = getTransitionWindowByStartFrame(prearmStartFrame);
          if (transitionWindow) {
            pinTransitionPlaybackSession(transitionWindow);
          }
        }
      }
    }
    if (!initialPlaybackState.isPlaying && initialPlaybackState.previewFrame === null) {
      const initialPausedActiveWindow = getTransitionWindowForFrame(initialPlaybackState.currentFrame);
      const pausedPrewarmStartFrame = initialPausedActiveWindow?.startFrame
        ?? getPausedTransitionPrewarmStartFrame(initialPlaybackState.currentFrame);
      if (pausedPrewarmStartFrame !== null) {
        lastPausedPrearmTargetRef.current = pausedPrewarmStartFrame;
        if (forceFastScrubOverlay) {
          // Pre-render the transition start frame using a DEDICATED background
          // renderer (separate canvas + decoders). This doesn't hold
          // scrubRenderInFlightRef and doesn't conflict with the rAF pump.
          // The rAF pump checks transitionSessionBufferedFramesRef and presents
          // the pre-rendered frame instantly (0ms vs 180-240ms first-frame stall).
          const tw = getTransitionWindowByStartFrame(pausedPrewarmStartFrame);
          if (tw) {
            pinTransitionPlaybackSession(tw);
            void (async () => {
              // Warm main renderer's decoders
              const mainRenderer = await ensureFastScrubRenderer();
              if (mainRenderer && 'prewarmItems' in mainRenderer) {
                await mainRenderer.prewarmItems?.(
                  [tw.leftClip.id, tw.rightClip.id],
                  tw.startFrame,
                );
              }
              // Pre-render via background renderer (separate instance)
              if (bgTransitionRenderInFlightRef.current) return;
              bgTransitionRenderInFlightRef.current = true;
              try {
                const bgRenderer = await ensureBgTransitionRenderer();
                if (bgRenderer && !usePlaybackStore.getState().isPlaying) {
                  await bgRenderer.renderFrame(tw.startFrame);
                  cacheTransitionSessionFrame(tw.startFrame);
                  pushTransitionTrace('bg_prerender', { frame: tw.startFrame });
                }
              } catch (error) {
                logger.debug('Background transition pre-render failed:', error);
              } finally {
                bgTransitionRenderInFlightRef.current = false;
              }
            })();
          }
        } else if (initialPausedActiveWindow) {
          // Paused INSIDE a transition on initial mount — pin session and
          // render so the GPU transition is visible without forceFastScrubOverlay.
          pinTransitionPlaybackSession(initialPausedActiveWindow);
        } else {
          schedulePlaybackTransitionPrepare(pausedPrewarmStartFrame);
        }
        pushTransitionTrace('paused_prearm', {
          targetFrame: pausedPrewarmStartFrame,
        });
      }
    }

    // Paused inside a transition on initial mount — trigger a render so
    // the GPU transition is visible without forceFastScrubOverlay.
    if (isPausedTransitionOverlayActive(initialPlaybackState.currentFrame, initialPlaybackState)) {
      scrubRequestedFrameRef.current = initialPlaybackState.currentFrame;
      void pumpRenderLoop();
    }

    if (
      !initialPlaybackState.isPlaying
      && initialPlaybackState.previewFrame !== null
      && !forceFastScrubOverlay
      && !shouldPreferPlayerForPreview(initialPlaybackState.previewFrame)
    ) {
      const previewTransitionState = getPlaybackTransitionStateForFrame(initialPlaybackState.previewFrame);
      if (
        previewTransitionState.shouldPrewarm
        && !previewTransitionState.hasActiveTransition
        && previewTransitionState.nextTransitionStartFrame !== null
      ) {
        schedulePlaybackTransitionPrepare(previewTransitionState.nextTransitionStartFrame);
      }
      scrubRequestedFrameRef.current = initialPlaybackState.previewFrame;
      void pumpRenderLoop();
    } else if (forceFastScrubOverlay) {
      const playbackState = usePlaybackStore.getState();
      const playbackTransitionState = getPlaybackTransitionStateForFrame(playbackState.currentFrame);
      if (playbackState.isPlaying && playbackTransitionState.shouldPrewarm && playbackTransitionState.nextTransitionStartFrame !== null) {
        if (forceFastScrubOverlay) {
          // Non-blocking prewarm path
          const tw = getTransitionWindowByStartFrame(playbackTransitionState.nextTransitionStartFrame);
          if (tw) {
            pinTransitionPlaybackSession(tw);
            const renderer = scrubRendererRef.current;
            if (renderer && 'prewarmItems' in renderer) {
              void renderer.prewarmItems?.(
                [tw.leftClip.id, tw.rightClip.id],
                tw.startFrame,
              );
            }
          }
        } else {
          schedulePlaybackTransitionPrepare(playbackTransitionState.nextTransitionStartFrame);
        }
      }
      const initialFrame = playbackState.previewFrame ?? playbackState.currentFrame;
      scrubRequestedFrameRef.current = initialFrame;
      void pumpRenderLoop();
      // Start rAF pump if already playing
      if (playbackState.isPlaying && forceFastScrubOverlay && playbackRafId === null) {
        playbackRafId = requestAnimationFrame(playbackRafPump);
      }
    } else if (usePlaybackStore.getState().isPlaying && !forceFastScrubOverlay) {
      const playbackState = usePlaybackStore.getState();
      const playbackTransitionState = getPlaybackTransitionStateForFrame(playbackState.currentFrame);
      if (playbackTransitionState.shouldPrewarm) {
        void ensureFastScrubRenderer();
        if (!playbackTransitionState.hasActiveTransition && playbackTransitionState.nextTransitionStartFrame !== null) {
          schedulePlaybackTransitionPrepare(playbackTransitionState.nextTransitionStartFrame);
        }
      }
      if (playbackTransitionState.hasActiveTransition || playbackTransitionState.shouldHoldOverlay) {
        if (!tryShowPreparedPlaybackTransitionOverlay(playbackState.currentFrame)) {
          if (playbackTransitionState.hasActiveTransition) {
            const trace = transitionSessionTraceRef.current;
            if (trace && trace.lastEntryMissFrame !== playbackState.currentFrame) {
              trace.entryMisses += 1;
              trace.lastEntryMissFrame = playbackState.currentFrame;
              pushTransitionTrace('entry_miss', {
                opId: trace.opId,
                frame: playbackState.currentFrame,
                bufferedFrames: transitionSessionBufferedFramesRef.current.size,
              });
            }
          }
          scrubRequestedFrameRef.current = playbackState.currentFrame;
          void pumpRenderLoop();
        }
      } else {
        if (!playbackTransitionState.shouldPrewarm) {
          clearTransitionPlaybackSession();
        }
        hideAllOverlays();
      }
    } else if (shouldPreferPlayerForPreview(usePlaybackStore.getState().previewFrame)) {
      clearTransitionPlaybackSession();
      hideAllOverlays();
    } else if (usePlaybackStore.getState().previewFrame === null) {
      clearTransitionPlaybackSession();
      hideAllOverlays();
    }

    return () => {
      scrubMountedRef.current = false;
      resetScrubLoopState();
      clearPendingFastScrubHandoff();
      clearScheduledTransitionPrepare();
      clearTransitionPlaybackSession();
      hideAllOverlays();
      if (playbackRafId !== null) {
        cancelAnimationFrame(playbackRafId);
        playbackRafId = null;
      }
      resumeScrubLoopRef.current = () => {};
      unsubscribe();
      unsubscribeGizmo();
      unsubscribeCornerPin();
      unsubscribeMaskEditor();
    };
  }, [
    disposeFastScrubRenderer,
    ensureFastScrubRenderer,
    fastScrubBoundaryFrames,
    fastScrubBoundarySources,
    forceFastScrubOverlay,
    fps,
    clearPendingFastScrubHandoff,
    clearTransitionPlaybackSession,
    getPausedTransitionPrewarmStartFrame,
    getPinnedTransitionElementForItem,
    getTransitionWindowForFrame,
    hideFastScrubOverlay,
    hidePlaybackTransitionOverlay,
    isPausedTransitionOverlayActive,
    pinTransitionPlaybackSession,
    preparePlaybackTransitionFrame,
    showPlaybackTransitionOverlayForFrame,
    beginFastScrubHandoff,
    maybeCompleteFastScrubHandoff,
    scheduleFastScrubHandoffCheck,
    playbackTransitionCooldownFrames,
    playbackTransitionLookaheadFrames,
    playbackTransitionOverlayWindows,
    pushTransitionTrace,
    setDisplayedFrame,
    shouldPreferPlayerForPreview,
    trackPlayerSeek,
  ]);
}
