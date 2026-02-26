import React, { useEffect, useRef, useState, useCallback } from 'react';
import { interpolate, useSequenceContext } from '@/features/player/composition';
import { useVideoConfig, useIsPlaying } from '../hooks/use-player-compat';
import { getAudioTargetTimeSeconds } from '../utils/video-timing';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { useItemKeyframesFromContext } from '../contexts/keyframes-context';
import { getPropertyKeyframes, interpolatePropertyValue } from '@/features/keyframes/utils/interpolation';
import {
  getOrDecodeAudio,
  isPreviewAudioDecodePending,
} from '../utils/audio-decode-cache';
import { createLogger } from '@/lib/logger';

const log = createLogger('CustomDecoderBufferedAudio');
const GAIN_RAMP_SECONDS = 0.008;
const STOP_GRACE_SECONDS = 0.002;
const PARTIAL_BUFFER_HEADROOM_SECONDS = 0.25;
const DRIFT_RESYNC_MIN_ELAPSED_SECONDS = 1.0;
const DRIFT_RESYNC_POSITIVE_THRESHOLD_SECONDS = 1.25;
const DRIFT_RESYNC_NEGATIVE_THRESHOLD_SECONDS = -0.75;
const WAIT_FOR_FULL_DECODE_BEFORE_PLAYBACK = true;

let sharedCtx: AudioContext | null = null;

function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  const Ctor = window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  if (sharedCtx === null || sharedCtx.state === 'closed') {
    sharedCtx = new Ctor();
  }
  return sharedCtx;
}

interface CustomDecoderBufferedAudioProps {
  src: string;
  mediaId: string;
  itemId: string;
  trimBefore?: number;
  sourceFps?: number;
  volume?: number;
  playbackRate?: number;
  muted?: boolean;
  durationInFrames: number;
  audioFadeIn?: number;
  audioFadeOut?: number;
  crossfadeFadeIn?: number;
  crossfadeFadeOut?: number;
}

