import { useCallback, useEffect, useMemo } from 'react'
import { interpolate, useSequenceContext } from '@/features/composition-runtime/deps/player'
import { useGizmoStore } from '@/features/composition-runtime/deps/stores'
import { usePlaybackStore } from '@/features/composition-runtime/deps/stores'
import { useVideoConfig } from '../hooks/use-player-compat'
import { useTimelineStore } from '@/features/composition-runtime/deps/stores'
import { useItemKeyframesFromContext } from '../contexts/keyframes-context'
import {
  getPropertyKeyframes,
  interpolatePropertyValue,
} from '@/features/composition-runtime/deps/keyframes'
import type { VideoItem } from '@/types/timeline'
import {
  evaluateAudioFadeInCurve,
  evaluateAudioFadeOutCurve,
} from '@/shared/utils/audio-fade-curve'
import { resolvePreviewAudioEqStages } from '@/shared/utils/audio-eq'
import { useMixerLiveGain, clearMixerLiveGain } from '@/shared/state/mixer-live-gain'
import type { ResolvedAudioEqSettings } from '@/types/audio'
import {
  createPreviewClipAudioGraph,
  getSharedPreviewAudioContext,
  rampPreviewClipEq,
  rampPreviewClipGain,
  setPreviewClipEq,
  setPreviewClipGain,
  type PreviewClipAudioGraph,
} from '../utils/preview-audio-graph'

// Track video elements that have been connected to Web Audio API
// A video element can only be connected to ONE MediaElementSourceNode ever
const connectedVideoElements = new WeakSet<HTMLVideoElement>()
const videoAudioGraphs = new WeakMap<HTMLVideoElement, PreviewClipAudioGraph>()
const videoAudioContexts = new WeakMap<HTMLVideoElement, AudioContext>()

export function applyVideoElementAudioState(
  video: HTMLVideoElement,
  audioVolume: number,
  audioEqStages: ReadonlyArray<ResolvedAudioEqSettings>,
): void {
  // Pool creates elements muted. Keep element unmuted and control via volume/gain.
  video.muted = false
  const safeVolume = Math.max(0, audioVolume)

  // Already connected to Web Audio API: ramp gain and resume context if needed.
  if (connectedVideoElements.has(video)) {
    const graph = videoAudioGraphs.get(video)
    const audioContext = videoAudioContexts.get(video)
    if (graph && audioContext?.state === 'running') {
      rampPreviewClipEq(graph, audioEqStages)
      rampPreviewClipGain(graph, safeVolume)
    } else if (graph) {
      // Context not running yet — direct assignment is safe (no audio output)
      setPreviewClipEq(graph, audioEqStages)
      setPreviewClipGain(graph, safeVolume)
    }
    if (audioContext?.state === 'suspended') {
      audioContext.resume()
    }
    return
  }

  // Always route preview video audio through the shared clip graph so future
  // EQ/SFX can be inserted in one place for video and audio clips alike.
  try {
    const graph = createPreviewClipAudioGraph({ eqStageCount: audioEqStages.length })
    if (!graph) {
      video.volume = Math.min(1, safeVolume)
      return
    }

    video.volume = 1
    const sourceNode = graph.context.createMediaElementSource(video)
    sourceNode.connect(graph.sourceInputNode)

    connectedVideoElements.add(video)
    videoAudioGraphs.set(video, graph)
    videoAudioContexts.set(video, graph.context)

    if (graph.context.state === 'suspended') {
      graph.context.resume()
    }
    setPreviewClipEq(graph, audioEqStages)
    rampPreviewClipGain(graph, safeVolume)
  } catch {
    // Fallback if Web Audio setup fails.
    video.volume = Math.min(1, safeVolume)
  }
}

/**
 * Pre-resume the shared AudioContext. Call on playback start so audio
 * is ready immediately when video elements begin playing. Without this,
 * the AudioContext may be suspended (browser autoplay policy) and audio
 * lags behind video by 50-100ms on cold resume.
 */
export function ensureAudioContextResumed(): void {
  const sharedPreviewContext = getSharedPreviewAudioContext()
  if (sharedPreviewContext?.state === 'suspended') {
    sharedPreviewContext.resume()
  }
}

