import React, { useEffect, useRef, useCallback } from 'react';
import { useVideoConfig, useIsPlaying } from '../hooks/use-player-compat';
import { useSequenceContext } from '@/features/composition-runtime/deps/player';
import { getAudioTargetTimeSeconds } from '../utils/video-timing';
import { useGizmoStore } from '@/features/composition-runtime/deps/stores';
import { usePlaybackStore } from '@/features/composition-runtime/deps/stores';
import { useTimelineStore } from '@/features/composition-runtime/deps/stores';
import { useItemKeyframesFromContext } from '../contexts/keyframes-context';
import { getPropertyKeyframes, interpolatePropertyValue } from '@/features/composition-runtime/deps/keyframes';
import { getAudioClipFadeMultiplier, getAudioFadeMultiplier, type AudioClipFadeSpan } from '@/shared/utils/audio-fade-curve';
import { useMixerLiveGainEpoch, getMixerLiveGain } from '@/shared/state/mixer-live-gain';

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
  sourceFps?: number;
  muted?: boolean;
  /** Duration of this audio clip in frames */
  durationInFrames: number;
  /** Fade in duration in seconds */
  audioFadeIn?: number;
  /** Fade out duration in seconds */
  audioFadeOut?: number;
  audioFadeInCurve?: number;
  audioFadeOutCurve?: number;
  audioFadeInCurveX?: number;
  audioFadeOutCurveX?: number;
  clipFadeSpans?: AudioClipFadeSpan[];
  contentStartOffsetFrames?: number;
  contentEndOffsetFrames?: number;
  fadeInDelayFrames?: number;
  fadeOutLeadFrames?: number;
  /** Crossfade fade in duration in FRAMES (for transitions - overrides audioFadeIn) */
  crossfadeFadeIn?: number;
  /** Crossfade fade out duration in FRAMES (for transitions - overrides audioFadeOut) */
  crossfadeFadeOut?: number;
  volumeMultiplier?: number;
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
  sourceFps,
  muted = false,
  durationInFrames,
  audioFadeIn = 0,
  audioFadeOut = 0,
  audioFadeInCurve = 0,
  audioFadeOutCurve = 0,
  audioFadeInCurveX = 0.52,
  audioFadeOutCurveX = 0.52,
  clipFadeSpans,
  contentStartOffsetFrames = 0,
  contentEndOffsetFrames = 0,
  fadeInDelayFrames = 0,
  fadeOutLeadFrames = 0,
  crossfadeFadeIn,
  crossfadeFadeOut,
  volumeMultiplier = 1,
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
  const preWarmTimerRef = useRef<number | null>(null);

  // Force a hard resync on resume after paused scrubbing/skimming.
  useEffect(() => {
    if (playing) {
      needsInitialSyncRef.current = true;
    }
  }, [playing]);

  // Read preview values from unified preview system
  const itemPreview = useGizmoStore(
    useCallback((s) => s.preview?.[itemId], [itemId])
  );
  const preview = itemPreview?.properties;

  // Read master preview volume from playback store (only used during preview, not render)
  // These are granular selectors to avoid unnecessary re-renders
  const previewMasterVolume = usePlaybackStore((s) => s.volume);
  const previewMasterMuted = usePlaybackStore((s) => s.muted);

  // Get keyframes for this item (context-first for render mode, store-fallback for preview)
  const contextKeyframes = useItemKeyframesFromContext(itemId);
  const storeKeyframes = useTimelineStore(
    useCallback(
      (s) => s.keyframes.find((k) => k.itemId === itemId),
      [itemId]
    )
  );
  const itemKeyframes = contextKeyframes ?? storeKeyframes;

  // Interpolate volume from keyframes if they exist, otherwise use static value
  const volumeKeyframes = getPropertyKeyframes(itemKeyframes, 'volume');
  const staticVolumeDb = preview?.volume ?? volume;
  const effectiveVolumeDb = volumeKeyframes.length > 0
    ? interpolatePropertyValue(volumeKeyframes, frame, staticVolumeDb)
    : staticVolumeDb;

  // Use preview values if available
  const effectiveFadeIn = preview?.audioFadeIn ?? audioFadeIn;
  const effectiveFadeOut = preview?.audioFadeOut ?? audioFadeOut;

  // Calculate fade multiplier
  // Crossfade props are in frames and override normal fades when present
  // Normal fades are in seconds and need conversion
  const clipFadeMultiplier = clipFadeSpans
    ? getAudioClipFadeMultiplier(frame, clipFadeSpans)
    : getAudioFadeMultiplier({
      frame,
      durationInFrames,
      fadeInFrames: effectiveFadeIn * fps,
      fadeOutFrames: effectiveFadeOut * fps,
      contentStartOffsetFrames,
      contentEndOffsetFrames,
      fadeInDelayFrames,
      fadeOutLeadFrames,
      fadeInCurve: preview?.audioFadeInCurve ?? audioFadeInCurve,
      fadeOutCurve: preview?.audioFadeOutCurve ?? audioFadeOutCurve,
      fadeInCurveX: preview?.audioFadeInCurveX ?? audioFadeInCurveX,
      fadeOutCurveX: preview?.audioFadeOutCurveX ?? audioFadeOutCurveX,
    });

  const fadeMultiplier = clipFadeMultiplier * getAudioFadeMultiplier({
    frame,
    durationInFrames,
    fadeInFrames: crossfadeFadeIn,
    fadeOutFrames: crossfadeFadeOut,
    useEqualPower: true,
  });

  // Convert dB to linear (0 dB = unity gain = 1.0)
  // +20dB = 10x, -20dB = 0.1x, -60dB ≈ 0.001x
  const linearVolume = Math.pow(10, effectiveVolumeDb / 20);
  // Item volume with fades - allow values > 1 for volume boost
  const itemVolume = muted ? 0 : Math.max(0, linearVolume * fadeMultiplier);

  // Apply master preview volume from playback controls
  const effectiveMasterVolume = previewMasterMuted ? 0 : previewMasterVolume;

  // Mixer fader live gain — updated during drag without re-rendering the composition
  useMixerLiveGainEpoch();
  const mixerGain = getMixerLiveGain(itemId);

  const finalVolume = itemVolume * effectiveMasterVolume * Math.max(0, volumeMultiplier) * mixerGain;

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
      if (preWarmTimerRef.current !== null) {
        clearTimeout(preWarmTimerRef.current);
        preWarmTimerRef.current = null;
      }
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
    const effectiveSourceFps = sourceFps ?? fps;

    // Calculate target time in the source audio
    // IMPORTANT: trimBefore is in source FPS frames — must use effectiveSourceFps, not fps
    const sourceTimeSeconds = getAudioTargetTimeSeconds(trimBefore, effectiveSourceFps, frame, playbackRate, fps);
    const clipStartTimeSeconds = Math.max(0, trimBefore / effectiveSourceFps);

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
      // Cancel any pending pre-warm since we're about to play
      if (preWarmTimerRef.current !== null) {
        clearTimeout(preWarmTimerRef.current);
        preWarmTimerRef.current = null;
      }

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

      // Play if paused and audio has buffered ahead (HAVE_FUTURE_DATA).
      // >= 3 ensures the decoder has data beyond the current position,
      // preventing audio stutter on play start after seeking.
      if (audio.paused && audio.readyState >= 3) {
        // After a large seek (e.g. element remounted at currentTime=0 but target
        // is 70s in), wait for the browser to finish seeking before playing.
        // Playing immediately after a large currentTime assignment causes audible
        // jitter because the decoder hasn't buffered the new position yet.
        const seekDistance = Math.abs(drift);
        if (seekDistance > 1 && !audio.seeking) {
          // Seek was large but already completed — safe to play
        } else if (seekDistance > 1 && audio.seeking) {
          // Still seeking — defer play until seeked event
          const onSeeked = () => {
            audio.removeEventListener('seeked', onSeeked);
            if (usePlaybackStore.getState().isPlaying && audio.paused) {
              const ctx = gainNodeRef.current ? getSharedAudioContext() : null;
              if (ctx?.state === 'suspended') ctx.resume();
              audio.play().catch(() => {});
            }
          };
          audio.addEventListener('seeked', onSeeked, { once: true });
          return; // Don't play yet
        }
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
      const playbackState = usePlaybackStore.getState();
      const isPreviewScrubbing =
        !playbackState.isPlaying
        && playbackState.previewFrame !== null
        && useGizmoStore.getState().activeGizmo === null;
      // Only seek when paused if frame actually changed (user is scrubbing) and audio is ready
      if (frameChanged && canSeek && !isPreviewScrubbing) {
        try {
          audio.currentTime = targetTimeSeconds;
        } catch {
          // Seek failed - audio may not be ready yet
        }

        // Pre-warm audio decoder at the new position (debounced).
        // A brief muted play/pause fills the decode buffer so audio
        // starts without a pop/stutter when the user presses play.
        if (preWarmTimerRef.current !== null) {
          clearTimeout(preWarmTimerRef.current);
        }
        preWarmTimerRef.current = window.setTimeout(() => {
          preWarmTimerRef.current = null;
          const a = audioRef.current;
          if (a && a.paused && a.readyState >= 2 && !usePlaybackStore.getState().isPlaying) {
            const prevVolume = a.volume;
            a.volume = 0;
            a.play().then(() => {
              if (!usePlaybackStore.getState().isPlaying) {
                a.pause();
                a.volume = prevVolume;
              }
              // If playback started, leave volume to the volume sync effect
            }).catch(() => {
              if (!usePlaybackStore.getState().isPlaying) {
                a.volume = prevVolume;
              }
            });
          }
        }, 50);
      }
    }
  }, [frame, fps, sourceFps, playing, playbackRate, trimBefore]);

  // This component renders nothing visually
  return null;
});
