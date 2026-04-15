import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '@/shared/logging/logger';
import { useGizmoStore } from '@/features/composition-runtime/deps/stores';
import {
  getOrDecodeAudio,
  getOrDecodeAudioSliceForPlayback,
} from '../utils/audio-decode-cache';
import { getAudioTargetTimeSeconds } from '../utils/video-timing';
import { SoundTouchWorkletAudio } from './soundtouch-worklet-audio';
import { CustomDecoderBufferedAudio } from './custom-decoder-buffered-audio';
import { StreamingPlaybackBufferedAudio } from './streaming-playback-buffered-audio';
import { StreamingSoundTouchWorkletAudio } from './streaming-soundtouch-worklet-audio';
import type { AudioPlaybackProps } from './audio-playback-props';
import { useAudioPlaybackState } from './hooks/use-audio-playback-state';
import {
  isAudioPitchShiftActive,
  resolvePreviewAudioPitchShiftSemitones,
} from '@/shared/utils/audio-pitch';

const log = createLogger('PitchCorrectedAudio');
const PLAYBACK_RATE_TOLERANCE = 0.0001;
const PARTIAL_PITCH_READY_SECONDS = 2;
const PARTIAL_PITCH_WAIT_TIMEOUT_MS = 6000;
const PARTIAL_PITCH_EXTENSION_TRIGGER_SECONDS = 1.25;
const PARTIAL_PITCH_EXTENSION_READY_SECONDS = 3;

export interface PitchCorrectedAudioProps extends AudioPlaybackProps {
  src: string;
  mediaId?: string;
  sourceStartOffsetSec?: number;
}

interface DecodedPitchSource {
  buffer: AudioBuffer;
  sourceStartOffsetSec: number;
  coverageEndSec: number;
  isComplete: boolean;
}

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

type DecodedPitchCorrectedAudioProps = PitchCorrectedAudioProps & {
  mediaId: string;
};

