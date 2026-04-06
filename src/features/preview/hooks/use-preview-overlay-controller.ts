import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react';
import type { PlayerRef } from '@/features/preview/deps/player-core';
import { usePlaybackStore } from '@/shared/state/playback';
import {
  pushRenderSourceSwitchHistory,
  type PreviewRenderSource,
  type RenderSourceSwitchEntry,
} from '../utils/preview-perf-metrics';
import {
  FAST_SCRUB_HANDOFF_TIMEOUT_MS,
  PREVIEW_PERF_RENDER_SOURCE_HISTORY_MAX,
} from '../utils/preview-constants';

interface UsePreviewOverlayControllerParams {
  playerRef: RefObject<PlayerRef | null>;
  bypassPreviewSeekRef: MutableRefObject<boolean>;
  shouldPreferPlayerForPreview: (previewFrame: number | null) => boolean;
  setDisplayedFrame: (frame: number | null) => void;
}

interface UsePreviewOverlayControllerResult {
  isRenderedOverlayVisible: boolean;
  showFastScrubOverlayRef: MutableRefObject<boolean>;
  showPlaybackTransitionOverlayRef: MutableRefObject<boolean>;
  renderSourceRef: MutableRefObject<PreviewRenderSource>;
  renderSourceSwitchCountRef: MutableRefObject<number>;
  renderSourceHistoryRef: MutableRefObject<RenderSourceSwitchEntry[]>;
  pendingFastScrubHandoffFrameRef: MutableRefObject<number | null>;
  clearPendingFastScrubHandoff: () => void;
  hideFastScrubOverlay: () => void;
  hidePlaybackTransitionOverlay: () => void;
  maybeCompleteFastScrubHandoff: (resolvedFrame?: number | null) => boolean;
  scheduleFastScrubHandoffCheck: () => void;
  beginFastScrubHandoff: (targetFrame: number) => void;
  showFastScrubOverlayForFrame: () => void;
  showPlaybackTransitionOverlayForFrame: () => void;
}

