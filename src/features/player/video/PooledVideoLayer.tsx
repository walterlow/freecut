/**
 * PooledVideoLayer.tsx - React component for rendering videos using the source pool
 *
 * This component renders video clips using shared video elements from VideoSourcePool.
 * Multiple clips from the same source share elements, dramatically reducing memory usage.
 *
 * Features:
 * - Element reuse by source URL
 * - Automatic seeking based on clip sourceStart + current frame
 * - Visibility management (show/hide based on current frame)
 * - Playback state synchronization
 * - Volume and mute control
 */

import {
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
  useState,
} from 'react';
import {
  VideoSourcePool,
  getGlobalVideoSourcePool,
} from './VideoSourcePool';
import type { VideoItemData } from './types';

/**
 * Props for a single pooled video clip
 */
interface PooledVideoClipProps {
  clip: VideoItemData;
  pool: VideoSourcePool;
  currentFrame: number;
  fps: number;
  isPlaying: boolean;
  playbackRate: number;
  isVisible: boolean;
  onError?: (clipId: string, error: Error) => void;
}

/**
 * Calculate the source time (in seconds) for a clip at a given frame
 *
 * When a clip is split, the right clip's sourceStart is set to where in the
 * source file that clip should begin playing. This ensures that even after
 * dragging Clip B to a new position, it still starts from the correct source time.
 *
 * Example:
 * - Original 10-second clip split at 3 seconds
 * - Left clip: sourceStart = 0
 * - Right clip: sourceStart = 90 frames (at 30fps = 3 seconds)
 * - When right clip plays, it starts at 3 seconds into the source video
 */
function calculateSourceTime(
  clip: VideoItemData,
  currentFrame: number,
  fps: number
): number {
  // Frame position within this clip (0 = start of clip on timeline)
  const localFrame = currentFrame - clip.from;

  // Convert to seconds
  const localTimeSeconds = localFrame / fps;

  // Apply playback speed (2x speed = advance 2 seconds of source per 1 second of timeline)
  const speed = clip.speed ?? 1;
  const sourceTimeOffset = localTimeSeconds * speed;

  // sourceStart is stored in FRAMES (from the timeline/split system)
  // Convert to seconds for the video element
  const sourceStartFrames = clip.sourceStart ?? 0;
  const sourceStartSeconds = sourceStartFrames / fps;

  // Final source time = where this clip starts in source + how far into the clip we are
  return sourceStartSeconds + sourceTimeOffset;
}

/**
 * Single pooled video clip renderer
 */
