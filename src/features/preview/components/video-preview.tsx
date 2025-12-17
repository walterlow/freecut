import { useRef, useEffect, useLayoutEffect, useState, useMemo, useCallback, memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Player, PlayerRef } from '@remotion/player';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { MainComposition } from '@/lib/remotion/compositions/main-composition';
import { useRemotionPlayer } from '../hooks/use-remotion-player';
import { resolveMediaUrl } from '../utils/media-resolver';
import { capturePlayerFrame } from '../utils/player-capture';
import { GizmoOverlay } from './gizmo-overlay';
import type { RemotionInputProps } from '@/types/export';
import { isMarqueeJustFinished } from '@/hooks/use-marquee-selection';

// Preload media files ahead of the playhead to reduce buffering
const PRELOAD_AHEAD_SECONDS = 5;

interface VideoPreviewProps {
  project: {
    width: number;
    height: number;
    backgroundColor?: string;
  };
  containerSize: {
    width: number;
    height: number;
  };
}


/**
 * Video Preview Component
 *
 * Displays the Remotion Player with:
 * - Real-time video rendering
 * - Bidirectional sync with timeline
 * - Responsive sizing based on zoom and container
 * - Frame counter
 * - Fullscreen toggle
 *
 * Memoized to prevent expensive Remotion Player re-renders.
 */
