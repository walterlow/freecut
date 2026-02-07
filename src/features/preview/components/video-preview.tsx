import { useRef, useEffect, useLayoutEffect, useState, useMemo, useCallback, memo } from 'react';
import { Player, type PlayerRef } from '@/features/player';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { MainComposition } from '@/lib/remotion/compositions/main-composition';
import { resolveMediaUrl } from '../utils/media-resolver';
import { GizmoOverlay } from './gizmo-overlay';
import type { RemotionInputProps } from '@/types/export';
import { isMarqueeJustFinished } from '@/hooks/use-marquee-selection';

// GPU rendering imports
import { GPUVideoPreview, BufferedGPUPreview } from '@/features/gpu/components';

// Preload media files ahead of the playhead to reduce buffering
const PRELOAD_AHEAD_SECONDS = 5;

// GPU rendering mode:
// - 'off': Always use HTML5 video (current behavior, most stable)
// - 'scrubbing': GPU for paused/scrubbing, HTML5 for playback
// - 'always': Always use GPU (slow without buffering)
// - 'buffered': WASM-powered buffered GPU playback (experimental)
//
// 'buffered' mode uses a Rust/WASM ring buffer with A/V sync for smooth
// GPU-accelerated playback. This enables effects during playback.
//
// GPU playback is slow without pre-rendered frame cache. HTML5 video uses
// browser's native decoder which is optimized. GPU path is for:
// - Frame-accurate scrubbing (when paused)
// - Export rendering
// - Effects that CSS can't do (LUTs, GPU blur, blend modes)
// Change this value to switch GPU rendering mode
const GPU_MODE = 'off' as 'off' | 'scrubbing' | 'always' | 'buffered';

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
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame);

  const [isBuffering] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const lastSyncedFrameRef = useRef<number>(0);
  const ignorePlayerUpdatesRef = useRef<boolean>(false);
  const wasPlayingRef = useRef(isPlaying);
  const pendingFrameRef = useRef<number | null>(null);

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
        playerRef.current.play();
      } else if (!isPlaying && wasPlaying) {
        playerRef.current.pause();
        if (pendingFrameRef.current !== null) {
          setCurrentFrame(pendingFrameRef.current);
          pendingFrameRef.current = null;
        }
      }
    } catch (error) {
      console.error('[Player Sync] Failed to control playback:', error);
    }
  }, [isPlaying, playerRef, setCurrentFrame]);

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

      if (state.isPlaying && frameDiff === 1) {
        lastSyncedFrameRef.current = currentFrame;
        return;
      }

      lastSyncedFrameRef.current = currentFrame;
      ignorePlayerUpdatesRef.current = true;

      try {
        const handleSeeked = () => {
          const actualFrame = playerRef.current?.getCurrentFrame();
          if (actualFrame !== undefined) {
            lastSyncedFrameRef.current = actualFrame;
          }
          requestAnimationFrame(() => {
            ignorePlayerUpdatesRef.current = false;
          });
          playerRef.current?.seekTo(currentFrame);
        };

        handleSeeked();
      } catch (error) {
        console.error('Failed to seek Player:', error);
        ignorePlayerUpdatesRef.current = false;
      }
    });

    return unsubscribe;
  }, [playerReady, playerRef]);

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

  return { isBuffering };
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
  const { isBuffering } = useCustomPlayer(playerRef);

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
  const inputProps: RemotionInputProps = useMemo(() => ({
    fps,
    tracks: resolvedTracks as RemotionInputProps['tracks'],
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
    const container = playerContainerRef.current;
    if (!container) return;

    const updateRect = () => {
      setPlayerContainerRect(container.getBoundingClientRect());
    };

    const resizeObserver = new ResizeObserver(updateRect);
    resizeObserver.observe(container);

    window.addEventListener('scroll', updateRect, true);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [playerSize]);

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
    if (usePlaybackStore.getState().previewFrame !== null) return;
    usePlaybackStore.getState().setCurrentFrame(frame);
  }, []);

  // Handle play state change from player
  const handlePlayStateChange = useCallback((playing: boolean) => {
    if (playing) {
      usePlaybackStore.getState().play();
    } else {
      usePlaybackStore.getState().pause();
    }
  }, []);

  // Handle frame update from player during playback
  useEffect(() => {
    if (!playerRef.current) return;

    let lastUpdateTime = 0;
    const THROTTLE_MS = 100;

    const handleTimeUpdate = () => {
      const now = performance.now();
      if (now - lastUpdateTime >= THROTTLE_MS) {
        // Skip when in preview mode to keep primary playhead stationary
        if (usePlaybackStore.getState().previewFrame !== null) return;
        const frame = playerRef.current?.getCurrentFrame();
        if (frame !== undefined) {
          usePlaybackStore.getState().setCurrentFrame(frame);
          lastUpdateTime = now;
        }
      }
    };

    const intervalId = setInterval(handleTimeUpdate, 16); // ~60fps check

    return () => {
      clearInterval(intervalId);
    };
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

            {isBuffering && !isResolving && (
              <div className="absolute top-2 left-2 z-20 flex items-center gap-2 bg-black/70 px-2 py-1 rounded">
                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span className="text-white text-xs">Buffering...</span>
              </div>
            )}

            {/* GPU mode: 'always' = GPU only, 'scrubbing' = GPU when paused, 'buffered' = WASM buffered, 'off' = HTML5 only */}
            {GPU_MODE === 'buffered' ? (
              // WASM-buffered GPU playback (experimental)
              (() => {
                const s = usePlaybackStore.getState();
                const effectiveFrame = s.previewFrame ?? s.currentFrame;
                const videoItems = items.filter((item) => item.type === 'video');
                const firstVideo = videoItems[0];
                const videoSrc = firstVideo?.mediaId ? resolvedUrls.get(firstVideo.mediaId) ?? '' : '';
                return (
                  <BufferedGPUPreview
                    src={videoSrc}
                    currentFrame={effectiveFrame}
                    fps={fps}
                    width={Math.round(playerSize.width)}
                    height={Math.round(playerSize.height)}
                    isPlaying={usePlaybackStore.getState().isPlaying}
                    backgroundColor={project.backgroundColor}
                    onFrameRendered={handleFrameChange}
                    onError={(err) => console.error('[Buffered GPU Preview]', err)}
                  />
                );
              })()
            ) : GPU_MODE === 'always' || (GPU_MODE === 'scrubbing' && !usePlaybackStore.getState().isPlaying) ? (
              (() => {
                const s2 = usePlaybackStore.getState();
                const effectiveFrame2 = s2.previewFrame ?? s2.currentFrame;
                return (
                  <GPUVideoPreview
                    items={items.filter((item) => item.type === 'video').map((item) => ({
                      ...item,
                      type: 'video' as const,
                      src: resolvedUrls.get(item.mediaId ?? '') ?? '',
                    }))}
                    tracks={tracks}
                    currentFrame={effectiveFrame2}
                    fps={fps}
                    width={Math.round(playerSize.width)}
                    height={Math.round(playerSize.height)}
                    backgroundColor={project.backgroundColor}
                    onFrameRendered={handleFrameChange}
                    onError={(err) => console.error('[GPU Preview]', err)}
                  />
                );
              })()
            ) : (
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
            )}
          </div>

          <GizmoOverlay
            containerRect={playerContainerRect}
            playerSize={playerSize}
            projectSize={{ width: project.width, height: project.height }}
            zoom={zoom}
            hitAreaRef={backgroundRef as React.RefObject<HTMLDivElement>}
          />
        </div>
      </div>
    </div>
  );
});
