import { useRef, useEffect, useState, useCallback } from 'react';
import { usePlaybackStore } from '@/shared/state/playback';
import type { PreviewVisualPlaybackMode } from '@/shared/state/preview-bridge';
import { useTimelineSettingsStore } from '@/features/preview/deps/timeline-store';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('usePreviewHostSync');

interface PreviewPlayerRef {
  seekTo: (frame: number) => void;
  play: () => void;
  pause: () => void;
  getCurrentFrame: () => number;
  isPlaying: () => boolean;
}

export function usePreviewHostSync(
  hostRef: React.RefObject<PreviewPlayerRef | null>,
  bypassPreviewSeekRef?: React.RefObject<boolean>,
  preferPlayerForStyledTextScrubRef?: React.RefObject<boolean>,
  _isGizmoInteractingRef?: React.RefObject<boolean>,
  onHostSeek?: (targetFrame: number) => void,
  _visualPlaybackModeRef?: React.RefObject<PreviewVisualPlaybackMode>,
  _shouldUsePlayerForFrame?: (frame: number) => boolean,
) {
  void _visualPlaybackModeRef;
  void _shouldUsePlayerForFrame;
  const [hostReady, setHostReady] = useState(false);
  const hostSeekTargetRef = useRef<number | null>(null);
  const ignoreHostUpdatesRef = useRef(false);

  const getHostFrame = useCallback(() => {
    const frame = hostRef.current?.getCurrentFrame();
    return Number.isFinite(frame) ? Math.round(frame!) : null;
  }, [hostRef]);

  const releaseIgnoredHostUpdates = useCallback(() => {
    requestAnimationFrame(() => {
      ignoreHostUpdatesRef.current = false;
    });
  }, []);

  const seekHostToFrame = useCallback((
    targetFrame: number,
    options?: {
      holdIgnoreUntilReleased?: boolean;
      force?: boolean;
    },
  ) => {
    if (!hostRef.current) return;
    const nextFrame = Math.max(0, Math.round(targetFrame));
    const hostFrame = getHostFrame();
    if (hostFrame !== null && hostFrame === nextFrame) {
      hostSeekTargetRef.current = nextFrame;
      return;
    }
    if (!options?.force && hostSeekTargetRef.current === nextFrame && ignoreHostUpdatesRef.current) {
      return;
    }

    ignoreHostUpdatesRef.current = true;
    try {
      onHostSeek?.(nextFrame);
      hostRef.current.seekTo(nextFrame);
      hostSeekTargetRef.current = nextFrame;
    } catch (error) {
      logger.error('Failed to seek preview host:', error);
    }

    if (!options?.holdIgnoreUntilReleased) {
      releaseIgnoredHostUpdates();
    }
  }, [getHostFrame, hostRef, onHostSeek, releaseIgnoredHostUpdates]);

  useEffect(() => {
    if (hostRef.current && !hostReady) {
      setHostReady(true);
    }

    const checkReady = setInterval(() => {
      if (hostRef.current) {
        setHostReady(true);
        clearInterval(checkReady);
      }
    }, 50);

    const timeout = setTimeout(() => clearInterval(checkReady), 1000);
    return () => {
      clearInterval(checkReady);
      clearTimeout(timeout);
    };
  }, [hostReady, hostRef]);

  const isTimelineLoading = useTimelineSettingsStore((s) => s.isTimelineLoading);

  useEffect(() => {
    if (!hostReady || !hostRef.current || isTimelineLoading) return;

    const syncPausedHostFrame = (state: ReturnType<typeof usePlaybackStore.getState>) => {
      if (_visualPlaybackModeRef?.current && _visualPlaybackModeRef.current !== 'player') {
        return;
      }

      const previewActive = (
        state.previewFrame !== null
        && state.previewFrameEpoch >= state.currentFrameEpoch
      );
      const shouldBypassSeek = (
        previewActive
        && (
          bypassPreviewSeekRef?.current === true
          || (
            state.currentFrame === state.previewFrame
            && state.currentFrameEpoch === state.previewFrameEpoch
            && preferPlayerForStyledTextScrubRef?.current !== true
          )
        )
      );
      if (shouldBypassSeek) {
        return;
      }

      const targetFrame = state.previewFrame !== null && state.previewFrameEpoch >= state.currentFrameEpoch
        ? state.previewFrame
        : state.currentFrame;
      seekHostToFrame(targetFrame);
    };

    const initialState = usePlaybackStore.getState();
    if (initialState.isPlaying) {
      seekHostToFrame(initialState.currentFrame, { holdIgnoreUntilReleased: true, force: true });
      try {
        hostRef.current.play();
      } finally {
        ignoreHostUpdatesRef.current = false;
      }
    } else {
      syncPausedHostFrame(initialState);
    }

    return usePlaybackStore.subscribe((state, prevState) => {
      if (!hostRef.current) return;

      const startedPlaying = state.isPlaying && !prevState.isPlaying;
      const stoppedPlaying = !state.isPlaying && prevState.isPlaying;

      if (startedPlaying && state.previewFrame !== null) {
        usePlaybackStore.getState().setPreviewFrame(null);
      }

      if (state.isPlaying) {
        const hostFrame = getHostFrame();
        const needsSeek = (
          startedPlaying
          || hostFrame === null
          || Math.abs(hostFrame - state.currentFrame) > 2
        );
        if (needsSeek) {
          seekHostToFrame(state.currentFrame, {
            holdIgnoreUntilReleased: true,
            force: startedPlaying,
          });
        }
        if (!hostRef.current.isPlaying()) {
          hostRef.current.play();
        }
        ignoreHostUpdatesRef.current = false;
        return;
      }

      if (stoppedPlaying && hostRef.current.isPlaying()) {
        hostRef.current.pause();
      }
      syncPausedHostFrame(state);
    });
  }, [
    bypassPreviewSeekRef,
    getHostFrame,
    isTimelineLoading,
    hostReady,
    hostRef,
    preferPlayerForStyledTextScrubRef,
    seekHostToFrame,
  ]);

  return {
    ignoreHostUpdatesRef,
    hostSeekTargetRef,
  };
}