export const CustomDecoderBufferedAudio: React.FC<CustomDecoderBufferedAudioProps> = React.memo(({
  src,
  mediaId,
  itemId,
  trimBefore = 0,
  sourceFps,
  volume = 0,
  playbackRate = 1,
  muted = false,
  durationInFrames,
  audioFadeIn = 0,
  audioFadeOut = 0,
  crossfadeFadeIn,
  crossfadeFadeOut,
}) => {
  const { fps } = useVideoConfig();
  const sequenceContext = useSequenceContext();
  const frame = sequenceContext?.localFrame ?? 0;
  const playing = useIsPlaying();

  const itemPreview = useGizmoStore(
    useCallback((s) => s.preview?.[itemId], [itemId])
  );
  const preview = itemPreview?.properties;

  const previewMasterVolume = usePlaybackStore((s) => s.volume);
  const previewMasterMuted = usePlaybackStore((s) => s.muted);

  const contextKeyframes = useItemKeyframesFromContext(itemId);
  const storeKeyframes = useTimelineStore(
    useCallback(
      (s) => s.keyframes.find((k) => k.itemId === itemId),
      [itemId]
    )
  );
  const itemKeyframes = contextKeyframes ?? storeKeyframes;

  const volumeKeyframes = getPropertyKeyframes(itemKeyframes, 'volume');
  const staticVolumeDb = preview?.volume ?? volume;
  const effectiveVolumeDb = volumeKeyframes.length > 0
    ? interpolatePropertyValue(volumeKeyframes, frame, staticVolumeDb)
    : staticVolumeDb;

  const effectiveFadeIn = preview?.audioFadeIn ?? audioFadeIn;
  const effectiveFadeOut = preview?.audioFadeOut ?? audioFadeOut;

  const fadeInFrames = crossfadeFadeIn !== undefined
    ? Math.min(crossfadeFadeIn, durationInFrames)
    : Math.min(effectiveFadeIn * fps, durationInFrames);
  const fadeOutFrames = crossfadeFadeOut !== undefined
    ? Math.min(crossfadeFadeOut, durationInFrames)
    : Math.min(effectiveFadeOut * fps, durationInFrames);

  const isCrossfade = crossfadeFadeIn !== undefined || crossfadeFadeOut !== undefined;

  let fadeMultiplier = 1;
  const hasFadeIn = fadeInFrames > 0;
  const hasFadeOut = fadeOutFrames > 0;

  if (hasFadeIn || hasFadeOut) {
    const fadeOutStart = durationInFrames - fadeOutFrames;

    if (isCrossfade) {
      if (hasFadeIn && frame < fadeInFrames) {
        const progress = frame / fadeInFrames;
        fadeMultiplier = Math.sin(progress * Math.PI / 2);
      } else if (hasFadeOut && frame >= fadeOutStart) {
        const progress = (frame - fadeOutStart) / fadeOutFrames;
        fadeMultiplier = Math.cos(progress * Math.PI / 2);
      }
    } else {
      if (hasFadeIn && hasFadeOut) {
        if (fadeInFrames >= fadeOutStart) {
          const midPoint = durationInFrames / 2;
          const peakVolume = Math.min(1, midPoint / Math.max(fadeInFrames, 1));
          fadeMultiplier = interpolate(
            frame,
            [0, midPoint, durationInFrames],
            [0, peakVolume, 0],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
          );
        } else {
          fadeMultiplier = interpolate(
            frame,
            [0, fadeInFrames, fadeOutStart, durationInFrames],
            [0, 1, 1, 0],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
          );
        }
      } else if (hasFadeIn) {
        fadeMultiplier = interpolate(
          frame,
          [0, fadeInFrames],
          [0, 1],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        );
      } else {
        fadeMultiplier = interpolate(
          frame,
          [fadeOutStart, durationInFrames],
          [1, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        );
      }
    }
  }

  const linearVolume = Math.pow(10, effectiveVolumeDb / 20);
  const itemVolume = muted ? 0 : Math.max(0, linearVolume * fadeMultiplier);
  const effectiveMasterVolume = previewMasterMuted ? 0 : previewMasterVolume;
  const audioVolume = itemVolume * effectiveMasterVolume;

  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);

  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioVolumeRef = useRef<number>(audioVolume);
  const startRequestIdRef = useRef<number>(0);
  const lastObservedFrameRef = useRef<number>(frame);

  const lastSyncContextTimeRef = useRef<number>(0);
  const lastStartOffsetRef = useRef<number>(0);
  const lastStartRateRef = useRef<number>(playbackRate);
  const needsInitialSyncRef = useRef<boolean>(true);

  useEffect(() => {
    if (!mediaId || !src) return;

    let cancelled = false;
    if (WAIT_FOR_FULL_DECODE_BEFORE_PLAYBACK) {
      getOrDecodeAudio(mediaId, src)
        .then((buffer) => {
          if (!cancelled) {
            setAudioBuffer(buffer);
            log.info('Full buffered audio ready', {
              mediaId,
              duration: buffer.duration.toFixed(2),
              sampleRate: buffer.sampleRate,
              channels: buffer.numberOfChannels,
            });
          }
        })
        .catch((err) => {
          if (!cancelled) {
            log.error('Failed to decode buffered audio', { mediaId, err });
          }
        });
    } else {
      // Legacy low-latency path: start from partial bins, then upgrade to full decode.
      import('../utils/audio-decode-cache')
        .then(({ getOrDecodeAudioForPlayback }) => getOrDecodeAudioForPlayback(mediaId, src, {
          minReadySeconds: 8,
          waitTimeoutMs: 6000,
        }))
        .then((buffer) => {
          if (!cancelled) {
            setAudioBuffer(buffer);
            log.info('Initial buffered audio ready', {
              mediaId,
              duration: buffer.duration.toFixed(2),
              sampleRate: buffer.sampleRate,
              channels: buffer.numberOfChannels,
            });
          }
        })
        .catch((err) => {
          if (!cancelled) {
            log.error('Failed to decode buffered audio', { mediaId, err });
          }
        });

      // Upgrade to full decoded buffer when background decode/reassembly completes.
      getOrDecodeAudio(mediaId, src)
        .then((buffer) => {
          if (!cancelled) {
            setAudioBuffer((current) => {
              if (current && current.length === buffer.length && current.sampleRate === buffer.sampleRate) {
                return current;
              }
              return buffer;
            });
          }
        })
        .catch((err) => {
          if (!cancelled) {
            log.error('Failed to finalize buffered audio decode', { mediaId, err });
          }
        });
    }

    return () => { cancelled = true; };
  }, [mediaId, src]);

  useEffect(() => {
    const ctx = getSharedAudioContext();
    if (!ctx) return;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    gainNodeRef.current = gain;

    return () => {
      if (sourceRef.current) {
        try { sourceRef.current.stop(); } catch { /* already stopped */ }
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      gain.disconnect();
      gainNodeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const resume = () => {
      const ctx = getSharedAudioContext();
      if (ctx && ctx.state === 'suspended') {
        void ctx.resume().catch(() => undefined);
      }
    };

    window.addEventListener('pointerdown', resume, { capture: true });
    window.addEventListener('keydown', resume, { capture: true });

    return () => {
      window.removeEventListener('pointerdown', resume, { capture: true });
      window.removeEventListener('keydown', resume, { capture: true });
    };
  }, []);

  useEffect(() => {
    const ctx = getSharedAudioContext();
    const gain = gainNodeRef.current;
    if (!ctx || !gain) return;

    audioVolumeRef.current = audioVolume;
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(Math.max(0, audioVolume), now + GAIN_RAMP_SECONDS);
  }, [audioVolume]);

  const stopSource = useCallback((fadeOut: boolean = true) => {
    startRequestIdRef.current += 1;

    const source = sourceRef.current;
    if (!source) return;
    sourceRef.current = null;

    const ctx = getSharedAudioContext();
    const gain = gainNodeRef.current;

    if (fadeOut && ctx && gain) {
      const now = ctx.currentTime;
      const stopAt = now + GAIN_RAMP_SECONDS;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, stopAt);
      try {
        source.stop(stopAt + STOP_GRACE_SECONDS);
      } catch {
        try { source.stop(); } catch { /* already stopped */ }
      }
      return;
    }

    try { source.stop(); } catch { /* already stopped */ }
  }, []);

  useEffect(() => {
    if (!audioBuffer) return;

    const ctx = getSharedAudioContext();
    const gain = gainNodeRef.current;
    if (!ctx || !gain) return;

    const isPremounted = frame < 0;
    const effectiveSourceFps = sourceFps ?? fps;
    // IMPORTANT: trimBefore is in source FPS frames — must use effectiveSourceFps, not fps
    const targetTime = getAudioTargetTimeSeconds(trimBefore, effectiveSourceFps, frame, playbackRate, fps);
    const frameDelta = frame - lastObservedFrameRef.current;
    lastObservedFrameRef.current = frame;
    const frameSeekJumpThreshold = Math.max(8, Math.round(fps * 0.5));

    if (isPremounted) {
      stopSource(false);
      needsInitialSyncRef.current = true;
      return;
    }

    if (playing) {
      let shouldStart = false;
      const currentSource = sourceRef.current;

      if (needsInitialSyncRef.current) {
        shouldStart = true;
      } else if (!currentSource) {
        shouldStart = true;
      } else if (Math.abs(playbackRate - lastStartRateRef.current) > 0.0001) {
        shouldStart = true;
      } else if (Math.abs(frameDelta) > frameSeekJumpThreshold) {
        // Treat large frame jumps as explicit seeks and re-sync immediately.
        shouldStart = true;
      } else if (currentSource.buffer !== audioBuffer) {
        // Buffer changed (partial -> full). Avoid immediate restart thrash;
        // only re-sync if current source is close to running out.
        const sourceDuration = currentSource.buffer?.duration ?? 0;
        const remainingCoverage = sourceDuration - targetTime;
        if (remainingCoverage <= PARTIAL_BUFFER_HEADROOM_SECONDS) {
          shouldStart = true;
        }
      } else {
        // While decode is pending, avoid drift-driven seeks because frame cadence
        // can be jittery during warm-up and causes audible restart clicks.
        if (!isPreviewAudioDecodePending(mediaId)) {
          const elapsedSec = ctx.currentTime - lastSyncContextTimeRef.current;
          const estimatedPosition = lastStartOffsetRef.current + elapsedSec * lastStartRateRef.current;
          const drift = estimatedPosition - targetTime;

          if (
            elapsedSec > DRIFT_RESYNC_MIN_ELAPSED_SECONDS
            && (drift > DRIFT_RESYNC_POSITIVE_THRESHOLD_SECONDS || drift < DRIFT_RESYNC_NEGATIVE_THRESHOLD_SECONDS)
          ) {
            shouldStart = true;
          }
        }
      }

      if (shouldStart) {
        // If we only have a partial decode and timeline position is beyond its duration,
        // wait for more bins/full decode instead of repeatedly starting at partial tail.
        if (targetTime >= audioBuffer.duration - PARTIAL_BUFFER_HEADROOM_SECONDS && isPreviewAudioDecodePending(mediaId)) {
          stopSource();
          return;
        }

        stopSource();
        const startRequestId = ++startRequestIdRef.current;

        const resumePromise = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
        resumePromise.then(() => {
          if (startRequestId !== startRequestIdRef.current) return;

          const liveGain = gainNodeRef.current;
          if (ctx.state !== 'running' || !liveGain) return;

          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.playbackRate.value = playbackRate;
          source.connect(liveGain);
          source.onended = () => {
            source.disconnect();
            if (sourceRef.current === source) {
              sourceRef.current = null;
            }
          };

          const clampedOffset = Math.max(0, Math.min(targetTime, audioBuffer.duration - 0.01));
          const startAt = ctx.currentTime;
          const startVolume = Math.max(0, audioVolumeRef.current);
          liveGain.gain.cancelScheduledValues(startAt);
          liveGain.gain.setValueAtTime(0, startAt);
          liveGain.gain.linearRampToValueAtTime(startVolume, startAt + GAIN_RAMP_SECONDS);

          source.start(startAt, clampedOffset);
          sourceRef.current = source;

          lastSyncContextTimeRef.current = startAt;
          lastStartOffsetRef.current = clampedOffset;
          lastStartRateRef.current = playbackRate;
          needsInitialSyncRef.current = false;
        }).catch((err) => {
          log.warn('Failed to resume/start buffered custom decoder audio context', {
            mediaId,
            err,
          });
        });
      }
    } else {
      stopSource();
      needsInitialSyncRef.current = true;
    }
  }, [frame, fps, playing, playbackRate, trimBefore, audioBuffer, mediaId, sourceFps, stopSource]);

  return null;
});
