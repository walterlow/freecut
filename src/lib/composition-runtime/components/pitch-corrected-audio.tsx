import React, { useEffect, useRef, useCallback } from 'react';
import { useVideoConfig, useIsPlaying } from '../hooks/use-player-compat';
import { interpolate, useSequenceContext } from '@/features/player/composition';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';

let sharedAudioContext: AudioContext | null = null;

function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  const webkitWindow = window as Window & {
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextCtor = window.AudioContext ?? webkitWindow.webkitAudioContext;
  if (!AudioContextCtor) return null;

  if (sharedAudioContext === null || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new AudioContextCtor();
  }

  return sharedAudioContext;
}

interface PitchCorrectedAudioProps {
  src: string;
  itemId: string;
  volume?: number;
  playbackRate?: number;
  trimBefore?: number;
  muted?: boolean;
  /** Duration of this audio clip in frames */
  durationInFrames: number;
  /** Fade in duration in seconds */
  audioFadeIn?: number;
  /** Fade out duration in seconds */
  audioFadeOut?: number;
  /** Crossfade fade in duration in FRAMES (for transitions - overrides audioFadeIn) */
  crossfadeFadeIn?: number;
  /** Crossfade fade out duration in FRAMES (for transitions - overrides audioFadeOut) */
  crossfadeFadeOut?: number;
}

/**
 * Audio component with pitch-preserved playback for rate-stretched audio.
 *
 * Uses HTML5 audio element with preservesPitch (native browser feature).
 * Export uses Canvas + WebCodecs (client-render-engine.ts) which handles audio separately.
 *
 * Wrapped in React.memo to prevent re-renders when parent composition updates
 * but audio props haven't changed (e.g., when moving other items in timeline).
 */