export const VideoPreview = memo(function VideoPreview({ project, containerSize }: VideoPreviewProps) {
  const playerRef = useRef<PlayerRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);

  // State for gizmo overlay positioning
  const [playerContainerRect, setPlayerContainerRect] = useState<DOMRect | null>(null);

  // Callback ref that measures immediately when element is available
  const setPlayerContainerRefCallback = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    playerContainerRef.current = el;
    if (el) {
      // Measure immediately when ref is set
      setPlayerContainerRect(el.getBoundingClientRect());
    }
  }, []);

  // Granular selectors - avoid subscribing to currentFrame here to prevent re-renders
  const fps = useTimelineStore((s) => s.fps);
  // Use useShallow for arrays to prevent re-renders when references change but content is same
  const tracks = useTimelineStore(useShallow((s) => s.tracks));
  const items = useTimelineStore(useShallow((s) => s.items));
  const transitions = useTimelineStore(useShallow((s) => s.transitions));
  const zoom = usePlaybackStore((s) => s.zoom);

  // Note: canvasBackgroundPreview is now read directly in MainComposition
  // to avoid inputProps changes during color picker drag (which caused Player seeks)

  // Note: Preview transform is now read directly in TransformWrapper component
  // to avoid re-rendering the entire composition on every gizmo update

  // Remotion Player integration (hook handles bidirectional sync)
  const { isBuffering } = useRemotionPlayer(playerRef);

  // Register frame capture function for project thumbnail generation and split transitions
  const setCaptureFrame = usePlaybackStore((s) => s.setCaptureFrame);
  useEffect(() => {
    const captureFunction = (options?: Parameters<typeof capturePlayerFrame>[1]) =>
      capturePlayerFrame(playerRef, options);
    setCaptureFrame(captureFunction);

    return () => {
      setCaptureFrame(null);
    };
  }, [setCaptureFrame]);

  // Cache for resolved blob URLs (mediaId -> blobUrl)
  const [resolvedUrls, setResolvedUrls] = useState<Map<string, string>>(new Map());
  const [isResolving, setIsResolving] = useState(false);

  // Combine tracks and items into TimelineTrack format
  // Sort in descending order so Track 1 (order: 0) renders last and appears on top
  const combinedTracks = useMemo(() => {
    return tracks
      .map((track) => ({
        ...track,
        items: items.filter((item) => item.trackId === track.id),
      }))
      .sort((a, b) => b.order - a.order);
  }, [tracks, items]);

  // Create resolved tracks by merging cached URLs with current items
  // This updates instantly when items change, without re-resolving media
  // IMPORTANT: For media items (video/audio/image), we only set src if we have a
  // resolved URL. This prevents using stale blob URLs from saved state after page refresh.
  const resolvedTracks = useMemo(() => {
    return combinedTracks.map((track) => ({
      ...track,
      items: track.items.map((item) => {
        // For media items with mediaId, only use resolved URLs (not stale saved src)
        if (item.mediaId && (item.type === 'video' || item.type === 'audio' || item.type === 'image')) {
          const resolvedSrc = resolvedUrls.get(item.mediaId);
          // Clear src if not resolved yet - Item component will show placeholder
          return { ...item, src: resolvedSrc ?? '' };
        }
        return item;
      }),
    }));
  }, [combinedTracks, resolvedUrls]);

  // Create a stable fingerprint for media resolution using derived selector
  // Only triggers re-render when media is added/removed, not when items move
  const mediaFingerprint = useTimelineStore((s) =>
    s.items
      .filter((item) => item.mediaId)
      .map((item) => item.mediaId!)
      .sort()
      .join('|')
  );

  // Calculate total frames using derived selector for furthest item end
  // This only triggers re-render when the actual timeline end changes, not on every item move
  const furthestItemEndFrame = useTimelineStore((s) =>
    s.items.reduce((max, item) => Math.max(max, item.from + item.durationInFrames), 0)
  );
  // Add buffer at the end for empty timeline space
  const totalFrames = useMemo(() => {
    if (furthestItemEndFrame === 0) return 900; // Default 30s at 30fps
    // Add 5 seconds buffer at the end
    return furthestItemEndFrame + (fps * 5);
  }, [furthestItemEndFrame, fps]);

  // Note: We intentionally do NOT cleanup blob URLs on mount.
  // Cleanup happens only on unmount (see effect below) to prevent race conditions
  // where the Player tries to use revoked blob URLs before re-resolution completes.
  // The media resolver's cache persists across HMR, so URLs remain valid.

  // Resolve media URLs when media fingerprint changes (not on transform changes)
  useEffect(() => {
    let isCancelled = false;

    async function resolve() {
      // Get unique mediaIds that need resolution
      const mediaIds = items
        .filter((item) => item.mediaId)
        .map((item) => item.mediaId!);
      const uniqueMediaIds = [...new Set(mediaIds)];

      if (uniqueMediaIds.length === 0) {
        setResolvedUrls(new Map());
        setIsResolving(false); // Reset in case previous project was still resolving
        return;
      }

      // Check which mediaIds are not yet resolved
      const unresolved = uniqueMediaIds.filter((id) => !resolvedUrls.has(id));

      // Only show loading for initial load with unresolved media
      if (unresolved.length > 0 && resolvedUrls.size === 0) {
        setIsResolving(true);
        // Small delay before resolving to allow cleanup and GC
        await new Promise(r => setTimeout(r, 150));
      }

      if (isCancelled) return;

      try {
        // Resolve all media URLs (resolver has its own cache)
        const newUrls = new Map(resolvedUrls);
        await Promise.all(
          uniqueMediaIds.map(async (mediaId) => {
            if (!newUrls.has(mediaId)) {
              const url = await resolveMediaUrl(mediaId);
              if (url) {
                newUrls.set(mediaId, url);
              }
            }
          })
        );

        if (!isCancelled) {
          setResolvedUrls(newUrls);
        }
      } catch (error) {
        console.error('Failed to resolve media URLs:', error);
      } finally {
        if (!isCancelled) {
          setIsResolving(false);
        }
      }
    }

    resolve();

    return () => {
      isCancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Use mediaFingerprint for stability
  }, [mediaFingerprint]);

  // Note: We do NOT cleanup blob URLs on unmount.
  // Blob URLs persist in the module-level cache for the page lifetime.
  // This prevents ERR_FILE_NOT_FOUND errors when components remount
  // (e.g., during HMR or navigation) and try to use cached URLs.
  // Memory is reclaimed when the page is unloaded or media is deleted.

  // Create a stable fingerprint for tracks to detect meaningful changes
  // This prevents inputProps from changing when only transforms/positions change
  const tracksFingerprint = useMemo(() => {
    return resolvedTracks.map(track => ({
      id: track.id,
      items: track.items.map(item => {
        // Extract src from media items only (video/audio/image have src)
        const src = 'src' in item ? item.src : undefined;
        return {
          id: item.id,
          type: item.type,
          from: item.from,
          durationInFrames: item.durationInFrames,
          src,
          mediaId: item.mediaId,
          speed: item.speed,
          volume: item.volume,
          sourceStart: item.sourceStart,
          sourceEnd: item.sourceEnd,
        };
      })
    }));
  }, [resolvedTracks]);

  // Memoize inputProps to prevent Player from re-rendering
  // Note: previewTransform is no longer passed here - TransformWrapper reads directly from store
  // Note: canvasBackgroundPreview is read directly in MainComposition to avoid inputProps changes
  const inputProps: RemotionInputProps = useMemo(() => ({
    fps,
    tracks: resolvedTracks as RemotionInputProps['tracks'],
    transitions,
    backgroundColor: project.backgroundColor,
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Use fingerprint for stability
  }), [fps, tracksFingerprint, transitions, project.backgroundColor]);

  // Preload media files ahead of the current playhead to reduce buffering
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const preloadMedia = () => {
      const currentFrame = usePlaybackStore.getState().currentFrame;
      const preloadEndFrame = currentFrame + (fps * PRELOAD_AHEAD_SECONDS);

      // Find media items that will be visible in the preload window
      const mediaToPreload = new Set<string>();
      for (const track of combinedTracks) {
        for (const item of track.items) {
          if (!item.mediaId) continue;
          // Check if item overlaps with preload window
          const itemEnd = item.from + item.durationInFrames;
          if (item.from <= preloadEndFrame && itemEnd >= currentFrame) {
            if (!resolvedUrls.has(item.mediaId)) {
              mediaToPreload.add(item.mediaId);
            }
          }
        }
      }

      // Preload in background (don't await)
      for (const mediaId of mediaToPreload) {
        resolveMediaUrl(mediaId).catch(() => {
          // Silently ignore preload failures
        });
      }
    };

    // Initial preload
    preloadMedia();

    // Subscribe to playback state for continuous preloading during playback
    const unsubscribe = usePlaybackStore.subscribe((state, prevState) => {
      if (state.isPlaying && !prevState.isPlaying) {
        // Started playing - set up preload interval
        intervalId = setInterval(preloadMedia, 1000);
      } else if (!state.isPlaying && prevState.isPlaying) {
        // Stopped playing - clear interval
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      }
    });

    return () => {
      unsubscribe();
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [fps, combinedTracks, resolvedUrls]);

  // Calculate player size based on zoom mode
  const playerSize = useMemo(() => {
    const aspectRatio = project.width / project.height;

    // Auto-fit mode (zoom = -1)
    if (zoom === -1) {
      if (containerSize.width > 0 && containerSize.height > 0) {
        const containerAspectRatio = containerSize.width / containerSize.height;

        let width: number;
        let height: number;

        // Compare aspect ratios to determine limiting dimension
        if (containerAspectRatio > aspectRatio) {
          // Container is wider - height is the limiting factor
          height = containerSize.height;
          width = height * aspectRatio;
        } else {
          // Container is taller - width is the limiting factor
          width = containerSize.width;
          height = width / aspectRatio;
        }

        return { width, height };
      }
      // Fallback while measuring
      return { width: project.width, height: project.height };
    }

    // Specific zoom level - show at exact size, no constraining
    const targetWidth = project.width * zoom;
    const targetHeight = project.height * zoom;
    return { width: targetWidth, height: targetHeight };
  }, [project.width, project.height, zoom, containerSize]);

  // Check if overflow is needed (video larger than container)
  const needsOverflow = useMemo(() => {
    if (zoom === -1) return false; // Auto-fit never needs overflow
    if (containerSize.width === 0 || containerSize.height === 0) return false;
    return playerSize.width > containerSize.width || playerSize.height > containerSize.height;
  }, [zoom, playerSize, containerSize]);

  // Track player container rect changes for gizmo positioning
  // Initial measurement is done in setPlayerContainerRefCallback
  useLayoutEffect(() => {
    const container = playerContainerRef.current;
    if (!container) return;

    const updateRect = () => {
      setPlayerContainerRect(container.getBoundingClientRect());
    };

    // Update on resize
    const resizeObserver = new ResizeObserver(updateRect);
    resizeObserver.observe(container);

    // Update on scroll (container rect changes position)
    window.addEventListener('scroll', updateRect, true);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [playerSize]);

  // Handle click on background area to deselect items
  const backgroundRef = useRef<HTMLDivElement>(null);
  const handleBackgroundClick = useCallback((e: React.MouseEvent) => {
    // Don't clear selection if marquee just finished
    if (isMarqueeJustFinished()) return;

    // Don't clear if clicking on gizmo elements
    const target = e.target as HTMLElement;
    if (target.closest('[data-gizmo]')) return;

    useSelectionStore.getState().clearItemSelection();
  }, []);

  return (
    <div
      ref={backgroundRef}
      className="w-full h-full bg-gradient-to-br from-background to-secondary/20 relative"
      style={{ overflow: needsOverflow ? 'auto' : 'visible' }}
      onClick={handleBackgroundClick}
    >
      <div
        className="min-w-full min-h-full grid place-items-center p-6"
        onClick={handleBackgroundClick}
      >
        {/* Wrapper for player + gizmo overlay - gizmo must be outside overflow-hidden */}
        <div className="relative">
          {/* Player container with overflow-hidden for video content */}
          <div
            ref={setPlayerContainerRefCallback}
            data-player-container
            className="relative overflow-hidden shadow-2xl"
            style={{
              width: `${playerSize.width}px`,
              height: `${playerSize.height}px`,
              transition: 'none',
              // Use outline instead of border to avoid affecting content area
              outline: '2px solid hsl(var(--border))',
              outlineOffset: 0,
            }}
            onDoubleClick={(e) => e.preventDefault()}
          >
            {isResolving && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
                <p className="text-white text-sm">Loading media...</p>
              </div>
            )}

            {/* Buffering indicator - shows when Remotion is buffering video data */}
            {isBuffering && !isResolving && (
              <div className="absolute top-2 left-2 z-20 flex items-center gap-2 bg-black/70 px-2 py-1 rounded">
                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span className="text-white text-xs">Buffering...</span>
              </div>
            )}

            <Player
              ref={playerRef}
              component={MainComposition}
              inputProps={inputProps}
              durationInFrames={totalFrames}
              compositionWidth={project.width}
              compositionHeight={project.height}
              bufferStateDelayInMilliseconds={300}
              acknowledgeRemotionLicense={true}
              fps={fps}
              style={{
                width: '100%',
                height: '100%',
              }}
              controls={false}
              loop={false}
              clickToPlay={false}
              doubleClickToFullscreen={false}
              spaceKeyToPlayOrPause={false}
              moveToBeginningWhenEnded={false}
              showPosterWhenPaused={false}
              showPosterWhenEnded={false}
              showPosterWhenUnplayed={false}
              errorFallback={({ error }) => (
                <div className="flex items-center justify-center h-full bg-red-500/10">
                  <p className="text-red-500">Player Error: {error.message}</p>
                </div>
              )}
            />
          </div>

          {/* Transform gizmo overlay - positioned over player but outside overflow-hidden */}
          <GizmoOverlay
            containerRect={playerContainerRect}
            playerSize={playerSize}
            projectSize={{ width: project.width, height: project.height }}
            zoom={zoom}
            hitAreaRef={backgroundRef}
          />
        </div>
      </div>
    </div>
  );
});
