/**
 * Hook for integrating custom Player with timeline playback state
 * 
 * Sync strategy:
 * - Timeline seeks trigger Player seeks (both playing and paused)
 * - Player updates are ignored briefly after seeks to prevent loops
 * - Player fires frameupdate → updates timeline scrubber position
 * - Play/pause state is synced bidirectionally
 * - Store is authoritative - if store says paused, Player follows
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { usePlaybackStore } from '@/shared/state/playback';
import { useTimelineSettingsStore } from '@/features/preview/deps/timeline-store';
import {
  ensureAudioContextResumed,
  ensureBufferedAudioContextResumed,
  ensurePitchCorrectedAudioContextResumed,
} from '@/features/preview/deps/composition-runtime';
import { resolvePreviewTransitionDecision } from '../utils/preview-state-coordinator';
import { createLogger } from '@/shared/logging/logger';
import {
  resolvePreviewPlayerCurrentFrameSyncDecision,
  resolvePreviewPlayerPlaybackCommand,
} from '../utils/preview-player-controller';

const logger = createLogger('useCustomPlayer');

export function useCustomPlayer(
  playerRef: React.RefObject<{ seekTo: (frame: number) => void; play: () => void; pause: () => void; getCurrentFrame: () => number; isPlaying: () => boolean } | null>,
  isGizmoInteractingRef?: React.RefObject<boolean>,
  onPlayerSeek?: (targetFrame: number) => void,
) {
  const isPlaying = usePlaybackStore((s) => s.isPlaying);

  const [playerReady, setPlayerReady] = useState(false);
  const lastSyncedFrameRef = useRef<number>(0);
  const lastSeekTargetRef = useRef<number | null>(null);
  const ignorePlayerUpdatesRef = useRef<boolean>(false);
  const wasPlayingRef = useRef(isPlaying);

  const getPlayerFrame = useCallback(() => {
    const frame = playerRef.current?.getCurrentFrame();
    return Number.isFinite(frame) ? Math.round(frame!) : null;
  }, [playerRef]);

  const seekPlayerToFrame = useCallback((targetFrame: number) => {
    if (!playerRef.current) return;
    if (lastSeekTargetRef.current === targetFrame) return;

    const playerFrame = getPlayerFrame();
    if (playerFrame !== null && playerFrame === targetFrame) {
      lastSyncedFrameRef.current = targetFrame;
      lastSeekTargetRef.current = targetFrame;
      return;
    }

    ignorePlayerUpdatesRef.current = true;
    try {
      onPlayerSeek?.(targetFrame);
      playerRef.current.seekTo(targetFrame);
      lastSyncedFrameRef.current = targetFrame;
      lastSeekTargetRef.current = targetFrame;
    } catch (error) {
      logger.error('Failed to seek Player:', error);
    }

    requestAnimationFrame(() => {
      ignorePlayerUpdatesRef.current = false;
    });
  }, [playerRef, getPlayerFrame, onPlayerSeek]);

  // Detect when Player becomes ready
  useEffect(() => {
    if (playerRef.current && !playerReady) {
      setPlayerReady(true);
    }
    const checkReady = setInterval(() => {
      if (playerRef.current && !playerReady) {
        setPlayerReady(true);
        clearInterval(checkReady);
      }
    }, 50);

    const timeout = setTimeout(() => clearInterval(checkReady), 1000);

    return () => {
      clearInterval(checkReady);
      clearTimeout(timeout);
    };
  }, [playerRef, playerReady]);

  // Timeline → Player: Sync play/pause state
  useEffect(() => {
    if (!playerRef.current) return;

    const wasPlaying = wasPlayingRef.current;
    wasPlayingRef.current = isPlaying;

    try {
      const playbackState = usePlaybackStore.getState();
      const playbackCommand = resolvePreviewPlayerPlaybackCommand({
        isPlaying,
        wasPlaying,
        currentFrame: playbackState.currentFrame,
        previewFrame: playbackState.previewFrame,
        playerFrame: getPlayerFrame(),
      });

      if (playbackCommand.kind === 'play') {
        // Resume from the frame currently visible to the user. If hover-scrub
        // is active, promote that frame to the real playhead before playback.
        const { commitPreviewFrame } = playbackState;
        lastSyncedFrameRef.current = playbackCommand.syncFrame;
        lastSeekTargetRef.current = playbackCommand.syncFrame;
        if (playbackCommand.shouldSeekBeforePlay) {
          ignorePlayerUpdatesRef.current = true;
          onPlayerSeek?.(playbackCommand.startFrame);
          playerRef.current.seekTo(playbackCommand.startFrame);
        }
        if (playbackCommand.shouldClearPreviewFrame) {
          commitPreviewFrame();
        }

        // Start playback immediately after optional seek. Deferring to rAF adds
        // an extra frame of latency every time playback resumes.
        if (!usePlaybackStore.getState().isPlaying) {
          ignorePlayerUpdatesRef.current = false;
          return;
        }
        ensureAudioContextResumed();
        ensureBufferedAudioContextResumed();
        ensurePitchCorrectedAudioContextResumed();
        playerRef.current?.play();
        ignorePlayerUpdatesRef.current = false;
        return;
      }

      if (playbackCommand.kind === 'pause') {
        playerRef.current.pause();
      }
    } catch (error) {
      logger.error('Failed to control playback:', error);
    }
  }, [isPlaying, playerRef, getPlayerFrame, onPlayerSeek]);

  // Wait for timeline to finish loading before syncing frame position.
  // Without this, the Player would seek to frame 0 (the default) before
  // loadTimeline() restores the saved currentFrame from IndexedDB.
  const isTimelineLoading = useTimelineSettingsStore((s) => s.isTimelineLoading);

  // Timeline → Player: Sync frame position
  useEffect(() => {
    if (!playerReady || !playerRef.current || isTimelineLoading) return;

    const initialFrame = usePlaybackStore.getState().currentFrame;
    const playerFrame = getPlayerFrame();
    lastSyncedFrameRef.current = initialFrame;
    lastSeekTargetRef.current = initialFrame;
    if (playerFrame !== initialFrame) {
      onPlayerSeek?.(initialFrame);
    }
    playerRef.current.seekTo(initialFrame);

    const unsubscribe = usePlaybackStore.subscribe((state, prevState) => {
      if (!playerRef.current) return;

      const transition = resolvePreviewTransitionDecision({
        prev: {
          isPlaying: prevState.isPlaying,
          previewFrame: prevState.previewFrame,
          currentFrame: prevState.currentFrame,
          isGizmoInteracting: isGizmoInteractingRef?.current === true,
        },
        next: {
          isPlaying: state.isPlaying,
          previewFrame: state.previewFrame,
          currentFrame: state.currentFrame,
          isGizmoInteracting: isGizmoInteractingRef?.current === true,
        },
      });

      const syncDecision = resolvePreviewPlayerCurrentFrameSyncDecision({
        transition,
        lastSyncedFrame: lastSyncedFrameRef.current,
        playerFrame: getPlayerFrame(),
      });

      if (syncDecision.kind === 'none') {
        return;
      }

      if (syncDecision.kind === 'update_synced_frame') {
        lastSyncedFrameRef.current = syncDecision.nextSyncedFrame;
        return;
      }

      seekPlayerToFrame(syncDecision.targetFrame);
    });

    return unsubscribe;
  }, [playerReady, isTimelineLoading, playerRef, getPlayerFrame, seekPlayerToFrame, isGizmoInteractingRef, onPlayerSeek]);
  return { ignorePlayerUpdatesRef };
}
