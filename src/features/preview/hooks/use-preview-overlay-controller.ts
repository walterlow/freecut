import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { usePlaybackStore } from '@/shared/state/playback';
import {
  pushRenderSourceSwitchHistory,
  type PreviewRenderSource,
  type RenderSourceSwitchEntry,
} from '../utils/preview-perf-metrics';
import { PREVIEW_PERF_RENDER_SOURCE_HISTORY_MAX } from '../utils/preview-constants';

interface UsePreviewOverlayControllerParams {
  bypassPreviewSeekRef: MutableRefObject<boolean>;
  setDisplayedFrame: (frame: number | null) => void;
}

interface UsePreviewOverlayControllerResult {
  isRenderedOverlayVisible: boolean;
  showFastScrubOverlayRef: MutableRefObject<boolean>;
  showPlaybackTransitionOverlayRef: MutableRefObject<boolean>;
  renderSourceRef: MutableRefObject<PreviewRenderSource>;
  renderSourceSwitchCountRef: MutableRefObject<number>;
  renderSourceHistoryRef: MutableRefObject<RenderSourceSwitchEntry[]>;
  clearPendingFastScrubHandoff: () => void;
  hideFastScrubOverlay: () => void;
  hidePlaybackTransitionOverlay: () => void;
  showFastScrubOverlayForFrame: () => void;
  showPlaybackTransitionOverlayForFrame: () => void;
}

export function usePreviewOverlayController({
  bypassPreviewSeekRef,
  setDisplayedFrame,
}: UsePreviewOverlayControllerParams): UsePreviewOverlayControllerResult {
  const [showFastScrubOverlay, setShowFastScrubOverlay] = useState(false);
  const [showPlaybackTransitionOverlay, setShowPlaybackTransitionOverlay] = useState(false);
  const showFastScrubOverlayRef = useRef(false);
  const showPlaybackTransitionOverlayRef = useRef(false);
  const renderSourceRef = useRef<PreviewRenderSource>('player');
  const renderSourceSwitchCountRef = useRef(0);
  const renderSourceHistoryRef = useRef<RenderSourceSwitchEntry[]>([]);
  const clearPendingFastScrubHandoff = useCallback(() => {}, []);

  const hideFastScrubOverlay = useCallback(() => {
    showFastScrubOverlayRef.current = false;
    setShowFastScrubOverlay(false);
    bypassPreviewSeekRef.current = false;
  }, [bypassPreviewSeekRef]);

  const hidePlaybackTransitionOverlay = useCallback(() => {
    showPlaybackTransitionOverlayRef.current = false;
    setShowPlaybackTransitionOverlay(false);
  }, []);

  const showFastScrubOverlayForFrame = useCallback(() => {
    showPlaybackTransitionOverlayRef.current = false;
    setShowPlaybackTransitionOverlay(false);
    showFastScrubOverlayRef.current = true;
    setShowFastScrubOverlay(true);
    bypassPreviewSeekRef.current = true;
  }, [bypassPreviewSeekRef]);

  const showPlaybackTransitionOverlayForFrame = useCallback(() => {
    showFastScrubOverlayRef.current = false;
    setShowFastScrubOverlay(false);
    showPlaybackTransitionOverlayRef.current = true;
    setShowPlaybackTransitionOverlay(true);
    bypassPreviewSeekRef.current = false;
  }, [bypassPreviewSeekRef]);

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
    clearPendingFastScrubHandoff,
    hideFastScrubOverlay,
    hidePlaybackTransitionOverlay,
    showFastScrubOverlayForFrame,
    showPlaybackTransitionOverlayForFrame,
  };
}
