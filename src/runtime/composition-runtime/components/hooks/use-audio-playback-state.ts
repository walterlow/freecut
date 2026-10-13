import { useCallback, useEffect, useMemo } from 'react'
import { useClockPlaybackRate, useSequenceContext } from '@/runtime/composition-runtime/deps/player'
import { useVideoConfig, useIsPlaying } from '../../hooks/use-player-compat'
import { useGizmoStore } from '@/runtime/composition-runtime/deps/stores'
import { usePlaybackStore } from '@/runtime/composition-runtime/deps/stores'
import { useTimelineStore } from '@/runtime/composition-runtime/deps/stores'
import { useItemKeyframesFromContext } from '../../contexts/keyframes-context'
import {
  getPropertyKeyframes,
  interpolatePropertyValue,
} from '@/runtime/composition-runtime/deps/keyframes'
import { getAudioClipFadeMultiplier, getAudioFadeMultiplier } from '@/shared/utils/audio-fade-curve'
import { resolvePreviewAudioEqStages } from '@/shared/utils/audio-eq'
import { resolvePreviewAudioPitchShiftSemitones } from '@/shared/utils/audio-pitch'
import { useMixerLiveGainProduct, clearMixerLiveGain } from '@/shared/state/mixer-live-gain'
import type { ResolvedAudioEqSettings } from '@/types/audio'
import type { AudioPlaybackProps } from '../audio-playback-props'

interface AudioPlaybackState {
  frame: number
  fps: number
  playing: boolean
  transportPlaybackRate: number
  isPreviewScrubbing: boolean
  resolvedVolume: number
  resolvedPitchShiftSemitones: number
  resolvedAudioEqStages: ResolvedAudioEqSettings[]
}

export function useAudioPlaybackState({
  itemId,
  liveGainItemIds,
  volume = 0,
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
  contentStartOffsetFrames = 0,
  contentEndOffsetFrames = 0,
  fadeInDelayFrames = 0,
  fadeOutLeadFrames = 0,
  crossfadeFadeIn,
  crossfadeFadeOut,
  volumeMultiplier = 1,
}: AudioPlaybackProps): AudioPlaybackState {
  const sequenceContext = useSequenceContext()
  const frame = sequenceContext?.localFrame ?? 0
  const { fps } = useVideoConfig()
  const playing = useIsPlaying()
  const transportPlaybackRate = useClockPlaybackRate()
  // Subscribe to the scrub lifecycle, not the changing preview frame itself.
  // Audio is silent while the pointer is down, so adapters can defer decode and
  // graph allocation until the scrub settles on its final frame.
  const hasPreviewFrame = usePlaybackStore((state) => state.previewFrame !== null)
  const hasActiveGizmo = useGizmoStore((state) => state.activeGizmo !== null)
  const isPreviewScrubbing = !playing && hasPreviewFrame && !hasActiveGizmo

  const itemPreview = useGizmoStore(useCallback((state) => state.preview?.[itemId], [itemId]))
  const preview = itemPreview?.properties

  const previewMasterVolume = usePlaybackStore((state) => state.volume)
  const previewMasterMuted = usePlaybackStore((state) => state.muted)
  const masterBusDb = usePlaybackStore((state) => state.masterBusDb)

  const contextKeyframes = useItemKeyframesFromContext(itemId)
  const storeKeyframes = useTimelineStore(
    useCallback(
      (state) => state.keyframes.find((keyframes) => keyframes.itemId === itemId),
      [itemId],
    ),
  )
  const itemKeyframes = contextKeyframes ?? storeKeyframes

  const volumeKeyframes = getPropertyKeyframes(itemKeyframes, 'volume')
  const staticVolumeDb = preview?.volume ?? volume
  const effectiveVolumeDb =
    volumeKeyframes.length > 0
      ? interpolatePropertyValue(volumeKeyframes, frame, staticVolumeDb)
      : staticVolumeDb

  const clipFadeMultiplier = clipFadeSpans
    ? getAudioClipFadeMultiplier(frame, clipFadeSpans)
    : getAudioFadeMultiplier({
        frame,
        durationInFrames,
        fadeInFrames: (preview?.audioFadeIn ?? audioFadeIn) * fps,
        fadeOutFrames: (preview?.audioFadeOut ?? audioFadeOut) * fps,
        contentStartOffsetFrames,
        contentEndOffsetFrames,
        fadeInDelayFrames,
        fadeOutLeadFrames,
        fadeInCurve: preview?.audioFadeInCurve ?? audioFadeInCurve,
        fadeOutCurve: preview?.audioFadeOutCurve ?? audioFadeOutCurve,
        fadeInCurveX: preview?.audioFadeInCurveX ?? audioFadeInCurveX,
        fadeOutCurveX: preview?.audioFadeOutCurveX ?? audioFadeOutCurveX,
      })

  const fadeMultiplier =
    clipFadeMultiplier *
    getAudioFadeMultiplier({
      frame,
      durationInFrames,
      fadeInFrames: crossfadeFadeIn,
      fadeOutFrames: crossfadeFadeOut,
      useEqualPower: true,
    })

  const linearVolume = Math.pow(10, effectiveVolumeDb / 20)
  const itemVolume = muted ? 0 : Math.max(0, linearVolume * fadeMultiplier)
  const masterBusGain = Math.pow(10, masterBusDb / 20)
  const effectiveMonitorVolume = previewMasterMuted ? 0 : previewMasterVolume

  const mixerGain = useMixerLiveGainProduct([itemId, ...(liveGainItemIds ?? [])])
  useEffect(() => {
    clearMixerLiveGain(itemId)
  }, [itemId, volume])

  const resolvedPitchShiftSemitones = useMemo(
    () =>
      resolvePreviewAudioPitchShiftSemitones({
        base: {
          audioPitchSemitones,
          audioPitchCents,
        },
        preview,
        additionalSemitones: audioPitchShiftSemitones,
      }),
    [audioPitchCents, audioPitchSemitones, audioPitchShiftSemitones, preview],
  )

  const resolvedAudioEqStages = useMemo(
    () => resolvePreviewAudioEqStages(audioEqStages, preview),
    [audioEqStages, preview],
  )

  return {
    frame,
    fps,
    playing,
    transportPlaybackRate,
    isPreviewScrubbing,
    resolvedVolume:
      itemVolume *
      masterBusGain *
      effectiveMonitorVolume *
      Math.max(0, volumeMultiplier) *
      mixerGain,
    resolvedPitchShiftSemitones,
    resolvedAudioEqStages,
  }
}
