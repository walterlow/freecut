/**
 * Hook for integrating the transport Player with timeline playback state.
 *
 * The renderer owns preview presentation. The Player is transport/audio only:
 * - committed transport seeks trigger Player seeks
 * - scrub and gizmo preview do not seek the Player
 * - play/pause state is synced from the store to the Player
 * - Player frame callbacks feed transport progress back into the store
 */

import { useRef, useEffect, useCallback } from 'react';
import { usePlaybackStore } from '@/shared/state/playback';
import { useTimelineSettingsStore } from '@/features/preview/deps/timeline-store';
import {
  ensureAudioContextResumed,
  ensureBufferedAudioContextResumed,
  ensurePitchCorrectedAudioContextResumed,
} from '@/features/preview/deps/composition-runtime';
import { createLogger } from '@/shared/logging/logger';
import {
  resolvePreviewPlayerPlaybackCommand,
  resolvePreviewPlayerTransportSyncDecision,
} from '../utils/preview-player-controller';

const logger = createLogger('useCustomPlayer');

export function useCustomPlayer(
  playerRef: React.RefObject<{ seekTo: (frame: number) => void; play: () => void; pause: () => void; getCurrentFrame: () => number; isPlaying: () => boolean } | null>,
  isGizmoInteracting = false,
  onPlayerSeek?: (targetFrame: number) => void,
) {
  const isPlaying = usePlaybackStore((s) => s.isPlaying);

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
      lastSeekTargetRef.current = targetFrame;
      return;
    }

    ignorePlayerUpdatesRef.current = true;
    try {
      onPlayerSeek?.(targetFrame);
      playerRef.current.seekTo(targetFrame);
      lastSeekTargetRef.current = targetFrame;
    } catch (error) {
      logger.error('Failed to seek Player:', error);
    }

    requestAnimationFrame(() => {
      ignorePlayerUpdatesRef.current = false;
    });
  }, [playerRef, getPlayerFrame, onPlayerSeek]);

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
        const { commitPreviewFrame } = playbackState;
        if (playbackCommand.shouldSeekBeforePlay) {
          seekPlayerToFrame(playbackCommand.startFrame);
        } else {
          lastSeekTargetRef.current = playbackCommand.startFrame;
        }
        if (playbackCommand.shouldClearPreviewFrame) {
          commitPreviewFrame();
        }

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
  }, [isPlaying, playerRef, getPlayerFrame, seekPlayerToFrame]);

  const isTimelineLoading = useTimelineSettingsStore((s) => s.isTimelineLoading);

  useEffect(() => {
    if (!playerRef.current || isTimelineLoading) return;

    const initialFrame = usePlaybackStore.getState().currentFrame;
    ignorePlayerUpdatesRef.current = true;
    try {
      onPlayerSeek?.(initialFrame);
      playerRef.current.seekTo(initialFrame);
      lastSeekTargetRef.current = initialFrame;
    } catch (error) {
      logger.error('Failed to initialize Player frame:', error);
    }

    requestAnimationFrame(() => {
      ignorePlayerUpdatesRef.current = false;
    });

    const unsubscribe = usePlaybackStore.subscribe((state, prevState) => {
      if (!playerRef.current) return;

      const syncDecision = resolvePreviewPlayerTransportSyncDecision({
        prevCurrentFrame: prevState.currentFrame,
        currentFrame: state.currentFrame,
        prevPreviewFrame: prevState.previewFrame,
        previewFrame: state.previewFrame,
        isGizmoInteracting,
        isPlaying: state.isPlaying,
        playerFrame: getPlayerFrame(),
      });

      if (syncDecision.kind === 'none') return;
      seekPlayerToFrame(syncDecision.targetFrame);
    });

    return unsubscribe;
  }, [isTimelineLoading, playerRef, getPlayerFrame, seekPlayerToFrame, isGizmoInteracting]);

  return { ignorePlayerUpdatesRef };
}
