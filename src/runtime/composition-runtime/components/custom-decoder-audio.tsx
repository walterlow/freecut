import React, { useCallback, useEffect, useRef, useState } from 'react'
import { SoundTouchWorkletAudio } from './soundtouch-worklet-audio'
import { CustomDecoderBufferedAudio } from './custom-decoder-buffered-audio'
import { NativePitchCorrectedAudio } from './pitch-corrected-audio'
import type { AudioPlaybackProps } from './audio-playback-props'
import { getOrDecodeAudioSliceForPlayback } from '../utils/audio-decode-cache'
import { audioBufferToWavBlob } from '../utils/audio-buffer-wav'
import { createReversedAudioBuffer } from '../utils/audio-buffer-utils'
import { createLogger } from '@/shared/logging/logger'
import { getAudioTargetTimeSeconds } from '../utils/video-timing'
import { needsDecodedPitchSourceExtension } from '../utils/decoded-pitch-source'
import { useAudioPlaybackState } from './hooks/use-audio-playback-state'
import { useGizmoStore } from '@/runtime/composition-runtime/deps/stores'
import { useClockPlaybackRate } from '@/runtime/composition-runtime/deps/player'
import {
  hasAudioPitchOverride,
  isAudioPitchShiftActive,
  resolvePreviewAudioPitchShiftSemitones,
} from '@/shared/utils/audio-pitch'

const log = createLogger('CustomDecoderAudio')
const PARTIAL_WAV_READY_SECONDS = 2
const PARTIAL_WAV_WAIT_TIMEOUT_MS = 6000
const PARTIAL_WAV_EXTENSION_TRIGGER_SECONDS = 1.25
const PARTIAL_WAV_EXTENSION_READY_SECONDS = 3
const REVERSE_SHUTTLE_PREROLL_SECONDS = 4

interface CustomDecoderAudioProps extends AudioPlaybackProps {
  src: string
  mediaId: string
}

interface DecodedPitchSource {
  buffer: AudioBuffer
  sourceStartOffsetSec: number
  coverageEndSec: number
  isComplete: boolean
}

interface DecodedPitchFallbackAudioProps extends AudioPlaybackProps {
  audioBuffer: AudioBuffer
  sourceStartOffsetSec: number
  isComplete: boolean
  timelineFps: number
}

