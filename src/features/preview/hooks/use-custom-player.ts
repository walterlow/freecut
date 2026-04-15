/**
 * Hook for integrating custom Player with timeline playback state
 * 
 * Sync strategy:
 * - Timeline seeks trigger Player seeks while playback is active or when
 *   the Player still owns visible preview output
 * - Player updates are ignored briefly after seeks to prevent loops
 * - Player frame updates only write back while the Player owns timing/state
 * - Play/pause state is synced bidirectionally
 * - Store is authoritative - if store says paused, Player follows
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { usePlaybackStore } from '@/shared/state/playback';
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge';
import type { PreviewVisualPlaybackMode } from '@/shared/state/preview-bridge';
import { useTimelineSettingsStore } from '@/features/preview/deps/timeline-store';
import { resolvePreviewTransitionFromPlaybackStates } from '../utils/preview-state-coordinator';
import {
  type PlayerCommand,
  planCurrentFrameSyncCommand,
  planPlaybackStateCommand,
  planPreviewFrameSyncCommand,
} from '../utils/player-command-planner';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('useCustomPlayer');

export function useCustomPlayer(
  playerRef: React.RefObject<{ seekTo: (frame: number) => void; play: () => void; pause: () => void; getCurrentFrame: () => number; isPlaying: () => boolean } | null>,
  bypassPreviewSeekRef?: React.RefObject<boolean>,
  preferPlayerForStyledTextScrubRef?: React.RefObject<boolean>,
  isGizmoInteractingRef?: React.RefObject<boolean>,
  onPlayerSeek?: (targetFrame: number) => void,
  visualPlaybackModeRef?: React.RefObject<PreviewVisualPlaybackMode>,
  shouldUsePlayerForFrame?: (frame: number) => boolean,
) {
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const visualPlaybackMode = usePreviewBridgeStore((s) => s.visualPlaybackMode);

  const [playerReady, setPlayerReady] = useState(false);
  const lastSyncedFrameRef = useRef<number>(0);
  const lastSeekTargetRef = useRef<number | null>(null);
  const lastBackwardScrubSeekAtRef = useRef(0);
  const lastBackwardScrubSeekFrameRef = useRef<number | null>(null);
  const ignorePlayerUpdatesRef = useRef<boolean>(false);
  const wasPlayingRef = useRef(isPlaying);

  const getPlayerFrame = useCallback(() => {
    const frame = playerRef.current?.getCurrentFrame();
    return Number.isFinite(frame) ? Math.round(frame!) : null;
  }, [playerRef]);

  const getCurrentVisualPlaybackMode = useCallback(() => {
    return visualPlaybackModeRef?.current ?? usePreviewBridgeStore.getState().visualPlaybackMode;
  }, [visualPlaybackModeRef]);

  const getShouldUsePlayerForFrame = useCallback((frame: number) => {
    if (shouldUsePlayerForFrame) {
      return shouldUsePlayerForFrame(frame);
    }
    return getCurrentVisualPlaybackMode() === 'player';
  }, [getCurrentVisualPlaybackMode, shouldUsePlayerForFrame]);

  const seekPlayerToFrame = useCallback((
    targetFrame: number,
    holdIgnoreUntilReleased = false,
    forceSameTargetReplay = false,
  ) => {
    if (!playerRef.current) return;
    const playerFrame = getPlayerFrame();
    if (playerFrame !== null && playerFrame === targetFrame) {
      lastSyncedFrameRef.current = targetFrame;
      lastSeekTargetRef.current = targetFrame;
      return;
    }
    if (!forceSameTargetReplay && lastSeekTargetRef.current === targetFrame && ignorePlayerUpdatesRef.current) {
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

    if (!holdIgnoreUntilReleased) {
      requestAnimationFrame(() => {
        ignorePlayerUpdatesRef.current = false;
      });
    }
  }, [playerRef, getPlayerFrame, onPlayerSeek]);

  const executePlayerCommand = useCallback((command: PlayerCommand) => {
    if (!playerRef.current) return;

    switch (command.type) {
      case 'noop':
        return;
      case 'pause':
        playerRef.current.pause();
        return;
      case 'play':
        playerRef.current.play();
        return;
      case 'seek':
        seekPlayerToFrame(command.targetFrame);
        return;
      case 'seek_and_play':
        seekPlayerToFrame(command.targetFrame, true, true);
        if (!usePlaybackStore.getState().isPlaying) {
          ignorePlayerUpdatesRef.current = false;
          return;
        }
        playerRef.current.play();
        ignorePlayerUpdatesRef.current = false;
        return;
      default:
        return;
    }
  }, [playerRef, seekPlayerToFrame]);

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
    const { currentFrame, setPreviewFrame } = usePlaybackStore.getState();
    const playbackPlan = planPlaybackStateCommand({
      wasPlaying,
      isPlaying,
      currentFrame,
      playerFrame: getPlayerFrame(),
    });

    try {
      if (playbackPlan.clearPreviewFrame) {
        setPreviewFrame(null);
      }
      if (isPlaying && !wasPlaying && !shouldUsePlayer) {
        return;
      }
      executePlayerCommand(playbackPlan.command);
    } catch (error) {
      logger.error('Failed to control playback:', error);
    }
  }, [isPlaying, playerRef, executePlayerCommand, getPlayerFrame, getShouldUsePlayerForFrame]);

  useEffect(() => {
    if (!playerReady || !playerRef.current || isPlaying || visualPlaybackMode !== 'player') {
      return;
    }

    const currentFrame = usePlaybackStore.getState().currentFrame;
    seekPlayerToFrame(currentFrame);
  }, [
    isPlaying,
    playerReady,
    playerRef,
    seekPlayerToFrame,
    visualPlaybackMode,
  ]);

  // Wait for timeline to finish loading before syncing frame position.
  // Without this, the Player would seek to frame 0 (the default) before
  // loadTimeline() restores the saved currentFrame from IndexedDB.
  //
  const isTimelineLoading = useTimelineSettingsStore((s) => s.isTimelineLoading);

  // Timeline → Player: Sync frame position
  useEffect(() => {
    if (!playerReady || !playerRef.current || isTimelineLoading) return;

    const initialFrame = usePlaybackStore.getState().currentFrame;
    const playerFrame = getPlayerFrame();
    lastSyncedFrameRef.current = initialFrame;
    lastSeekTargetRef.current = initialFrame;

    const shouldPrimePlayer = isPlaying || getShouldUsePlayerForFrame(initialFrame);

    if (playerFrame !== initialFrame && shouldPrimePlayer) {
      onPlayerSeek?.(initialFrame);
      playerRef.current.seekTo(initialFrame);
    }

    const unsubscribe = usePlaybackStore.subscribe((state, prevState) => {
      if (!playerRef.current) return;

      const transition = resolvePreviewTransitionFromPlaybackStates({
        prev: prevState,
        next: state,
        isGizmoInteracting: isGizmoInteractingRef?.current === true,
      });
      const plan = planCurrentFrameSyncCommand({
        transition,
        currentFrame: state.currentFrame,
        lastSyncedFrame: lastSyncedFrameRef.current,
        playerFrame: getPlayerFrame(),
      });

      if (plan.acknowledgedFrame !== null) {
        lastSyncedFrameRef.current = plan.acknowledgedFrame;
      }
      if (state.isPlaying) {
        const shouldUsePlayer = getShouldUsePlayerForFrame(state.currentFrame);
        if (!shouldUsePlayer) {
          if (playerRef.current.isPlaying()) {
            playerRef.current.pause();
          }
          return;
        }
        if (!playerRef.current.isPlaying()) {
          seekPlayerToFrame(state.currentFrame, true, true);
          if (!usePlaybackStore.getState().isPlaying) {
            ignorePlayerUpdatesRef.current = false;
            return;
          }
          playerRef.current.play();
          ignorePlayerUpdatesRef.current = false;
          return;
        }
      }
      if (plan.command.type === 'seek') {
        if (!state.isPlaying && getCurrentVisualPlaybackMode() !== 'player') {
          return;
        }
        seekPlayerToFrame(plan.command.targetFrame);
      }
    });

    return unsubscribe;
  }, [playerReady, isTimelineLoading, playerRef, getPlayerFrame, seekPlayerToFrame, isGizmoInteractingRef, isPlaying, onPlayerSeek, visualPlaybackMode, getCurrentVisualPlaybackMode, getShouldUsePlayerForFrame]);

  // Preview frame seeking: seek to hovered position on timeline
  useEffect(() => {
    if (!playerReady || !playerRef.current) return;

    return usePlaybackStore.subscribe((state, prev) => {
      if (!playerRef.current) return;
      const transition = resolvePreviewTransitionFromPlaybackStates({
        prev,
        next: state,
        isGizmoInteracting: isGizmoInteractingRef?.current === true,
      });
      const plan = planPreviewFrameSyncCommand({
        transition,
        currentFrame: state.currentFrame,
        previewFrame: state.previewFrame,
        currentFrameEpoch: state.currentFrameEpoch,
        previewFrameEpoch: state.previewFrameEpoch,
        bypassPreviewSeek: bypassPreviewSeekRef?.current === true,
        preferPlayerForStyledTextScrub: preferPlayerForStyledTextScrubRef?.current === true,
        nowMs: performance.now(),
        backwardScrubState: {
          lastSeekAtMs: lastBackwardScrubSeekAtRef.current,
          lastSeekFrame: lastBackwardScrubSeekFrameRef.current,
        },
      });

      lastBackwardScrubSeekAtRef.current = plan.backwardScrubState.lastSeekAtMs;
      lastBackwardScrubSeekFrameRef.current = plan.backwardScrubState.lastSeekFrame;

      if (plan.command.type === 'seek') {
        if (plan.shouldBypassPlayerSeek) {
          return;
        }
        if (getCurrentVisualPlaybackMode() !== 'player') {
          return;
        }
        seekPlayerToFrame(plan.command.targetFrame);
        return;
      }
    });
  }, [playerReady, playerRef, seekPlayerToFrame, bypassPreviewSeekRef, preferPlayerForStyledTextScrubRef, isGizmoInteractingRef, visualPlaybackMode, getCurrentVisualPlaybackMode]);

  return {
    ignorePlayerUpdatesRef,
    playerSeekTargetRef: lastSeekTargetRef,
  };
}
