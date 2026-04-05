/**
 * Hook for integrating the headless transport with timeline playback state.
 *
 * The renderer owns preview presentation. The transport is audio/clock only:
 * - committed transport seeks trigger transport seeks
 * - scrub and gizmo preview do not seek the transport
 * - play/pause state is synced from the store to the transport
 * - transport frame callbacks feed committed progress back into the store
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
  transportRef: React.RefObject<{ seekTo: (frame: number) => void; play: () => void; pause: () => void; getCurrentFrame: () => number; isPlaying: () => boolean } | null>,
  isGizmoInteracting = false,
  onTransportSeek?: (targetFrame: number) => void,
) {
  const isPlaying = usePlaybackStore((s) => s.isPlaying);

  const lastSeekTargetRef = useRef<number | null>(null);
  const ignoreTransportUpdatesRef = useRef<boolean>(false);
  const wasPlayingRef = useRef(isPlaying);

  const getTransportFrame = useCallback(() => {
    const frame = transportRef.current?.getCurrentFrame();
    return Number.isFinite(frame) ? Math.round(frame!) : null;
  }, [transportRef]);

  const seekTransportToFrame = useCallback((targetFrame: number) => {
    if (!transportRef.current) return;
    if (lastSeekTargetRef.current === targetFrame) return;

    const transportFrame = getTransportFrame();
    if (transportFrame !== null && transportFrame === targetFrame) {
      lastSeekTargetRef.current = targetFrame;
      return;
    }

    ignoreTransportUpdatesRef.current = true;
    try {
      onTransportSeek?.(targetFrame);
      transportRef.current.seekTo(targetFrame);
      lastSeekTargetRef.current = targetFrame;
    } catch (error) {
      logger.error('Failed to seek transport:', error);
    }

    requestAnimationFrame(() => {
      ignoreTransportUpdatesRef.current = false;
    });
  }, [transportRef, getTransportFrame, onTransportSeek]);

  useEffect(() => {
    if (!transportRef.current) return;

    const wasPlaying = wasPlayingRef.current;
    wasPlayingRef.current = isPlaying;

    try {
      const playbackState = usePlaybackStore.getState();
      const playbackCommand = resolvePreviewPlayerPlaybackCommand({
        isPlaying,
        wasPlaying,
        currentFrame: playbackState.currentFrame,
        previewFrame: playbackState.previewFrame,
        playerFrame: getTransportFrame(),
      });

      if (playbackCommand.kind === 'play') {
        const { commitPreviewFrame } = playbackState;
        if (playbackCommand.shouldSeekBeforePlay) {
          seekTransportToFrame(playbackCommand.startFrame);
        } else {
          lastSeekTargetRef.current = playbackCommand.startFrame;
        }
        if (playbackCommand.shouldClearPreviewFrame) {
          commitPreviewFrame();
        }

        if (!usePlaybackStore.getState().isPlaying) {
          ignoreTransportUpdatesRef.current = false;
          return;
        }
        ensureAudioContextResumed();
        ensureBufferedAudioContextResumed();
        ensurePitchCorrectedAudioContextResumed();
        transportRef.current?.play();
        ignoreTransportUpdatesRef.current = false;
        return;
      }

      if (playbackCommand.kind === 'pause') {
        transportRef.current.pause();
      }
    } catch (error) {
      logger.error('Failed to control playback:', error);
    }
  }, [isPlaying, transportRef, getTransportFrame, seekTransportToFrame]);

  const isTimelineLoading = useTimelineSettingsStore((s) => s.isTimelineLoading);

  useEffect(() => {
    if (!transportRef.current || isTimelineLoading) return;

    const initialFrame = usePlaybackStore.getState().currentFrame;
    ignoreTransportUpdatesRef.current = true;
    try {
      onTransportSeek?.(initialFrame);
      transportRef.current.seekTo(initialFrame);
      lastSeekTargetRef.current = initialFrame;
    } catch (error) {
      logger.error('Failed to initialize transport frame:', error);
    }

    requestAnimationFrame(() => {
      ignoreTransportUpdatesRef.current = false;
    });

    const unsubscribe = usePlaybackStore.subscribe((state, prevState) => {
      if (!transportRef.current) return;

      const syncDecision = resolvePreviewPlayerTransportSyncDecision({
        prevCurrentFrame: prevState.currentFrame,
        currentFrame: state.currentFrame,
        prevPreviewFrame: prevState.previewFrame,
        previewFrame: state.previewFrame,
        isGizmoInteracting,
        isPlaying: state.isPlaying,
        playerFrame: getTransportFrame(),
      });

      if (syncDecision.kind === 'none') return;
      seekTransportToFrame(syncDecision.targetFrame);
    });

    return unsubscribe;
  }, [isTimelineLoading, transportRef, getTransportFrame, seekTransportToFrame, isGizmoInteracting, onTransportSeek]);

  return { ignoreTransportUpdatesRef };
}
