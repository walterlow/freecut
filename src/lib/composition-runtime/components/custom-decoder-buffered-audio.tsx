import React, { useEffect, useRef, useState, useCallback } from 'react';
import { interpolate, useSequenceContext } from '@/features/player/composition';
import { useVideoConfig, useIsPlaying } from '../hooks/use-player-compat';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { useItemKeyframesFromContext } from '../contexts/keyframes-context';
import { getPropertyKeyframes, interpolatePropertyValue } from '@/features/keyframes/utils/interpolation';
import {
  getOrDecodeAudio,
  getOrDecodeAudioForPlayback,
  isPreviewAudioDecodePending,
} from '../utils/audio-decode-cache';
import { createLogger } from '@/lib/logger';

const log = createLogger('CustomDecoderBufferedAudio');

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

  const lastSyncTimeRef = useRef<number>(0);
  const lastStartOffsetRef = useRef<number>(0);
  const lastStartRateRef = useRef<number>(playbackRate);
  const needsInitialSyncRef = useRef<boolean>(true);

  useEffect(() => {
    if (!mediaId || !src) return;

    let cancelled = false;
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

    return () => { cancelled = true; };
  }, [mediaId, src]);

  useEffect(() => {
    const ctx = getSharedAudioContext();
    if (!ctx) return;

    const gain = ctx.createGain();
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
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = audioVolume;
    }
  }, [audioVolume]);

  const stopSource = () => {
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch { /* already stopped */ }
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
  };

  useEffect(() => {
    if (!audioBuffer) return;

    const ctx = getSharedAudioContext();
    const gain = gainNodeRef.current;
    if (!ctx || !gain) return;

    const isPremounted = frame < 0;
    const targetTime = (trimBefore / fps) + (frame * playbackRate / fps);

    if (isPremounted) {
      stopSource();
      return;
    }

    if (playing) {
      const now = Date.now();

      let shouldStart = false;

      if (needsInitialSyncRef.current) {
        shouldStart = true;
      } else if (!sourceRef.current) {
        shouldStart = true;
      } else if (sourceRef.current.buffer !== audioBuffer) {
        // Audio buffer was upgraded (partial -> full), re-sync with new source.
        shouldStart = true;
      } else if (Math.abs(playbackRate - lastStartRateRef.current) > 0.0001) {
        shouldStart = true;
      } else {
        const elapsedSec = (now - lastSyncTimeRef.current) / 1000;
        const estimatedPosition = lastStartOffsetRef.current + elapsedSec * lastStartRateRef.current;
        const drift = estimatedPosition - targetTime;

        if (drift > 0.5 || drift < -0.2) {
          shouldStart = true;
        }
      }

      if (shouldStart) {
        // If we only have a partial decode and timeline position is beyond its duration,
        // wait for more bins/full decode instead of repeatedly starting at partial tail.
        if (targetTime >= audioBuffer.duration - 0.01 && isPreviewAudioDecodePending(mediaId)) {
          stopSource();
          return;
        }

        stopSource();

        const resumePromise = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
        resumePromise.then(() => {
          if (ctx.state !== 'running' || !gainNodeRef.current) return;

          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.playbackRate.value = playbackRate;
          source.connect(gain);
          source.onended = () => {
            if (sourceRef.current === source) {
              sourceRef.current = null;
            }
          };

          const clampedOffset = Math.max(0, Math.min(targetTime, audioBuffer.duration - 0.01));
          source.start(0, clampedOffset);
          sourceRef.current = source;

          lastSyncTimeRef.current = Date.now();
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
  }, [frame, fps, playing, playbackRate, trimBefore, audioBuffer, mediaId]);

  return null;
});
