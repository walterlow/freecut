import React, { useEffect, useRef } from 'react';
import { useCurrentFrame, useVideoConfig, Internals, getRemotionEnvironment, Audio, interpolate } from 'remotion';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';

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
 * During preview: Uses HTML5 audio element with preservesPitch (native browser feature)
 * During render: Uses Remotion's Audio component with playbackRate (uses FFmpeg atempo filter
 *                which preserves pitch automatically)
 *
 * Note: We use Audio from 'remotion' directly instead of '@remotion/media' Audio because:
 * - @remotion/media Audio shows "Unknown container format" warnings for MP3 files
 * - The standard Audio component works reliably with all formats
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
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const environment = getRemotionEnvironment();
  const [playing] = Internals.Timeline.usePlayingState();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Track when we last synced - initialized to current time
  const lastSyncTimeRef = useRef<number>(Date.now());
  // Track if this is the very first sync (component just mounted)
  const needsInitialSyncRef = useRef<boolean>(true);
  // Track last frame for scrub detection (only seek on pause if frame changed)
  const lastFrameRef = useRef<number>(-1);

  // Read preview values from gizmo store
  const itemPropertiesPreview = useGizmoStore((s) => s.itemPropertiesPreview);
  const preview = itemPropertiesPreview?.[itemId];

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

  let fadeMultiplier = 1;
  const hasFadeIn = fadeInFrames > 0;
  const hasFadeOut = fadeOutFrames > 0;

  if (hasFadeIn || hasFadeOut) {
    const fadeOutStart = durationInFrames - fadeOutFrames;

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

  // Convert dB to linear (0 dB = unity gain = 1.0)
  const linearVolume = Math.pow(10, effectiveVolumeDb / 20);
  // Item volume with fades (used for both render and preview)
  const itemVolume = muted ? 0 : Math.max(0, Math.min(1, linearVolume * fadeMultiplier));

  // During render, use only item volume
  // During preview, apply master preview volume from playback controls
  const isPreview = !environment.isRendering;
  const effectiveMasterVolume = isPreview ? (previewMasterMuted ? 0 : previewMasterVolume) : 1;
  const finalVolume = itemVolume * effectiveMasterVolume;

  // During rendering, use Remotion's Audio component
  // Remotion's playbackRate uses FFmpeg's atempo filter which already preserves pitch
  // So we don't need to apply toneFrequency for pitch correction
  if (environment.isRendering) {
    return (
      <Audio
        src={src}
        volume={finalVolume}
        playbackRate={playbackRate}
        trimBefore={trimBefore > 0 ? trimBefore : undefined}
      />
    );
  }

  // Preview mode: Use HTML5 audio with native preservesPitch

  // Create and manage audio element
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
    };
  }, [src]);

  // Update playback rate
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Update volume (with fades applied)
  useEffect(() => {
    if (audioRef.current) {
      // Clamp to 0-1 range for HTML5 audio
      audioRef.current.volume = Math.max(0, Math.min(1, finalVolume));
      audioRef.current.muted = muted;
    }
  }, [finalVolume, muted]);

  // Sync playback with Remotion timeline
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Calculate target time in the source audio
    // frame is the current frame in the composition
    // We need to convert to source time accounting for trim and speed
    const compositionTimeSeconds = frame / fps;
    const sourceTimeSeconds = (trimBefore / fps) + (compositionTimeSeconds * playbackRate);

    // Detect if frame actually changed (for scrub detection)
    const frameChanged = frame !== lastFrameRef.current;
    lastFrameRef.current = frame;

    if (playing) {
      const currentTime = audio.currentTime;
      const now = Date.now();

      // Calculate drift direction: positive = audio ahead, negative = audio behind
      const drift = currentTime - sourceTimeSeconds;
      const timeSinceLastSync = now - lastSyncTimeRef.current;

      // Determine if we need to seek:
      // 1. Initial sync when component first plays
      // 2. Audio is BEHIND by more than threshold (needs to catch up)
      //
      // IMPORTANT: Never seek backwards when audio is ahead!
      // During heavy renders (drag operations), frame updates lag behind real-time
      // audio playback. The frame will catch up naturally. Seeking backwards causes
      // the audible "rewind" glitch that disrupts playback.
      const audioBehind = drift < -0.2;
      const needsSync = needsInitialSyncRef.current || (audioBehind && timeSinceLastSync > 500);

      if (needsSync) {
        audio.currentTime = sourceTimeSeconds;
        lastSyncTimeRef.current = now;
        needsInitialSyncRef.current = false;
      }

      // Play if paused
      if (audio.paused) {
        audio.play().catch(() => {
          // Autoplay might be blocked
        });
      }
    } else {
      // Pause audio when not playing
      if (!audio.paused) {
        audio.pause();
      }
      // Only seek when paused if frame actually changed (user is scrubbing)
      if (frameChanged) {
        audio.currentTime = sourceTimeSeconds;
      }
    }
  }, [frame, fps, playing, playbackRate, trimBefore]);

  // This component renders nothing visually
  return null;
});