export function usePreviewOverlayController({
  playerRef,
  bypassPreviewSeekRef,
  shouldPreferPlayerForPreview,
  setDisplayedFrame,
}: UsePreviewOverlayControllerParams): UsePreviewOverlayControllerResult {
  const pendingFastScrubHandoffFrameRef = useRef<number | null>(null);
  const pendingFastScrubHandoffStartedAtRef = useRef(0);
  const pendingFastScrubHandoffRafRef = useRef<number | null>(null);
  const [showFastScrubOverlay, setShowFastScrubOverlay] = useState(false);
  const [showPlaybackTransitionOverlay, setShowPlaybackTransitionOverlay] = useState(false);
  const showFastScrubOverlayRef = useRef(false);
  const showPlaybackTransitionOverlayRef = useRef(false);
  const renderSourceRef = useRef<PreviewRenderSource>('player');
  const renderSourceSwitchCountRef = useRef(0);
  const renderSourceHistoryRef = useRef<RenderSourceSwitchEntry[]>([]);

  const clearPendingFastScrubHandoff = useCallback(() => {
    pendingFastScrubHandoffFrameRef.current = null;
    pendingFastScrubHandoffStartedAtRef.current = 0;
    if (pendingFastScrubHandoffRafRef.current !== null) {
      cancelAnimationFrame(pendingFastScrubHandoffRafRef.current);
      pendingFastScrubHandoffRafRef.current = null;
    }
  }, []);

  const hideFastScrubOverlay = useCallback(() => {
    clearPendingFastScrubHandoff();
    showFastScrubOverlayRef.current = false;
    setShowFastScrubOverlay(false);
    bypassPreviewSeekRef.current = false;
  }, [bypassPreviewSeekRef, clearPendingFastScrubHandoff]);

  const hidePlaybackTransitionOverlay = useCallback(() => {
    showPlaybackTransitionOverlayRef.current = false;
    setShowPlaybackTransitionOverlay(false);
  }, []);

  const maybeCompleteFastScrubHandoff = useCallback((resolvedFrame?: number | null) => {
    const targetFrame = pendingFastScrubHandoffFrameRef.current;
    if (targetFrame === null) return false;

    let playerFrame = resolvedFrame ?? null;
    if (playerFrame === null) {
      const currentFrame = playerRef.current?.getCurrentFrame();
      playerFrame = Number.isFinite(currentFrame)
        ? Math.round(currentFrame as number)
        : null;
    }

    if (playerFrame !== targetFrame) return false;
    hideFastScrubOverlay();
    return true;
  }, [hideFastScrubOverlay, playerRef]);

  const scheduleFastScrubHandoffCheck = useCallback(() => {
    if (pendingFastScrubHandoffFrameRef.current === null) return;
    if (pendingFastScrubHandoffRafRef.current !== null) return;

    pendingFastScrubHandoffRafRef.current = requestAnimationFrame(() => {
      pendingFastScrubHandoffRafRef.current = null;

      if (pendingFastScrubHandoffFrameRef.current === null) return;
      const playbackState = usePlaybackStore.getState();
      if (playbackState.previewFrame !== null) {
        clearPendingFastScrubHandoff();
        return;
      }
      if (playbackState.isPlaying || shouldPreferPlayerForPreview(playbackState.previewFrame)) {
        hideFastScrubOverlay();
        return;
      }
      if (maybeCompleteFastScrubHandoff()) {
        return;
      }
      if (
        performance.now() - pendingFastScrubHandoffStartedAtRef.current
        >= FAST_SCRUB_HANDOFF_TIMEOUT_MS
      ) {
        hideFastScrubOverlay();
        return;
      }
      scheduleFastScrubHandoffCheck();
    });
  }, [
    clearPendingFastScrubHandoff,
    hideFastScrubOverlay,
    maybeCompleteFastScrubHandoff,
    shouldPreferPlayerForPreview,
  ]);

  const beginFastScrubHandoff = useCallback((targetFrame: number) => {
    pendingFastScrubHandoffFrameRef.current = targetFrame;
    pendingFastScrubHandoffStartedAtRef.current = performance.now();
    scheduleFastScrubHandoffCheck();
  }, [scheduleFastScrubHandoffCheck]);

  const showFastScrubOverlayForFrame = useCallback(() => {
    clearPendingFastScrubHandoff();
    showPlaybackTransitionOverlayRef.current = false;
    setShowPlaybackTransitionOverlay(false);
    showFastScrubOverlayRef.current = true;
    setShowFastScrubOverlay(true);
    bypassPreviewSeekRef.current = true;
  }, [bypassPreviewSeekRef, clearPendingFastScrubHandoff]);

  const showPlaybackTransitionOverlayForFrame = useCallback(() => {
    clearPendingFastScrubHandoff();
    showFastScrubOverlayRef.current = false;
    setShowFastScrubOverlay(false);
    showPlaybackTransitionOverlayRef.current = true;
    setShowPlaybackTransitionOverlay(true);
    bypassPreviewSeekRef.current = false;
  }, [bypassPreviewSeekRef, clearPendingFastScrubHandoff]);

  const isRenderedOverlayVisible = showFastScrubOverlay || showPlaybackTransitionOverlay;

  useEffect(() => {
    showFastScrubOverlayRef.current = showFastScrubOverlay;
    showPlaybackTransitionOverlayRef.current = showPlaybackTransitionOverlay;
    const nextSource: PreviewRenderSource = showFastScrubOverlay
      ? 'fast_scrub_overlay'
      : showPlaybackTransitionOverlay
        ? 'playback_transition_overlay'
        : 'player';
    const prevSource = renderSourceRef.current;
    if (prevSource !== nextSource) {
      renderSourceSwitchCountRef.current += 1;
      renderSourceHistoryRef.current = pushRenderSourceSwitchHistory(
        renderSourceHistoryRef.current,
        {
          ts: Date.now(),
          atFrame: usePlaybackStore.getState().currentFrame,
          from: prevSource,
          to: nextSource,
        },
        PREVIEW_PERF_RENDER_SOURCE_HISTORY_MAX,
      );
    }
    renderSourceRef.current = nextSource;
  }, [showFastScrubOverlay, showPlaybackTransitionOverlay]);

  useEffect(() => {
    if (!isRenderedOverlayVisible) {
      setDisplayedFrame(null);
    }
  }, [isRenderedOverlayVisible, setDisplayedFrame]);

  return {
    isRenderedOverlayVisible,
    showFastScrubOverlayRef,
    showPlaybackTransitionOverlayRef,
    renderSourceRef,
    renderSourceSwitchCountRef,
    renderSourceHistoryRef,
    pendingFastScrubHandoffFrameRef,
    clearPendingFastScrubHandoff,
    hideFastScrubOverlay,
    hidePlaybackTransitionOverlay,
    maybeCompleteFastScrubHandoff,
    scheduleFastScrubHandoffCheck,
    beginFastScrubHandoff,
    showFastScrubOverlayForFrame,
    showPlaybackTransitionOverlayForFrame,
  };
}
