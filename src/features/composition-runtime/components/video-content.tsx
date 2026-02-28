import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { useSequenceContext } from '@/features/composition-runtime/deps/player';
import { usePlaybackStore } from '@/features/composition-runtime/deps/stores';
import { useVideoConfig, useIsPlaying } from '../hooks/use-player-compat';
import { useClock } from '@/features/composition-runtime/deps/player';
import type { VideoItem } from '@/types/timeline';
import { useVideoSourcePool } from '@/features/composition-runtime/deps/player';
import { isVideoPoolAbortError } from '@/features/composition-runtime/deps/player';
import { createLogger } from '@/shared/logging/logger';
import { getVideoTargetTimeSeconds } from '../utils/video-timing';
import {
  applyVideoElementAudioVolume,
  useVideoAudioVolume,
  connectedVideoElements,
  videoAudioContexts,
} from './video-audio-context';

const videoLog = createLogger('NativePreviewVideo');
videoLog.setLevel(2); // WARN â€” suppress noisy per-frame debug logs

// Feature detection for requestVideoFrameCallback (avoids per-frame React sync)
const supportsRVFC = typeof HTMLVideoElement !== 'undefined' &&
  'requestVideoFrameCallback' in HTMLVideoElement.prototype;


/**
 * Native HTML5 video component for preview mode using VideoSourcePool.
 * Uses pooled video elements instead of creating new ones per clip.
 * Split clips from the same source share video elements for efficiency.
 */