/** Expose connected-element tracking for use by video-content acquisition logic. */
export { connectedVideoElements, videoAudioContexts }

/**
 * Mute a video element's audio via Web Audio gain node. Called when pinning
 * elements for a transition — the composition's crossfade audio handles mixing,
 * so the DOM element must be silent to prevent doubling.
 * Operates directly on the gain node, bypassing React state for zero latency.
 */
export function muteTransitionElement(video: HTMLVideoElement): void {
  const graph = videoAudioGraphs.get(video)
  const audioContext = videoAudioContexts.get(video)
  if (graph && audioContext && audioContext.state === 'running') {
    rampPreviewClipGain(graph, 0)
  } else if (graph) {
    setPreviewClipGain(graph, 0)
  } else {
    video.volume = 0
  }
}

/**
 * Restore a video element's audio after a transition ends. Ramps gain to the
 * target volume over GAIN_RAMP_SECONDS to prevent a click.
 */
export function unmuteTransitionElement(video: HTMLVideoElement, targetVolume: number): void {
  const graph = videoAudioGraphs.get(video)
  const audioContext = videoAudioContexts.get(video)
  const safeVolume = Math.max(0, targetVolume)
  if (graph && audioContext && audioContext.state === 'running') {
    rampPreviewClipGain(graph, safeVolume)
  } else if (graph) {
    setPreviewClipGain(graph, safeVolume)
  } else {
    video.volume = Math.min(1, safeVolume)
  }
}

/**
 * Set playback rate and play a paused element with gain at 0 (kept muted).
 * The composition's crossfade audio handles transition mixing. The DOM element
 * must play so the render loop can read pixels, but its audio stays silent.
 */
export function transitionSafePlay(video: HTMLVideoElement, targetRate: number): void {
  if (Math.abs(video.playbackRate - targetRate) > 0.01) {
    video.playbackRate = targetRate
  }

  if (!video.paused) {
    muteTransitionElement(video)
    return
  }

  // Mute before play — the element will stay muted for the duration of the transition
  muteTransitionElement(video)
  video.play().catch(() => {})
}

/**
 * Hook to calculate video audio state with fades and preview support.
 * Returns both the final volume and resolved EQ stage chain for the clip.
 */
