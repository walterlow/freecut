import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '@/shared/logging/logger';
import { useGizmoStore } from '@/features/composition-runtime/deps/stores';
import { usePlaybackStore } from '@/features/composition-runtime/deps/stores';
import {
  getOrDecodeAudio,
  getOrDecodeAudioSliceForPlayback,
} from '../utils/audio-decode-cache';
import { getAudioTargetTimeSeconds } from '../utils/video-timing';
import {
  acquirePreviewAudioElement,
  markPreviewAudioElementUsesWebAudio,
  releasePreviewAudioElement,
} from '../utils/preview-audio-element-pool';
import {
  createPreviewClipAudioGraph,
  rampPreviewClipEq,
  rampPreviewClipGain,
  setPreviewClipGain,
  type PreviewClipAudioGraph,
} from '../utils/preview-audio-graph';
import { SoundTouchWorkletAudio } from './soundtouch-worklet-audio';
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

export const NativePitchCorrectedAudio: React.FC<PitchCorrectedAudioProps> = React.memo(({
  src,
  itemId,
  volume = 0,
  playbackRate = 1,
  trimBefore = 0,
  sourceFps,
  sourceStartOffsetSec = 0,
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
}) => {
  const { frame, fps, playing, resolvedVolume: finalVolume, resolvedAudioEqStages } = useAudioPlaybackState({
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

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const graphRef = useRef<PreviewClipAudioGraph | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const lastSyncTimeRef = useRef<number>(Date.now());
  const needsInitialSyncRef = useRef<boolean>(true);
  const lastFrameRef = useRef<number>(-1);
  const preWarmTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (playing) {
      needsInitialSyncRef.current = true;
    }
  }, [playing]);

  useEffect(() => {
    const audio = acquirePreviewAudioElement(src);
    // Keep the media element and graph alive across EQ toggles; the EQ stages ramp in place below.
    const graph = createPreviewClipAudioGraph();
    if (!graph) {
      releasePreviewAudioElement(audio);
      return;
    }
    audioRef.current = audio;
    graphRef.current = graph;
    audio.volume = 1;
    audio.muted = false;

    try {
      const sourceNode = graph.context.createMediaElementSource(audio);
      markPreviewAudioElementUsesWebAudio(audio);
      sourceNode.connect(graph.sourceInputNode);
      sourceNodeRef.current = sourceNode;
    } catch {
      graph.dispose();
      graphRef.current = null;
      audioRef.current = null;
      releasePreviewAudioElement(audio);
      return;
    }

    return () => {
      audioRef.current = null;
      sourceNodeRef.current?.disconnect();
      sourceNodeRef.current = null;
      graph.dispose();
      graphRef.current = null;
      if (preWarmTimerRef.current !== null) {
        clearTimeout(preWarmTimerRef.current);
        preWarmTimerRef.current = null;
      }
      releasePreviewAudioElement(audio);
    };
  }, [src]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const clampedVolume = muted ? 0 : Math.max(0, finalVolume);
    rampPreviewClipGain(graph, clampedVolume);
  }, [finalVolume, muted]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    rampPreviewClipEq(graph, resolvedAudioEqStages);
  }, [resolvedAudioEqStages]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const effectiveSourceFps = sourceFps ?? fps;
    const sourceTimeSeconds = getAudioTargetTimeSeconds(trimBefore, effectiveSourceFps, frame, playbackRate, fps) - sourceStartOffsetSec;
    const clipStartTimeSeconds = Math.max(0, (trimBefore / effectiveSourceFps) - sourceStartOffsetSec);
    const isPremounted = frame < 0;
    const targetTimeSeconds = isPremounted
      ? clipStartTimeSeconds
      : Math.max(0, sourceTimeSeconds);

    const frameChanged = frame !== lastFrameRef.current;
    lastFrameRef.current = frame;

    const canSeek = audio.readyState >= 1;

    if (isPremounted) {
      if (!audio.paused) {
        audio.pause();
      }
      if (canSeek && Math.abs(audio.currentTime - clipStartTimeSeconds) > 0.05) {
        try {
          audio.currentTime = clipStartTimeSeconds;
        } catch {
          // Audio is not ready to seek yet.
        }
      }
      return;
    }

    if (playing) {
      if (preWarmTimerRef.current !== null) {
        clearTimeout(preWarmTimerRef.current);
        preWarmTimerRef.current = null;
      }

      const currentTime = audio.currentTime;
      const now = Date.now();
      const drift = currentTime - targetTimeSeconds;
      const timeSinceLastSync = now - lastSyncTimeRef.current;
      const audioBehind = drift < -0.2;
      const audioFarAhead = drift > 0.5;
      const needsSync = needsInitialSyncRef.current || audioFarAhead || (audioBehind && timeSinceLastSync > 500);

      if (needsSync && canSeek) {
        try {
          audio.currentTime = targetTimeSeconds;
          lastSyncTimeRef.current = now;
          needsInitialSyncRef.current = false;
        } catch {
          // Audio is not ready to seek yet.
        }
      }

      if (audio.paused && audio.readyState >= 3) {
        const seekDistance = Math.abs(drift);
        if (seekDistance > 1 && audio.seeking) {
          const onSeeked = () => {
            audio.removeEventListener('seeked', onSeeked);
            if (usePlaybackStore.getState().isPlaying && audio.paused) {
              const ctx = graphRef.current?.context;
              if (ctx?.state === 'suspended') ctx.resume();
              audio.play().catch(() => {});
            }
          };
          audio.addEventListener('seeked', onSeeked, { once: true });
          return;
        }

        const sharedContext = graphRef.current?.context;
        if (sharedContext?.state === 'suspended') {
          sharedContext.resume();
        }
        audio.play().catch(() => {
          // Autoplay might be blocked.
        });
      }
    } else {
      if (!audio.paused) {
        audio.pause();
      }
      const playbackState = usePlaybackStore.getState();
      const isPreviewScrubbing =
        !playbackState.isPlaying
        && playbackState.previewFrame !== null
        && useGizmoStore.getState().activeGizmo === null;

      if (frameChanged && canSeek && !isPreviewScrubbing) {
        try {
          audio.currentTime = targetTimeSeconds;
        } catch {
          // Audio is not ready to seek yet.
        }

        if (preWarmTimerRef.current !== null) {
          clearTimeout(preWarmTimerRef.current);
        }
        preWarmTimerRef.current = window.setTimeout(() => {
          preWarmTimerRef.current = null;
          const currentAudio = audioRef.current;
          if (currentAudio && currentAudio.paused && currentAudio.readyState >= 2 && !usePlaybackStore.getState().isPlaying) {
            const graph = graphRef.current;
            const previousGain = graph?.outputGainNode.gain.value ?? 0;
            if (graph) {
              setPreviewClipGain(graph, 0);
            } else {
              currentAudio.volume = 0;
            }
            currentAudio.play().then(() => {
              if (!usePlaybackStore.getState().isPlaying) {
                currentAudio.pause();
                if (graph) {
                  setPreviewClipGain(graph, previousGain);
                } else {
                  currentAudio.volume = previousGain;
                }
              }
            }).catch(() => {
              if (!usePlaybackStore.getState().isPlaying) {
                if (graph) {
                  setPreviewClipGain(graph, previousGain);
                } else {
                  currentAudio.volume = previousGain;
                }
              }
            });
          }
        }, 50);
      }
    }
  }, [frame, fps, sourceFps, sourceStartOffsetSec, playing, playbackRate, trimBefore]);

  return null;
});

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
  const nativeFallback = <NativePitchCorrectedAudio {...props} />;

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
    return nativeFallback;
  }

  return (
    <SoundTouchWorkletAudio
      audioBuffer={decodedSource.buffer}
      fallback={nativeFallback}
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

  if (!requiresPitchCorrection && Math.abs(playbackRate - 1) <= PLAYBACK_RATE_TOLERANCE) {
    return <NativePitchCorrectedAudio {...props} playbackRate={playbackRate} />;
  }

  return <DecodedPitchCorrectedAudio {...props} mediaId={decodeMediaId} playbackRate={playbackRate} />;
});