const PooledVideoClip = memo<PooledVideoClipProps>(
  ({
    clip,
    pool,
    currentFrame,
    fps,
    isPlaying,
    playbackRate,
    isVisible,
    onError,
  }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const elementRef = useRef<HTMLVideoElement | null>(null);
    const [isReady, setIsReady] = useState(false);

    // DEBUG logging
    const DEBUG = false;
    const log = (...args: unknown[]) => {
      if (DEBUG) console.log(`[PooledVideoClip ${clip.id.slice(0, 8)}]`, ...args);
    };

    // Calculate source time for current frame
    const sourceTime = useMemo(() => {
      if (!isVisible) return 0;
      return calculateSourceTime(clip, currentFrame, fps);
    }, [clip, currentFrame, fps, isVisible]);

    // Effective playback rate (clip speed * global rate)
    const effectivePlaybackRate = (clip.speed ?? 1) * playbackRate;

    // Volume (convert from dB to linear)
    const volumeDb = clip.volume ?? 0;
    const linearVolume = Math.pow(10, volumeDb / 20);

    // Acquire element when clip becomes visible
    useEffect(() => {
      log('visibility changed:', { isVisible, currentFrame, clipFrom: clip.from });

      if (!isVisible) {
        // Release when not visible - MUST pause and remove from DOM
        if (elementRef.current) {
          log('releasing element (not visible)');
          const element = elementRef.current;

          // Pause to stop playback
          element.pause();

          // Remove from DOM so it's not visible
          if (element.parentElement) {
            element.parentElement.removeChild(element);
          }

          pool.releaseClip(clip.id);
          elementRef.current = null;
          setIsReady(false);
        }
        return;
      }

      // Acquire element for this clip
      log('acquiring element for src:', clip.src);
      const element = pool.acquireForClip(clip.id, clip.src);
      if (!element) {
        console.error(`[PooledVideoClip] Failed to acquire element for ${clip.id}`);
        return;
      }
      log('acquired element, readyState:', element.readyState);

      // IMPORTANT: Pause immediately when acquiring
      // The element might be playing from a previous clip
      element.pause();

      elementRef.current = element;

      // Set up event listeners BEFORE seeking (so we catch the seeked event)
      const handleCanPlay = () => {
        log('canplay event, readyState:', element.readyState);
        setIsReady(true);
      };
      const handleSeeked = () => {
        log('seeked event, readyState:', element.readyState, 'currentTime:', element.currentTime);
        // Mark ready when seek completes and video has data
        if (element.readyState >= 3) {
          setIsReady(true);
        }
      };
      const handleError = () => {
        log('error event:', element.error);
        const error = new Error(
          `Video error: ${element.error?.message || 'Unknown'}`
        );
        onError?.(clip.id, error);
      };

      element.addEventListener('canplay', handleCanPlay);
      element.addEventListener('seeked', handleSeeked);
      element.addEventListener('error', handleError);

      // Calculate and seek to initial position
      const initialSourceTime = calculateSourceTime(clip, currentFrame, fps);
      log('seeking to initialSourceTime:', initialSourceTime, 'sourceStart:', clip.sourceStart);
      element.currentTime = initialSourceTime;

      // Mount element into container
      const container = containerRef.current;
      if (container && element.parentElement !== container) {
        element.style.width = '100%';
        element.style.height = '100%';
        element.style.objectFit = 'contain';
        element.style.display = 'block';
        container.appendChild(element);
        log('mounted element to container');
      }

      // If already ready (no seek needed or instant), mark immediately
      if (element.readyState >= 3) {
        log('already ready, readyState:', element.readyState);
        setIsReady(true);
      } else {
        log('not ready yet, readyState:', element.readyState);
      }

      return () => {
        element.removeEventListener('canplay', handleCanPlay);
        element.removeEventListener('seeked', handleSeeked);
        element.removeEventListener('error', handleError);
      };
      // Note: currentFrame/fps are NOT in deps - we only want this effect to run on visibility change
      // The initial seek uses whatever currentFrame is current when visibility changes
      // Ongoing seeking is handled by the separate seek effect below
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isVisible, clip.id, clip.src, pool, onError]);

    // Sync source time (seeking)
    useEffect(() => {
      if (!isVisible || !elementRef.current) return;

      pool.seekClip(clip.id, sourceTime, { fast: isPlaying });
    }, [clip.id, sourceTime, isVisible, isPlaying, pool]);

    // Sync playback rate
    useEffect(() => {
      const element = elementRef.current;
      if (!element || !isVisible) return;

      if (element.playbackRate !== effectivePlaybackRate) {
        element.playbackRate = effectivePlaybackRate;
      }
    }, [effectivePlaybackRate, isVisible]);

    // Sync play/pause state
    useEffect(() => {
      const element = elementRef.current;
      log('play/pause effect:', {
        hasElement: !!element,
        isVisible,
        isReady,
        isPlaying,
        paused: element?.paused,
        readyState: element?.readyState,
      });

      if (!element || !isVisible || !isReady) {
        log('skipping play - conditions not met');
        return;
      }

      if (isPlaying && element.paused) {
        log('attempting to play...');
        element.play().then(() => {
          log('play succeeded!');
        }).catch((error) => {
          if (error.name !== 'AbortError') {
            console.error('[PooledVideoClip] Play failed:', error);
            onError?.(clip.id, error);
          } else {
            log('play aborted (normal during seeking)');
          }
        });
      } else if (!isPlaying && !element.paused) {
        log('pausing');
        element.pause();
      }
    }, [isPlaying, isVisible, isReady, clip.id, onError]);

    // Sync volume and mute
    useEffect(() => {
      const element = elementRef.current;
      if (!element) return;

      element.volume = clip.muted ? 0 : Math.min(1, linearVolume);
      element.muted = clip.muted ?? false;
    }, [linearVolume, clip.muted]);

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        if (elementRef.current) {
          // Remove from DOM but don't destroy (pool manages lifecycle)
          const element = elementRef.current;
          if (element.parentElement) {
            element.parentElement.removeChild(element);
          }
          pool.releaseClip(clip.id);
          elementRef.current = null;
        }
      };
    }, [clip.id, pool]);

    // Container for the video element
    return (
      <div
        ref={containerRef}
        data-clip-id={clip.id}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: clip.zIndex ?? 0,
          visibility: isVisible && (clip.trackVisible ?? true) ? 'visible' : 'hidden',
          pointerEvents: 'none',
        }}
      />
    );
  }
);

PooledVideoClip.displayName = 'PooledVideoClip';

/**
 * Props for PooledVideoLayer
 */