const DecodedPitchCorrectedAudio: React.FC<DecodedPitchCorrectedAudioProps> = React.memo((props) => {
  const {
    src,
    mediaId,
    itemId,
    trimBefore = 0,
    sourceFps,
    sourceStartOffsetSec = 0,
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
    audioEqStages,
    clipFadeSpans,
    contentStartOffsetFrames = 0,
    contentEndOffsetFrames = 0,
    fadeInDelayFrames = 0,
    fadeOutLeadFrames = 0,
    crossfadeFadeIn,
    crossfadeFadeOut,
    liveGainItemIds,
    volumeMultiplier = 1,
  } = props;

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
  const bufferedFallback = (
    <CustomDecoderBufferedAudio
      {...props}
      mediaId={mediaId}
      playbackRate={playbackRate}
      sourceStartOffsetSec={sourceStartOffsetSec}
    />
  );

  useEffect(() => {
    if (!mediaId || !src) return;

    let cancelled = false;
    const effectiveSourceFps = sourceFps ?? fps;
    const clipStartTime = Math.max(0, (trimBefore / effectiveSourceFps) - sourceStartOffsetSec);
    setDecodedSource(null);
    pendingExtensionKeyRef.current = null;

    getOrDecodeAudioSliceForPlayback(mediaId, src, {
      minReadySeconds: PARTIAL_PITCH_READY_SECONDS,
      waitTimeoutMs: PARTIAL_PITCH_WAIT_TIMEOUT_MS,
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
      })
      .catch((error) => {
        if (!cancelled) {
          log.warn('Failed to prepare partial pitch-corrected preview buffer', {
            mediaId,
            error,
          });
        }
      });

    getOrDecodeAudio(mediaId, src)
      .then((buffer) => {
        if (cancelled) return;
        setDecodedSource({
          buffer,
          sourceStartOffsetSec: 0,
          coverageEndSec: Number.POSITIVE_INFINITY,
          isComplete: true,
        });
      })
      .catch((error) => {
        if (!cancelled) {
          log.warn('Failed to prepare full pitch-corrected preview buffer', {
            mediaId,
            error,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fps, mediaId, sourceFps, sourceStartOffsetSec, src, trimBefore]);

  useEffect(() => {
    const currentSource = decodedSource;
    if (!currentSource || currentSource.isComplete || !playing) {
      pendingExtensionKeyRef.current = null;
      return;
    }

    const effectiveSourceFps = sourceFps ?? fps;
    const targetTime = Math.max(
      0,
      getAudioTargetTimeSeconds(trimBefore, effectiveSourceFps, frame, playbackRate, fps) - sourceStartOffsetSec,
    );
    const remainingCoverage = currentSource.coverageEndSec - targetTime;
    const targetOutsideSource = targetTime < currentSource.sourceStartOffsetSec || targetTime >= currentSource.coverageEndSec;

    if (!targetOutsideSource && remainingCoverage > PARTIAL_PITCH_EXTENSION_TRIGGER_SECONDS) {
      return;
    }

    const requestKey = `${mediaId}:${src}:${playbackRate}:${targetTime.toFixed(3)}`;
    if (pendingExtensionKeyRef.current === requestKey) {
      return;
    }
    pendingExtensionKeyRef.current = requestKey;

    let cancelled = false;
    getOrDecodeAudioSliceForPlayback(mediaId, src, {
      minReadySeconds: PARTIAL_PITCH_EXTENSION_READY_SECONDS,
      waitTimeoutMs: PARTIAL_PITCH_WAIT_TIMEOUT_MS,
      targetTimeSeconds: targetTime,
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
      .catch((error) => {
        if (!cancelled) {
          log.warn('Failed to extend pitch-corrected preview buffer', {
            mediaId,
            targetTime,
            error,
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
  }, [decodedSource, fps, frame, mediaId, playbackRate, playing, sourceFps, sourceStartOffsetSec, src, trimBefore]);

  if (!decodedSource) {
    return bufferedFallback;
  }

  return (
    <SoundTouchWorkletAudio
      audioBuffer={decodedSource.buffer}
      fallback={bufferedFallback}
      itemId={itemId}
      trimBefore={trimBefore}
      sourceFps={sourceFps}
      sourceStartOffsetSec={sourceStartOffsetSec + decodedSource.sourceStartOffsetSec}
      isComplete={decodedSource.isComplete}
      volume={volume}
      playbackRate={playbackRate}
      audioPitchSemitones={props.audioPitchSemitones}
      audioPitchCents={props.audioPitchCents}
      audioPitchShiftSemitones={props.audioPitchShiftSemitones}
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
      liveGainItemIds={liveGainItemIds}
      volumeMultiplier={volumeMultiplier}
    />
  );
});

export const PitchCorrectedAudio: React.FC<PitchCorrectedAudioProps> = React.memo((props) => {
  const playbackRate = props.playbackRate ?? 1;
  const streamingAudioStreamKey = props.streamingAudioStreamKey;
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
  const requiresPitchCorrection = isAudioPitchShiftActive(resolvedPitchShiftSemitones);
  const decodeMediaId = props.mediaId ?? `legacy-src:${props.src}`;
  const unshiftedFallback = (
    <CustomDecoderBufferedAudio {...props} mediaId={decodeMediaId} playbackRate={playbackRate} />
  );

  if (!requiresPitchCorrection && Math.abs(playbackRate - 1) <= PLAYBACK_RATE_TOLERANCE) {
    if (streamingAudioStreamKey) {
      return (
        <StreamingPlaybackBufferedAudio
          {...props}
          streamKey={streamingAudioStreamKey}
          sourceStartOffsetSec={props.sourceStartOffsetSec}
          playbackRate={playbackRate}
          fallback={unshiftedFallback}
        />
      );
    }
    return unshiftedFallback;
  }

  if (streamingAudioStreamKey) {
    return (
      <StreamingSoundTouchWorkletAudio
        {...props}
        streamKey={streamingAudioStreamKey}
        playbackRate={playbackRate}
        fallback={<DecodedPitchCorrectedAudio {...props} mediaId={decodeMediaId} playbackRate={playbackRate} />}
      />
    );
  }

  return <DecodedPitchCorrectedAudio {...props} mediaId={decodeMediaId} playbackRate={playbackRate} />;
});
