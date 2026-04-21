import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SoundTouchWorkletAudio } from './soundtouch-worklet-audio';
import { CustomDecoderBufferedAudio } from './custom-decoder-buffered-audio';
import { NativePitchCorrectedAudio } from './pitch-corrected-audio';
import type { AudioPlaybackProps } from './audio-playback-props';
import { getOrDecodeAudio, getOrDecodeAudioSliceForPlayback } from '../utils/audio-decode-cache';
import { audioBufferToWavBlob } from '../utils/audio-buffer-wav';
import { createLogger } from '@/shared/logging/logger';
import { getAudioTargetTimeSeconds } from '../utils/video-timing';
import { useAudioPlaybackState } from './hooks/use-audio-playback-state';
import { useGizmoStore } from '@/features/composition-runtime/deps/stores';
import {
  hasAudioPitchOverride,
  isAudioPitchShiftActive,
  resolvePreviewAudioPitchShiftSemitones,
} from '@/shared/utils/audio-pitch';

const log = createLogger('CustomDecoderAudio');
const PARTIAL_WAV_READY_SECONDS = 2;
const PARTIAL_WAV_WAIT_TIMEOUT_MS = 6000;
const PARTIAL_WAV_EXTENSION_TRIGGER_SECONDS = 1.25;
const PARTIAL_WAV_EXTENSION_READY_SECONDS = 3;
const BACKGROUND_FULL_DECODE_DELAY_MS = 1500;
const BACKGROUND_FULL_DECODE_BACKSTOP_MS = 4000;

interface CustomDecoderAudioProps extends AudioPlaybackProps {
  src: string;
  mediaId: string;
}

interface DecodedPitchSource {
  buffer: AudioBuffer;
  sourceStartOffsetSec: number;
  coverageEndSec: number;
  isComplete: boolean;
}

interface DecodedPitchFallbackAudioProps extends AudioPlaybackProps {
  audioBuffer: AudioBuffer;
  sourceStartOffsetSec: number;
}

const DecodedPitchFallbackAudio: React.FC<DecodedPitchFallbackAudioProps> = ({
  audioBuffer,
  sourceStartOffsetSec,
  itemId,
  liveGainItemIds,
  trimBefore,
  sourceFps,
  volume,
  playbackRate,
  muted,
  durationInFrames,
  audioFadeIn,
  audioFadeOut,
  audioFadeInCurve,
  audioFadeOutCurve,
  audioFadeInCurveX,
  audioFadeOutCurveX,
  audioPitchSemitones,
  audioPitchCents,
  audioPitchShiftSemitones,
  audioEqStages,
  clipFadeSpans,
  contentStartOffsetFrames,
  contentEndOffsetFrames,
  fadeInDelayFrames,
  fadeOutLeadFrames,
  crossfadeFadeIn,
  crossfadeFadeOut,
  volumeMultiplier,
}) => {
  const [decodedSrc, setDecodedSrc] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(audioBufferToWavBlob(audioBuffer));
    setDecodedSrc(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [audioBuffer]);

  if (!decodedSrc) {
    return null;
  }

  return (
    <NativePitchCorrectedAudio
      src={decodedSrc}
      itemId={itemId}
      liveGainItemIds={liveGainItemIds}
      trimBefore={trimBefore}
      sourceFps={sourceFps}
      sourceStartOffsetSec={sourceStartOffsetSec}
      volume={volume}
      playbackRate={playbackRate}
      audioPitchSemitones={audioPitchSemitones}
      audioPitchCents={audioPitchCents}
      audioPitchShiftSemitones={audioPitchShiftSemitones}
      muted={muted}
      durationInFrames={durationInFrames}
      audioFadeIn={audioFadeIn}
      audioFadeOut={audioFadeOut}
      audioFadeInCurve={audioFadeInCurve}
      audioFadeOutCurve={audioFadeOutCurve}
      audioFadeInCurveX={audioFadeInCurveX}
      audioFadeOutCurveX={audioFadeOutCurveX}
      audioEqStages={audioEqStages}
      clipFadeSpans={clipFadeSpans}
      contentStartOffsetFrames={contentStartOffsetFrames}
      contentEndOffsetFrames={contentEndOffsetFrames}
      fadeInDelayFrames={fadeInDelayFrames}
      fadeOutLeadFrames={fadeOutLeadFrames}
      crossfadeFadeIn={crossfadeFadeIn}
      crossfadeFadeOut={crossfadeFadeOut}
      volumeMultiplier={volumeMultiplier}
    />
  );
};

