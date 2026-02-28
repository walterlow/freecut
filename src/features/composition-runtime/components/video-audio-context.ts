import { useCallback } from 'react';
import { interpolate, useSequenceContext } from '@/features/composition-runtime/deps/player';
import { useGizmoStore } from '@/features/composition-runtime/deps/stores';
import { usePlaybackStore } from '@/features/composition-runtime/deps/stores';
import { useVideoConfig } from '../hooks/use-player-compat';
import { useTimelineStore } from '@/features/composition-runtime/deps/stores';
import { useItemKeyframesFromContext } from '../contexts/keyframes-context';
import { getPropertyKeyframes, interpolatePropertyValue } from '@/features/composition-runtime/deps/keyframes';
import type { VideoItem } from '@/types/timeline';

// Track video elements that have been connected to Web Audio API
// A video element can only be connected to ONE MediaElementSourceNode ever
const connectedVideoElements = new WeakSet<HTMLVideoElement>();
// Store gain nodes by video element for volume updates
const videoGainNodes = new WeakMap<HTMLVideoElement, GainNode>();
const videoAudioContexts = new WeakMap<HTMLVideoElement, AudioContext>();
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

  // Already connected to Web Audio API: update gain and resume context if needed.
  if (connectedVideoElements.has(video)) {
    const gainNode = videoGainNodes.get(video);
    const audioContext = videoAudioContexts.get(video);
    if (gainNode) {
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
    gainNode.gain.value = audioVolume;
    const sourceNode = audioContext.createMediaElementSource(video);
    sourceNode.connect(gainNode);
    gainNode.connect(audioContext.destination);

    connectedVideoElements.add(video);
    videoGainNodes.set(video, gainNode);
    videoAudioContexts.set(video, audioContext);

    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
  } catch {
    // Fallback if Web Audio setup fails.
    video.volume = Math.min(1, Math.max(0, audioVolume));
  }
}

/** Expose connected-element tracking for use by video-content acquisition logic. */
export { connectedVideoElements, videoAudioContexts };

/**
 * Hook to calculate video audio volume with fades and preview support.
 * Returns the final volume (0-1) to apply to the video component.
 * Applies master preview volume from playback controls.
 */
export function useVideoAudioVolume(item: VideoItem & { _sequenceFrameOffset?: number }, muted: boolean): number {
  const { fps } = useVideoConfig();
  // Get local frame from Sequence context (0-based within this Sequence)
  const sequenceContext = useSequenceContext();
  const sequenceFrame = sequenceContext?.localFrame ?? 0;

  // Adjust frame for shared Sequences (split clips)
  // In a shared Sequence, localFrame is relative to the shared Sequence start,
  // not relative to this specific item. _sequenceFrameOffset corrects this.
  const frame = sequenceFrame - (item._sequenceFrameOffset ?? 0);

  // Read preview values from unified preview system
  const itemPreview = useGizmoStore(
    useCallback((s) => s.preview?.[item.id], [item.id])
  );
  const preview = itemPreview?.properties;

  // Read master preview volume from playback store (only used during preview, not render)
  const previewMasterVolume = usePlaybackStore((s) => s.volume);
  const previewMasterMuted = usePlaybackStore((s) => s.muted);

  // Get keyframes for this item (context-first for render mode, store-fallback for preview)
  const contextKeyframes = useItemKeyframesFromContext(item.id);
  const storeKeyframes = useTimelineStore(
    useCallback(
      (s) => s.keyframes.find((k) => k.itemId === item.id),
      [item.id]
    )
  );
  const itemKeyframes = contextKeyframes ?? storeKeyframes;

  // Interpolate volume from keyframes if they exist, otherwise use static value
  const volumeKeyframes = getPropertyKeyframes(itemKeyframes, 'volume');
  const staticVolumeDb = preview?.volume ?? item.volume ?? 0;
  const volumeDb = volumeKeyframes.length > 0
    ? interpolatePropertyValue(volumeKeyframes, frame, staticVolumeDb)
    : staticVolumeDb;

  // Use preview values if available, otherwise use item's stored values
  const audioFadeIn = preview?.audioFadeIn ?? item.audioFadeIn ?? 0;
  const audioFadeOut = preview?.audioFadeOut ?? item.audioFadeOut ?? 0;

  if (muted) return 0;

  // Calculate fade multiplier
  const fadeInFrames = Math.min(audioFadeIn * fps, item.durationInFrames);
  const fadeOutFrames = Math.min(audioFadeOut * fps, item.durationInFrames);

  let fadeMultiplier = 1;
  const hasFadeIn = fadeInFrames > 0;
  const hasFadeOut = fadeOutFrames > 0;

  if (hasFadeIn || hasFadeOut) {
    const fadeOutStart = item.durationInFrames - fadeOutFrames;

    if (hasFadeIn && hasFadeOut) {
      if (fadeInFrames >= fadeOutStart) {
        // Overlapping fades
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
      fadeMultiplier = interpolate(
        frame,
        [0, fadeInFrames],
        [0, 1],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
      );
    } else {
      fadeMultiplier = interpolate(
        frame,
        [fadeOutStart, item.durationInFrames],
        [1, 0],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
      );
    }
  }

  // Convert dB to linear (0 dB = unity gain = 1.0)
  // +20dB = 10x, -20dB = 0.1x, -60dB ≈ 0.001x
  const linearVolume = Math.pow(10, volumeDb / 20);
  // Item volume with fades - allow values > 1 for volume boost (Web Audio API handles this)
  const itemVolume = Math.max(0, linearVolume * fadeMultiplier);

  // Apply master preview volume from playback controls
  const effectiveMasterVolume = previewMasterMuted ? 0 : previewMasterVolume;

  return itemVolume * effectiveMasterVolume;
}
