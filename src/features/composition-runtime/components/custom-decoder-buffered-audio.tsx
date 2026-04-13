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
import {
  createPreviewClipAudioGraph,
  PREVIEW_AUDIO_GAIN_RAMP_SECONDS,
  rampPreviewClipEq,
  rampPreviewClipGain,
  type PreviewClipAudioGraph,
} from '../utils/preview-audio-graph';

const log = createLogger('CustomDecoderBufferedAudio');
const STOP_GRACE_SECONDS = 0.002;
const PARTIAL_BUFFER_HEADROOM_SECONDS = 0.25;
const DRIFT_RESYNC_MIN_ELAPSED_SECONDS = 1.0;
const DRIFT_RESYNC_POSITIVE_THRESHOLD_SECONDS = 1.25;
const DRIFT_RESYNC_NEGATIVE_THRESHOLD_SECONDS = -0.75;
const BACKGROUND_RESYNC_GRACE_MS = 250;
const INITIAL_PLAYABLE_BUFFER_SECONDS = 1;
const PARTIAL_BUFFER_EXTENSION_TRIGGER_SECONDS = 1.25;
const PARTIAL_BUFFER_EXTENSION_READY_SECONDS = 3;
const PARTIAL_BUFFER_REQUEST_PREROLL_SECONDS = 0.25;
const PENDING_SLICE_REUSE_HEADROOM_SECONDS = 1;
const PAUSED_SEEK_PREFETCH_DEBOUNCE_MS = 50;
const BACKGROUND_FULL_DECODE_DELAY_MS = 1500;
const BACKGROUND_FULL_DECODE_BACKSTOP_MS = 4000;
// Prefer a playable partial decode first, then upgrade to the full buffer in
// the background. This keeps custom-decoded formats like Vorbis responsive on
// first play after import/refresh instead of waiting for the whole file.
const WAIT_FOR_FULL_DECODE_BEFORE_PLAYBACK = false;

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

interface PendingSliceRequest {
  requestId: number;
  requestedStartTime: number;
  requestedCoverageEndTime: number;
  promise: Promise<PlaybackAudioSlice>;
}

interface QueuedPreviewSource {
  predecessor: AudioBufferSourceNode;
  node: AudioBufferSourceNode;
  startAtContextTime: number;
  startOffset: number;
  bufferStartTime: number;
  coverageEndTime: number;
  playbackRate: number;
}

