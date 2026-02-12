import { useRef, useEffect, useLayoutEffect, useState, useMemo, useCallback, memo } from 'react';
import { Player, type PlayerRef } from '@/features/player';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { MainComposition } from '@/lib/composition-runtime/compositions/main-composition';
import { resolveMediaUrl } from '../utils/media-resolver';
import { GizmoOverlay } from './gizmo-overlay';
import type { CompositionInputProps } from '@/types/export';
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
  suspendOverlay?: boolean;
}

/**
 * Hook for integrating custom Player with timeline playback state
 * 
 * Sync strategy:
 * - Timeline seeks trigger Player seeks (both playing and paused)
 * - Player updates are ignored briefly after seeks to prevent loops
 * - Player fires frameupdate → updates timeline scrubber position
 * - Play/pause state is synced bidirectionally
 * - Store is authoritative - if store says paused, Player follows
 */
function useCustomPlayer(
  playerRef: React.RefObject<{ seekTo: (frame: number) => void; play: () => void; pause: () => void; getCurrentFrame: () => number; isPlaying: () => boolean } | null>,
) {
  const isPlaying = usePlaybackStore((s) => s.isPlaying);

  const [playerReady, setPlayerReady] = useState(false);
  const lastSyncedFrameRef = useRef<number>(0);
  const ignorePlayerUpdatesRef = useRef<boolean>(false);
  const wasPlayingRef = useRef(isPlaying);

  const getPlayerFrame = useCallback(() => {
    const frame = playerRef.current?.getCurrentFrame();
    return Number.isFinite(frame) ? Math.round(frame!) : null;
  }, [playerRef]);

  // Detect when Player becomes ready
  useEffect(() => {
    if (playerRef.current && !playerReady) {
      setPlayerReady(true);
    }
    const checkReady = setInterval(() => {
      if (playerRef.current && !playerReady) {
        setPlayerReady(true);
        clearInterval(checkReady);
      }
    }, 50);

    const timeout = setTimeout(() => clearInterval(checkReady), 1000);

    return () => {
      clearInterval(checkReady);
      clearTimeout(timeout);
    };
  }, [playerRef, playerReady]);

  // Timeline → Player: Sync play/pause state
  useEffect(() => {
    if (!playerRef.current) return;

    const wasPlaying = wasPlayingRef.current;
    wasPlayingRef.current = isPlaying;

    try {
      if (isPlaying && !wasPlaying) {
        // Always resume from the store playhead, not the hover-preview (gray) playhead.
        const { currentFrame, setPreviewFrame } = usePlaybackStore.getState();
        const playerFrame = getPlayerFrame();
        const needsSeek = playerFrame === null || Math.abs(playerFrame - currentFrame) > 1;
        if (needsSeek) {
          ignorePlayerUpdatesRef.current = true;
          playerRef.current.seekTo(currentFrame);
          lastSyncedFrameRef.current = currentFrame;
        }
        setPreviewFrame(null);

        // Start playback immediately after optional seek. Deferring to rAF adds
        // an extra frame of latency every time playback resumes.
        if (!usePlaybackStore.getState().isPlaying) {
          ignorePlayerUpdatesRef.current = false;
          return;
        }
        playerRef.current?.play();
        ignorePlayerUpdatesRef.current = false;
        return;
      } else if (!isPlaying && wasPlaying) {
        playerRef.current.pause();
      }
    } catch (error) {
      console.error('[Player Sync] Failed to control playback:', error);
    }
  }, [isPlaying, playerRef, getPlayerFrame]);

  // Timeline → Player: Sync frame position
  useEffect(() => {
    if (!playerReady || !playerRef.current) return;

    const initialFrame = usePlaybackStore.getState().currentFrame;
    lastSyncedFrameRef.current = initialFrame;
    playerRef.current.seekTo(initialFrame);

    const unsubscribe = usePlaybackStore.subscribe((state, prevState) => {
      if (!playerRef.current) return;

      const currentFrame = state.currentFrame;
      const prevFrame = prevState.currentFrame;

      if (currentFrame === prevFrame) return;

      const frameDiff = Math.abs(currentFrame - lastSyncedFrameRef.current);
      if (frameDiff === 0) return;

      if (state.isPlaying) {
        const playerFrame = getPlayerFrame();
        // While actively playing, most store frame updates originate from the Player itself.
        // Only seek when there is real drift, which indicates an external timeline seek.
        if (playerFrame !== null && Math.abs(playerFrame - currentFrame) <= 2) {
          lastSyncedFrameRef.current = currentFrame;
          return;
        }
      }

      lastSyncedFrameRef.current = currentFrame;
      ignorePlayerUpdatesRef.current = true;

      try {
        playerRef.current.seekTo(currentFrame);
        requestAnimationFrame(() => {
          const actualFrame = playerRef.current?.getCurrentFrame();
          if (actualFrame !== undefined) {
            lastSyncedFrameRef.current = actualFrame;
          }
          ignorePlayerUpdatesRef.current = false;
        });
      } catch (error) {
        console.error('Failed to seek Player:', error);
        ignorePlayerUpdatesRef.current = false;
      }
    });

    return unsubscribe;
  }, [playerReady, playerRef, getPlayerFrame]);

  // Preview frame seeking: seek to hovered position on timeline
  useEffect(() => {
    if (!playerReady || !playerRef.current) return;

    return usePlaybackStore.subscribe((state, prev) => {
      if (!playerRef.current) return;
      if (state.isPlaying) return;
      if (state.previewFrame === prev.previewFrame) return;

      if (state.previewFrame !== null) {
        // Seek to preview position
        ignorePlayerUpdatesRef.current = true;
        playerRef.current.seekTo(state.previewFrame);
        requestAnimationFrame(() => {
          ignorePlayerUpdatesRef.current = false;
        });
      } else {
        // Preview ended — seek back to actual playback position
        ignorePlayerUpdatesRef.current = true;
        playerRef.current.seekTo(state.currentFrame);
        requestAnimationFrame(() => {
          ignorePlayerUpdatesRef.current = false;
        });
      }
    });
  }, [playerReady, playerRef]);

  return { ignorePlayerUpdatesRef };
}

