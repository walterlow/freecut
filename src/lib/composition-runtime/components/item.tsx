import React, { useState, useCallback, useRef, useEffect } from 'react';
import { AbsoluteFill, interpolate, useSequenceContext } from '@/features/player/composition';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useDebugStore } from '@/features/editor/stores/debug-store';
import { useVideoConfig, useIsPlaying } from '../hooks/use-player-compat';
import type { TimelineItem, VideoItem, ShapeItem } from '@/types/timeline';
import type { TransformProperties } from '@/types/transform';
import { DebugOverlay } from './debug-overlay';
import { PitchCorrectedAudio } from './pitch-corrected-audio';
import { GifPlayer } from './gif-player';
import { ItemVisualWrapper } from './item-visual-wrapper';
import { TextContent } from './text-content';
import { ShapeContent } from './shape-content';
import {
  timelineToSourceFrames,
  isValidSeekPosition,
  isWithinSourceBounds,
  getSafeTrimBefore,
  DEFAULT_SPEED,
} from '@/features/timeline/utils/source-calculations';
import { useVideoSourcePool } from '@/features/player/video/VideoSourcePoolContext';
import { createLogger } from '@/lib/logger';
import { isGifUrl } from '@/utils/media-utils';

const videoLog = createLogger('NativePreviewVideo');

/** Mask information passed from composition to items */
export interface MaskInfo {
  shape: ShapeItem;
  transform: TransformProperties;
}

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