function pendingSliceRequestCoversTarget(
  request: PendingSliceRequest,
  targetTimeSeconds: number,
  minReadySeconds: number,
): boolean {
  const reusableHeadroomSeconds = Math.min(
    minReadySeconds,
    PENDING_SLICE_REUSE_HEADROOM_SECONDS,
  );

  return (
    request.requestedStartTime <= (targetTimeSeconds + 0.05)
    && request.requestedCoverageEndTime >= (targetTimeSeconds + reusableHeadroomSeconds - 0.05)
  );
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
  const { frame, fps, playing, resolvedVolume: audioVolume, resolvedAudioEqStages } = useAudioPlaybackState({
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

  const [audioSlice, setAudioSlice] = useState<PlaybackAudioSlice | null>(null);

  const graphRef = useRef<PreviewClipAudioGraph | null>(null);
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
  const latestSliceRequestIdRef = useRef<number>(0);
  const activeSliceRequestRef = useRef<PendingSliceRequest | null>(null);
  const pausedSeekPrefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedSeekPrefetchKeyRef = useRef<string | null>(null);
  const queuedSourceRef = useRef<QueuedPreviewSource | null>(null);

  const requestPartialSlice = useCallback((targetTimeSeconds: number, minReadySeconds: number) => {
    const requestId = ++latestSliceRequestIdRef.current;
    const request: PendingSliceRequest = {
      requestId,
      requestedStartTime: Math.max(0, targetTimeSeconds - PARTIAL_BUFFER_REQUEST_PREROLL_SECONDS),
      requestedCoverageEndTime: targetTimeSeconds + minReadySeconds,
      promise: getOrDecodeAudioSliceForPlayback(mediaId, src, {
        minReadySeconds,
        waitTimeoutMs: 6000,
        targetTimeSeconds,
        preRollSeconds: PARTIAL_BUFFER_REQUEST_PREROLL_SECONDS,
      }),
    };
    activeSliceRequestRef.current = request;
    return {
      requestId,
      promise: request.promise,
    };
  }, [mediaId, src]);

  const acceptPartialSlice = useCallback((requestId: number, slice: PlaybackAudioSlice): boolean => {
    if (requestId !== latestSliceRequestIdRef.current) {
      return false;
    }

    setAudioSlice((current) => {
      if (!shouldReplaceSlice(current, slice)) {
        return current;
      }
      return slice;
    });
    return true;
  }, []);

  useEffect(() => {
    if (!mediaId || !src) return;

    let cancelled = false;
    let fullDecodeStarted = false;
    let scheduledFullDecodeAtMs = Number.POSITIVE_INFINITY;
    let fullDecodeTimer: ReturnType<typeof setTimeout> | null = null;
    const effectiveSourceFps = sourceFps ?? fps;
    const clearScheduledFullDecode = () => {
      scheduledFullDecodeAtMs = Number.POSITIVE_INFINITY;
      if (fullDecodeTimer !== null) {
        clearTimeout(fullDecodeTimer);
        fullDecodeTimer = null;
      }
    };
    const startFullDecode = () => {
      if (cancelled || fullDecodeStarted) {
        return;
      }
      clearScheduledFullDecode();
      activeSliceRequestRef.current = null;
      fullDecodeStarted = true;
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
    };
    const scheduleFullDecode = (delayMs: number) => {
      if (cancelled || fullDecodeStarted) {
        return;
      }
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
    activeSliceRequestRef.current = null;
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
      scheduleFullDecode(BACKGROUND_FULL_DECODE_BACKSTOP_MS);
      const initialSliceRequest = requestPartialSlice(initialTargetTime, INITIAL_PLAYABLE_BUFFER_SECONDS);
      initialSliceRequest.promise
        .then((slice) => {
          if (!cancelled) {
            if (!acceptPartialSlice(initialSliceRequest.requestId, slice)) {
              return;
            }
            if (slice.isComplete) {
              clearScheduledFullDecode();
            } else {
              scheduleFullDecode(BACKGROUND_FULL_DECODE_DELAY_MS);
            }
            log.info('Initial buffered audio ready', {
              mediaId,
              duration: slice.buffer.duration.toFixed(2),
              sampleRate: slice.buffer.sampleRate,
              channels: slice.buffer.numberOfChannels,
              startTime: slice.startTime.toFixed(2),
            });

            // The startup slice is intentionally small for fast first sound.
            // If it is still tiny once ready, immediately ask for follow-up
            // coverage so 1x playback does not outrun the initial buffer before
            // the normal extension effect gets another turn.
            if (!slice.isComplete && slice.buffer.duration <= INITIAL_PLAYABLE_BUFFER_SECONDS + 0.5) {
              const prefetchTargetTime = Math.max(
                initialTargetTime,
                slice.startTime + Math.max(0, slice.buffer.duration - PARTIAL_BUFFER_HEADROOM_SECONDS),
              );
              const prefetchSliceRequest = requestPartialSlice(
                prefetchTargetTime,
                PARTIAL_BUFFER_EXTENSION_READY_SECONDS,
              );
              void prefetchSliceRequest.promise
                .then((nextSlice) => {
                  if (cancelled) {
                    return;
                  }
                  acceptPartialSlice(prefetchSliceRequest.requestId, nextSlice);
                })
                .catch((err) => {
                  if (!cancelled) {
                    log.warn('Failed to prefetch buffered custom decoder audio slice', {
                      mediaId,
                      targetTime: prefetchTargetTime,
                      err,
                    });
                  }
                })
                .finally(() => {
                  if (activeSliceRequestRef.current?.requestId === prefetchSliceRequest.requestId) {
                    activeSliceRequestRef.current = null;
                  }
                });
            }
          }
        })
        .catch((err) => {
          if (!cancelled) {
            log.error('Failed to decode buffered audio', { mediaId, err });
          }
          startFullDecode();
        })
        .finally(() => {
          if (activeSliceRequestRef.current?.requestId === initialSliceRequest.requestId) {
            activeSliceRequestRef.current = null;
          }
        });
    }

    return () => {
      cancelled = true;
      clearScheduledFullDecode();
      activeSliceRequestRef.current = null;
    };
  }, [acceptPartialSlice, fps, mediaId, playbackRate, requestPartialSlice, sourceFps, src, trimBefore]);

  useEffect(() => {
    const currentSlice = audioSlice;
    if (!currentSlice || currentSlice.isComplete || !playing) {
      pendingExtensionKeyRef.current = null;
      return;
    }

    const effectiveSourceFps = sourceFps ?? fps;
    const targetTime = getAudioTargetTimeSeconds(trimBefore, effectiveSourceFps, frame, playbackRate, fps);
    const coverageEnd = getSliceCoverageEnd(currentSlice);
    const remainingCoverage = coverageEnd - targetTime;
    const isTargetOutsideSlice = targetTime < currentSlice.startTime || targetTime >= coverageEnd;
    const shouldPrefetchImmediately = currentSlice.buffer.duration <= INITIAL_PLAYABLE_BUFFER_SECONDS + 0.5;
    const extensionTriggerSeconds = shouldPrefetchImmediately
      ? currentSlice.buffer.duration
      : PARTIAL_BUFFER_EXTENSION_TRIGGER_SECONDS;

    if (!isTargetOutsideSlice && remainingCoverage > extensionTriggerSeconds) {
      return;
    }

    const activeSliceRequest = activeSliceRequestRef.current;
    if (
      activeSliceRequest
      && pendingSliceRequestCoversTarget(
        activeSliceRequest,
        Math.max(0, targetTime),
        PARTIAL_BUFFER_EXTENSION_READY_SECONDS,
      )
    ) {
      return;
    }

    const requestKey = `${mediaId}:${src}:${playbackRate}:${targetTime.toFixed(3)}`;
    if (pendingExtensionKeyRef.current === requestKey) {
      return;
    }
    pendingExtensionKeyRef.current = requestKey;

    let cancelled = false;
    const extensionSliceRequest = requestPartialSlice(
      Math.max(0, targetTime),
      PARTIAL_BUFFER_EXTENSION_READY_SECONDS,
    );
    extensionSliceRequest.promise
      .then((nextSlice) => {
        if (cancelled) {
          return;
        }
        acceptPartialSlice(extensionSliceRequest.requestId, nextSlice);
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
        if (activeSliceRequestRef.current?.requestId === extensionSliceRequest.requestId) {
          activeSliceRequestRef.current = null;
        }
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
  }, [acceptPartialSlice, audioSlice, frame, fps, mediaId, playbackRate, playing, requestPartialSlice, sourceFps, src, trimBefore]);

  useEffect(() => {
    if (playing) {
      if (pausedSeekPrefetchTimerRef.current !== null) {
        clearTimeout(pausedSeekPrefetchTimerRef.current);
        pausedSeekPrefetchTimerRef.current = null;
      }
      pausedSeekPrefetchKeyRef.current = null;
      return;
    }

    const currentSlice = audioSlice;
    if (currentSlice?.isComplete) {
      pausedSeekPrefetchKeyRef.current = null;
      return;
    }

    const effectiveSourceFps = sourceFps ?? fps;
    const targetTime = getAudioTargetTimeSeconds(trimBefore, effectiveSourceFps, frame, playbackRate, fps);
    if (!currentSlice && decodeSeedRef.current && Math.abs(decodeSeedRef.current.targetTime - targetTime) <= 0.001) {
      pausedSeekPrefetchKeyRef.current = null;
      return;
    }
    const coverageEnd = currentSlice ? getSliceCoverageEnd(currentSlice) : 0;
    const hasEnoughCoverage = !!currentSlice
      && targetTime >= currentSlice.startTime
      && coverageEnd >= (targetTime + INITIAL_PLAYABLE_BUFFER_SECONDS - PARTIAL_BUFFER_HEADROOM_SECONDS);

    const activeSliceRequest = activeSliceRequestRef.current;
    const hasActiveCoveredRequest = !!activeSliceRequest && pendingSliceRequestCoversTarget(
      activeSliceRequest,
      targetTime,
      INITIAL_PLAYABLE_BUFFER_SECONDS,
    );

    if (hasEnoughCoverage || hasActiveCoveredRequest) {
      pausedSeekPrefetchKeyRef.current = null;
      return;
    }

    const requestKey = `${mediaId}:${src}:${playbackRate}:${targetTime.toFixed(3)}`;
    if (pausedSeekPrefetchKeyRef.current === requestKey) {
      return;
    }
    pausedSeekPrefetchKeyRef.current = requestKey;

    if (pausedSeekPrefetchTimerRef.current !== null) {
      clearTimeout(pausedSeekPrefetchTimerRef.current);
      pausedSeekPrefetchTimerRef.current = null;
    }

    let cancelled = false;
    pausedSeekPrefetchTimerRef.current = setTimeout(() => {
      pausedSeekPrefetchTimerRef.current = null;
      const prefetchRequest = requestPartialSlice(Math.max(0, targetTime), INITIAL_PLAYABLE_BUFFER_SECONDS);
      void prefetchRequest.promise
        .then((slice) => {
          if (cancelled) {
            return;
          }
          acceptPartialSlice(prefetchRequest.requestId, slice);
        })
        .catch((err) => {
          if (!cancelled) {
            log.warn('Failed to prefetch paused custom decoder audio slice', {
              mediaId,
              targetTime,
              err,
            });
          }
        })
        .finally(() => {
          if (activeSliceRequestRef.current?.requestId === prefetchRequest.requestId) {
            activeSliceRequestRef.current = null;
          }
        });
    }, PAUSED_SEEK_PREFETCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      if (pausedSeekPrefetchTimerRef.current !== null) {
        clearTimeout(pausedSeekPrefetchTimerRef.current);
        pausedSeekPrefetchTimerRef.current = null;
      }
    };
  }, [acceptPartialSlice, audioSlice, fps, frame, mediaId, playbackRate, playing, requestPartialSlice, sourceFps, src, trimBefore]);

  useEffect(() => {
    // Keep the preview graph alive across EQ toggles; the EQ stages ramp in place below.
    const graph = createPreviewClipAudioGraph();
    if (!graph) return;
    graphRef.current = graph;

    return () => {
      const queuedSource = queuedSourceRef.current;
      if (queuedSource) {
        try { queuedSource.node.stop(); } catch { /* already stopped */ }
        queuedSource.node.disconnect();
        queuedSourceRef.current = null;
      }
      if (sourceRef.current) {
        try { sourceRef.current.stop(); } catch { /* already stopped */ }
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      if (pausedSeekPrefetchTimerRef.current !== null) {
        clearTimeout(pausedSeekPrefetchTimerRef.current);
        pausedSeekPrefetchTimerRef.current = null;
      }
      activeSliceRequestRef.current = null;
      graph.dispose();
      graphRef.current = null;
    };
  }, []);

  useEffect(() => {
    const resume = () => {
      const graph = graphRef.current;
      if (graph?.context.state === 'suspended') {
        void graph.context.resume().catch(() => undefined);
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
      const ctx = graphRef.current?.context;
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
    const graph = graphRef.current;
    if (!graph) return;

    const safeVolume = Number.isFinite(audioVolume) ? Math.max(0, audioVolume) : 0;
    audioVolumeRef.current = safeVolume;
    rampPreviewClipGain(graph, safeVolume);
  }, [audioVolume]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    rampPreviewClipEq(graph, resolvedAudioEqStages);
  }, [resolvedAudioEqStages]);

  const clearQueuedSource = useCallback(() => {
    const queuedSource = queuedSourceRef.current;
    if (!queuedSource) {
      return;
    }

    queuedSourceRef.current = null;
    try { queuedSource.node.stop(); } catch { /* already stopped */ }
    queuedSource.node.disconnect();
  }, []);

  const stopSource = useCallback((fadeOut: boolean = true) => {
    startRequestIdRef.current += 1;
    clearQueuedSource();

    const source = sourceRef.current;
    if (!source) return;
    sourceRef.current = null;

    const graph = graphRef.current;
    const ctx = graph?.context ?? null;

    if (fadeOut && ctx && graph) {
      const now = ctx.currentTime;
      const stopAt = now + PREVIEW_AUDIO_GAIN_RAMP_SECONDS;
      rampPreviewClipGain(graph, 0, now);
      try {
        source.stop(stopAt + STOP_GRACE_SECONDS);
      } catch {
        try { source.stop(); } catch { /* already stopped */ }
      }
      return;
    }

    try { source.stop(); } catch { /* already stopped */ }
  }, [clearQueuedSource]);

  const scheduleQueuedSource = useCallback((
    ctx: AudioContext,
    graph: PreviewClipAudioGraph,
    currentSource: AudioBufferSourceNode,
    nextSlice: PlaybackAudioSlice,
  ): boolean => {
    const currentBuffer = currentSource.buffer;
    if (!currentBuffer) {
      return false;
    }

    const currentCoverageEndTime = lastBufferStartTimeRef.current + currentBuffer.duration;
    const nextCoverageEndTime = nextSlice.startTime + nextSlice.buffer.duration;
    if (nextCoverageEndTime <= currentCoverageEndTime + 0.05) {
      return false;
    }

    const handoffTime = Math.max(currentCoverageEndTime, nextSlice.startTime);
    const startOffset = handoffTime - nextSlice.startTime;
    if (startOffset < 0 || startOffset >= nextSlice.buffer.duration - 0.01) {
      return false;
    }

    const currentSourceTimeAtStart = lastBufferStartTimeRef.current + lastStartOffsetRef.current;
    const sourceRate = Math.max(0.0001, lastStartRateRef.current);
    const startAtContextTime = lastSyncContextTimeRef.current
      + ((handoffTime - currentSourceTimeAtStart) / sourceRate);
    if (!Number.isFinite(startAtContextTime) || startAtContextTime <= ctx.currentTime + 0.02) {
      return false;
    }

    const queuedSource = queuedSourceRef.current;
    if (
      queuedSource
      && queuedSource.predecessor === currentSource
      && Math.abs(queuedSource.startAtContextTime - startAtContextTime) <= 0.05
      && queuedSource.bufferStartTime <= nextSlice.startTime + 0.05
      && queuedSource.coverageEndTime >= nextCoverageEndTime - 0.05
    ) {
      return true;
    }

    clearQueuedSource();

    const nextSource = ctx.createBufferSource();
    nextSource.buffer = nextSlice.buffer;
    nextSource.playbackRate.value = playbackRate;
    nextSource.connect(graph.sourceInputNode);

    const scheduledSource: QueuedPreviewSource = {
      predecessor: currentSource,
      node: nextSource,
      startAtContextTime,
      startOffset,
      bufferStartTime: nextSlice.startTime,
      coverageEndTime: nextCoverageEndTime,
      playbackRate,
    };
    queuedSourceRef.current = scheduledSource;

    nextSource.onended = () => {
      nextSource.disconnect();
      if (queuedSourceRef.current?.node === nextSource) {
        queuedSourceRef.current = null;
      }
      if (sourceRef.current === nextSource) {
        sourceRef.current = null;
      }
    };

    try {
      nextSource.start(
        startAtContextTime,
        Math.max(0, Math.min(startOffset, nextSlice.buffer.duration - 0.01)),
      );
      return true;
    } catch (err) {
      log.warn('Failed to queue buffered custom decoder audio slice', {
        mediaId,
        startAtContextTime,
        startOffset,
        err,
      });
      if (queuedSourceRef.current?.node === nextSource) {
        queuedSourceRef.current = null;
      }
      try { nextSource.disconnect(); } catch { /* already disconnected */ }
      return false;
    }
  }, [clearQueuedSource, mediaId, playbackRate]);

  useEffect(() => {
    const currentSlice = audioSlice;
    if (!currentSlice) return;
    const audioBuffer = currentSlice.buffer;

    const graph = graphRef.current;
    const ctx = graph?.context ?? null;
    if (!ctx || !graph) return;

    const isPremounted = frame < 0;
    const effectiveSourceFps = sourceFps ?? fps;
    // IMPORTANT: trimBefore is in source FPS frames â€” must use effectiveSourceFps, not fps
    const targetTime = getAudioTargetTimeSeconds(trimBefore, effectiveSourceFps, frame, playbackRate, fps);
    const audioStartTime = currentSlice.startTime;
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
        const queued = scheduleQueuedSource(ctx, graph, currentSource, currentSlice);
        if (!queued) {
          // Buffer changed (partial -> full). Avoid immediate restart thrash;
          // only re-sync if current source is close to running out.
          const sourceDuration = currentSource.buffer?.duration ?? 0;
          const remainingCoverage = (lastBufferStartTimeRef.current + sourceDuration) - targetTime;
          if (remainingCoverage <= PARTIAL_BUFFER_HEADROOM_SECONDS) {
            shouldStart = true;
          }
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
        if (targetOffsetInBuffer < 0 || targetOffsetInBuffer >= audioBuffer.duration - PARTIAL_BUFFER_HEADROOM_SECONDS) {
          const shouldWaitForMoreAudio = !audioSlice?.isComplete || isPreviewAudioDecodePending(mediaId);
          if (shouldWaitForMoreAudio) {
            stopSource();
            return;
          }
        }

        stopSource();
        const startRequestId = ++startRequestIdRef.current;

        const resumePromise = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
        resumePromise.then(() => {
          if (startRequestId !== startRequestIdRef.current) return;

          const liveGraph = graphRef.current;
          if (ctx.state !== 'running' || !liveGraph) return;

          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.playbackRate.value = playbackRate;
          source.connect(liveGraph.sourceInputNode);
          source.onended = () => {
            source.disconnect();
            const queuedSource = queuedSourceRef.current;
            if (queuedSource?.predecessor === source) {
              queuedSourceRef.current = null;
              sourceRef.current = queuedSource.node;
              lastSyncContextTimeRef.current = queuedSource.startAtContextTime;
              lastStartOffsetRef.current = queuedSource.startOffset;
              lastStartRateRef.current = queuedSource.playbackRate;
              lastBufferStartTimeRef.current = queuedSource.bufferStartTime;
              return;
            }

            if (sourceRef.current === source) {
              sourceRef.current = null;
            }
          };

          const clampedOffset = Math.max(0, Math.min(targetOffsetInBuffer, audioBuffer.duration - 0.01));
          const startAt = ctx.currentTime;
          const startVolume = Math.max(0, audioVolumeRef.current);
          const gainParam = liveGraph.outputGainNode.gain;
          gainParam.cancelScheduledValues(startAt);
          gainParam.setValueAtTime(0, startAt);
          gainParam.linearRampToValueAtTime(startVolume, startAt + PREVIEW_AUDIO_GAIN_RAMP_SECONDS);

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
  }, [audioSlice, frame, fps, playing, playbackRate, trimBefore, mediaId, scheduleQueuedSource, sourceFps, stopSource]);

  return null;
});