/**
 * Video Preview Component
 *
 * Displays the custom Player with:
 * - Real-time video rendering
 * - Bidirectional sync with timeline
 * - Responsive sizing based on zoom and container
 * - Frame counter
 * - Fullscreen toggle
 *
 * Memoized to prevent expensive Player re-renders.
 */
export const VideoPreview = memo(function VideoPreview({
  project,
  containerSize,
  suspendOverlay = false,
}: VideoPreviewProps) {
  const playerRef = useRef<PlayerRef>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);

  // State for gizmo overlay positioning
  const [playerContainerRect, setPlayerContainerRect] = useState<DOMRect | null>(null);

  // Callback ref that measures immediately when element is available
  const setPlayerContainerRefCallback = useCallback((el: HTMLDivElement | null) => {
    playerContainerRef.current = el;
    if (el) {
      setPlayerContainerRect(el.getBoundingClientRect());
    }
  }, []);

  // Granular selectors - avoid subscribing to currentFrame here to prevent re-renders
  const fps = useTimelineStore((s) => s.fps);
  const tracks = useTimelineStore((s) => s.tracks);
  const items = useTimelineStore((s) => s.items);
  const transitions = useTimelineStore((s) => s.transitions);
  const zoom = usePlaybackStore((s) => s.zoom);

  // Custom Player integration (hook handles bidirectional sync)
  const { ignorePlayerUpdatesRef } = useCustomPlayer(playerRef);

  // Register frame capture function for project thumbnail generation and split transitions
  const setCaptureFrame = usePlaybackStore((s) => s.setCaptureFrame);
  useEffect(() => {
    const captureFunction = async () => {
      if (playerRef.current) {
        playerRef.current.getCurrentFrame();
        return null;
      }
      return null;
    };
    setCaptureFrame(captureFunction);

    return () => {
      setCaptureFrame(null);
    };
  }, [setCaptureFrame]);

  // Cache for resolved blob URLs (mediaId -> blobUrl)
  const [resolvedUrls, setResolvedUrls] = useState<Map<string, string>>(new Map());
  const [isResolving, setIsResolving] = useState(false);

  // Combine tracks and items into TimelineTrack format
  const combinedTracks = useMemo(() => {
    return tracks
      .map((track) => ({
        ...track,
        items: items.filter((item) => item.trackId === track.id),
      }))
      .toSorted((a, b) => b.order - a.order);
  }, [tracks, items]);

  // Create resolved tracks by merging cached URLs with current items
  const resolvedTracks = useMemo(() => {
    return combinedTracks.map((track) => ({
      ...track,
      items: track.items.map((item) => {
        if (item.mediaId && (item.type === 'video' || item.type === 'audio' || item.type === 'image')) {
          const resolvedSrc = resolvedUrls.get(item.mediaId);
          return { ...item, src: resolvedSrc ?? '' };
        }
        return item;
      }),
    }));
  }, [combinedTracks, resolvedUrls]);

  // Create a stable fingerprint for media resolution using derived selector
  const mediaFingerprint = useTimelineStore((s) =>
    s.items
      .filter((item) => item.mediaId)
      .map((item) => item.mediaId!)
      .toSorted()
      .join('|')
  );

  // Calculate total frames using derived selector for furthest item end
  const furthestItemEndFrame = useTimelineStore((s) =>
    s.items.reduce((max, item) => Math.max(max, item.from + item.durationInFrames), 0)
  );
  const totalFrames = useMemo(() => {
    if (furthestItemEndFrame === 0) return 900; // Default 30s at 30fps
    return furthestItemEndFrame + (fps * 5);
  }, [furthestItemEndFrame, fps]);

  // Resolve media URLs when media fingerprint changes (not on transform changes)
  useEffect(() => {
    let isCancelled = false;

    async function resolve() {
      const mediaIds = items
        .filter((item) => item.mediaId)
        .map((item) => item.mediaId!);
      const uniqueMediaIds = [...new Set(mediaIds)];

      if (uniqueMediaIds.length === 0) {
        setResolvedUrls(new Map());
        setIsResolving(false);
        return;
      }

      const unresolved = uniqueMediaIds.filter((id) => !resolvedUrls.has(id));

      if (unresolved.length > 0 && resolvedUrls.size === 0) {
        setIsResolving(true);
        await new Promise(r => setTimeout(r, 150));
      }

      if (isCancelled) return;

      try {
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
  }, [mediaFingerprint]);

  // Create a stable fingerprint for tracks to detect meaningful changes
  const tracksFingerprint = useMemo(() => {
    return resolvedTracks.map(track => ({
      id: track.id,
      order: track.order,
      visible: track.visible,
      solo: track.solo,
      muted: track.muted,
      items: track.items.map(item => {
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
  const inputProps: CompositionInputProps = useMemo(() => ({
    fps,
    tracks: resolvedTracks as CompositionInputProps['tracks'],
    transitions,
    backgroundColor: project.backgroundColor,
  }), [fps, tracksFingerprint, transitions, project.backgroundColor]);

  // Preload media files ahead of the current playhead to reduce buffering
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const preloadMedia = () => {
      const currentFrame = usePlaybackStore.getState().currentFrame;
      const preloadEndFrame = currentFrame + (fps * PRELOAD_AHEAD_SECONDS);

      const mediaToPreload = new Set<string>();
      for (const track of combinedTracks) {
        for (const item of track.items) {
          if (!item.mediaId) continue;
          const itemEnd = item.from + item.durationInFrames;
          if (item.from <= preloadEndFrame && itemEnd >= currentFrame) {
            if (!resolvedUrls.has(item.mediaId)) {
              mediaToPreload.add(item.mediaId);
            }
          }
        }
      }

      for (const mediaId of mediaToPreload) {
        resolveMediaUrl(mediaId).catch(() => {});
      }
    };

    preloadMedia();

    const unsubscribe = usePlaybackStore.subscribe((state, prevState) => {
      if (state.isPlaying && !prevState.isPlaying) {
        intervalId = setInterval(preloadMedia, 1000);
      } else if (!state.isPlaying && prevState.isPlaying) {
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

    if (zoom === -1) {
      if (containerSize.width > 0 && containerSize.height > 0) {
        const containerAspectRatio = containerSize.width / containerSize.height;

        let width: number;
        let height: number;

        if (containerAspectRatio > aspectRatio) {
          height = containerSize.height;
          width = height * aspectRatio;
        } else {
          width = containerSize.width;
          height = width / aspectRatio;
        }

        return { width, height };
      }
      return { width: project.width, height: project.height };
    }

    const targetWidth = project.width * zoom;
    const targetHeight = project.height * zoom;
    return { width: targetWidth, height: targetHeight };
  }, [project.width, project.height, zoom, containerSize]);

  // Check if overflow is needed (video larger than container)
  const needsOverflow = useMemo(() => {
    if (zoom === -1) return false;
    if (containerSize.width === 0 || containerSize.height === 0) return false;
    return playerSize.width > containerSize.width || playerSize.height > containerSize.height;
  }, [zoom, playerSize, containerSize]);

  // Track player container rect changes for gizmo positioning
  useLayoutEffect(() => {
    if (suspendOverlay) return;
    const container = playerContainerRef.current;
    if (!container) return;

    const updateRect = () => {
      const nextRect = container.getBoundingClientRect();
      setPlayerContainerRect((prev) => {
        if (
          prev
          && prev.left === nextRect.left
          && prev.top === nextRect.top
          && prev.width === nextRect.width
          && prev.height === nextRect.height
        ) {
          return prev;
        }
        return nextRect;
      });
    };

    updateRect();

    const resizeObserver = new ResizeObserver(updateRect);
    resizeObserver.observe(container);

    window.addEventListener('scroll', updateRect, true);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [suspendOverlay]);

  // Handle click on background area to deselect items
  const backgroundRef = useRef<HTMLDivElement>(null);
  const handleBackgroundClick = useCallback((e: React.MouseEvent) => {
    if (isMarqueeJustFinished()) return;

    const target = e.target as HTMLElement;
    if (target.closest('[data-gizmo]')) return;

    useSelectionStore.getState().clearItemSelection();
  }, []);

  // Handle frame change from player
  // Skip when in preview mode to keep primary playhead stationary
  const handleFrameChange = useCallback((frame: number) => {
    if (ignorePlayerUpdatesRef.current) return;
    const playbackState = usePlaybackStore.getState();
    if (!playbackState.isPlaying && playbackState.previewFrame !== null) return;
    const nextFrame = Math.round(frame);
    const { currentFrame, setCurrentFrame } = playbackState;
    if (currentFrame === nextFrame) return;
    setCurrentFrame(nextFrame);
  }, []);

  // Handle play state change from player
  const handlePlayStateChange = useCallback((playing: boolean) => {
    if (playing) {
      usePlaybackStore.getState().play();
    } else {
      usePlaybackStore.getState().pause();
    }
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
        <div className="relative">
          <div
            ref={setPlayerContainerRefCallback}
            data-player-container
            className="relative shadow-2xl"
            style={{
              width: `${playerSize.width}px`,
              height: `${playerSize.height}px`,
              transition: 'none',
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

            <Player
              ref={playerRef}
              durationInFrames={totalFrames}
              fps={fps}
              width={project.width}
              height={project.height}
              autoPlay={false}
              loop={false}
              controls={false}
              style={{
                width: '100%',
                height: '100%',
              }}
              onFrameChange={handleFrameChange}
              onPlayStateChange={handlePlayStateChange}
            >
              <MainComposition {...inputProps} />
            </Player>
          </div>

          {!suspendOverlay && (
            <GizmoOverlay
              containerRect={playerContainerRect}
              playerSize={playerSize}
              projectSize={{ width: project.width, height: project.height }}
              zoom={zoom}
              hitAreaRef={backgroundRef as React.RefObject<HTMLDivElement>}
            />
          )}
        </div>
      </div>
    </div>
  );
});
