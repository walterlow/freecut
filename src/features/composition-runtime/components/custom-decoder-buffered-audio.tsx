import React, { useEffect, useRef, useState, useCallback } from 'react';
import { getAudioTargetTimeSeconds } from '../utils/video-timing';
import {
  getOrDecodeAudio,
  getOrDecodeAudioSliceForPlayback,
  isPreviewAudioDecodePending,
  type PlaybackAudioSlice,
} from '../utils/audio-decode-cache';
import { createLogger } from '@/shared/logging/logger';
import type { AudioPlaybackProps } from './audio-playback-props';
import { useAudioPlaybackState } from './hooks/use-audio-playback-state';

const log = createLogger('CustomDecoderBufferedAudio');
const GAIN_RAMP_SECONDS = 0.008;
const STOP_GRACE_SECONDS = 0.002;
const PARTIAL_BUFFER_HEADROOM_SECONDS = 0.25;
const DRIFT_RESYNC_MIN_ELAPSED_SECONDS = 1.0;
const DRIFT_RESYNC_POSITIVE_THRESHOLD_SECONDS = 1.25;
const DRIFT_RESYNC_NEGATIVE_THRESHOLD_SECONDS = -0.75;
const BACKGROUND_RESYNC_GRACE_MS = 250;
const INITIAL_PLAYABLE_BUFFER_SECONDS = 2;
const PARTIAL_BUFFER_EXTENSION_TRIGGER_SECONDS = 1.25;
const PARTIAL_BUFFER_EXTENSION_READY_SECONDS = 3;
// Prefer a playable partial decode first, then upgrade to the full buffer in
// the background. This keeps custom-decoded formats like Vorbis responsive on
// first play after import/refresh instead of waiting for the whole file.
const WAIT_FOR_FULL_DECODE_BEFORE_PLAYBACK = false;

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

interface CustomDecoderBufferedAudioProps extends AudioPlaybackProps {
  src: string;
  mediaId: string;
}

function getSliceCoverageEnd(slice: PlaybackAudioSlice): number {
  return slice.startTime + slice.buffer.duration;
}

