import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { useSequenceContext } from '@/features/composition-runtime/deps/player';
import { usePlaybackStore } from '@/features/composition-runtime/deps/stores';
import { useGizmoStore } from '@/features/composition-runtime/deps/stores';
import { useVideoConfig, useIsPlaying } from '../hooks/use-player-compat';
import { useClock } from '@/features/composition-runtime/deps/player';
import type { ResolvedAudioEqSettings } from '@/types/audio';
import type { VideoItem } from '@/types/timeline';
import { useVideoSourcePool } from '@/features/composition-runtime/deps/player';
import { isVideoPoolAbortError } from '@/features/composition-runtime/deps/player';
import { createLogger } from '@/shared/logging/logger';
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager';
import { getVideoTargetTimeSeconds } from '../utils/video-timing';
import {
  getVideoSyncTargetContext,
  planLayoutVideoSync,
  planPausedVideoFrameSync,
  planPlayingVideoDriftCorrection,
  planPlayingVideoInitialSync,
  planPremountedVideoSync,
  planVideoFrameCallbackCorrection,
  shouldReactOwnPlaybackRate,
} from '../utils/video-sync-plan';
import {
  registerDomVideoElement,
  unregisterDomVideoElement,
} from '../utils/dom-video-element-registry';
import {
  applyVideoElementAudioState,
  useVideoAudioState,
  connectedVideoElements,
  videoAudioContexts,
  ensureAudioContextResumed,
} from './video-audio-context';