const DecodedPitchFallbackAudio: React.FC<DecodedPitchFallbackAudioProps> = ({
  audioBuffer,
  sourceStartOffsetSec,
  isComplete,
  timelineFps,
  itemId,
  liveGainItemIds,
  trimBefore = 0,
  sourceFps,
  volume,
  playbackRate,
  isReversed,
  reverseSourceEnd,
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
  const [decodedSrc, setDecodedSrc] = useState<string | null>(null)
  const reversedPlayback = React.useMemo(() => {
    if (!isComplete || !isReversed) return null
    const effectiveSourceFps = sourceFps ?? timelineFps
    const sourceEndSeconds = (reverseSourceEnd ?? trimBefore) / effectiveSourceFps
    return {
      buffer: createReversedAudioBuffer(audioBuffer),
      trimBefore: Math.max(
        0,
        Math.round((audioBuffer.duration - sourceEndSeconds) * effectiveSourceFps),
      ),
    }
  }, [audioBuffer, isComplete, isReversed, reverseSourceEnd, sourceFps, timelineFps, trimBefore])
  const fallbackBuffer = reversedPlayback?.buffer ?? audioBuffer

  useEffect(() => {
    const url = URL.createObjectURL(audioBufferToWavBlob(fallbackBuffer))
    setDecodedSrc(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [fallbackBuffer])

  if (!decodedSrc) {
    return null
  }

  return (
    <NativePitchCorrectedAudio
      src={decodedSrc}
      itemId={itemId}
      liveGainItemIds={liveGainItemIds}
      trimBefore={reversedPlayback?.trimBefore ?? trimBefore}
      sourceFps={sourceFps}
      sourceStartOffsetSec={reversedPlayback ? 0 : sourceStartOffsetSec}
      volume={volume}
      playbackRate={playbackRate}
      isReversed={isReversed && !reversedPlayback}
      reverseSourceEnd={reversedPlayback ? undefined : reverseSourceEnd}
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
  )
}

function shouldReplaceDecodedPitchSource(
  current: DecodedPitchSource | null,
  next: DecodedPitchSource,
): boolean {
  if (!current) {
    return true
  }
  if (current.isComplete) {
    return (
      next.isComplete &&
      (current.buffer.length !== next.buffer.length ||
        current.buffer.sampleRate !== next.buffer.sampleRate)
    )
  }
  if (next.isComplete) {
    return true
  }
  if (next.coverageEndSec > current.coverageEndSec + 0.05) {
    return true
  }
  if (next.sourceStartOffsetSec < current.sourceStartOffsetSec - 0.05) {
    return true
  }
  return false
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
  isReversed,
  reverseSourceEnd,
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
  const { frame, fps, playing, transportPlaybackRate, isPreviewScrubbing } = useAudioPlaybackState({
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
  })
  const [decodedSource, setDecodedSource] = useState<DecodedPitchSource | null>(null)
  const pendingExtensionKeyRef = useRef<string | null>(null)
  const frameRef = useRef(frame)
  frameRef.current = frame
  const isReverseShuttle = transportPlaybackRate < 0

  useEffect(() => {
    if (!mediaId || !src || isPreviewScrubbing) return

    let cancelled = false
    const effectiveSourceFps = sourceFps ?? 30
    const seedSourceFrames = isReverseShuttle
      ? getAudioTargetTimeSeconds(
          trimBefore,
          effectiveSourceFps,
          frameRef.current,
          playbackRate,
          fps,
          isReversed,
          reverseSourceEnd,
        ) * effectiveSourceFps
      : isReversed && reverseSourceEnd !== undefined
        ? reverseSourceEnd
        : trimBefore
    const clipStartTime = Math.max(0, seedSourceFrames / effectiveSourceFps)
    setDecodedSource(null)
    pendingExtensionKeyRef.current = null

    // Keep preview audio windowed. Whole-file decoding makes long custom-codec
    // sources retain very large Float32 buffers after the cache has evicted them.
    getOrDecodeAudioSliceForPlayback(mediaId, src, {
      minReadySeconds: PARTIAL_WAV_READY_SECONDS,
      waitTimeoutMs: PARTIAL_WAV_WAIT_TIMEOUT_MS,
      targetTimeSeconds: clipStartTime,
      ...(isReverseShuttle ? { preRollSeconds: REVERSE_SHUTTLE_PREROLL_SECONDS } : {}),
    })
      .then((slice) => {
        if (cancelled) return
        const nextSource: DecodedPitchSource = {
          buffer: slice.buffer,
          sourceStartOffsetSec: slice.startTime,
          coverageEndSec: slice.startTime + slice.buffer.duration,
          isComplete: slice.isComplete,
        }
        setDecodedSource((current) => {
          if (!shouldReplaceDecodedPitchSource(current, nextSource)) {
            return current
          }
          return nextSource
        })
        log.info('Partial decoded pitch source ready', {
          mediaId,
          duration: slice.buffer.duration.toFixed(2),
        })
      })
      .catch((err) => {
        if (cancelled) return
        log.error('Failed to prepare partial decoded pitch source', { mediaId, err })
      })

    return () => {
      cancelled = true
    }
  }, [
    fps,
    isPreviewScrubbing,
    isReversed,
    isReverseShuttle,
    mediaId,
    playbackRate,
    reverseSourceEnd,
    sourceFps,
    src,
    trimBefore,
  ])

  useEffect(() => {
    const currentSource = decodedSource
    const effectiveSourceFps = sourceFps ?? fps
    const targetTime = getAudioTargetTimeSeconds(
      trimBefore,
      effectiveSourceFps,
      frame,
      playbackRate,
      fps,
      isReversed,
      reverseSourceEnd,
    )
    if (
      !needsDecodedPitchSourceExtension(
        currentSource,
        playing,
        targetTime,
        isReverseShuttle,
        PARTIAL_WAV_EXTENSION_TRIGGER_SECONDS,
      )
    ) {
      pendingExtensionKeyRef.current = null
      return
    }

    const requestKey = `${mediaId}:${src}:${playbackRate}:${targetTime.toFixed(3)}`
    if (pendingExtensionKeyRef.current === requestKey) {
      return
    }
    pendingExtensionKeyRef.current = requestKey

    let cancelled = false
    getOrDecodeAudioSliceForPlayback(mediaId, src, {
      minReadySeconds: PARTIAL_WAV_EXTENSION_READY_SECONDS,
      waitTimeoutMs: PARTIAL_WAV_WAIT_TIMEOUT_MS,
      targetTimeSeconds: Math.max(0, targetTime),
      ...(isReverseShuttle ? { preRollSeconds: REVERSE_SHUTTLE_PREROLL_SECONDS } : {}),
    })
      .then((slice) => {
        if (cancelled) return
        const nextSource: DecodedPitchSource = {
          buffer: slice.buffer,
          sourceStartOffsetSec: slice.startTime,
          coverageEndSec: slice.startTime + slice.buffer.duration,
          isComplete: slice.isComplete,
        }
        setDecodedSource((current) => {
          if (!shouldReplaceDecodedPitchSource(current, nextSource)) {
            return current
          }
          return nextSource
        })
      })
      .catch((err) => {
        if (!cancelled) {
          log.warn('Failed to extend pitch-preserved custom decoder audio slice', {
            mediaId,
            targetTime,
            err,
          })
        }
      })
      .finally(() => {
        if (!cancelled && pendingExtensionKeyRef.current === requestKey) {
          pendingExtensionKeyRef.current = null
        }
      })

    return () => {
      cancelled = true
      if (pendingExtensionKeyRef.current === requestKey) {
        pendingExtensionKeyRef.current = null
      }
    }
  }, [
    decodedSource,
    fps,
    frame,
    isReversed,
    isReverseShuttle,
    mediaId,
    playbackRate,
    playing,
    reverseSourceEnd,
    sourceFps,
    src,
    trimBefore,
  ])

  if (!decodedSource) return null

  const fallback = (
    <DecodedPitchFallbackAudio
      audioBuffer={decodedSource.buffer}
      sourceStartOffsetSec={decodedSource.sourceStartOffsetSec}
      isComplete={decodedSource.isComplete}
      timelineFps={fps}
      itemId={itemId}
      liveGainItemIds={liveGainItemIds}
      trimBefore={trimBefore}
      sourceFps={sourceFps}
      volume={volume}
      playbackRate={playbackRate}
      isReversed={isReversed}
      reverseSourceEnd={reverseSourceEnd}
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
  )

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
      isReversed={isReversed}
      reverseSourceEnd={reverseSourceEnd}
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
  )
}

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
  const playbackRate = props.playbackRate ?? 1
  const transportPlaybackRate = useClockPlaybackRate()
  const isShuttleRate = Math.abs(transportPlaybackRate - 1) > 0.0001
  const itemPreview = useGizmoStore(
    useCallback((state) => state.preview?.[props.itemId], [props.itemId]),
  )
  const resolvedPitchShiftSemitones = resolvePreviewAudioPitchShiftSemitones({
    base: {
      audioPitchSemitones: props.audioPitchSemitones,
      audioPitchCents: props.audioPitchCents,
    },
    preview: itemPreview?.properties,
    additionalSemitones: props.audioPitchShiftSemitones,
  })
  // Stay on the SoundTouch path while a pitch preview is active so crossing the
  // zero boundary mid-drag doesn't remount between buffered and pitch-preserved.
  const hasActivePitchPreview = hasAudioPitchOverride(itemPreview?.properties)
  const shouldUseBufferedPlayback =
    props.isReversed !== true &&
    !isShuttleRate &&
    Math.abs(playbackRate - 1) <= 0.0001 &&
    !hasActivePitchPreview &&
    !isAudioPitchShiftActive(resolvedPitchShiftSemitones)

  if (shouldUseBufferedPlayback) {
    return <CustomDecoderBufferedAudio {...props} playbackRate={playbackRate} />
  }

  return <CustomDecoderPitchPreservedAudio {...props} playbackRate={playbackRate} />
})
