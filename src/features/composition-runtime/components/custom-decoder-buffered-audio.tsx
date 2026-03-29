import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSequenceContext } from '@/features/composition-runtime/deps/player';
import { useVideoConfig, useIsPlaying } from '../hooks/use-player-compat';
import { getAudioTargetTimeSeconds } from '../utils/video-timing';
import { usePlaybackStore } from '@/features/composition-runtime/deps/stores';
import { useGizmoStore } from '@/features/composition-runtime/deps/stores';
import { useTimelineStore } from '@/features/composition-runtime/deps/stores';
import { useItemKeyframesFromContext } from '../contexts/keyframes-context';
import { getPropertyKeyframes, interpolatePropertyValue } from '@/features/composition-runtime/deps/keyframes';
import { getAudioClipFadeMultiplier, getAudioFadeMultiplier, type AudioClipFadeSpan } from '@/shared/utils/audio-fade-curve';
import { useMixerLiveGainEpoch, getMixerLiveGain } from '@/shared/state/mixer-live-gain';
import {
  getOrDecodeAudio,
  getOrDecodeAudioForPlayback,
  isPreviewAudioDecodePending,
} from '../utils/audio-decode-cache';
import { createLogger } from '@/shared/logging/logger';

const log = createLogger('CustomDecoderBufferedAudio');
const GAIN_RAMP_SECONDS = 0.008;
const STOP_GRACE_SECONDS = 0.002;
const PARTIAL_BUFFER_HEADROOM_SECONDS = 0.25;
const DRIFT_RESYNC_MIN_ELAPSED_SECONDS = 1.0;
const DRIFT_RESYNC_POSITIVE_THRESHOLD_SECONDS = 1.25;
const DRIFT_RESYNC_NEGATIVE_THRESHOLD_SECONDS = -0.75;
const BACKGROUND_RESYNC_GRACE_MS = 250;
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
  audioFadeInCurve?: number;
  audioFadeOutCurve?: number;
  audioFadeInCurveX?: number;
  audioFadeOutCurveX?: number;
  clipFadeSpans?: AudioClipFadeSpan[];
  contentStartOffsetFrames?: number;
  contentEndOffsetFrames?: number;
  fadeInDelayFrames?: number;
  fadeOutLeadFrames?: number;
  crossfadeFadeIn?: number;
  crossfadeFadeOut?: number;
  volumeMultiplier?: number;
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
  volumeMultiplier = 1,
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

  const clipFadeMultiplier = clipFadeSpans
    ? getAudioClipFadeMultiplier(frame, clipFadeSpans)
    : getAudioFadeMultiplier({
      frame,
      durationInFrames,
      fadeInFrames: effectiveFadeIn * fps,
      fadeOutFrames: effectiveFadeOut * fps,
      contentStartOffsetFrames,
      contentEndOffsetFrames,
      fadeInDelayFrames,
      fadeOutLeadFrames,
      fadeInCurve: preview?.audioFadeInCurve ?? audioFadeInCurve,
      fadeOutCurve: preview?.audioFadeOutCurve ?? audioFadeOutCurve,
      fadeInCurveX: preview?.audioFadeInCurveX ?? audioFadeInCurveX,
      fadeOutCurveX: preview?.audioFadeOutCurveX ?? audioFadeOutCurveX,
    });

  const fadeMultiplier = clipFadeMultiplier * getAudioFadeMultiplier({
    frame,
    durationInFrames,
    fadeInFrames: crossfadeFadeIn,
    fadeOutFrames: crossfadeFadeOut,
    useEqualPower: true,
  });

  const linearVolume = Math.pow(10, effectiveVolumeDb / 20);
  const itemVolume = muted ? 0 : Math.max(0, linearVolume * fadeMultiplier);
  const effectiveMasterVolume = previewMasterMuted ? 0 : previewMasterVolume;

  // Mixer fader live gain — updated during drag without re-rendering the composition
  useMixerLiveGainEpoch();
  const mixerGain = getMixerLiveGain(itemId);

  const audioVolume = itemVolume * effectiveMasterVolume * Math.max(0, volumeMultiplier) * mixerGain;

  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);

  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioVolumeRef = useRef<number>(audioVolume);
  const startRequestIdRef = useRef<number>(0);
  const lastObservedFrameRef = useRef<number>(frame);
  const wasBackgroundedRef = useRef<boolean>(false);
  const backgroundResyncGraceUntilRef = useRef<number>(0);

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
      getOrDecodeAudioForPlayback(mediaId, src, {
        minReadySeconds: 8,
        waitTimeoutMs: 6000,
      })
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

    audioVolumeRef.current = audioVolume;
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    const safeVolume = Number.isFinite(audioVolume) ? Math.max(0, audioVolume) : 0;
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
    if (!audioBuffer) return;

    const ctx = getSharedAudioContext();
    const gain = gainNodeRef.current;
    if (!ctx || !gain) return;

    const isPremounted = frame < 0;
    const effectiveSourceFps = sourceFps ?? fps;
    // IMPORTANT: trimBefore is in source FPS frames â€” must use effectiveSourceFps, not fps
    const targetTime = getAudioTargetTimeSeconds(trimBefore, effectiveSourceFps, frame, playbackRate, fps);
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
        const remainingCoverage = sourceDuration - targetTime;
        if (remainingCoverage <= PARTIAL_BUFFER_HEADROOM_SECONDS) {
          shouldStart = true;
        }
      } else {
        // While decode is pending, avoid drift-driven seeks because frame cadence
        // can be jittery during warm-up and causes audible restart clicks.
        if (!shouldIgnoreBackgroundResync && !isPreviewAudioDecodePending(mediaId)) {
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

    if (!isBackgrounded && !backgroundGraceActive && wasBackgroundedRef.current) {
      wasBackgroundedRef.current = false;
    }
  }, [frame, fps, playing, playbackRate, trimBefore, audioBuffer, mediaId, sourceFps, stopSource]);

  return null;
});