const NativePreviewVideo: React.FC<{
  poolClipId: string;
  itemId: string;
  src: string;
  safeTrimBefore: number;
  sequenceFrameOffset?: number;
  sourceFps: number;
  playbackRate: number;
  audioVolume: number;
  onError: (error: Error) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}> = ({ poolClipId, itemId, src, safeTrimBefore, sequenceFrameOffset = 0, sourceFps, playbackRate, audioVolume, onError, containerRef }) => {
  // Get local frame from Sequence context (not global frame from Clock)
  // The Sequence provides localFrame which is 0-based within this sequence
  const sequenceContext = useSequenceContext();
  const frame = sequenceContext?.localFrame ?? 0;
  const { fps } = useVideoConfig();
  const pool = useVideoSourcePool();
  const elementRef = useRef<HTMLVideoElement | null>(null);
  const forceRenderTimeoutRef = useRef<number | null>(null);
  const preWarmTimerRef = useRef<number | null>(null);
  const preWarmGenRef = useRef(0);
  const audioVolumeRef = useRef(audioVolume);
  const onErrorRef = useRef(onError);
  const lastSyncTimeRef = useRef<number>(Date.now());
  const needsInitialSyncRef = useRef<boolean>(true);
  const lastFrameRef = useRef<number>(-1);
  audioVolumeRef.current = audioVolume;
  onErrorRef.current = onError;

  // Clock instance for imperative access in rVFC callback
  const clock = useClock();
  const sequenceFromRef = useRef(0);
  // Stable refs for rVFC callback (avoids stale closures)
  const safeTrimBeforeRef = useRef(safeTrimBefore);
  const sourceFpsRef = useRef(sourceFps);
  const playbackRateRef = useRef(playbackRate);
  const fpsRef = useRef(fps);
  const sequenceFrameOffsetRef = useRef(sequenceFrameOffset);
  safeTrimBeforeRef.current = safeTrimBefore;
  sourceFpsRef.current = sourceFps;
  playbackRateRef.current = playbackRate;
  fpsRef.current = fps;
  sequenceFrameOffsetRef.current = sequenceFrameOffset;

  // Get playing state from our clock
  const isPlaying = useIsPlaying();

  // Calculate target time in the source video
  // safeTrimBefore is in SOURCE frames (where playback starts in the source)
  // frame is in TIMELINE frames (current position within the Sequence)
  // For seeking, convert source start to seconds using source FPS.
  const targetTime = getVideoTargetTimeSeconds(
    safeTrimBefore,
    sourceFps,
    frame,
    playbackRate,
    fps,
    sequenceFrameOffset
  );

  const shortId = poolClipId?.slice(0, 8) ?? 'no-id';

  // Segment boundary resync:
  // With stable pool identities, split clips no longer remount/reacquire.
  // When the active segment switches (itemId changes), source mapping can jump
  // discontinuously (especially around transition overlaps), so force an
  // immediate sync on the next playback tick.
  useEffect(() => {
    needsInitialSyncRef.current = true;
    lastSyncTimeRef.current = 0;
  }, [itemId]);

  // Acquire element from pool on mount
  useEffect(() => {
    // Guard: poolClipId and src are required
    if (!poolClipId || !src) {
      console.error('[NativePreviewVideo] Missing poolClipId or src');
      return;
    }

    let cancelled = false;

    // Reset sync state for the new clip. The component doesn't unmount when
    // crossing split boundaries (React reconciles with new props), so refs
    // retain stale values from the previous clip. Without this reset, the
    // sync effect skips the initial seek for the new clip because it thinks
    // initial sync already happened.
    needsInitialSyncRef.current = true;
    lastSyncTimeRef.current = 0;

    videoLog.debug(`[${shortId}] acquiring element for:`, src);

    // Ensure source is preloaded
    pool.preloadSource(src).catch((error) => {
      if (cancelled || isVideoPoolAbortError(error)) {
        return;
      }
      console.warn(`[NativePreviewVideo] Failed to preload ${src}:`, error);
    });

    // Acquire element for this clip
    const element = pool.acquireForClip(poolClipId, src);
    if (!element) {
      console.error(`[NativePreviewVideo] Failed to acquire element for ${poolClipId}`);
      return;
    }

    videoLog.debug(`[${shortId}] acquired:`, element.readyState);

    // CRITICAL: Unmute video element immediately after acquisition
    // Pool creates elements muted, and we need audio to work.
    // This must happen here (not just in volume effect) because when crossing
    // split boundaries, itemId changes causing this effect to re-run, but
    // the volume effect won't re-run if audioVolume hasn't changed.
    element.muted = false;

    // Also resume AudioContext if this element was previously connected
    // (e.g., when crossing split boundary and reusing the same video element)
    if (connectedVideoElements.has(element)) {
      const audioContext = videoAudioContexts.get(element);
      if (audioContext?.state === 'suspended') {
        audioContext.resume();
      }
    }

    // Check if this is a split boundary crossing during playback.
    // The pool may return the same element that was just released by cleanup.
    // If the element is already near the correct position, keep it playing
    // to avoid a decode restart stutter.
    const initialTargetTime = getVideoTargetTimeSeconds(
      safeTrimBefore,
      sourceFps,
      frame,
      playbackRate,
      fps,
      sequenceFrameOffset
    );
    const clampedInitial = Math.min(initialTargetTime, (element.duration || Infinity) - 0.1);
    const currentlyPlaying = usePlaybackStore.getState().isPlaying;
    const isNearTarget = Math.abs(element.currentTime - clampedInitial) < 0.2;
    const isContinuousPlayback = currentlyPlaying && isNearTarget && element.readyState >= 2;

    if (isContinuousPlayback) {
      // Split boundary during playback: element was just paused by cleanup
      // but is at the right position. Resume immediately to minimize the
      // decode pipeline interruption (pauseâ†’play in same synchronous batch).
      elementRef.current = element;
      applyVideoElementAudioVolume(element, audioVolumeRef.current);
      element.playbackRate = playbackRate;
      element.play().catch(() => {});
      needsInitialSyncRef.current = false;
    } else {
      // Normal mount (first mount, scrubbing, or position mismatch)
      element.pause();
      elementRef.current = element;
      applyVideoElementAudioVolume(element, audioVolumeRef.current);
    }

    // Set up event listeners
    const handleCanPlay = () => {
      videoLog.debug(`[${shortId}] canplay:`, element.readyState);
    };
    const handleSeeked = () => {
      videoLog.debug(`[${shortId}] seeked:`, element.currentTime);
    };
    const handleError = () => {
      const error = new Error(`Video error: ${element.error?.message || 'Unknown'}`);
      onErrorRef.current(error);
    };
    // Prevent black frames when video reaches its natural end
    // Seek back slightly to show the last frame
    const handleEnded = () => {
      videoLog.debug(`[${shortId}] ended, seeking to last frame`);
      if (element.duration && element.duration > 0.1) {
        element.currentTime = element.duration - 0.05;
      }
    };

    element.addEventListener('canplay', handleCanPlay);
    element.addEventListener('seeked', handleSeeked);
    element.addEventListener('error', handleError);
    element.addEventListener('ended', handleEnded);

    // Mount element into container
    const container = containerRef.current;
    if (container && element.parentElement !== container) {
      element.style.width = '100%';
      element.style.height = '100%';
      element.style.objectFit = 'contain';
      element.style.display = 'block';
      element.style.position = 'absolute';
      element.style.top = '0';
      element.style.left = '0';
      element.id = `pooled-video-${poolClipId}`;
      container.appendChild(element);

      videoLog.debug(`[${shortId}] mounted to container`);
    }

    // Seek to initial position (skip for continuous playback - already at position)
    if (!isContinuousPlayback) {
      videoLog.debug(`[${shortId}] initial seek to:`, clampedInitial.toFixed(3),
        'safeTrimBefore:', safeTrimBefore, 'frame:', frame, 'playbackRate:', playbackRate,
        'fps:', fps,
        'videoDuration:', element.duration?.toFixed(3),
        'seekPastEnd:', initialTargetTime > element.duration);
      element.currentTime = clampedInitial;
    } else {
      videoLog.debug(`[${shortId}] continuous playback, skipping seek (drift: ${(element.currentTime - clampedInitial).toFixed(3)}s)`);
    }

    // Force a frame render by doing a quick play/pause - some browsers need this
    // to actually display the video frame after seeking.
    // IMPORTANT: Only do this when NOT playing. During playback, the sync effect
    // handles play() and this timeout's playâ†’pause sequence would race with it,
    // causing the video to get paused right after the sync effect started it.
    const forceFrameRender = () => {
      if (element.paused && element.readyState >= 2 && !usePlaybackStore.getState().isPlaying) {
        element.play().then(() => {
          element.pause();
          videoLog.debug(`[${shortId}] forced frame render`);
        }).catch(() => {
          // Ignore - autoplay might be blocked
        });
      }
    };

    // Try after a short delay to allow the seek to complete
    forceRenderTimeoutRef.current = window.setTimeout(forceFrameRender, 100);

    // Stall watchdog: if the element is stuck at readyState 0 for too long
    // (e.g., slow OPFS read, browser decoder init, broken file), retry load.
    // For stale blob URLs after inactivity, the visibilitychange handler in
    // video-preview.tsx refreshes all proxy/source URLs and triggers a full
    // re-render with fresh src props, which remounts this component.
    let stallTimerId: number | null = null;
    if (element.readyState === 0) {
      stallTimerId = window.setTimeout(() => {
        stallTimerId = null;
        if (elementRef.current === element && element.readyState === 0) {
          console.warn(`[NativePreviewVideo] Video stalled at readyState 0 for ${shortId}, retrying load`);
          try {
            element.load();
          } catch {
            // load() can throw if element is in a bad state
          }
        }
      }, 3000);
    }

    return () => {
      cancelled = true;
      element.removeEventListener('canplay', handleCanPlay);
      element.removeEventListener('seeked', handleSeeked);
      element.removeEventListener('error', handleError);
      element.removeEventListener('ended', handleEnded);

      // Pause and remove from DOM
      element.pause();
      if (forceRenderTimeoutRef.current !== null) {
        clearTimeout(forceRenderTimeoutRef.current);
        forceRenderTimeoutRef.current = null;
      }
      if (preWarmTimerRef.current !== null) {
        clearTimeout(preWarmTimerRef.current);
        preWarmTimerRef.current = null;
      }
      if (stallTimerId !== null) {
        clearTimeout(stallTimerId);
        stallTimerId = null;
      }
      if (element.parentElement) {
        element.parentElement.removeChild(element);
      }

      // Release back to pool
      pool.releaseClip(poolClipId);
      elementRef.current = null;

      videoLog.debug(`[${shortId}] released`);
    };
    // Note: frame, fps, targetTime intentionally NOT in deps - we only want to acquire once on mount
    // Ongoing seeking is handled by the separate sync effect
  }, [poolClipId, src, pool, containerRef, shortId]);

  // Sync video playback with timeline
  // Layout pass handles immediate seeks before paint to avoid one-frame stale
  // content during segment/transition boundary handoffs.
  useLayoutEffect(() => {
    const video = elementRef.current;
    if (!video) return;

    video.playbackRate = playbackRate;

    const relativeFrame = frame - sequenceFrameOffset;
    const isPremounted = relativeFrame < 0;
    const canSeek = video.readyState >= 1;

    const effectiveTargetTime = isPremounted
      ? (safeTrimBefore / sourceFps)
      : targetTime;
    const videoDuration = video.duration || Infinity;
    const clampedTargetTime = Math.min(Math.max(0, effectiveTargetTime), videoDuration - 0.05);

    if (!canSeek) return;

    if (isPremounted) {
      if (!video.paused) {
        video.pause();
      }
      if (Math.abs(video.currentTime - clampedTargetTime) > 0.016) {
        try {
          video.currentTime = clampedTargetTime;
        } catch {
          // Seek failed - element may still be initializing
        }
      }
      return;
    }

    const mustHardSync = needsInitialSyncRef.current;
    if (mustHardSync || (!isPlaying && Math.abs(video.currentTime - clampedTargetTime) > 0.016)) {
      try {
        video.currentTime = clampedTargetTime;
        lastSyncTimeRef.current = Date.now();
        if (mustHardSync) {
          needsInitialSyncRef.current = false;
        }
      } catch {
        // Seek failed - element may still be initializing
      }
    }
  }, [frame, isPlaying, playbackRate, safeTrimBefore, sourceFps, targetTime, sequenceFrameOffset]);

  // Runtime playback control + drift correction
  useEffect(() => {
    const video = elementRef.current;
    if (!video) return;

    // Set playback rate
    video.playbackRate = playbackRate;

    // Update sequenceFrom for rVFC callback (global frame minus local frame)
    sequenceFromRef.current = clock.currentFrame - frame;

    // Detect if frame actually changed (for scrub detection)
    const frameChanged = frame !== lastFrameRef.current;
    lastFrameRef.current = frame;

    // Check if we're in premount phase (frame < 0 means clip hasn't started yet)
    // During premount, we should NOT play - just prepare the video at the start position
    const relativeFrame = frame - sequenceFrameOffset;
    const isPremounted = relativeFrame < 0;

    // Guard: Only seek if video has enough data loaded
    const canSeek = video.readyState >= 1;

    // During premount, seek to the start of the clip (frame 0 position), not negative time
    // This ensures the video is ready at the correct starting frame when playback reaches this clip
    const effectiveTargetTime = isPremounted
      ? (safeTrimBefore / sourceFps)
      : targetTime;

    // Clamp target time to video duration to prevent seeking past the end
    // This prevents black frames when the clip extends to the edge of the source
    const videoDuration = video.duration || Infinity;
    const clampedTargetTime = Math.min(Math.max(0, effectiveTargetTime), videoDuration - 0.05);

    if (targetTime > videoDuration - 1) {
      videoLog.debug(`[${shortId}] NEAR END:`, {
        targetTime: targetTime.toFixed(2),
        videoDuration: videoDuration.toFixed(2),
        clampedTargetTime: clampedTargetTime.toFixed(2),
        frame,
        playbackRate,
        safeTrimBefore,
        fps,
      });
    }

    // During premount, always pause - don't play until clip is actually visible
    if (isPremounted) {
      if (!video.paused) {
        video.pause();
      }
      // Seek to start position so video is ready when playback reaches this clip
      if (canSeek && Math.abs(video.currentTime - clampedTargetTime) > 0.1) {
        video.currentTime = clampedTargetTime;
      }
      return;
    }

    if (isPlaying) {
      // Cancel any pending pre-warm since we're about to play
      if (preWarmTimerRef.current !== null) {
        clearTimeout(preWarmTimerRef.current);
        preWarmTimerRef.current = null;
      }
      // Invalidate any in-flight pre-warm promise so its .then()/.catch() no-ops
      preWarmGenRef.current += 1;

      // Normal forward playback
      // Initial sync is always needed (first play after mount/seek)
      if (needsInitialSyncRef.current && canSeek) {
        try {
          video.currentTime = clampedTargetTime;
          lastSyncTimeRef.current = Date.now();
          needsInitialSyncRef.current = false;
        } catch {
          // Seek failed - video may not be ready yet
        }
      }

      // Drift correction: only run from React effect when rVFC is NOT available.
      // When rVFC is supported, the callback below handles drift correction
      // directly from the video's presentation callback, avoiding per-frame
      // React scheduling overhead.
      if (!supportsRVFC) {
        const currentTime = video.currentTime;
        const now = Date.now();
        const drift = currentTime - clampedTargetTime;
        const timeSinceLastSync = now - lastSyncTimeRef.current;
        const videoBehind = drift < -0.2;
        const videoFarAhead = drift > 0.5;
        // Keep correction responsive for segment/transition boundaries.
        // A 500ms backoff can leak stale frames in preview.
        if ((videoFarAhead || (videoBehind && timeSinceLastSync > 80)) && canSeek) {
          try {
            video.currentTime = clampedTargetTime;
            lastSyncTimeRef.current = now;
          } catch {
            // Seek failed - video may not be ready yet
          }
        }
      }

      // Play if paused and video has buffered ahead (HAVE_FUTURE_DATA).
      // >= 3 ensures the decoder has frames in its buffer, preventing
      // stutter on play start after seeking to a new position.
      if (video.paused && video.readyState >= 3) {
        video.play().catch(() => {
          // Autoplay might be blocked - this is fine
        });
      }
    } else {
      // Pause video when not playing
      if (!video.paused) {
        video.pause();
      }
      const isPreviewScrubbing = usePlaybackStore.getState().previewFrame !== null;
      // Only seek when paused if frame actually changed (user is scrubbing)
      if (frameChanged && canSeek) {
        // Layout sync already applies seeks before paint; skip duplicate runtime seek
        // unless the element still has meaningful drift.
        if (Math.abs(video.currentTime - clampedTargetTime) > 0.016) {
          try {
            video.currentTime = clampedTargetTime;
          } catch {
            // Seek failed - video may not be ready yet
          }
        }

        // Pre-warm decoder at the new position (debounced). A brief muted
        // play/pause fills the decode buffer so playback starts without
        // stutter when the user presses play. Short debounce avoids
        // thrashing during rapid scrubbing while keeping warm-up fast.
        if (!isPreviewScrubbing) {
          if (preWarmTimerRef.current !== null) {
            clearTimeout(preWarmTimerRef.current);
          }
          preWarmGenRef.current += 1;
          const gen = preWarmGenRef.current;
          preWarmTimerRef.current = window.setTimeout(() => {
            preWarmTimerRef.current = null;
            const v = elementRef.current;
            if (v && v.paused && v.readyState >= 2 && !usePlaybackStore.getState().isPlaying) {
              v.muted = true;
              v.play().then(() => {
                // Only pause if this pre-warm is still current and playback hasn't started
                if (gen === preWarmGenRef.current && !usePlaybackStore.getState().isPlaying) {
                  v.pause();
                }
                // Always unmute â€” if playback started or another scrub superseded
                // this pre-warm, leaving muted=true causes silent playback.
                v.muted = false;
              }).catch(() => {
                v.muted = false;
              });
            }
          }, 50);
        }
      }
    }
  }, [frame, fps, isPlaying, playbackRate, safeTrimBefore, sourceFps, targetTime, sequenceFrameOffset]);

  // requestVideoFrameCallback-based drift correction.
  // Runs outside React's render cycle â€” the browser calls us exactly when a
  // video frame is presented, so we can nudge currentTime with zero scheduling
  // overhead. Falls back to the per-frame React effect above when unsupported.
  useEffect(() => {
    const video = elementRef.current;
    if (!video || !isPlaying || !supportsRVFC) return;

    let handle: number;
    const onVideoFrame = () => {
      const v = elementRef.current;
      if (!v) return;

      // Read current clock frame imperatively (no React re-render needed)
      const globalFrame = clock.currentFrame;
      const localFrame = globalFrame - sequenceFromRef.current;
      const relativeFrame = localFrame - sequenceFrameOffsetRef.current;

      // During premount, just keep listening
      if (relativeFrame < 0) {
        handle = v.requestVideoFrameCallback(onVideoFrame);
        return;
      }

      const rate = playbackRateRef.current;
      const timelineFps = fpsRef.current;
      const clipSourceFps = sourceFpsRef.current;
      const trim = safeTrimBeforeRef.current;
      const target = getVideoTargetTimeSeconds(
        trim,
        clipSourceFps,
        localFrame,
        rate,
        timelineFps,
        sequenceFrameOffsetRef.current
      );
      const dur = v.duration || Infinity;
      const clamped = Math.min(Math.max(0, target), dur - 0.05);

      const drift = v.currentTime - clamped;
      const now = Date.now();
      const timeSinceLastSync = now - lastSyncTimeRef.current;

      if (drift > 0.5 || (drift < -0.2 && timeSinceLastSync > 80)) {
        if (v.readyState >= 1) {
          try {
            v.currentTime = clamped;
            lastSyncTimeRef.current = now;
          } catch {
            // Seek may fail if element isn't fully loaded
          }
        }
      }

      handle = v.requestVideoFrameCallback(onVideoFrame);
    };

    handle = video.requestVideoFrameCallback(onVideoFrame);
    return () => {
      video.cancelVideoFrameCallback(handle);
    };
  }, [isPlaying, poolClipId, clock]);

  // Keep volume/gain in sync for pooled element.
  useEffect(() => {
    const video = elementRef.current;
    if (!video) return;
    applyVideoElementAudioVolume(video, audioVolume);
  }, [audioVolume]);

  // Guard: itemId is required for rendering
  if (!itemId) {
    return <div style={{ width: '100%', height: '100%', backgroundColor: '#1a1a1a' }} />;
  }

  // DEBUG: Give container a unique ID so we can verify in DOM
  const containerId = `video-container-${itemId}`;

  // When premounted, frame will be negative. Hide the video until it's visible.
  // In shared Sequences, local frame is offset by _sequenceFrameOffset.
  const isVisible = frame - sequenceFrameOffset >= 0;

  return (
    <div
      ref={containerRef}
      id={containerId}
      data-item-id={itemId}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        // Hide when premounted (frame < 0), otherwise inherit parent visibility
        visibility: isVisible ? undefined : 'hidden',
      }}
    >
      {/* Video element is mounted here by the useEffect */}
    </div>
  );
};

