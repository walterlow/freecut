import { useCallback, type MutableRefObject } from 'react';
import type { TimelineItem } from '@/types/timeline';
import type { ResolvedTransitionWindow } from '@/core/timeline/transitions/transition-planner';
import { usePlaybackStore } from '@/shared/state/playback';
import {
  getBestDomVideoElementForItem,
  transitionSafePlay,
  snapSourceTime,
} from '@/features/preview/deps/composition-runtime';
import { createLogger, createOperationId } from '@/shared/logging/logger';

const logger = createLogger('VideoPreview');

type TransitionPreviewEvent = {
  success: (payload: Record<string, unknown>) => void;
};

export type TransitionPreviewSessionTrace = {
  opId: string;
  event: TransitionPreviewEvent;
  startedAtMs: number;
  startFrame: number;
  endFrame: number;
  mode: 'dom' | 'render';
  complex: boolean;
  leftClipId: string;
  rightClipId: string;
  leftSpeed: number;
  rightSpeed: number;
  leftHasEffects: boolean;
  rightHasEffects: boolean;
  prepareStartedAtMs: number | null;
  firstPreparedAtMs: number | null;
  enteredAtMs: number | null;
  exitedAtMs: number | null;
  lastPrepareMs: number;
  lastPreparedFrame: number;
  bufferedFramesPeak: number;
  entryMisses: number;
  lastEntryMissFrame: number | null;
};

export type TransitionPreviewTelemetry = {
  sessionCount: number;
  lastPrepareMs: number;
  lastReadyLeadMs: number;
  lastEntryMisses: number;
  lastSessionDurationMs: number;
};

type TransitionRenderer = {
  renderFrame: (frame: number) => Promise<void>;
  prewarmFrame: (frame: number) => Promise<void>;
  setDomVideoElementProvider?: (provider: (itemId: string) => HTMLVideoElement | null) => void;
};

interface UsePreviewTransitionSessionControllerParams {
  fps: number;
  forceFastScrubOverlay: boolean;
  pausedTransitionPrearmFrames: number;
  playingComplexTransitionPrearmFrames: number;
  playbackTransitionWindows: ResolvedTransitionWindow<TimelineItem>[];
  playbackTransitionComplexStartFrames: Set<number>;
  playbackTransitionPrerenderRunwayFrames: number;
  playbackTransitionCooldownFrames: number;
  transitionWindowUsesDomProvider: (window: ResolvedTransitionWindow<TimelineItem> | null) => boolean;
  getTransitionWindowByStartFrame: (startFrame: number) => ResolvedTransitionWindow<TimelineItem> | null;
  getActiveTransitionWindowForFrame: (frame: number) => ResolvedTransitionWindow<TimelineItem> | null;
  pushTransitionTrace: (phase: string, data?: Record<string, unknown>) => void;
  ensureFastScrubRendererRef: MutableRefObject<() => Promise<TransitionRenderer | null>>;
  scrubMountedRef: MutableRefObject<boolean>;
  scrubRenderInFlightRef: MutableRefObject<boolean>;
  scrubRequestedFrameRef: MutableRefObject<number | null>;
  scrubOffscreenCanvasRef: MutableRefObject<OffscreenCanvas | null>;
  scrubOffscreenRenderedFrameRef: MutableRefObject<number | null>;
  resumeScrubLoopRef: MutableRefObject<() => void>;
  playbackTransitionPreparePromiseRef: MutableRefObject<Promise<boolean> | null>;
  playbackTransitionPreparingFrameRef: MutableRefObject<number | null>;
  transitionSessionWindowRef: MutableRefObject<ResolvedTransitionWindow<TimelineItem> | null>;
  transitionSessionPinnedElementsRef: MutableRefObject<Map<string, HTMLVideoElement | null>>;
  transitionExitElementsRef: MutableRefObject<Map<string, HTMLVideoElement | null>>;
  transitionSessionStallCountRef: MutableRefObject<Map<string, { ct: number; count: number }>>;
  transitionSessionBufferedFramesRef: MutableRefObject<Map<number, OffscreenCanvas>>;
  transitionPrewarmPromiseRef: MutableRefObject<Promise<void> | null>;
  transitionSessionTraceRef: MutableRefObject<TransitionPreviewSessionTrace | null>;
  transitionTelemetryRef: MutableRefObject<TransitionPreviewTelemetry>;
}

