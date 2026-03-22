import { useEffect } from 'react';
import { useClock } from '@/features/composition-runtime/deps/player';
import { useVideoSourcePool } from '@/features/composition-runtime/deps/player';
import { getVideoTargetTimeSeconds } from '../utils/video-timing';
import { useIsPlaying } from './use-player-compat';

export interface TransitionSyncParticipant {
  poolClipId: string;
  safeTrimBefore: number;
  sourceFps: number;
  playbackRate: number;
  sequenceFrameOffset: number;
  role: 'leader' | 'follower';
}

export function getTransitionSyncPlaybackRate(
  nominalRate: number,
  driftSeconds: number,
  role: 'leader' | 'follower',
): number {
  if (role === 'leader') {
    return nominalRate;
  }

  const maxAdjustment = Math.max(0.03, Math.abs(nominalRate) * 0.06);
  const correction = -driftSeconds * 0.25;
  return Math.max(
    nominalRate - maxAdjustment,
    Math.min(nominalRate + maxAdjustment, nominalRate + correction),
  );
}

export function useTransitionParticipantSync(
  participants: TransitionSyncParticipant[],
  groupMinFrom: number,
  timelineFps: number,
): void {
  const clock = useClock();
  const pool = useVideoSourcePool();
  const isPlaying = useIsPlaying();

  useEffect(() => {
    if (!isPlaying || participants.length < 2) {
      return;
    }

    const syncAtFrame = (globalFrame: number) => {
      const sequenceLocalFrame = globalFrame - groupMinFrom;

      for (const participant of participants) {
        const video = pool.getClipElement(participant.poolClipId);
        if (!video) continue;

        const relativeFrame = sequenceLocalFrame - participant.sequenceFrameOffset;
        const startTime = participant.safeTrimBefore / participant.sourceFps;
        const videoDuration = video.duration || Infinity;
        const clampTime = (time: number) => Math.min(Math.max(0, time), videoDuration - 0.05);

        if (relativeFrame < 0) {
          // Skip premount pause/seek if the element is held by a transition
          // session — the canvas overlay needs it playing for frame reads.
          if (video.dataset.transitionHold !== '1') {
            const premountTarget = clampTime(startTime);
            if (!video.paused) {
              video.pause();
            }
            if (video.readyState >= 1 && Math.abs(video.currentTime - premountTarget) > 0.016) {
              try {
                video.currentTime = premountTarget;
              } catch {
                // Ignore transient seek failures while element is still settling.
              }
            }
            video.playbackRate = participant.playbackRate;
          }
          continue;
        }

        const targetTime = clampTime(
          getVideoTargetTimeSeconds(
            participant.safeTrimBefore,
            participant.sourceFps,
            sequenceLocalFrame,
            participant.playbackRate,
            timelineFps,
            participant.sequenceFrameOffset,
          ),
        );
        const drift = video.currentTime - targetTime;
        const hardSyncThreshold = participant.role === 'leader' ? 0.12 : 0.06;

        if (Math.abs(drift) > hardSyncThreshold && video.readyState >= 1) {
          try {
            video.currentTime = targetTime;
          } catch {
            // Ignore transient seek failures while element is still settling.
          }
          video.playbackRate = participant.playbackRate;
        } else {
          video.playbackRate = getTransitionSyncPlaybackRate(
            participant.playbackRate,
            drift,
            participant.role,
          );
        }

        if (video.paused && video.readyState >= 2) {
          video.play().catch(() => {
            // Best-effort resume while playback is active.
          });
        }
      }
    };

    syncAtFrame(clock.currentFrame);
    return clock.onFrameChange(syncAtFrame);
  }, [clock, groupMinFrom, isPlaying, participants, pool, timelineFps]);
}