/**
 * Video content with audio volume/fades support.
 * Separate component so we can use hooks for audio calculation.
 *
 * Uses native HTML5 video for both preview and export (via Canvas + WebCodecs).
 */
export const VideoContent: React.FC<{
  item: VideoItem & { _sequenceFrameOffset?: number; _poolClipId?: string };
  muted: boolean;
  safeTrimBefore: number;
  playbackRate: number;
  sourceFps: number;
}> = ({ item, muted, safeTrimBefore, playbackRate, sourceFps }) => {
  const audioVolume = useVideoAudioVolume(item, muted);
  const [hasError, setHasError] = useState(false);

  // NativePreviewVideo mounts pooled <video> into this container.
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Handle media errors (e.g., invalid blob URL after HMR or cache cleanup)
  const handleError = useCallback((error: Error) => {
    console.warn(`[VideoContent] Media error for item ${item.id}:`, error.message);
    setHasError(true);
  }, [item.id]);

  // Show error state if media failed to load
  if (hasError) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: '#1a1a1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <p style={{ color: '#666', fontSize: 14 }}>Media unavailable</p>
      </div>
    );
  }

  // Use native HTML5 video with VideoSourcePool for element reuse
  // Export uses Canvas + WebCodecs (client-render-engine.ts), not Composition's renderer
  return (
    <NativePreviewVideo
      poolClipId={item._poolClipId ?? item.id}
      itemId={item.id}
      src={item.src!}
      safeTrimBefore={safeTrimBefore}
      sequenceFrameOffset={item._sequenceFrameOffset ?? 0}
      sourceFps={sourceFps}
      playbackRate={playbackRate}
      audioVolume={audioVolume}
      onError={handleError}
      containerRef={containerRef}
    />
  );
};