function shouldReplaceDecodedPitchSource(
  current: DecodedPitchSource | null,
  next: DecodedPitchSource,
): boolean {
  if (!current) {
    return true;
  }
  if (current.isComplete) {
    return next.isComplete
      && (
        current.buffer.length !== next.buffer.length
        || current.buffer.sampleRate !== next.buffer.sampleRate
      );
  }
  if (next.isComplete) {
    return true;
  }
  if (next.coverageEndSec > current.coverageEndSec + 0.05) {
    return true;
  }
  if (next.sourceStartOffsetSec < current.sourceStartOffsetSec - 0.05) {
    return true;
  }
  return false;
}


const CustomDecoderPitchPreservedAudio: React.FC<CustomDecoderAudioProps> = ({
  src,
  mediaId,
  itemId,
  liveGainItemIds,
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
  audioPitchSemitones,
  audioPitchCents,
  audioPitchShiftSemitones,
  audioEqStages,
  clipFadeSpans,
  contentStartOffsetFrames,
  contentEndOffsetFrames,
  fadeInDelayFrames,
  fadeOutLeadFrames,
  crossfadeFadeIn,
  crossfadeFadeOut,
  volumeMultiplier = 1,
}) => {
  const { frame, fps, playing } = useAudioPlaybackState({
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
    audioPitchSemitones,
    audioPitchCents,
    audioPitchShiftSemitones,
    audioEqStages,
    clipFadeSpans,
    contentStartOffsetFrames,
    contentEndOffsetFrames,
    fadeInDelayFrames,
    fadeOutLeadFrames,
    crossfadeFadeIn,
    crossfadeFadeOut,
    volumeMultiplier,
  });
  const [decodedSource, setDecodedSource] = useState<DecodedPitchSource | null>(null);
  const pendingExtensionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!mediaId || !src) return;

    let cancelled = false;
    let fullDecodeStarted = false;
    let scheduledFullDecodeAtMs = Number.POSITIVE_INFINITY;
    let fullDecodeTimer: ReturnType<typeof setTimeout> | null = null;
    const effectiveSourceFps = sourceFps ?? 30;
    const clipStartTime = Math.max(0, trimBefore / effectiveSourceFps);
    const clearScheduledFullDecode = () => {
      scheduledFullDecodeAtMs = Number.POSITIVE_INFINITY;
      if (fullDecodeTimer !== null) {
        clearTimeout(fullDecodeTimer);
        fullDecodeTimer = null;
      }
    };
    const startFullDecode = () => {
      if (cancelled || fullDecodeStarted) return;
      clearScheduledFullDecode();
      fullDecodeStarted = true;
      getOrDecodeAudio(mediaId, src)
        .then((buffer) => {
          if (cancelled) return;
          setDecodedSource({
            buffer,
            sourceStartOffsetSec: 0,
            coverageEndSec: Number.POSITIVE_INFINITY,
            isComplete: true,
          });
          log.info('Decoded pitch source ready', { mediaId });
        })
        .catch((err) => {
          if (cancelled) return;
          log.error('Failed to prepare decoded pitch source', { mediaId, err });
        });
    };
    const scheduleFullDecode = (delayMs: number) => {
      if (cancelled || fullDecodeStarted) return;
      const safeDelayMs = Math.max(0, delayMs);
      const dueAtMs = Date.now() + safeDelayMs;
      if (fullDecodeTimer !== null && dueAtMs >= scheduledFullDecodeAtMs - 1) {
        return;
      }
      clearScheduledFullDecode();
      scheduledFullDecodeAtMs = dueAtMs;
      fullDecodeTimer = setTimeout(() => {
        fullDecodeTimer = null;
        scheduledFullDecodeAtMs = Number.POSITIVE_INFINITY;
        startFullDecode();
      }, safeDelayMs);
    };
    setDecodedSource(null);
    pendingExtensionKeyRef.current = null;
    scheduleFullDecode(BACKGROUND_FULL_DECODE_BACKSTOP_MS);

    getOrDecodeAudioSliceForPlayback(mediaId, src, {
      minReadySeconds: PARTIAL_WAV_READY_SECONDS,
      waitTimeoutMs: PARTIAL_WAV_WAIT_TIMEOUT_MS,
      targetTimeSeconds: clipStartTime,
    })
      .then((slice) => {
        if (cancelled) return;
        const nextSource: DecodedPitchSource = {
          buffer: slice.buffer,
          sourceStartOffsetSec: slice.startTime,
          coverageEndSec: slice.startTime + slice.buffer.duration,
          isComplete: slice.isComplete,
        };
        setDecodedSource((current) => {
          if (!shouldReplaceDecodedPitchSource(current, nextSource)) {
            return current;
          }
          return nextSource;
        });
        if (slice.isComplete) {
          clearScheduledFullDecode();
        } else {
          scheduleFullDecode(BACKGROUND_FULL_DECODE_DELAY_MS);
        }
        log.info('Partial decoded pitch source ready', {
          mediaId,
          duration: slice.buffer.duration.toFixed(2),
        });
      })
      .catch((err) => {
        if (cancelled) return;
        log.error('Failed to prepare partial decoded pitch source', { mediaId, err });
        startFullDecode();
      });

    return () => {
      cancelled = true;
      clearScheduledFullDecode();
    };
  }, [mediaId, src, trimBefore, sourceFps]);

  useEffect(() => {
    const currentSource = decodedSource;
    if (!currentSource || currentSource.isComplete || !playing) {
      pendingExtensionKeyRef.current = null;
      return;
    }

    const effectiveSourceFps = sourceFps ?? fps;
    const targetTime = getAudioTargetTimeSeconds(trimBefore, effectiveSourceFps, frame, playbackRate, fps);
    const remainingCoverage = currentSource.coverageEndSec - targetTime;
    const targetOutsideSource = targetTime < currentSource.sourceStartOffsetSec || targetTime >= currentSource.coverageEndSec;

    if (!targetOutsideSource && remainingCoverage > PARTIAL_WAV_EXTENSION_TRIGGER_SECONDS) {
      return;
    }

    const requestKey = `${mediaId}:${src}:${playbackRate}:${targetTime.toFixed(3)}`;
    if (pendingExtensionKeyRef.current === requestKey) {
      return;
    }
    pendingExtensionKeyRef.current = requestKey;

    let cancelled = false;
    getOrDecodeAudioSliceForPlayback(mediaId, src, {
      minReadySeconds: PARTIAL_WAV_EXTENSION_READY_SECONDS,
      waitTimeoutMs: PARTIAL_WAV_WAIT_TIMEOUT_MS,
      targetTimeSeconds: Math.max(0, targetTime),
    })
      .then((slice) => {
        if (cancelled) return;
        const nextSource: DecodedPitchSource = {
          buffer: slice.buffer,
          sourceStartOffsetSec: slice.startTime,
          coverageEndSec: slice.startTime + slice.buffer.duration,
          isComplete: slice.isComplete,
        };
        setDecodedSource((current) => {
          if (!shouldReplaceDecodedPitchSource(current, nextSource)) {
            return current;
          }
          return nextSource;
        });
      })
      .catch((err) => {
        if (!cancelled) {
          log.warn('Failed to extend pitch-preserved custom decoder audio slice', {
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
  }, [decodedSource, fps, frame, mediaId, playbackRate, playing, sourceFps, src, trimBefore]);

  if (!decodedSource) return null;

  const fallback = (
    <DecodedPitchFallbackAudio
      audioBuffer={decodedSource.buffer}
      sourceStartOffsetSec={decodedSource.sourceStartOffsetSec}
      itemId={itemId}
      liveGainItemIds={liveGainItemIds}
      trimBefore={trimBefore}
      sourceFps={sourceFps}
      volume={volume}
      playbackRate={playbackRate}
      audioPitchSemitones={audioPitchSemitones}
      audioPitchCents={audioPitchCents}
      audioPitchShiftSemitones={audioPitchShiftSemitones}
      muted={muted}
      durationInFrames={durationInFrames}
      audioFadeIn={audioFadeIn}
      audioFadeOut={audioFadeOut}
      audioFadeInCurve={audioFadeInCurve}
      audioFadeOutCurve={audioFadeOutCurve}
      audioFadeInCurveX={audioFadeInCurveX}
      audioFadeOutCurveX={audioFadeOutCurveX}
      audioEqStages={audioEqStages}
      clipFadeSpans={clipFadeSpans}
      contentStartOffsetFrames={contentStartOffsetFrames}
      contentEndOffsetFrames={contentEndOffsetFrames}
      fadeInDelayFrames={fadeInDelayFrames}
      fadeOutLeadFrames={fadeOutLeadFrames}
      crossfadeFadeIn={crossfadeFadeIn}
      crossfadeFadeOut={crossfadeFadeOut}
      volumeMultiplier={volumeMultiplier}
    />
  );

  return (
    <SoundTouchWorkletAudio
      audioBuffer={decodedSource.buffer}
      fallback={fallback}
      itemId={itemId}
      liveGainItemIds={liveGainItemIds}
      trimBefore={trimBefore}
      sourceFps={sourceFps}
      sourceStartOffsetSec={decodedSource.sourceStartOffsetSec}
      isComplete={decodedSource.isComplete}
      volume={volume}
      playbackRate={playbackRate}
      audioPitchSemitones={audioPitchSemitones}
      audioPitchCents={audioPitchCents}
      audioPitchShiftSemitones={audioPitchShiftSemitones}
      muted={muted}
      durationInFrames={durationInFrames}
      audioFadeIn={audioFadeIn}
      audioFadeOut={audioFadeOut}
      audioFadeInCurve={audioFadeInCurve}
      audioFadeOutCurve={audioFadeOutCurve}
      audioFadeInCurveX={audioFadeInCurveX}
      audioFadeOutCurveX={audioFadeOutCurveX}
      audioEqStages={audioEqStages}
      clipFadeSpans={clipFadeSpans}
      contentStartOffsetFrames={contentStartOffsetFrames}
      contentEndOffsetFrames={contentEndOffsetFrames}
      fadeInDelayFrames={fadeInDelayFrames}
      fadeOutLeadFrames={fadeOutLeadFrames}
      crossfadeFadeIn={crossfadeFadeIn}
      crossfadeFadeOut={crossfadeFadeOut}
      volumeMultiplier={volumeMultiplier}
    />
  );
};

/**
 * Custom decoder adapter for codecs that native media elements cannot decode
 * or seek reliably (for example AC-3/E-AC-3, Vorbis, and PCM endian variants).
 *
 * - playbackRate === 1: keep buffered WebAudio playback from decoded bins for
 *   the fastest startup and scrubbing response.
 * - playbackRate !== 1: use a local SoundTouch worklet path directly from
 *   decoded AudioBuffers, avoiding WAV/object-URL round-trips before preview.
 */
export const CustomDecoderAudio: React.FC<CustomDecoderAudioProps> = React.memo((props) => {
  const playbackRate = props.playbackRate ?? 1;
  const itemPreview = useGizmoStore(
    useCallback((state) => state.preview?.[props.itemId], [props.itemId]),
  );
  const resolvedPitchShiftSemitones = resolvePreviewAudioPitchShiftSemitones({
    base: {
      audioPitchSemitones: props.audioPitchSemitones,
      audioPitchCents: props.audioPitchCents,
    },
    preview: itemPreview?.properties,
    additionalSemitones: props.audioPitchShiftSemitones,
  });
  // Stay on the SoundTouch path while a pitch preview is active so crossing the
  // zero boundary mid-drag doesn't remount between buffered and pitch-preserved.
  const hasActivePitchPreview = hasAudioPitchOverride(itemPreview?.properties);
  const shouldUseBufferedPlayback = Math.abs(playbackRate - 1) <= 0.0001
    && !hasActivePitchPreview
    && !isAudioPitchShiftActive(resolvedPitchShiftSemitones);

  if (shouldUseBufferedPlayback) {
    return <CustomDecoderBufferedAudio {...props} playbackRate={playbackRate} />;
  }

  return <CustomDecoderPitchPreservedAudio {...props} playbackRate={playbackRate} />;
});