function applyVideoElementAudioVolume(video: HTMLVideoElement, audioVolume: number): void {
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

/**
 * Hook to calculate video audio volume with fades and preview support.
 * Returns the final volume (0-1) to apply to the video component.
 * Applies master preview volume from playback controls.
 */
function useVideoAudioVolume(item: VideoItem & { _sequenceFrameOffset?: number }, muted: boolean): number {
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

  // Use preview values if available, otherwise use item's stored values
  // Volume is stored in dB (0 = unity gain)
  const volumeDb = preview?.volume ?? item.volume ?? 0;
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

/**
 * Native HTML5 video component for preview mode using VideoSourcePool.
 * Uses pooled video elements instead of creating new ones per clip.
 * Split clips from the same source share video elements for efficiency.
 */
const NativePreviewVideo: React.FC<{
  itemId: string;
  src: string;
  safeTrimBefore: number;
  playbackRate: number;
  audioVolume: number;
  onError: (error: Error) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}> = ({ itemId, src, safeTrimBefore, playbackRate, audioVolume, onError, containerRef }) => {
  // Get local frame from Sequence context (not global frame from Clock)
  // The Sequence provides localFrame which is 0-based within this sequence
  const sequenceContext = useSequenceContext();
  const frame = sequenceContext?.localFrame ?? 0;
  const { fps } = useVideoConfig();
  const pool = useVideoSourcePool();
  const elementRef = useRef<HTMLVideoElement | null>(null);
  const forceRenderTimeoutRef = useRef<number | null>(null);
  const audioVolumeRef = useRef(audioVolume);
  const lastSyncTimeRef = useRef<number>(Date.now());
  const needsInitialSyncRef = useRef<boolean>(true);
  const lastFrameRef = useRef<number>(-1);
  const [isReady, setIsReady] = useState(false);
  audioVolumeRef.current = audioVolume;

  // Get playing state from our clock
  const isPlaying = useIsPlaying();

  // Calculate target time in the source video
  // safeTrimBefore is in SOURCE frames (where playback starts in the source)
  // frame is in TIMELINE frames (current position within the Sequence)
  // For seeking, we need: sourceStart + localFrame * speed
  // The playbackRate affects how many source frames we advance per timeline frame
  const targetTime = (safeTrimBefore / fps) + (frame * playbackRate / fps);

  const shortId = itemId?.slice(0, 8) ?? 'no-id';

  // Acquire element from pool on mount
  useEffect(() => {
    // Guard: itemId and src are required
    if (!itemId || !src) {
      console.error('[NativePreviewVideo] Missing itemId or src');
      return;
    }

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
      console.warn(`[NativePreviewVideo] Failed to preload ${src}:`, error);
    });

    // Acquire element for this clip
    const element = pool.acquireForClip(itemId, src);
    if (!element) {
      console.error(`[NativePreviewVideo] Failed to acquire element for ${itemId}`);
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
    const initialTargetTime = (safeTrimBefore / fps) + (frame * playbackRate / fps);
    const clampedInitial = Math.min(initialTargetTime, (element.duration || Infinity) - 0.1);
    const currentlyPlaying = usePlaybackStore.getState().isPlaying;
    const isNearTarget = Math.abs(element.currentTime - clampedInitial) < 0.2;
    const isContinuousPlayback = currentlyPlaying && isNearTarget && element.readyState >= 2;

    if (isContinuousPlayback) {
      // Split boundary during playback: element was just paused by cleanup
      // but is at the right position. Resume immediately to minimize the
      // decode pipeline interruption (pause→play in same synchronous batch).
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
      setIsReady(true);
    };
    const handleSeeked = () => {
      videoLog.debug(`[${shortId}] seeked:`, element.currentTime);
      if (element.readyState >= 3) {
        setIsReady(true);
      }
    };
    const handleError = () => {
      const error = new Error(`Video error: ${element.error?.message || 'Unknown'}`);
      onError(error);
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
      element.id = `pooled-video-${itemId}`;
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
    // handles play() and this timeout's play→pause sequence would race with it,
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

    // Check if already ready
    if (element.readyState >= 3) {
      setIsReady(true);
    }

    return () => {
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
      if (element.parentElement) {
        element.parentElement.removeChild(element);
      }

      // Release back to pool
      pool.releaseClip(itemId);
      elementRef.current = null;
      setIsReady(false);

      videoLog.debug(`[${shortId}] released`);
    };
    // Note: frame, fps, targetTime intentionally NOT in deps - we only want to acquire once on mount
    // Ongoing seeking is handled by the separate sync effect
  }, [itemId, src, pool, onError, containerRef, shortId]);

  // Sync video playback with timeline
  useEffect(() => {
    const video = elementRef.current;
    if (!video) return;

    // Set playback rate
    video.playbackRate = playbackRate;

    // Detect if frame actually changed (for scrub detection)
    const frameChanged = frame !== lastFrameRef.current;
    lastFrameRef.current = frame;

    // Check if we're in premount phase (frame < 0 means clip hasn't started yet)
    // During premount, we should NOT play - just prepare the video at the start position
    const isPremounted = frame < 0;

    // Guard: Only seek if video has enough data loaded
    const canSeek = video.readyState >= 1;

    // During premount, seek to the start of the clip (frame 0 position), not negative time
    // This ensures the video is ready at the correct starting frame when playback reaches this clip
    const effectiveTargetTime = isPremounted
      ? (safeTrimBefore / fps) // Start position of this clip in source video
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

    if (isPlaying && isReady) {
      const currentTime = video.currentTime;
      const now = Date.now();

      // Calculate drift direction: positive = video ahead, negative = video behind
      const drift = currentTime - clampedTargetTime;
      const timeSinceLastSync = now - lastSyncTimeRef.current;

      // Determine if we need to seek:
      // 1. Initial sync when component first plays
      // 2. Video is BEHIND by more than threshold (needs to catch up)
      const videoBehind = drift < -0.2;
      const needsSync = needsInitialSyncRef.current || (videoBehind && timeSinceLastSync > 500);

      if (needsSync && canSeek) {
        try {
          video.currentTime = clampedTargetTime;
          lastSyncTimeRef.current = now;
          needsInitialSyncRef.current = false;
        } catch {
          // Seek failed - video may not be ready yet
        }
      }

      // Play if paused and video is ready
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
      // Only seek when paused if frame actually changed (user is scrubbing)
      if (frameChanged && canSeek) {
        try {
          video.currentTime = clampedTargetTime;
        } catch {
          // Seek failed - video may not be ready yet
        }
      }
    }
  }, [frame, fps, isPlaying, isReady, playbackRate, safeTrimBefore, targetTime]);

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
  // frame < 0 means we're premounted but not yet at the clip's start
  const isVisible = frame >= 0;

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
        // border: '5px solid lime', // DEBUG: make container visible
        // backgroundColor: 'rgba(255,0,0,0.3)', // DEBUG: red tint
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
const VideoContent: React.FC<{
  item: VideoItem;
  muted: boolean;
  safeTrimBefore: number;
  playbackRate: number;
}> = ({ item, muted, safeTrimBefore, playbackRate }) => {
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
      itemId={item.id}
      src={item.src!}
      safeTrimBefore={safeTrimBefore}
      playbackRate={playbackRate}
      audioVolume={audioVolume}
      onError={handleError}
      containerRef={containerRef}
    />
  );
};

// TextContent extracted to ./text-content.tsx

// ShapeContent extracted to ./shape-content.tsx


interface ItemProps {
  item: TimelineItem;
  muted?: boolean;
  /** Active masks that should clip this item's content */
  masks?: MaskInfo[];
}

/**
 * Composition Item Component
 *
 * Renders different item types following Composition best practices:
 * - Video: OffthreadVideo for preview (resilient to UI), @legacy-video/media Video for rendering
 * - Audio: Uses Audio component with trim support
 * - Image: Uses img tag
 * - Text: Renders text with styling
 * - Shape: Renders solid colors or shapes
 * - Respects mute state for audio/video items (reads directly from store for reactivity)
 * - Supports trimStart/trimEnd for media trimming (uses trimStart as trimBefore)
 *
 * Memoized to prevent unnecessary re-renders when parent (MainComposition) updates.
 */
export const Item = React.memo<ItemProps>(({ item, muted = false, masks = [] }) => {
  // Use muted prop directly - MainComposition already passes track.muted
  // Avoiding store subscription here prevents re-render issues with @legacy-video/media Audio

  // Debug overlay toggle (always false in production via store)
  const showDebugOverlay = useDebugStore((s) => s.showVideoDebugOverlay);

  if (item.type === 'video') {

    // Guard against missing src (media resolution failed)
    if (!item.src) {
      return (
        <AbsoluteFill style={{ backgroundColor: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: '#666', fontSize: 14 }}>Media not loaded</p>
        </AbsoluteFill>
      );
    }
    // Use sourceStart for trimBefore (absolute position in source)
    // Fall back to trimStart or offset for backward compatibility
    const trimBefore = item.sourceStart ?? item.trimStart ?? item.offset ?? 0;
    // Get playback rate from speed property (default 1x)
    const playbackRate = item.speed ?? DEFAULT_SPEED;

    // Calculate source frames needed for playback using shared utility
    const sourceFramesNeeded = timelineToSourceFrames(item.durationInFrames, playbackRate);
    const sourceEndPosition = trimBefore + sourceFramesNeeded;
    const sourceDuration = item.sourceDuration || 0;

    // Calculate the effective source segment this clip represents
    // This is more accurate than sourceDuration for rate-stretched clips
    // sourceEnd - sourceStart defines the actual source frames used
    const effectiveSourceSegment = item.sourceEnd !== undefined && item.sourceStart !== undefined
      ? item.sourceEnd - item.sourceStart
      : sourceDuration;

    // Only validate if we have valid source duration info
    const hasValidSourceDuration = sourceDuration > 0 || effectiveSourceSegment > 0;

    // Validate using shared utilities - skip if no valid duration info
    const isInvalidSeek = hasValidSourceDuration && !isValidSeekPosition(trimBefore, sourceDuration || undefined);
    const exceedsSource = hasValidSourceDuration && !isWithinSourceBounds(trimBefore, item.durationInFrames, playbackRate, sourceDuration || undefined);

    // Safety check: if sourceStart is unreasonably high (>1 hour) and no sourceDuration is set,
    // this indicates corrupted metadata from split/trim operations
    const MAX_REASONABLE_FRAMES = 30 * 60 * 60; // 1 hour at 30fps
    const hasCorruptedMetadata = sourceDuration === 0 && effectiveSourceSegment === 0 && trimBefore > MAX_REASONABLE_FRAMES;

    if (hasCorruptedMetadata || isInvalidSeek) {
      console.error('[Composition Item] Invalid source position detected:', {
        itemId: item.id,
        sourceStart: item.sourceStart,
        trimBefore,
        sourceDuration,
        effectiveSourceSegment,
        hasCorruptedMetadata,
        isInvalidSeek,
      });
      return (
        <AbsoluteFill style={{ backgroundColor: '#2a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: '#ff6b6b', fontSize: 14 }}>Invalid source position</p>
        </AbsoluteFill>
      );
    }

    // Clamp trimBefore to valid range using shared utility
    const safeTrimBefore = getSafeTrimBefore(trimBefore, item.durationInFrames, playbackRate, sourceDuration || undefined);

    // If clip would exceed source even after clamping, show error
    // This happens when durationInFrames * playbackRate > sourceDuration
    // Skip this check if we don't have valid source duration info (can't validate)
    // Also use effectiveSourceSegment as fallback for rate-stretched clips
    const effectiveDuration = sourceDuration > 0 ? sourceDuration : effectiveSourceSegment;
    if (exceedsSource && safeTrimBefore === 0 && effectiveDuration > 0 && sourceFramesNeeded > effectiveDuration) {
      console.error('[Composition Item] Clip duration exceeds source duration:', {
        itemId: item.id,
        sourceFramesNeeded,
        sourceDuration,
        effectiveSourceSegment,
        effectiveDuration,
        durationInFrames: item.durationInFrames,
        playbackRate,
      });
      return (
        <AbsoluteFill style={{ backgroundColor: '#2a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: '#ff6b6b', fontSize: 14 }}>Clip exceeds source duration</p>
        </AbsoluteFill>
      );
    }

    const videoContent = (
      <>
        <VideoContent
          item={item}
          muted={muted}
          safeTrimBefore={safeTrimBefore}
          playbackRate={playbackRate}
        />
        {showDebugOverlay && (
          <DebugOverlay
            id={item.id}
            speed={playbackRate}
            trimBefore={trimBefore}
            safeTrimBefore={safeTrimBefore}
            sourceStart={item.sourceStart}
            sourceDuration={sourceDuration}
            durationInFrames={item.durationInFrames}
            sourceFramesNeeded={sourceFramesNeeded}
            sourceEndPosition={sourceEndPosition}
            isInvalidSeek={isInvalidSeek}
            exceedsSource={exceedsSource}
          />
        )}
      </>
    );

    // Use new ItemVisualWrapper for consolidated state and fixed DOM structure
    // resolveTransform handles defaults (fit-to-canvas) when no explicit transform is set
    return (
      <ItemVisualWrapper item={item} masks={masks}>
        {videoContent}
      </ItemVisualWrapper>
    );
  }

  if (item.type === 'audio') {
    // Guard against missing src (media resolution failed)
    if (!item.src) {
      return null; // Audio can fail silently
    }

    // Use sourceStart for trimBefore (absolute position in source)
    const trimBefore = item.sourceStart ?? item.trimStart ?? item.offset ?? 0;
    // Get playback rate from speed property
    const playbackRate = item.speed ?? DEFAULT_SPEED;

    // Use PitchCorrectedAudio for pitch-preserved playback during preview
    // and toneFrequency correction during rendering
    return (
      <PitchCorrectedAudio
        src={item.src}
        itemId={item.id}
        trimBefore={trimBefore}
        volume={item.volume ?? 0}
        playbackRate={playbackRate}
        muted={muted}
        durationInFrames={item.durationInFrames}
        audioFadeIn={item.audioFadeIn}
        audioFadeOut={item.audioFadeOut}
      />
    );
  }

  if (item.type === 'image') {
    // Guard against missing src (media resolution failed)
    if (!item.src) {
      return (
        <AbsoluteFill style={{ backgroundColor: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: '#666', fontSize: 14 }}>Image not loaded</p>
        </AbsoluteFill>
      );
    }

    // Use Composition's Gif component for animated GIFs
    // This ensures proper frame-by-frame rendering during export
    // Check both src URL and item label (original filename) for .gif extension
    const isAnimatedGif = isGifUrl(item.src) || (item.label && item.label.toLowerCase().endsWith('.gif'));

    if (isAnimatedGif) {
      // Get playback rate from speed property
      const gifPlaybackRate = item.speed ?? DEFAULT_SPEED;

      const gifContent = (
        <GifPlayer
          mediaId={item.mediaId!}
          src={item.src}
          fit="cover"
          playbackRate={gifPlaybackRate}
          loopBehavior="loop"
        />
      );

      // Use new ItemVisualWrapper for consolidated state and fixed DOM structure
      return (
        <ItemVisualWrapper item={item} masks={masks}>
          {gifContent}
        </ItemVisualWrapper>
      );
    }

    // Regular static images - use native img element
    const imageContent = (
      <img
        src={item.src}
        alt=""
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain'
        }}
      />
    );

    // Use new ItemVisualWrapper for consolidated state and fixed DOM structure
    return (
      <ItemVisualWrapper item={item} masks={masks}>
        {imageContent}
      </ItemVisualWrapper>
    );
  }

  if (item.type === 'text') {
    // Use new ItemVisualWrapper for consolidated state and fixed DOM structure
    return (
      <ItemVisualWrapper item={item} masks={masks}>
        <TextContent item={item} />
      </ItemVisualWrapper>
    );
  }

  if (item.type === 'shape') {
    // Use new ItemVisualWrapper for consolidated state and fixed DOM structure
    // ShapeContent renders the appropriate Composition shape based on shapeType
    return (
      <ItemVisualWrapper item={item} masks={masks}>
        <ShapeContent item={item} />
      </ItemVisualWrapper>
    );
  }

  throw new Error(`Unknown item type: ${JSON.stringify(item)}`);
});