export interface PooledVideoLayerProps {
  /** All video clips in the timeline */
  clips: VideoItemData[];
  /** Current frame position */
  currentFrame: number;
  /** Timeline FPS */
  fps: number;
  /** Whether playback is active */
  isPlaying: boolean;
  /** Playback rate multiplier */
  playbackRate?: number;
  /** Frames to preload ahead of playhead */
  preloadAheadFrames?: number;
  /** Frames to keep loaded behind playhead */
  preloadBehindFrames?: number;
  /** Custom pool instance (uses global pool if not provided) */
  pool?: VideoSourcePool;
  /** Error callback */
  onClipError?: (clipId: string, error: Error) => void;
}

/**
 * Determine which clips are visible at the current frame
 */
function getVisibleClips(clips: VideoItemData[], frame: number): VideoItemData[] {
  return clips.filter((clip) => {
    const start = clip.from;
    const end = clip.from + clip.durationInFrames;
    return frame >= start && frame < end;
  });
}

/**
 * Determine which clips should be preloaded (near playhead)
 */
function getPreloadClips(
  clips: VideoItemData[],
  frame: number,
  aheadFrames: number,
  behindFrames: number
): VideoItemData[] {
  const rangeStart = frame - behindFrames;
  const rangeEnd = frame + aheadFrames;

  return clips.filter((clip) => {
    const clipStart = clip.from;
    const clipEnd = clip.from + clip.durationInFrames;
    return clipEnd >= rangeStart && clipStart <= rangeEnd;
  });
}

/**
 * PooledVideoLayer - Main component for rendering videos with element pooling
 *
 * Usage:
 * ```tsx
 * <PooledVideoLayer
 *   clips={videoClips}
 *   currentFrame={frame}
 *   fps={30}
 *   isPlaying={playing}
 * />
 * ```
 */
export const PooledVideoLayer = memo<PooledVideoLayerProps>(
  ({
    clips,
    currentFrame,
    fps,
    isPlaying,
    playbackRate = 1,
    preloadAheadFrames = 150,
    preloadBehindFrames = 30,
    pool: customPool,
    onClipError,
  }) => {
    // Use custom pool or global singleton
    const pool = useMemo(
      () => customPool ?? getGlobalVideoSourcePool(),
      [customPool]
    );

    // Determine visible clips
    const visibleClips = useMemo(
      () => getVisibleClips(clips, currentFrame),
      [clips, currentFrame]
    );

    // Determine clips to preload
    const preloadClips = useMemo(
      () => getPreloadClips(clips, currentFrame, preloadAheadFrames, preloadBehindFrames),
      [clips, currentFrame, preloadAheadFrames, preloadBehindFrames]
    );

    // Create sets for quick lookup
    const visibleIds = useMemo(
      () => new Set(visibleClips.map((c) => c.id)),
      [visibleClips]
    );

    const preloadIds = useMemo(
      () => new Set(preloadClips.map((c) => c.id)),
      [preloadClips]
    );

    // Preload sources for nearby clips
    useEffect(() => {
      const sourcesToPreload = new Set(preloadClips.map((c) => c.src));

      for (const sourceUrl of sourcesToPreload) {
        pool.preloadSource(sourceUrl).catch((error) => {
          console.warn(`[PooledVideoLayer] Failed to preload ${sourceUrl}:`, error);
        });
      }

      // Prune unused sources
      pool.pruneUnused(sourcesToPreload);
    }, [preloadClips, pool]);

    // Sort clips by z-index for proper layering
    const sortedClips = useMemo(
      () => [...clips].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)),
      [clips]
    );

    // Error handler
    const handleError = useCallback(
      (clipId: string, error: Error) => {
        console.error(`[PooledVideoLayer] Error in clip ${clipId}:`, error);
        onClipError?.(clipId, error);
      },
      [onClipError]
    );

    return (
      <>
        {sortedClips.map((clip) => {
          const isVisible = visibleIds.has(clip.id);
          const isPreloaded = preloadIds.has(clip.id);

          // Only render if in preload range
          if (!isPreloaded) {
            return null;
          }

          return (
            <PooledVideoClip
              key={clip.id}
              clip={clip}
              pool={pool}
              currentFrame={currentFrame}
              fps={fps}
              isPlaying={isPlaying}
              playbackRate={playbackRate}
              isVisible={isVisible}
              onError={handleError}
            />
          );
        })}
      </>
    );
  }
);

PooledVideoLayer.displayName = 'PooledVideoLayer';

/**
 * Hook to get pool statistics for debugging
 */
export function usePoolStats(pool?: VideoSourcePool) {
  const effectivePool = pool ?? getGlobalVideoSourcePool();
  const [stats, setStats] = useState(effectivePool.getStats());

  useEffect(() => {
    const interval = setInterval(() => {
      setStats(effectivePool.getStats());
    }, 1000);

    return () => clearInterval(interval);
  }, [effectivePool]);

  return stats;
}

export default PooledVideoLayer;
