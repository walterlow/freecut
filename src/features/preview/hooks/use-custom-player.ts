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
import { resolvePreviewTransitionDecision } from '../utils/preview-state-coordinator';
import {
  PLAYER_BACKWARD_SCRUB_SEEK_THROTTLE_MS,
  PLAYER_BACKWARD_SCRUB_SEEK_QUANTIZE_FRAMES,
  PLAYER_BACKWARD_SCRUB_FORCE_JUMP_FRAMES,
  getFrameDirection,
} from '../utils/preview-constants';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('useCustomPlayer');

export function useCustomPlayer(
  playerRef: React.RefObject<{ seekTo: (frame: number) => void; play: () => void; pause: () => void; getCurrentFrame: () => number; isPlaying: () => boolean } | null>,
  bypassPreviewSeekRef?: React.RefObject<boolean>,
  preferPlayerForStyledTextScrubRef?: React.RefObject<boolean>,
  isGizmoInteractingRef?: React.RefObject<boolean>,
  onPlayerSeek?: (targetFrame: number) => void,
) {
  const isPlaying = usePlaybackStore((s) => s.isPlaying);

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
      if (isPlaying && !wasPlaying) {
        // Always resume from the store playhead, not the hover-preview (gray) playhead.
        const { currentFrame, setPreviewFrame } = usePlaybackStore.getState();
        const playerFrame = getPlayerFrame();
        const needsSeek = playerFrame === null || Math.abs(playerFrame - currentFrame) > 1;
        if (needsSeek) {
          ignorePlayerUpdatesRef.current = true;
          onPlayerSeek?.(currentFrame);
          playerRef.current.seekTo(currentFrame);
          lastSyncedFrameRef.current = currentFrame;
          lastSeekTargetRef.current = currentFrame;
        }
        setPreviewFrame(null);

        // Start playback immediately after optional seek. Deferring to rAF adds
        // an extra frame of latency every time playback resumes.
        if (!usePlaybackStore.getState().isPlaying) {
          ignorePlayerUpdatesRef.current = false;
          return;
        }
        playerRef.current?.play();
        ignorePlayerUpdatesRef.current = false;
        return;
      } else if (!isPlaying && wasPlaying) {
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

      if (!transition.currentFrameChanged) return;
      const currentFrame = state.currentFrame;

      const frameDiff = Math.abs(currentFrame - lastSyncedFrameRef.current);
      if (frameDiff === 0) return;

      if (transition.next.mode === 'playing') {
        const playerFrame = getPlayerFrame();
        // While actively playing, most store frame updates originate from the Player itself.
        // Only seek when there is real drift, which indicates an external timeline seek.
        if (playerFrame !== null && Math.abs(playerFrame - currentFrame) <= 2) {
          lastSyncedFrameRef.current = currentFrame;
          return;
        }
      }

      // During active gizmo interactions, don't seek from currentFrame updates.
      // Gizmo mode prioritizes real-time transform updates from Player output.
      if (transition.shouldSkipCurrentFrameSeek) {
        lastSyncedFrameRef.current = currentFrame;
        return;
      }

      seekPlayerToFrame(currentFrame);
    });

    return unsubscribe;
  }, [playerReady, isTimelineLoading, playerRef, getPlayerFrame, seekPlayerToFrame, isGizmoInteractingRef, onPlayerSeek]);

  // Preview frame seeking: seek to hovered position on timeline
  useEffect(() => {
    if (!playerReady || !playerRef.current) return;

    return usePlaybackStore.subscribe((state, prev) => {
      if (!playerRef.current) return;
      const transition = resolvePreviewTransitionDecision({
        prev: {
          isPlaying: prev.isPlaying,
          previewFrame: prev.previewFrame,
          currentFrame: prev.currentFrame,
          isGizmoInteracting: isGizmoInteractingRef?.current === true,
        },
        next: {
          isPlaying: state.isPlaying,
          previewFrame: state.previewFrame,
          currentFrame: state.currentFrame,
          isGizmoInteracting: isGizmoInteractingRef?.current === true,
        },
      });
      if (!transition.previewFrameChanged) return;
      const interactionMode = transition.next.mode;
      if (interactionMode === 'playing' || interactionMode === 'gizmo_dragging') {
        lastBackwardScrubSeekAtRef.current = 0;
        lastBackwardScrubSeekFrameRef.current = null;
        return;
      }
      if (interactionMode === 'scrubbing' && bypassPreviewSeekRef?.current) {
        lastBackwardScrubSeekAtRef.current = 0;
        lastBackwardScrubSeekFrameRef.current = null;
        return;
      }
      const shouldUseFastScrubOnly = (
        !preferPlayerForStyledTextScrubRef?.current
        &&
        interactionMode === 'scrubbing'
        && state.previewFrame !== null
        && state.currentFrame === state.previewFrame
        && state.currentFrameEpoch === state.previewFrameEpoch
      );
      if (shouldUseFastScrubOnly) {
        lastBackwardScrubSeekAtRef.current = 0;
        lastBackwardScrubSeekFrameRef.current = null;
        return;
      }

      const targetFrame = transition.next.anchorFrame;
      const scrubDirection = interactionMode === 'scrubbing'
        ? getFrameDirection(transition.prev.anchorFrame, transition.next.anchorFrame)
        : 0;

      if (scrubDirection < 0) {
        const nowMs = performance.now();
        const quantizedFrame = Math.floor(
          targetFrame / PLAYER_BACKWARD_SCRUB_SEEK_QUANTIZE_FRAMES
        ) * PLAYER_BACKWARD_SCRUB_SEEK_QUANTIZE_FRAMES;
        const lastRequestedFrame = lastBackwardScrubSeekFrameRef.current;
        const withinThrottle = (
          (nowMs - lastBackwardScrubSeekAtRef.current) < PLAYER_BACKWARD_SCRUB_SEEK_THROTTLE_MS
        );
        const jumpDistance = lastRequestedFrame === null
          ? Number.POSITIVE_INFINITY
          : Math.abs(quantizedFrame - lastRequestedFrame);
        if (
          withinThrottle
          && jumpDistance < PLAYER_BACKWARD_SCRUB_FORCE_JUMP_FRAMES
        ) {
          return;
        }

        lastBackwardScrubSeekAtRef.current = nowMs;
        lastBackwardScrubSeekFrameRef.current = quantizedFrame;
        seekPlayerToFrame(quantizedFrame);
        return;
      }

      lastBackwardScrubSeekAtRef.current = 0;
      lastBackwardScrubSeekFrameRef.current = null;
      seekPlayerToFrame(targetFrame);
    });
  }, [playerReady, playerRef, seekPlayerToFrame, bypassPreviewSeekRef, preferPlayerForStyledTextScrubRef, isGizmoInteractingRef]);

  return { ignorePlayerUpdatesRef };
}