export function useVideoAudioState(
  item: VideoItem & { _sequenceFrameOffset?: number; trackVolumeDb?: number },
  muted: boolean,
  audioEqStages: ReadonlyArray<ResolvedAudioEqSettings>,
): {
  audioVolume: number
  resolvedAudioEqStages: ResolvedAudioEqSettings[]
} {
  const { fps } = useVideoConfig()
  // Get local frame from Sequence context (0-based within this Sequence)
  const sequenceContext = useSequenceContext()
  const sequenceFrame = sequenceContext?.localFrame ?? 0

  // Adjust frame for shared Sequences (split clips)
  // In a shared Sequence, localFrame is relative to the shared Sequence start,
  // not relative to this specific item. _sequenceFrameOffset corrects this.
  const frame = sequenceFrame - (item._sequenceFrameOffset ?? 0)

  // Read preview values from unified preview system
  const itemPreview = useGizmoStore(useCallback((s) => s.preview?.[item.id], [item.id]))
  const preview = itemPreview?.properties

  // Read master preview volume from playback store (only used during preview, not render)
  const previewMasterVolume = usePlaybackStore((s) => s.volume)
  const previewMasterMuted = usePlaybackStore((s) => s.muted)
  const masterBusDb = usePlaybackStore((s) => s.masterBusDb)

  // Get keyframes for this item (context-first for render mode, store-fallback for preview)
  const contextKeyframes = useItemKeyframesFromContext(item.id)
  const storeKeyframes = useTimelineStore(
    useCallback((s) => s.keyframes.find((k) => k.itemId === item.id), [item.id]),
  )
  const itemKeyframes = contextKeyframes ?? storeKeyframes

  // Interpolate volume from keyframes if they exist, otherwise use static value
  const volumeKeyframes = getPropertyKeyframes(itemKeyframes, 'volume')
  const staticVolumeDb = preview?.volume ?? item.volume ?? 0
  const itemVolumeDb =
    volumeKeyframes.length > 0
      ? interpolatePropertyValue(volumeKeyframes, frame, staticVolumeDb)
      : staticVolumeDb
  const volumeDb = itemVolumeDb + (item.trackVolumeDb ?? 0)

  // Use preview values if available, otherwise use item's stored values
  const audioFadeIn = preview?.audioFadeIn ?? item.audioFadeIn ?? 0
  const audioFadeOut = preview?.audioFadeOut ?? item.audioFadeOut ?? 0
  const audioFadeInCurve = preview?.audioFadeInCurve ?? item.audioFadeInCurve ?? 0
  const audioFadeOutCurve = preview?.audioFadeOutCurve ?? item.audioFadeOutCurve ?? 0
  const audioFadeInCurveX = preview?.audioFadeInCurveX ?? item.audioFadeInCurveX ?? 0.52
  const audioFadeOutCurveX = preview?.audioFadeOutCurveX ?? item.audioFadeOutCurveX ?? 0.52

  const resolvedAudioEqStages = useMemo(
    () => resolvePreviewAudioEqStages(audioEqStages, preview),
    [audioEqStages, preview],
  )

  // Mixer fader live gain - updated during drag without re-rendering the composition.
  // Clear when the composition re-renders with updated track volume (trackVolumeDb changes).
  const mixerGain = useMixerLiveGain(item.id)
  const trackVolumeDb = item.trackVolumeDb
  useEffect(() => {
    clearMixerLiveGain(item.id)
  }, [trackVolumeDb, item.id])

  if (muted) {
    return {
      audioVolume: 0,
      resolvedAudioEqStages,
    }
  }

  // Calculate fade multiplier
  const fadeInFrames = Math.min(audioFadeIn * fps, item.durationInFrames)
  const fadeOutFrames = Math.min(audioFadeOut * fps, item.durationInFrames)

  let fadeMultiplier = 1
  const hasFadeIn = fadeInFrames > 0
  const hasFadeOut = fadeOutFrames > 0

  if (hasFadeIn || hasFadeOut) {
    const fadeOutStart = item.durationInFrames - fadeOutFrames

    if (hasFadeIn && hasFadeOut) {
      if (fadeInFrames >= fadeOutStart) {
        // Overlapping fades
        const midPoint = item.durationInFrames / 2
        const peakVolume = Math.min(1, midPoint / Math.max(fadeInFrames, 1))
        fadeMultiplier = interpolate(
          frame,
          [0, midPoint, item.durationInFrames],
          [0, peakVolume, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
        )
      } else {
        fadeMultiplier = interpolate(
          frame,
          [0, fadeInFrames, fadeOutStart, item.durationInFrames],
          [0, 1, 1, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
        )
      }
    } else if (hasFadeIn) {
      fadeMultiplier = evaluateAudioFadeInCurve(
        frame / fadeInFrames,
        audioFadeInCurve,
        audioFadeInCurveX,
      )
    } else {
      fadeMultiplier = evaluateAudioFadeOutCurve(
        (frame - fadeOutStart) / fadeOutFrames,
        audioFadeOutCurve,
        audioFadeOutCurveX,
      )
    }
  }

  // Convert dB to linear (0 dB = unity gain = 1.0)
  // +20dB = 10x, -20dB = 0.1x, -60dB ≈ 0.001x
  const linearVolume = Math.pow(10, volumeDb / 20)
  // Item volume with fades - allow values > 1 for volume boost (Web Audio API handles this)
  const itemVolume = Math.max(0, linearVolume * fadeMultiplier)

  // Apply master bus gain (project) then monitor volume (per-device).
  const masterBusGain = Math.pow(10, masterBusDb / 20)
  const effectiveMonitorVolume = previewMasterMuted ? 0 : previewMasterVolume

  return {
    audioVolume: itemVolume * masterBusGain * effectiveMonitorVolume * mixerGain,
    resolvedAudioEqStages,
  }
}
