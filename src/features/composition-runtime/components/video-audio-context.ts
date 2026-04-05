import { useCallback, useEffect } from 'react';
import { interpolate, useSequenceContext } from '@/features/composition-runtime/deps/player';
import { useGizmoStore } from '@/features/composition-runtime/deps/stores';
import { usePlaybackStore } from '@/features/composition-runtime/deps/stores';
import { useVideoConfig } from '../hooks/use-player-compat';
import { useTimelineStore } from '@/features/composition-runtime/deps/stores';
import { useItemKeyframesFromContext } from '../contexts/keyframes-context';
import { getPropertyKeyframes, interpolatePropertyValue } from '@/features/composition-runtime/deps/keyframes';
import type { VideoItem } from '@/types/timeline';
import { evaluateAudioFadeInCurve, evaluateAudioFadeOutCurve } from '@/shared/utils/audio-fade-curve';
import { useMixerLiveGain, clearMixerLiveGain } from '@/shared/state/mixer-live-gain';

// Track video elements that have been connected to Web Audio API.
// A video element can only be connected to ONE MediaElementSourceNode ever.
const connectedVideoElements = new WeakSet<HTMLVideoElement>();
// Store gain nodes by video element for volume updates.
const videoGainNodes = new WeakMap<HTMLVideoElement, GainNode>();
const videoAudioContexts = new WeakMap<HTMLVideoElement, AudioContext>();

// Short ramp to prevent audio clicks/pops on gain changes (matches custom decoder).
const GAIN_RAMP_SECONDS = 0.008;
let sharedVideoAudioContext: AudioContext | null = null;

function getSharedVideoAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  const webkitWindow = window as Window & {
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextCtor = window.AudioContext ?? webkitWindow.webkitAudioContext;
  if (!AudioContextCtor) return null;

  if (sharedVideoAudioContext === null || sharedVideoAudioContext.state === 'closed') {
    sharedVideoAudioContext = new AudioContextCtor();
  }

  return sharedVideoAudioContext;
}

export function applyVideoElementAudioVolume(video: HTMLVideoElement, audioVolume: number): void {
  // Pool creates elements muted. Keep element unmuted and control via volume/gain.
  video.muted = false;

  // Already connected to Web Audio API: ramp gain and resume context if needed.
  if (connectedVideoElements.has(video)) {
    const gainNode = videoGainNodes.get(video);
    const audioContext = videoAudioContexts.get(video);
    if (gainNode && audioContext && audioContext.state === 'running') {
      const now = audioContext.currentTime;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.linearRampToValueAtTime(Math.max(0, audioVolume), now + GAIN_RAMP_SECONDS);
    } else if (gainNode) {
      // Context not running yet — direct assignment is safe (no audio output).
      gainNode.gain.value = audioVolume;
    }
    if (audioContext?.state === 'suspended') {
      audioContext.resume();
    }
    return;
  }

  // For <= 1, native volume is cheaper.
  if (audioVolume <= 1) {
    video.volume = Math.max(0, audioVolume);
    return;
  }

  // For boost > 1, use shared Web Audio context.
  try {
    const audioContext = getSharedVideoAudioContext();
    if (!audioContext) {
      video.volume = Math.min(1, Math.max(0, audioVolume));
      return;
    }

    const gainNode = audioContext.createGain();
    // Start at 0 and ramp to target to prevent click on initial connection.
    gainNode.gain.value = 0;
    const sourceNode = audioContext.createMediaElementSource(video);
    sourceNode.connect(gainNode);
    gainNode.connect(audioContext.destination);

    connectedVideoElements.add(video);
    videoGainNodes.set(video, gainNode);
    videoAudioContexts.set(video, audioContext);

    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    // Ramp gain after connection is established and context is resuming.
    const now = audioContext.currentTime;
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(Math.max(0, audioVolume), now + GAIN_RAMP_SECONDS);
  } catch {
    // Fallback if Web Audio setup fails.
    video.volume = Math.min(1, Math.max(0, audioVolume));
  }
}

/**
 * Pre-resume the shared AudioContext. Call on playback start so audio
 * is ready immediately when video elements begin playing. Without this,
 * the AudioContext may be suspended (browser autoplay policy) and audio
 * lags behind video by 50-100ms on cold resume.
 */
export function ensureAudioContextResumed(): void {
  if (sharedVideoAudioContext?.state === 'suspended') {
    sharedVideoAudioContext.resume();
  }
}

/** Expose connected-element tracking for use by video-content acquisition logic. */
export { connectedVideoElements, videoAudioContexts };

/**
 * Hook to calculate video audio volume with fades and preview support.
 * Returns the final volume (0-1) to apply to the video component.
 * Applies master preview volume from playback controls.
 */