function shouldReplaceSlice(
  current: PlaybackAudioSlice | null,
  next: PlaybackAudioSlice,
): boolean {
  if (!current) {
    return true;
  }
  if (current.isComplete) {
    return next.isComplete && next.buffer.length !== current.buffer.length;
  }
  if (next.isComplete) {
    return true;
  }

  const currentCoverageEnd = getSliceCoverageEnd(current);
  const nextCoverageEnd = getSliceCoverageEnd(next);
  if (nextCoverageEnd > currentCoverageEnd + 0.05) {
    return true;
  }
  if (next.startTime < current.startTime - 0.05) {
    return true;
  }
  return false;
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
  audioFadeInCurve = 0,
  audioFadeOutCurve = 0,
  audioFadeInCurveX = 0.52,
  audioFadeOutCurveX = 0.52,
  clipFadeSpans,
  contentStartOffsetFrames = 0,
  contentEndOffsetFrames = 0,
  fadeInDelayFrames = 0,
  fadeOutLeadFrames = 0,
  crossfadeFadeIn,
  crossfadeFadeOut,
  liveGainItemIds,
  volumeMultiplier = 1,
}) => {
  const { frame, fps, playing, resolvedVolume: audioVolume } = useAudioPlaybackState({
    itemId,
    liveGainItemIds,
    volume,
    muted,
    durationInFrames,
    audioFadeIn,
    audioFadeOut,
    audioFadeInCurve,
    audioFadeOutCurve,
    audioFadeInCurveX,
    audioFadeOutCurveX,
    clipFadeSpans,
    contentStartOffsetFrames,
    contentEndOffsetFrames,
    fadeInDelayFrames,
    fadeOutLeadFrames,
    crossfadeFadeIn,
    crossfadeFadeOut,
    volumeMultiplier,
  });

  const [audioSlice, setAudioSlice] = useState<PlaybackAudioSlice | null>(null);

  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioVolumeRef = useRef<number>(audioVolume);
  const startRequestIdRef = useRef<number>(0);
  const lastObservedFrameRef = useRef<number>(frame);
  const wasBackgroundedRef = useRef<boolean>(false);
  const backgroundResyncGraceUntilRef = useRef<number>(0);
  const decodeSeedRef = useRef<{ key: string; targetTime: number } | null>(null);

  const lastSyncContextTimeRef = useRef<number>(0);
  const lastStartOffsetRef = useRef<number>(0);
  const lastStartRateRef = useRef<number>(playbackRate);
  const lastBufferStartTimeRef = useRef<number>(0);
  const needsInitialSyncRef = useRef<boolean>(true);
  const pendingExtensionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!mediaId || !src) return;

    let cancelled = false;
    const effectiveSourceFps = sourceFps ?? fps;
    const decodeSeedKey = `${mediaId}:${src}:${trimBefore}:${effectiveSourceFps}:${playbackRate}`;
    if (decodeSeedRef.current?.key !== decodeSeedKey) {
      decodeSeedRef.current = {
        key: decodeSeedKey,
        targetTime: getAudioTargetTimeSeconds(
          trimBefore,
          effectiveSourceFps,
          Math.max(0, frame),
          playbackRate,
          fps,
        ),
      };
    }
    const initialTargetTime = decodeSeedRef.current.targetTime;
    if (WAIT_FOR_FULL_DECODE_BEFORE_PLAYBACK) {
      getOrDecodeAudio(mediaId, src)
        .then((buffer) => {
          if (!cancelled) {
            setAudioSlice({ buffer, startTime: 0, isComplete: true });
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
      getOrDecodeAudioSliceForPlayback(mediaId, src, {
        minReadySeconds: INITIAL_PLAYABLE_BUFFER_SECONDS,
        waitTimeoutMs: 6000,
        targetTimeSeconds: initialTargetTime,
      })
        .then((slice) => {
          if (!cancelled) {
            setAudioSlice((current) => {
              if (!shouldReplaceSlice(current, slice)) {
                return current;
              }
              return slice;
            });
            log.info('Initial buffered audio ready', {
              mediaId,
              duration: slice.buffer.duration.toFixed(2),
              sampleRate: slice.buffer.sampleRate,
              channels: slice.buffer.numberOfChannels,
              startTime: slice.startTime.toFixed(2),
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
            setAudioSlice((current) => {
              if (current?.isComplete && current.buffer.length === buffer.length && current.buffer.sampleRate === buffer.sampleRate) {
                return current;
              }
              return { buffer, startTime: 0, isComplete: true };
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
  }, [mediaId, src, trimBefore, sourceFps, fps, playbackRate]);

  useEffect(() => {
    const currentSlice = audioSlice;
    if (!currentSlice || currentSlice.isComplete || !playing) {
      pendingExtensionKeyRef.current = null;
      return;
    }
    if (!isPreviewAudioDecodePending(mediaId)) {
      pendingExtensionKeyRef.current = null;
      return;
    }

    const effectiveSourceFps = sourceFps ?? fps;
    const targetTime = getAudioTargetTimeSeconds(trimBefore, effectiveSourceFps, frame, playbackRate, fps);
    const coverageEnd = getSliceCoverageEnd(currentSlice);
    const remainingCoverage = coverageEnd - targetTime;
    const isTargetOutsideSlice = targetTime < currentSlice.startTime || targetTime >= coverageEnd;

    if (!isTargetOutsideSlice && remainingCoverage > PARTIAL_BUFFER_EXTENSION_TRIGGER_SECONDS) {
      return;
    }

    const requestKey = `${mediaId}:${src}:${playbackRate}:${targetTime.toFixed(3)}`;
    if (pendingExtensionKeyRef.current === requestKey) {
      return;
    }
    pendingExtensionKeyRef.current = requestKey;

    let cancelled = false;
    getOrDecodeAudioSliceForPlayback(mediaId, src, {
      minReadySeconds: PARTIAL_BUFFER_EXTENSION_READY_SECONDS,
      waitTimeoutMs: 6000,
      targetTimeSeconds: Math.max(0, targetTime),
    })
      .then((nextSlice) => {
        if (cancelled) {
          return;
        }
        setAudioSlice((current) => {
          if (!shouldReplaceSlice(current, nextSlice)) {
            return current;
          }
          return nextSlice;
        });
      })
      .catch((err) => {
        if (!cancelled) {
          log.warn('Failed to extend buffered custom decoder audio slice', {
            mediaId,
            targetTime,
            err,
          });
        }
      })
      .finally(() => {
        if (!cancelled && pendingExtensionKeyRef.current === requestKey) {
          pendingExtensionKeyRef.current = null;
        }
      });

    return () => {
      cancelled = true;
      if (pendingExtensionKeyRef.current === requestKey) {
        pendingExtensionKeyRef.current = null;
      }
    };
  }, [audioSlice, frame, fps, mediaId, playbackRate, playing, sourceFps, src, trimBefore]);

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
    const markBackgrounded = () => {
      backgroundResyncGraceUntilRef.current = 0;
      wasBackgroundedRef.current = true;
    };
    const markForegrounded = () => {
      if (!wasBackgroundedRef.current) return;
      backgroundResyncGraceUntilRef.current = performance.now() + BACKGROUND_RESYNC_GRACE_MS;
      const ctx = getSharedAudioContext();
      if (ctx?.state === 'suspended') {
        void ctx.resume().catch(() => undefined);
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        markBackgrounded();
      } else {
        markForegrounded();
      }
    };

    const handleWindowBlur = () => {
      if (document.hidden) return;
      markBackgrounded();
    };
    const handleWindowFocus = () => {
      markForegrounded();
    };
    const handlePageHide = () => {
      markBackgrounded();
    };
    const handlePageShow = () => {
      markForegrounded();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  useEffect(() => {
    const ctx = getSharedAudioContext();
    const gain = gainNodeRef.current;
    if (!ctx || !gain) return;

    const safeVolume = Number.isFinite(audioVolume) ? Math.max(0, audioVolume) : 0;
    audioVolumeRef.current = safeVolume;
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(safeVolume, now + GAIN_RAMP_SECONDS);
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
    const audioBuffer = audioSlice?.buffer ?? null;
    if (!audioBuffer) return;

    const ctx = getSharedAudioContext();
    const gain = gainNodeRef.current;
    if (!ctx || !gain) return;

    const isPremounted = frame < 0;
    const effectiveSourceFps = sourceFps ?? fps;
    // IMPORTANT: trimBefore is in source FPS frames â€” must use effectiveSourceFps, not fps
    const targetTime = getAudioTargetTimeSeconds(trimBefore, effectiveSourceFps, frame, playbackRate, fps);
    const audioStartTime = audioSlice?.startTime ?? 0;
    const targetOffsetInBuffer = targetTime - audioStartTime;
    const frameDelta = frame - lastObservedFrameRef.current;
    lastObservedFrameRef.current = frame;
    const frameSeekJumpThreshold = Math.max(8, Math.round(fps * 0.5));
    const isBackgrounded =
      document.hidden
      || (typeof document.hasFocus === 'function' && !document.hasFocus());
    const backgroundGraceActive = performance.now() < backgroundResyncGraceUntilRef.current;
    const shouldIgnoreBackgroundResync = isBackgrounded || backgroundGraceActive;

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
      } else if (!shouldIgnoreBackgroundResync && Math.abs(frameDelta) > frameSeekJumpThreshold) {
        // Treat large frame jumps as explicit seeks and re-sync immediately.
        shouldStart = true;
      } else if (currentSource.buffer !== audioBuffer) {
        // Buffer changed (partial -> full). Avoid immediate restart thrash;
        // only re-sync if current source is close to running out.
        const sourceDuration = currentSource.buffer?.duration ?? 0;
        const remainingCoverage = (lastBufferStartTimeRef.current + sourceDuration) - targetTime;
        if (remainingCoverage <= PARTIAL_BUFFER_HEADROOM_SECONDS) {
          shouldStart = true;
        }
      } else {
        // While decode is pending, avoid drift-driven seeks because frame cadence
        // can be jittery during warm-up and causes audible restart clicks.
        if (!shouldIgnoreBackgroundResync && !isPreviewAudioDecodePending(mediaId)) {
          const elapsedSec = ctx.currentTime - lastSyncContextTimeRef.current;
          const estimatedPosition = lastStartOffsetRef.current + elapsedSec * lastStartRateRef.current;
          const drift = estimatedPosition - targetOffsetInBuffer;

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
        if (
          (targetOffsetInBuffer < 0 || targetOffsetInBuffer >= audioBuffer.duration - PARTIAL_BUFFER_HEADROOM_SECONDS)
          && isPreviewAudioDecodePending(mediaId)
        ) {
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

          const clampedOffset = Math.max(0, Math.min(targetOffsetInBuffer, audioBuffer.duration - 0.01));
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
          lastBufferStartTimeRef.current = audioStartTime;
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

    if (!isBackgrounded && !backgroundGraceActive && wasBackgroundedRef.current) {
      wasBackgroundedRef.current = false;
    }
  }, [audioSlice, frame, fps, playing, playbackRate, trimBefore, mediaId, sourceFps, stopSource]);

  return null;
});
