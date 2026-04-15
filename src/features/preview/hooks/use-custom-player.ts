import { useRef, useEffect, useState, useCallback } from 'react';
import { usePlaybackStore } from '@/shared/state/playback';
import type { PreviewVisualPlaybackMode } from '@/shared/state/preview-bridge';
import { useTimelineSettingsStore } from '@/features/preview/deps/timeline-store';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('useCustomPlayer');

interface PreviewPlayerRef {
  seekTo: (frame: number) => void;
  play: () => void;
  pause: () => void;
  getCurrentFrame: () => number;
  isPlaying: () => boolean;
}

export function useCustomPlayer(
  playerRef: React.RefObject<PreviewPlayerRef | null>,
  bypassPreviewSeekRef?: React.RefObject<boolean>,
  preferPlayerForStyledTextScrubRef?: React.RefObject<boolean>,
  _isGizmoInteractingRef?: React.RefObject<boolean>,
  onPlayerSeek?: (targetFrame: number) => void,
  _visualPlaybackModeRef?: React.RefObject<PreviewVisualPlaybackMode>,
  _shouldUsePlayerForFrame?: (frame: number) => boolean,
) {
  void _visualPlaybackModeRef;
  void _shouldUsePlayerForFrame;
  const [playerReady, setPlayerReady] = useState(false);
  const lastSeekTargetRef = useRef<number | null>(null);
  const ignorePlayerUpdatesRef = useRef(false);

  const getPlayerFrame = useCallback(() => {
    const frame = playerRef.current?.getCurrentFrame();
    return Number.isFinite(frame) ? Math.round(frame!) : null;
  }, [playerRef]);

  const releaseIgnoredPlayerUpdates = useCallback(() => {
    requestAnimationFrame(() => {
      ignorePlayerUpdatesRef.current = false;
    });
  }, []);

  const seekPlayerToFrame = useCallback((
    targetFrame: number,
    options?: {
      holdIgnoreUntilReleased?: boolean;
      force?: boolean;
    },
  ) => {
    if (!playerRef.current) return;
    const nextFrame = Math.max(0, Math.round(targetFrame));
    const playerFrame = getPlayerFrame();
    if (playerFrame !== null && playerFrame === nextFrame) {
      lastSeekTargetRef.current = nextFrame;
      return;
    }
    if (!options?.force && lastSeekTargetRef.current === nextFrame && ignorePlayerUpdatesRef.current) {
      return;
    }

    ignorePlayerUpdatesRef.current = true;
    try {
      onPlayerSeek?.(nextFrame);
      playerRef.current.seekTo(nextFrame);
      lastSeekTargetRef.current = nextFrame;
    } catch (error) {
      logger.error('Failed to seek preview host:', error);
    }

    if (!options?.holdIgnoreUntilReleased) {
      releaseIgnoredPlayerUpdates();
    }
  }, [getPlayerFrame, onPlayerSeek, playerRef, releaseIgnoredPlayerUpdates]);

  useEffect(() => {
    if (playerRef.current && !playerReady) {
      setPlayerReady(true);
    }

    const checkReady = setInterval(() => {
      if (playerRef.current) {
        setPlayerReady(true);
        clearInterval(checkReady);
      }
    }, 50);

    const timeout = setTimeout(() => clearInterval(checkReady), 1000);
    return () => {
      clearInterval(checkReady);
      clearTimeout(timeout);
    };
  }, [playerReady, playerRef]);

  const isTimelineLoading = useTimelineSettingsStore((s) => s.isTimelineLoading);

  useEffect(() => {
    if (!playerReady || !playerRef.current || isTimelineLoading) return;

    const syncPausedPlayerFrame = (state: ReturnType<typeof usePlaybackStore.getState>) => {
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
      seekPlayerToFrame(targetFrame);
    };

    const initialState = usePlaybackStore.getState();
    if (initialState.isPlaying) {
      seekPlayerToFrame(initialState.currentFrame, { holdIgnoreUntilReleased: true, force: true });
      try {
        playerRef.current.play();
      } finally {
        ignorePlayerUpdatesRef.current = false;
      }
    } else {
      syncPausedPlayerFrame(initialState);
    }

    return usePlaybackStore.subscribe((state, prevState) => {
      if (!playerRef.current) return;

      const startedPlaying = state.isPlaying && !prevState.isPlaying;
      const stoppedPlaying = !state.isPlaying && prevState.isPlaying;

      if (startedPlaying && state.previewFrame !== null) {
        usePlaybackStore.getState().setPreviewFrame(null);
      }

      if (state.isPlaying) {
        const playerFrame = getPlayerFrame();
        const needsSeek = (
          startedPlaying
          || playerFrame === null
          || Math.abs(playerFrame - state.currentFrame) > 2
        );
        if (needsSeek) {
          seekPlayerToFrame(state.currentFrame, {
            holdIgnoreUntilReleased: true,
            force: startedPlaying,
          });
        }
        if (!playerRef.current.isPlaying()) {
          playerRef.current.play();
        }
        ignorePlayerUpdatesRef.current = false;
        return;
      }

      if (stoppedPlaying && playerRef.current.isPlaying()) {
        playerRef.current.pause();
      }
      syncPausedPlayerFrame(state);
    });
  }, [
    bypassPreviewSeekRef,
    getPlayerFrame,
    isTimelineLoading,
    playerReady,
    playerRef,
    preferPlayerForStyledTextScrubRef,
    seekPlayerToFrame,
  ]);

  return {
    ignorePlayerUpdatesRef,
    playerSeekTargetRef: lastSeekTargetRef,
  };
}