export const PitchCorrectedAudio: React.FC<PitchCorrectedAudioProps> = React.memo(({
  src,
  itemId,
  volume = 0,
  playbackRate = 1,
  trimBefore = 0,
  muted = false,
  durationInFrames,
  audioFadeIn = 0,
  audioFadeOut = 0,
  crossfadeFadeIn,
  crossfadeFadeOut,
}) => {
  // Get local frame from Sequence context (0-based within this Sequence)
  const sequenceContext = useSequenceContext();
  const frame = sequenceContext?.localFrame ?? 0;
  const { fps } = useVideoConfig();
  const playing = useIsPlaying();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Web Audio API refs are created lazily only when gain > 1 is needed.
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  // Track when we last synced - initialized to current time
  const lastSyncTimeRef = useRef<number>(Date.now());
  // Track if this is the very first sync (component just mounted)
  const needsInitialSyncRef = useRef<boolean>(true);
  // Track last frame for scrub detection (only seek on pause if frame changed)
  const lastFrameRef = useRef<number>(-1);

  // Read preview values from unified preview system
  const itemPreview = useGizmoStore(
    useCallback((s) => s.preview?.[itemId], [itemId])
  );
  const preview = itemPreview?.properties;

  // Read master preview volume from playback store (only used during preview, not render)
  // These are granular selectors to avoid unnecessary re-renders
  const previewMasterVolume = usePlaybackStore((s) => s.volume);
  const previewMasterMuted = usePlaybackStore((s) => s.muted);

  // Use preview values if available
  // Volume is stored in dB (0 = unity gain)
  const effectiveVolumeDb = preview?.volume ?? volume;
  const effectiveFadeIn = preview?.audioFadeIn ?? audioFadeIn;
  const effectiveFadeOut = preview?.audioFadeOut ?? audioFadeOut;

  // Calculate fade multiplier
  // Crossfade props are in frames and override normal fades when present
  // Normal fades are in seconds and need conversion
  const fadeInFrames = crossfadeFadeIn !== undefined
    ? Math.min(crossfadeFadeIn, durationInFrames)
    : Math.min(effectiveFadeIn * fps, durationInFrames);
  const fadeOutFrames = crossfadeFadeOut !== undefined
    ? Math.min(crossfadeFadeOut, durationInFrames)
    : Math.min(effectiveFadeOut * fps, durationInFrames);

  // Check if this is a transition crossfade (uses equal-power curve to avoid volume dip)
  const isCrossfade = crossfadeFadeIn !== undefined || crossfadeFadeOut !== undefined;

  let fadeMultiplier = 1;
  const hasFadeIn = fadeInFrames > 0;
  const hasFadeOut = fadeOutFrames > 0;

  if (hasFadeIn || hasFadeOut) {
    const fadeOutStart = durationInFrames - fadeOutFrames;

    if (isCrossfade) {
      // Equal-power crossfade: uses sin/cos curves to maintain constant perceived loudness
      // This prevents the volume dip that occurs with linear crossfades
      // At midpoint: sin(45°)² + cos(45°)² = 0.5 + 0.5 = 1 (constant power)
      if (hasFadeIn && frame < fadeInFrames) {
        // Fade in: sin curve (0 to 1)
        const progress = frame / fadeInFrames;
        fadeMultiplier = Math.sin(progress * Math.PI / 2);
      } else if (hasFadeOut && frame >= fadeOutStart) {
        // Fade out: cos curve (1 to 0)
        const progress = (frame - fadeOutStart) / fadeOutFrames;
        fadeMultiplier = Math.cos(progress * Math.PI / 2);
      }
    } else {
      // Regular linear fades for non-crossfade scenarios
      if (hasFadeIn && hasFadeOut) {
        if (fadeInFrames >= fadeOutStart) {
          // Overlapping fades
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

  // Convert dB to linear (0 dB = unity gain = 1.0)
  // +20dB = 10x, -20dB = 0.1x, -60dB ≈ 0.001x
  const linearVolume = Math.pow(10, effectiveVolumeDb / 20);
  // Item volume with fades - allow values > 1 for volume boost
  const itemVolume = muted ? 0 : Math.max(0, linearVolume * fadeMultiplier);

  // Apply master preview volume from playback controls
  const effectiveMasterVolume = previewMasterMuted ? 0 : previewMasterVolume;
  const finalVolume = itemVolume * effectiveMasterVolume;

  // Use HTML5 audio with native preservesPitch.
  // Export uses Canvas + WebCodecs (client-render-engine.ts) which handles audio separately.
  // Web Audio graph is created lazily only when volume boost (>1) is needed.
  useEffect(() => {
    const audio = new window.Audio();
    audio.src = src;
    audio.preload = 'auto';
    // preservesPitch is true by default in browsers, but set explicitly
    audio.preservesPitch = true;
    // @ts-expect-error - webkit prefix for older Safari
    audio.webkitPreservesPitch = true;
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
      // Disconnect per-element nodes; shared AudioContext is reused.
      sourceNodeRef.current?.disconnect();
      gainNodeRef.current?.disconnect();
      gainNodeRef.current = null;
      sourceNodeRef.current = null;
    };
  }, [src]);

  // Update playback rate
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Update volume. Use native audio.volume for <= 1, lazily promote to Web Audio gain for boosts.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const clampedVolume = muted ? 0 : Math.max(0, finalVolume);

    // Existing graph: keep using gain node regardless of current value.
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = clampedVolume;
      return;
    }

    // Fast path: native volume is cheaper and avoids allocating Web Audio nodes.
    if (clampedVolume <= 1) {
      audio.volume = clampedVolume;
      return;
    }

    // Promote to Web Audio graph only when boost above 1 is actually required.
    const audioContext = getSharedAudioContext();
    if (!audioContext) {
      audio.volume = 1;
      return;
    }

    try {
      const gainNode = audioContext.createGain();
      const sourceNode = audioContext.createMediaElementSource(audio);
      sourceNode.connect(gainNode);
      gainNode.connect(audioContext.destination);

      gainNodeRef.current = gainNode;
      sourceNodeRef.current = sourceNode;
      audio.volume = 1;
      gainNode.gain.value = clampedVolume;
    } catch {
      // Fallback if graph connection fails (e.g., browser restrictions).
      audio.volume = 1;
    }
  }, [finalVolume, muted]);

  // Sync playback with Composition timeline
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Calculate target time in the source audio
    const compositionTimeSeconds = frame / fps;
    const sourceTimeSeconds = (trimBefore / fps) + (compositionTimeSeconds * playbackRate);
    const clipStartTimeSeconds = Math.max(0, trimBefore / fps);

    // During Sequence premount, frame is negative. Keep audio paused and pre-seek to
    // clip start so playback starts immediately when frame reaches 0.
    const isPremounted = frame < 0;
    const targetTimeSeconds = isPremounted
      ? clipStartTimeSeconds
      : Math.max(0, sourceTimeSeconds);

    // Detect if frame actually changed (for scrub detection)
    const frameChanged = frame !== lastFrameRef.current;
    lastFrameRef.current = frame;

    // Guard: Only seek if audio has enough data loaded
    // readyState: 0=HAVE_NOTHING, 1=HAVE_METADATA, 2=HAVE_CURRENT_DATA, 3=HAVE_FUTURE_DATA, 4=HAVE_ENOUGH_DATA
    const canSeek = audio.readyState >= 1;

    if (isPremounted) {
      if (!audio.paused) {
        audio.pause();
      }
      if (canSeek && Math.abs(audio.currentTime - clipStartTimeSeconds) > 0.05) {
        try {
          audio.currentTime = clipStartTimeSeconds;
        } catch {
          // Seek failed - audio may not be ready yet
        }
      }
      return;
    }

    if (playing) {
      const currentTime = audio.currentTime;
      const now = Date.now();

      // Calculate drift direction: positive = audio ahead, negative = audio behind
      const drift = currentTime - targetTimeSeconds;
      const timeSinceLastSync = now - lastSyncTimeRef.current;

      // Determine if we need to seek:
      // 1. Initial sync when component first plays
      // 2. Audio is BEHIND by more than threshold (needs to catch up)
      // 3. Audio is far AHEAD (user seeked backwards, e.g., "Go to start")
      //
      // Small positive drift (< 0.5s) during heavy renders is tolerated — the
      // frame will catch up naturally. Seeking backwards on every render lag
      // causes an audible "rewind" glitch. But large drift (> 0.5s) signals a
      // deliberate user seek and must be respected.
      const audioBehind = drift < -0.2;
      const audioFarAhead = drift > 0.5;
      const needsSync = needsInitialSyncRef.current || audioFarAhead || (audioBehind && timeSinceLastSync > 500);

      if (needsSync && canSeek) {
        try {
          audio.currentTime = targetTimeSeconds;
          lastSyncTimeRef.current = now;
          needsInitialSyncRef.current = false;
        } catch {
          // Seek failed - audio may not be ready yet
        }
      }

      // Play if paused and audio is ready
      if (audio.paused && audio.readyState >= 2) {
        // Resume shared context when this clip is using Web Audio gain.
        const sharedContext = gainNodeRef.current ? getSharedAudioContext() : null;
        if (sharedContext?.state === 'suspended') {
          sharedContext.resume();
        }
        audio.play().catch(() => {
          // Autoplay might be blocked - this is fine
        });
      }
    } else {
      // Pause audio when not playing
      if (!audio.paused) {
        audio.pause();
      }
      // Only seek when paused if frame actually changed (user is scrubbing) and audio is ready
      if (frameChanged && canSeek) {
        try {
          audio.currentTime = targetTimeSeconds;
        } catch {
          // Seek failed - audio may not be ready yet
        }
      }
    }
  }, [frame, fps, playing, playbackRate, trimBefore]);

  // This component renders nothing visually
  return null;
});