export function useVideoAudioVolume(
  item: VideoItem & { _sequenceFrameOffset?: number; trackVolumeDb?: number },
  muted: boolean
): number {
  const { fps } = useVideoConfig();
  const sequenceContext = useSequenceContext();
  const sequenceFrame = sequenceContext?.localFrame ?? 0;

  // In a shared Sequence, localFrame is relative to the shared Sequence start,
  // not relative to this specific item. _sequenceFrameOffset corrects this.
  const frame = sequenceFrame - (item._sequenceFrameOffset ?? 0);

  const itemPreview = useGizmoStore(
    useCallback((s) => s.preview?.[item.id], [item.id])
  );
  const preview = itemPreview?.properties;

  const previewMasterVolume = usePlaybackStore((s) => s.volume);
  const previewMasterMuted = usePlaybackStore((s) => s.muted);

  // Context-first for render mode, store-fallback for preview.
  const contextKeyframes = useItemKeyframesFromContext(item.id);
  const storeKeyframes = useTimelineStore(
    useCallback(
      (s) => s.keyframes.find((k) => k.itemId === item.id),
      [item.id]
    )
  );
  const itemKeyframes = contextKeyframes ?? storeKeyframes;

  const volumeKeyframes = getPropertyKeyframes(itemKeyframes, 'volume');
  const staticVolumeDb = preview?.volume ?? item.volume ?? 0;
  const itemVolumeDb = volumeKeyframes.length > 0
    ? interpolatePropertyValue(volumeKeyframes, frame, staticVolumeDb)
    : staticVolumeDb;
  const volumeDb = itemVolumeDb + (item.trackVolumeDb ?? 0);

  const audioFadeIn = preview?.audioFadeIn ?? item.audioFadeIn ?? 0;
  const audioFadeOut = preview?.audioFadeOut ?? item.audioFadeOut ?? 0;
  const audioFadeInCurve = preview?.audioFadeInCurve ?? item.audioFadeInCurve ?? 0;
  const audioFadeOutCurve = preview?.audioFadeOutCurve ?? item.audioFadeOutCurve ?? 0;
  const audioFadeInCurveX = preview?.audioFadeInCurveX ?? item.audioFadeInCurveX ?? 0.52;
  const audioFadeOutCurveX = preview?.audioFadeOutCurveX ?? item.audioFadeOutCurveX ?? 0.52;

  if (muted) return 0;

  const fadeInFrames = Math.min(audioFadeIn * fps, item.durationInFrames);
  const fadeOutFrames = Math.min(audioFadeOut * fps, item.durationInFrames);

  let fadeMultiplier = 1;
  const hasFadeIn = fadeInFrames > 0;
  const hasFadeOut = fadeOutFrames > 0;

  if (hasFadeIn || hasFadeOut) {
    const fadeOutStart = item.durationInFrames - fadeOutFrames;

    if (hasFadeIn && hasFadeOut) {
      if (fadeInFrames >= fadeOutStart) {
        const midPoint = item.durationInFrames / 2;
        const peakVolume = Math.min(1, midPoint / Math.max(fadeInFrames, 1));
        fadeMultiplier = interpolate(
          frame,
          [0, midPoint, item.durationInFrames],
          [0, peakVolume, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        );
      } else {
        fadeMultiplier = interpolate(
          frame,
          [0, fadeInFrames, fadeOutStart, item.durationInFrames],
          [0, 1, 1, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        );
      }
    } else if (hasFadeIn) {
      fadeMultiplier = evaluateAudioFadeInCurve(frame / fadeInFrames, audioFadeInCurve, audioFadeInCurveX);
    } else {
      fadeMultiplier = evaluateAudioFadeOutCurve((frame - fadeOutStart) / fadeOutFrames, audioFadeOutCurve, audioFadeOutCurveX);
    }
  }

  // Convert dB to linear. 0 dB = 1.0, +20 dB = 10x, -20 dB = 0.1x.
  const linearVolume = Math.pow(10, volumeDb / 20);
  const itemVolume = Math.max(0, linearVolume * fadeMultiplier);

  const effectiveMasterVolume = previewMasterMuted ? 0 : previewMasterVolume;

  // Mixer fader live gain — updated during drag without re-rendering.
  // Clear when the composition re-renders with updated track volume.
  const mixerGain = useMixerLiveGain(item.id);
  const trackVolumeDb = item.trackVolumeDb;
  useEffect(() => {
    clearMixerLiveGain(item.id);
  }, [trackVolumeDb, item.id]);

  return itemVolume * effectiveMasterVolume * mixerGain;
}