export function usePreviewTransitionSessionController({
  fps,
  forceFastScrubOverlay,
  pausedTransitionPrearmFrames,
  playingComplexTransitionPrearmFrames,
  playbackTransitionWindows,
  playbackTransitionComplexStartFrames,
  playbackTransitionPrerenderRunwayFrames,
  playbackTransitionCooldownFrames,
  transitionWindowUsesDomProvider,
  getTransitionWindowByStartFrame,
  getActiveTransitionWindowForFrame,
  pushTransitionTrace,
  ensureFastScrubRendererRef,
  scrubMountedRef,
  scrubRenderInFlightRef,
  scrubRequestedFrameRef,
  scrubOffscreenCanvasRef,
  scrubOffscreenRenderedFrameRef,
  resumeScrubLoopRef,
  playbackTransitionPreparePromiseRef,
  playbackTransitionPreparingFrameRef,
  transitionSessionWindowRef,
  transitionSessionPinnedElementsRef,
  transitionExitElementsRef,
  transitionSessionStallCountRef,
  transitionSessionBufferedFramesRef,
  transitionPrewarmPromiseRef,
  transitionSessionTraceRef,
  transitionTelemetryRef,
}: UsePreviewTransitionSessionControllerParams) {
  const clearTransitionPlaybackSession = useCallback(() => {
    const activeTrace = transitionSessionTraceRef.current;
    if (activeTrace) {
      const finishedAtMs = performance.now();
      activeTrace.exitedAtMs = finishedAtMs;
      transitionTelemetryRef.current.lastPrepareMs = activeTrace.lastPrepareMs;
      transitionTelemetryRef.current.lastEntryMisses = activeTrace.entryMisses;
      transitionTelemetryRef.current.lastSessionDurationMs = Math.max(0, finishedAtMs - activeTrace.startedAtMs);
      transitionTelemetryRef.current.lastReadyLeadMs = (
        activeTrace.enteredAtMs !== null && activeTrace.firstPreparedAtMs !== null
      )
        ? Math.max(0, activeTrace.enteredAtMs - activeTrace.firstPreparedAtMs)
        : 0;
      activeTrace.event.success({
        startFrame: activeTrace.startFrame,
        endFrame: activeTrace.endFrame,
        mode: activeTrace.mode,
        complex: activeTrace.complex,
        leftClipId: activeTrace.leftClipId,
        rightClipId: activeTrace.rightClipId,
        leftSpeed: activeTrace.leftSpeed,
        rightSpeed: activeTrace.rightSpeed,
        leftHasEffects: activeTrace.leftHasEffects,
        rightHasEffects: activeTrace.rightHasEffects,
        prepareMs: activeTrace.lastPrepareMs,
        preparedFrame: activeTrace.lastPreparedFrame,
        bufferedFramesPeak: activeTrace.bufferedFramesPeak,
        entryMisses: activeTrace.entryMisses,
        readyLeadMs: transitionTelemetryRef.current.lastReadyLeadMs,
        sessionDurationMs: transitionTelemetryRef.current.lastSessionDurationMs,
      });
      pushTransitionTrace('session_end', {
        opId: activeTrace.opId,
        mode: activeTrace.mode,
        complex: activeTrace.complex,
        startFrame: activeTrace.startFrame,
        endFrame: activeTrace.endFrame,
        prepareMs: activeTrace.lastPrepareMs,
        preparedFrame: activeTrace.lastPreparedFrame,
        bufferedFramesPeak: activeTrace.bufferedFramesPeak,
        entryMisses: activeTrace.entryMisses,
        readyLeadMs: transitionTelemetryRef.current.lastReadyLeadMs,
        sessionDurationMs: transitionTelemetryRef.current.lastSessionDurationMs,
      });
      transitionSessionTraceRef.current = null;
    }

    const window = transitionSessionWindowRef.current;
    if (window) {
      const currentFrame = usePlaybackStore.getState().currentFrame;
      for (const clip of [window.leftClip, window.rightClip]) {
        if (clip.type !== 'video') continue;
        const el = transitionSessionPinnedElementsRef.current.get(clip.id);
        if (!el) continue;
        const localFrame = currentFrame - clip.from;
        if (localFrame < 0) continue;
        if (localFrame >= clip.durationInFrames) continue;
        const sourceStart = clip.sourceStart ?? clip.trimStart ?? 0;
        const sourceFps = clip.sourceFps ?? fps;
        const clipSpeed = clip.speed ?? 1;
        const targetTime = snapSourceTime((sourceStart / sourceFps) + (localFrame * clipSpeed / fps), sourceFps);
        const videoDuration = el.duration || Infinity;
        const clamped = Math.min(Math.max(0, targetTime), videoDuration - 0.05);
        const drift = Math.abs(el.currentTime - clamped);
        if (drift > 0.15) {
          try {
            el.currentTime = clamped;
          } catch {
            // Element may be settling — ignore transient seek failures.
          }
        } else if (drift > 0.016) {
          el.playbackRate = clipSpeed;
        }
      }
    }

    transitionSessionWindowRef.current = null;
    for (const el of transitionSessionPinnedElementsRef.current.values()) {
      if (el) delete el.dataset.transitionHold;
    }
    transitionExitElementsRef.current = new Map(transitionSessionPinnedElementsRef.current);
    transitionSessionPinnedElementsRef.current.clear();
    transitionSessionStallCountRef.current.clear();
    transitionSessionBufferedFramesRef.current.clear();
    transitionPrewarmPromiseRef.current = null;
  }, [
    fps,
    pushTransitionTrace,
    transitionExitElementsRef,
    transitionPrewarmPromiseRef,
    transitionSessionBufferedFramesRef,
    transitionSessionPinnedElementsRef,
    transitionSessionStallCountRef,
    transitionSessionTraceRef,
    transitionSessionWindowRef,
    transitionTelemetryRef,
  ]);

  const pinTransitionPlaybackSession = useCallback((window: ResolvedTransitionWindow<TimelineItem> | null) => {
    if (!window) {
      clearTransitionPlaybackSession();
      return null;
    }

    const activeWindow = transitionSessionWindowRef.current;
    if (activeWindow?.transition.id === window.transition.id && activeWindow.startFrame === window.startFrame) {
      return activeWindow;
    }

    clearTransitionPlaybackSession();

    transitionSessionWindowRef.current = window;
    const opId = createOperationId();
    const event = logger.startEvent('preview_transition_session', opId) as TransitionPreviewEvent;
    const leftSpeed = window.leftClip.speed ?? 1;
    const rightSpeed = window.rightClip.speed ?? 1;
    const leftHasEffects = Boolean(window.leftClip.effects?.some((effect) => effect.enabled));
    const rightHasEffects = Boolean(window.rightClip.effects?.some((effect) => effect.enabled));
    const mode = transitionWindowUsesDomProvider(window) ? 'dom' : 'render';
    const complex = mode === 'render';
    transitionTelemetryRef.current.sessionCount += 1;
    transitionSessionTraceRef.current = {
      opId,
      event,
      startedAtMs: performance.now(),
      startFrame: window.startFrame,
      endFrame: window.endFrame,
      mode,
      complex,
      leftClipId: window.leftClip.id,
      rightClipId: window.rightClip.id,
      leftSpeed,
      rightSpeed,
      leftHasEffects,
      rightHasEffects,
      prepareStartedAtMs: null,
      firstPreparedAtMs: null,
      enteredAtMs: null,
      exitedAtMs: null,
      lastPrepareMs: 0,
      lastPreparedFrame: -1,
      bufferedFramesPeak: 0,
      entryMisses: 0,
      lastEntryMissFrame: null,
    };
    pushTransitionTrace('session_start', {
      opId,
      mode,
      complex,
      startFrame: window.startFrame,
      endFrame: window.endFrame,
      leftClipId: window.leftClip.id,
      rightClipId: window.rightClip.id,
      leftSpeed,
      rightSpeed,
      leftHasEffects,
      rightHasEffects,
    });
    const isPlaying = usePlaybackStore.getState().isPlaying;
    const pinnedElements = new Map<string, HTMLVideoElement | null>();
    for (const clip of [window.leftClip, window.rightClip]) {
      const el = getBestDomVideoElementForItem(clip.id);
      pinnedElements.set(clip.id, el);
      if (el && isPlaying) {
        el.dataset.transitionHold = '1';
        const clipSpeed = clip.speed ?? 1;
        if (el.readyState >= 2) {
          transitionSafePlay(el, clipSpeed);
        } else {
          const onCanPlay = () => {
            el.removeEventListener('canplay', onCanPlay);
            if (el.dataset.transitionHold === '1' && el.paused) {
              transitionSafePlay(el, clipSpeed);
            }
          };
          el.addEventListener('canplay', onCanPlay, { once: true });
        }
      }
    }
    transitionSessionPinnedElementsRef.current = pinnedElements;
    transitionSessionBufferedFramesRef.current.clear();
    return window;
  }, [
    clearTransitionPlaybackSession,
    pushTransitionTrace,
    transitionSessionBufferedFramesRef,
    transitionSessionPinnedElementsRef,
    transitionSessionTraceRef,
    transitionSessionWindowRef,
    transitionTelemetryRef,
    transitionWindowUsesDomProvider,
  ]);

  const getPinnedTransitionElementForItem = useCallback((itemId: string) => {
    const sessionWindow = transitionSessionWindowRef.current;
    const isSessionParticipant = sessionWindow?.leftClip.id === itemId || sessionWindow?.rightClip.id === itemId;
    if (!isSessionParticipant) {
      const registryEl = getBestDomVideoElementForItem(itemId);
      if (registryEl) {
        transitionExitElementsRef.current.delete(itemId);
        return registryEl;
      }
      const exitEl = transitionExitElementsRef.current.get(itemId);
      if (exitEl?.isConnected && exitEl.readyState >= 2) {
        return exitEl;
      }
      transitionExitElementsRef.current.delete(itemId);
      return null;
    }

    const isPlaying = usePlaybackStore.getState().isPlaying;
    if (!isPlaying && !transitionWindowUsesDomProvider(sessionWindow ?? null)) {
      return null;
    }

    const clipSpeed = (
      sessionWindow?.leftClip.id === itemId ? (sessionWindow.leftClip.speed ?? 1)
        : sessionWindow?.rightClip.id === itemId ? (sessionWindow.rightClip.speed ?? 1)
          : 1
    );

    const ensurePlaying = (el: HTMLVideoElement) => {
      if (isPlaying) {
        el.dataset.transitionHold = '1';
        transitionSafePlay(el, clipSpeed);
      }
    };

    const pinned = transitionSessionPinnedElementsRef.current.get(itemId) ?? null;
    if (pinned && pinned.isConnected && pinned.readyState >= 2 && pinned.videoWidth > 0) {
      ensurePlaying(pinned);
      return pinned;
    }

    const next = getBestDomVideoElementForItem(itemId);
    if (pinned && pinned !== next) {
      delete pinned.dataset.transitionHold;
    }
    if (next && next.readyState >= 2) {
      ensurePlaying(next);
    }
    transitionSessionPinnedElementsRef.current.set(itemId, next);
    return next;
  }, [
    transitionExitElementsRef,
    transitionSessionPinnedElementsRef,
    transitionSessionWindowRef,
    transitionWindowUsesDomProvider,
  ]);

  const getUpcomingTransitionStartFrame = useCallback((
    frame: number,
    maxLookaheadFrames: number,
    options?: { complexOnly?: boolean },
  ) => {
    const nextWindow = playbackTransitionWindows.find((window) => {
      if (frame > window.startFrame) {
        return false;
      }
      if (options?.complexOnly && !playbackTransitionComplexStartFrames.has(window.startFrame)) {
        return false;
      }
      return true;
    });
    if (!nextWindow) return null;
    if ((nextWindow.startFrame - frame) > maxLookaheadFrames) {
      return null;
    }
    return nextWindow.startFrame;
  }, [playbackTransitionComplexStartFrames, playbackTransitionWindows]);

  const getPausedTransitionPrewarmStartFrame = useCallback((frame: number) => {
    return getUpcomingTransitionStartFrame(frame, pausedTransitionPrearmFrames);
  }, [getUpcomingTransitionStartFrame, pausedTransitionPrearmFrames]);

  const getPlayingAnyTransitionPrewarmStartFrame = useCallback((frame: number) => {
    return getUpcomingTransitionStartFrame(frame, playingComplexTransitionPrearmFrames);
  }, [getUpcomingTransitionStartFrame, playingComplexTransitionPrearmFrames]);

  const isPausedTransitionOverlayActive = useCallback((frame: number, playbackState: { isPlaying: boolean; previewFrame: number | null }) => {
    return (
      !playbackState.isPlaying
      && playbackState.previewFrame === null
      && !forceFastScrubOverlay
      && getActiveTransitionWindowForFrame(frame) !== null
    );
  }, [forceFastScrubOverlay, getActiveTransitionWindowForFrame]);

  const cacheTransitionSessionFrame = useCallback((frame: number) => {
    const offscreen = scrubOffscreenCanvasRef.current;
    if (!offscreen || !transitionSessionWindowRef.current) return;

    const snapshot = new OffscreenCanvas(offscreen.width, offscreen.height);
    const snapshotCtx = snapshot.getContext('2d');
    if (!snapshotCtx) return;

    snapshotCtx.drawImage(offscreen, 0, 0);
    transitionSessionBufferedFramesRef.current.set(frame, snapshot);
    const trace = transitionSessionTraceRef.current;
    if (trace) {
      trace.lastPreparedFrame = frame;
      trace.bufferedFramesPeak = Math.max(
        trace.bufferedFramesPeak,
        transitionSessionBufferedFramesRef.current.size,
      );
      if (trace.firstPreparedAtMs === null) {
        trace.firstPreparedAtMs = performance.now();
        pushTransitionTrace('prepare_ready', {
          opId: trace.opId,
          preparedFrame: frame,
          bufferedFrames: transitionSessionBufferedFramesRef.current.size,
        });
      }
    }

    const maxBufferedFrames = playbackTransitionPrerenderRunwayFrames + playbackTransitionCooldownFrames + 2;
    while (transitionSessionBufferedFramesRef.current.size > maxBufferedFrames) {
      const oldestFrame = transitionSessionBufferedFramesRef.current.keys().next().value;
      if (oldestFrame === undefined) break;
      transitionSessionBufferedFramesRef.current.delete(oldestFrame);
    }
  }, [
    playbackTransitionCooldownFrames,
    playbackTransitionPrerenderRunwayFrames,
    pushTransitionTrace,
    scrubOffscreenCanvasRef,
    transitionSessionBufferedFramesRef,
    transitionSessionTraceRef,
    transitionSessionWindowRef,
  ]);

  const preparePlaybackTransitionFrame = useCallback(async (targetFrame: number): Promise<boolean> => {
    if (targetFrame < 0) return false;
    if (scrubOffscreenRenderedFrameRef.current === targetFrame) {
      return true;
    }
    if (
      playbackTransitionPreparingFrameRef.current === targetFrame
      && playbackTransitionPreparePromiseRef.current
    ) {
      return playbackTransitionPreparePromiseRef.current;
    }
    if (scrubRenderInFlightRef.current) {
      return false;
    }

    playbackTransitionPreparingFrameRef.current = targetFrame;
    const isPlaybackPrepare = usePlaybackStore.getState().isPlaying && forceFastScrubOverlay;
    const task = (async () => {
      if (!isPlaybackPrepare) {
        scrubRenderInFlightRef.current = true;
      }
      try {
        pinTransitionPlaybackSession(getTransitionWindowByStartFrame(targetFrame));
        const prepareStartedAtMs = performance.now();
        const trace = transitionSessionTraceRef.current;
        if (trace) {
          trace.prepareStartedAtMs = prepareStartedAtMs;
          pushTransitionTrace('prepare_start', {
            opId: trace.opId,
            targetFrame,
            mode: trace.mode,
            complex: trace.complex,
          });
        }
        const renderer = await ensureFastScrubRendererRef.current();
        if (!renderer || !scrubMountedRef.current) return false;

        if ('setDomVideoElementProvider' in renderer && renderer.setDomVideoElementProvider) {
          renderer.setDomVideoElementProvider(getPinnedTransitionElementForItem);
        }

        const isComplexTransitionStart = playbackTransitionComplexStartFrames.has(targetFrame);
        const shouldRenderFullTargetFrame = forceFastScrubOverlay || isComplexTransitionStart;
        if (shouldRenderFullTargetFrame) {
          await renderer.renderFrame(targetFrame);
          cacheTransitionSessionFrame(targetFrame);
        }
        for (let offset = 1; offset < playbackTransitionPrerenderRunwayFrames; offset += 1) {
          const runwayFrame = targetFrame + offset;
          if (forceFastScrubOverlay && !isComplexTransitionStart) {
            await renderer.renderFrame(runwayFrame);
            cacheTransitionSessionFrame(runwayFrame);
          } else {
            await renderer.prewarmFrame(runwayFrame);
          }
        }
        if (!shouldRenderFullTargetFrame) {
          await renderer.renderFrame(targetFrame);
          cacheTransitionSessionFrame(targetFrame);
        }
        if (!scrubMountedRef.current) return false;
        scrubOffscreenRenderedFrameRef.current = targetFrame;
        const finishedAtMs = performance.now();
        if (trace) {
          trace.lastPrepareMs = Math.max(0, finishedAtMs - prepareStartedAtMs);
          pushTransitionTrace('prepare_done', {
            opId: trace.opId,
            targetFrame,
            prepareMs: trace.lastPrepareMs,
            preparedFrame: trace.lastPreparedFrame,
            bufferedFrames: transitionSessionBufferedFramesRef.current.size,
          });
        }
        return true;
      } catch (error) {
        logger.debug('Hidden transition prerender failed:', targetFrame, error);
        return false;
      } finally {
        if (!isPlaybackPrepare) {
          scrubRenderInFlightRef.current = false;
        }
        if (playbackTransitionPreparingFrameRef.current === targetFrame) {
          playbackTransitionPreparingFrameRef.current = null;
          playbackTransitionPreparePromiseRef.current = null;
        }
        if (scrubRequestedFrameRef.current !== null) {
          resumeScrubLoopRef.current();
        }
      }
    })();

    playbackTransitionPreparePromiseRef.current = task;
    return task;
  }, [
    cacheTransitionSessionFrame,
    ensureFastScrubRendererRef,
    forceFastScrubOverlay,
    getPinnedTransitionElementForItem,
    getTransitionWindowByStartFrame,
    pinTransitionPlaybackSession,
    playbackTransitionComplexStartFrames,
    playbackTransitionPreparePromiseRef,
    playbackTransitionPreparingFrameRef,
    playbackTransitionPrerenderRunwayFrames,
    pushTransitionTrace,
    resumeScrubLoopRef,
    scrubMountedRef,
    scrubOffscreenRenderedFrameRef,
    scrubRenderInFlightRef,
    scrubRequestedFrameRef,
    transitionSessionBufferedFramesRef,
    transitionSessionTraceRef,
  ]);

  return {
    clearTransitionPlaybackSession,
    pinTransitionPlaybackSession,
    getPinnedTransitionElementForItem,
    getPausedTransitionPrewarmStartFrame,
    getPlayingAnyTransitionPrewarmStartFrame,
    isPausedTransitionOverlayActive,
    cacheTransitionSessionFrame,
    preparePlaybackTransitionFrame,
  };
}