const videoLog = createLogger('NativePreviewVideo');
const contentLog = createLogger('VideoContent');
videoLog.setLevel(2); // WARN — suppress noisy per-frame debug logs
const POOL_RELEASE_STICKY_MS = 400;

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
  audioEqStages: ReadonlyArray<ResolvedAudioEqSettings>;
  onError: (error: Error) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  fitMode?: 'contain' | 'fill';
  forceCssComposite?: boolean;
  sharedTransitionSync?: boolean;
}> = ({
  poolClipId,
  itemId,
  src,
  safeTrimBefore,
  sequenceFrameOffset = 0,
  sourceFps,
  playbackRate,
  audioVolume,
  audioEqStages,
  onError,
  containerRef,
  fitMode = 'contain',
  forceCssComposite = false,
  sharedTransitionSync = false,
}) => {
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
  const audioEqStagesRef = useRef(audioEqStages);
  const onErrorRef = useRef(onError);
  const lastSyncTimeRef = useRef<number>(Date.now());
  const needsInitialSyncRef = useRef<boolean>(true);
  const lastFrameRef = useRef<number>(-1);
  const registeredElementRef = useRef<HTMLVideoElement | null>(null);
  const registeredItemIdRef = useRef<string | null>(null);
  audioVolumeRef.current = audioVolume;
  audioEqStagesRef.current = audioEqStages;
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
  const frameRef = useRef(frame);
  frameRef.current = frame;

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

  const syncRegisteredVideoElement = useCallback((nextItemId: string, nextElement: HTMLVideoElement | null) => {
    const prevElement = registeredElementRef.current;
    const prevItemId = registeredItemIdRef.current;

    if (prevElement && prevItemId && (prevElement !== nextElement || prevItemId !== nextItemId)) {
      unregisterDomVideoElement(prevItemId, prevElement);
    }

    if (nextElement && (prevElement !== nextElement || prevItemId !== nextItemId)) {
      registerDomVideoElement(nextItemId, nextElement);
    }

    registeredElementRef.current = nextElement;
    registeredItemIdRef.current = nextElement ? nextItemId : null;
  }, []);

  const clearRegisteredVideoElement = useCallback(() => {
    const prevElement = registeredElementRef.current;
    const prevItemId = registeredItemIdRef.current;
    if (prevElement && prevItemId) {
      unregisterDomVideoElement(prevItemId, prevElement);
    }
    registeredElementRef.current = null;
    registeredItemIdRef.current = null;
  }, []);

  useLayoutEffect(() => {
    syncRegisteredVideoElement(itemId, elementRef.current);
  }, [itemId, syncRegisteredVideoElement]);

  // Acquire element from pool on mount
  useEffect(() => {
    // Guard: poolClipId and src are required
    if (!poolClipId || !src) {
      videoLog.error('Missing poolClipId or src');
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
      videoLog.warn(`Failed to preload ${src}:`, error);
    });

    // Acquire element for this clip
    const element = pool.acquireForClip(poolClipId, src);
    if (!element) {
      videoLog.error(`Failed to acquire element for ${poolClipId}`);
      return;
    }

    videoLog.debug(`[${shortId}] acquired:`, element.readyState);

    // CRITICAL: Unmute video element immediately after acquisition
    // Pool creates elements muted, and we need audio to work.
    // Item-id-only handoffs reuse the same acquired element and are handled
    // by registration/sync effects below, so this only runs when the actual
    // pool lane/source changes.
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

    elementRef.current = element;
    syncRegisteredVideoElement(itemId, element);
    applyVideoElementAudioState(element, audioVolumeRef.current, audioEqStagesRef.current);

    if (isContinuousPlayback) {
      // Split boundary during playback: element was just paused by cleanup
      // but is at the right position. Resume immediately to minimize the
      // decode pipeline interruption (pause→play in same synchronous batch).
      element.playbackRate = playbackRate;
      element.play().catch(() => {});
      needsInitialSyncRef.current = false;
    } else if (currentlyPlaying) {
      // Playback is active but element isn’t at position (transition mount,
      // shadow mount, or resume near a boundary). Seek and play immediately
      // instead of pausing and waiting for the sync effect next frame.
      // This eliminates ~16-50ms of React scheduling + readyState gate delay.
      element.playbackRate = playbackRate;
      element.currentTime = clampedInitial;
      if (element.readyState >= 2) {
        element.play().catch(() => {});
      }
      needsInitialSyncRef.current = false;
    } else {
      // Not playing (scrubbing, paused) — pause and seek
      element.pause();
    }

    // Set up event listeners
    const handleCanPlay = () => {
      videoLog.debug(`[${shortId}] canplay:`, element.readyState);
      if (usePlaybackStore.getState().isPlaying && element.paused && element.readyState >= 2) {
        const liveTargetTime = getVideoTargetTimeSeconds(
          safeTrimBeforeRef.current,
          sourceFpsRef.current,
          frameRef.current,
          playbackRateRef.current,
          fpsRef.current,
          sequenceFrameOffsetRef.current,
        );
        const clampedLiveTargetTime = Math.min(Math.max(0, liveTargetTime), (element.duration || Infinity) - 0.05);
        if (Math.abs(element.currentTime - clampedLiveTargetTime) > 0.016) {
          try {
            element.currentTime = clampedLiveTargetTime;
          } catch {
            // Seek failed - element may still be stabilizing.
          }
        }
        element.playbackRate = playbackRateRef.current;
        element.play().catch(() => {});
        needsInitialSyncRef.current = false;
      }
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
      element.style.objectFit = fitMode;
      element.style.display = 'block';
      element.style.position = 'absolute';
      element.style.top = '0';
      element.style.left = '0';
      if (forceCssComposite) {
        element.style.transform = 'translateZ(0)';
        element.style.backfaceVisibility = 'hidden';
        element.style.willChange = 'transform, opacity';
      } else {
        element.style.transform = '';
        element.style.backfaceVisibility = '';
        element.style.willChange = '';
      }
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
    // Only when NOT playing — during playback, the sync effect handles play()
    // and this timeout’s play→pause sequence would race with it.
    if (!currentlyPlaying) {
      const forceFrameRender = () => {
        if (element.paused && element.readyState >= 2 && !usePlaybackStore.getState().isPlaying) {
          element.play().then(() => {
            element.pause();
          }).catch(() => {});
        }
      };
      forceRenderTimeoutRef.current = window.setTimeout(forceFrameRender, 100);
    }

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
          videoLog.warn(`Video stalled at readyState 0 for ${shortId}, retrying load`);
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
      clearRegisteredVideoElement();
      pool.releaseClip(poolClipId, { delayMs: POOL_RELEASE_STICKY_MS });
      elementRef.current = null;

      videoLog.debug(`[${shortId}] released`);
    };
    // Note: frame, fps, targetTime intentionally NOT in deps - we only want to acquire once per lane/source
    // Ongoing seeking is handled by the separate sync effect, and itemId-only
    // handoffs are handled by the registration + sync refs without tearing down
    // the element across split-boundary transitions.
  }, [poolClipId, src, pool, containerRef, shortId, syncRegisteredVideoElement, clearRegisteredVideoElement, fitMode]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    if (forceCssComposite) {
      element.style.transform = 'translateZ(0)';
      element.style.backfaceVisibility = 'hidden';
      element.style.willChange = 'transform, opacity';
      return;
    }
    element.style.transform = '';
    element.style.backfaceVisibility = '';
    element.style.willChange = '';
  }, [forceCssComposite]);

  // Sync video playback with timeline
  // Layout pass handles immediate seeks before paint to avoid one-frame stale
  // content during segment/transition boundary handoffs.
  useLayoutEffect(() => {
    const video = elementRef.current;
    if (!video) return;

    if (shouldReactOwnPlaybackRate({
      isPlaying,
      supportsRequestVideoFrameCallback: supportsRVFC,
      sharedTransitionSync,
    })) {
      video.playbackRate = playbackRate;
    }

    const syncContext = getVideoSyncTargetContext({
      frame,
      sequenceFrameOffset,
      safeTrimBefore,
      sourceFps,
      targetTime,
      readyState: video.readyState,
      videoDuration: video.duration || Infinity,
      currentTime: video.currentTime,
    });
    const layoutPlan = planLayoutVideoSync({
      isPremounted: syncContext.isPremounted,
      isTransitionHeld: video.dataset.transitionHold === '1',
      canSeek: syncContext.canSeek,
      currentTime: video.currentTime,
      targetTime: syncContext.clampedTargetTime,
      isPlaying,
      needsInitialSync: needsInitialSyncRef.current,
    });

    if (layoutPlan.shouldPause && !video.paused) {
      video.pause();
    }

    if (layoutPlan.seekTo !== null) {
      try {
        video.currentTime = layoutPlan.seekTo;
        lastSyncTimeRef.current = Date.now();
        if (layoutPlan.shouldMarkInitialSyncComplete) {
          needsInitialSyncRef.current = false;
        }
      } catch {
        // Seek failed - element may still be initializing
      }
    }
  }, [frame, isPlaying, playbackRate, safeTrimBefore, sharedTransitionSync, sourceFps, targetTime, sequenceFrameOffset]);

  // Runtime playback control + drift correction
  useEffect(() => {
    const video = elementRef.current;
    if (!video) return;

    if (shouldReactOwnPlaybackRate({
      isPlaying,
      supportsRequestVideoFrameCallback: supportsRVFC,
      sharedTransitionSync,
    })) {
      video.playbackRate = playbackRate;
    }

    // Update sequenceFrom for rVFC callback (global frame minus local frame)
    sequenceFromRef.current = clock.currentFrame - frame;

    // Detect if frame actually changed (for scrub detection)
    const frameChanged = frame !== lastFrameRef.current;
    lastFrameRef.current = frame;
    const syncContext = getVideoSyncTargetContext({
      frame,
      sequenceFrameOffset,
      safeTrimBefore,
      sourceFps,
      targetTime,
      readyState: video.readyState,
      videoDuration: video.duration || Infinity,
      currentTime: video.currentTime,
    });

    if (targetTime > syncContext.videoDuration - 1) {
      videoLog.debug(`[${shortId}] NEAR END:`, {
        targetTime: targetTime.toFixed(2),
        videoDuration: syncContext.videoDuration.toFixed(2),
        clampedTargetTime: syncContext.clampedTargetTime.toFixed(2),
        frame,
        playbackRate,
        safeTrimBefore,
        fps,
      });
    }

    // During premount, always pause - don't play until clip is actually visible.
    // Exception: if the element is held by a transition session (marked via
    // data-transition-hold), the canvas overlay needs it playing for zero-copy
    // frame reads. Pausing it would cause a play/pause fight every frame that
    // disrupts Chrome's video decode pipeline and produces visible judder.
    if (syncContext.isPremounted) {
      const premountPlan = planPremountedVideoSync({
        isTransitionHeld: video.dataset.transitionHold === '1',
        canSeek: syncContext.canSeek,
        currentTime: video.currentTime,
        targetTime: syncContext.clampedTargetTime,
        seekToleranceSeconds: 0.1,
      });
      if (premountPlan.shouldPause && !video.paused) {
        video.pause();
      }
      if (premountPlan.seekTo !== null) {
        video.currentTime = premountPlan.seekTo;
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

      // Initial sync on first play after mount/seek.
      // Skip the seek if element is already at the target (avoids readyState
      // drop from redundant seeks, which delays play start by 100-300ms).
      const initialSyncPlan = planPlayingVideoInitialSync({
        needsInitialSync: needsInitialSyncRef.current,
        canSeek: syncContext.canSeek,
        currentTime: video.currentTime,
        targetTime: syncContext.clampedTargetTime,
      });
      if (initialSyncPlan.seekTo !== null) {
        try {
          video.currentTime = initialSyncPlan.seekTo;
        } catch {
          // Seek failed - video may not be ready yet
        }
      }
      if (initialSyncPlan.shouldUpdateLastSyncTime) {
        lastSyncTimeRef.current = Date.now();
      }
      if (initialSyncPlan.shouldMarkInitialSyncComplete) {
        needsInitialSyncRef.current = false;
      }

      // Drift correction: only run from React effect when rVFC is NOT available.
      // When rVFC is supported, the callback below handles drift correction
      // directly from the video's presentation callback, avoiding per-frame
      // React scheduling overhead.
      if (!supportsRVFC && !sharedTransitionSync) {
        const driftCorrectionPlan = planPlayingVideoDriftCorrection({
          canSeek: syncContext.canSeek,
          currentTime: video.currentTime,
          targetTime: syncContext.clampedTargetTime,
          lastSyncTimeMs: lastSyncTimeRef.current,
          nowMs: Date.now(),
        });
        if (driftCorrectionPlan.seekTo !== null) {
          try {
            video.currentTime = driftCorrectionPlan.seekTo;
            lastSyncTimeRef.current = Date.now();
          } catch {
            // Seek failed - video may not be ready yet
          }
        }
      }

      // Play if paused and video has current frame data (HAVE_CURRENT_DATA).
      // >= 2 is sufficient — the browser buffers ahead during playback.
      // Previous >= 3 gate added 100-300ms of unnecessary cold start delay
      // waiting for HAVE_FUTURE_DATA after every seek.
      if (video.paused && video.readyState >= 2) {
        video.play().catch(() => {
          // Autoplay might be blocked - this is fine
        });
      }
    } else {
      // Pause video when not playing
      if (!video.paused) {
        video.pause();
      }
      const playbackState = usePlaybackStore.getState();
      const isPreviewScrubbing =
        !playbackState.isPlaying
        && playbackState.previewFrame !== null
        && useGizmoStore.getState().activeGizmo === null;
      // Only seek when paused if frame actually changed (user is scrubbing)
      if (frameChanged && syncContext.canSeek) {
        // Layout sync already applies seeks before paint; skip duplicate runtime seek
        // unless the element still has meaningful drift.
        const pausedSyncPlan = planPausedVideoFrameSync({
          frameChanged,
          canSeek: syncContext.canSeek,
          currentTime: video.currentTime,
          targetTime: syncContext.clampedTargetTime,
        });
        if (pausedSyncPlan.seekTo !== null) {
          try {
            video.currentTime = pausedSyncPlan.seekTo;
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
                // Always unmute — if playback started or another scrub superseded
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
  }, [frame, fps, isPlaying, playbackRate, safeTrimBefore, sharedTransitionSync, sourceFps, targetTime, sequenceFrameOffset]);

  // requestVideoFrameCallback-based drift correction.
  // Runs outside React's render cycle — the browser calls us exactly when a
  // video frame is presented. Uses rate-based correction for small drifts
  // (adjusts playbackRate ±2-5% to smoothly converge) and hard seeks only
  // for large drifts (>200ms). This eliminates the visible “drift then jump”
  // jitter pattern that hard-seek-only correction causes.
  useEffect(() => {
    const video = elementRef.current;
    if (!video || !isPlaying || !supportsRVFC || sharedTransitionSync) return;

    // Pre-resume AudioContext so audio starts immediately with video.
    // Without this, suspended AudioContext adds 50-100ms audio delay on cold resume.
    ensureAudioContextResumed();

    // Set initial playbackRate when RVFC takes over
    video.playbackRate = playbackRateRef.current;

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

      const nominalRate = playbackRateRef.current;
      const timelineFps = fpsRef.current;
      const clipSourceFps = sourceFpsRef.current;
      const trim = safeTrimBeforeRef.current;
      const target = getVideoTargetTimeSeconds(
        trim,
        clipSourceFps,
        localFrame,
        nominalRate,
        timelineFps,
        sequenceFrameOffsetRef.current
      );
      const dur = v.duration || Infinity;
      const clamped = Math.min(Math.max(0, target), dur - 0.05);
      const correctionPlan = planVideoFrameCallbackCorrection({
        currentTime: v.currentTime,
        targetTime: clamped,
        nominalRate,
        readyState: v.readyState,
      });

      if (correctionPlan.kind === 'seek') {
        try {
          v.currentTime = correctionPlan.seekTo;
          if (correctionPlan.shouldUpdateLastSyncTime) {
            lastSyncTimeRef.current = Date.now();
          }
        } catch {
          // Seek may fail if element isn't fully loaded
        }
      }
      v.playbackRate = correctionPlan.playbackRate;

      handle = v.requestVideoFrameCallback(onVideoFrame);
    };

    handle = video.requestVideoFrameCallback(onVideoFrame);
    return () => {
      video.cancelVideoFrameCallback(handle);
      // Reset to nominal rate when RVFC stops managing
      if (elementRef.current) {
        elementRef.current.playbackRate = playbackRateRef.current;
      }
    };
  }, [clock, isPlaying, poolClipId, sharedTransitionSync]);

  // Keep volume/gain in sync for pooled element.
  useEffect(() => {
    const video = elementRef.current;
    if (!video) return;
    applyVideoElementAudioState(video, audioVolume, audioEqStages);
  }, [audioEqStages, audioVolume]);

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
        ...(forceCssComposite ? {
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden' as const,
          willChange: 'transform, opacity',
          contain: 'paint',
        } : {}),
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
  item: VideoItem & { _sequenceFrameOffset?: number; _poolClipId?: string; _sharedTransitionSync?: boolean };
  muted: boolean;
  safeTrimBefore: number;
  playbackRate: number;
  sourceFps: number;
  audioEqStages: ReadonlyArray<ResolvedAudioEqSettings>;
  forceCssComposite?: boolean;
}> = ({ item, muted, safeTrimBefore, playbackRate, sourceFps, audioEqStages, forceCssComposite = false }) => {
  const { audioVolume: baseAudioVolume, resolvedAudioEqStages } = useVideoAudioState(item, muted, audioEqStages);
  // During transition overlaps, the composition's audio crossfade system
  // (CustomDecoderAudio) handles audio mixing. Mute the DOM video element
  // to prevent doubling — one audio stream from the element and another
  // from the crossfade renderer.
  const audioVolume = item._sharedTransitionSync ? 0 : baseAudioVolume;
  const [hasError, setHasError] = useState(false);
  // One-shot per-item retry: on first failure, invalidate the blob URL so
  // the upstream resolver (driven by `useBlobUrlVersion`) produces a fresh
  // one. Fixes `ERR_UPLOAD_FILE_CHANGED` / "Format error" when a blob URL
  // was captured before a concurrent mirror-write completed, which manifests
  // as "works on refresh, fails on direct URL first load".
  const retriedRef = useRef(false);

  // NativePreviewVideo mounts pooled <video> into this container.
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Handle media errors (e.g., invalid blob URL after HMR or cache cleanup).
  const handleError = useCallback((error: Error) => {
    contentLog.warn(`Media error for item ${item.id}:`, error.message);

    const looksLikeStaleBlob =
      /format error|unknown|empty src/i.test(error.message);
    if (looksLikeStaleBlob && !retriedRef.current && item.mediaId) {
      retriedRef.current = true;
      contentLog.info(
        `Retrying item ${item.id} with fresh blob URL for media ${item.mediaId}`,
      );
      blobUrlManager.invalidate(item.mediaId);
      return;
    }

    setHasError(true);
  }, [item.id, item.mediaId]);

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
      audioEqStages={resolvedAudioEqStages}
      onError={handleError}
      containerRef={containerRef}
      fitMode="fill"
      forceCssComposite={forceCssComposite}
      sharedTransitionSync={item._sharedTransitionSync === true}
    />
  );
};
