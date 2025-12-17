import { useEffect, useRef, useState, type RefObject } from 'react';
import type { PlayerRef } from '@remotion/player';
import { usePlaybackStore } from '../stores/playback-store';
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store';

/**
 * Hook for integrating Remotion Player with timeline playback state
 *
 * Sync strategy:
 * - Timeline seeks trigger Player seeks (both playing and paused)
 * - Player updates are ignored briefly after seeks to prevent loops
 * - Player fires frameupdate → updates timeline scrubber position
 * - Play/pause state is synced bidirectionally
 * - Store is authoritative - if store says paused, Player follows
 *
 * @param playerRef - Ref to the Remotion Player instance
 * @returns Player sync handlers and current playback state
 */
export function useRemotionPlayer(playerRef: RefObject<PlayerRef>) {
  // Only subscribe to isPlaying - currentFrame is accessed via ref to prevent re-renders
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame);
  // Subscribe to loading state - used to wait for timeline to load before initial sync
  const isTimelineLoading = useTimelineSettingsStore((s) => s.isTimelineLoading);

  // Buffering state for UI feedback
  const [isBuffering, setIsBuffering] = useState(false);

  // Track when Player is ready (ref.current is set)
  // This triggers effects to re-run after Player mounts
  const [playerReady, setPlayerReady] = useState(false);

  // Refs for tracking state without causing re-renders
  const lastSyncedFrameRef = useRef<number>(0);
  const ignorePlayerUpdatesRef = useRef<boolean>(false);
  const wasPlayingRef = useRef(isPlaying);
  const pendingFrameRef = useRef<number | null>(null);

  // Detect when Player becomes ready (handles F5 refresh timing)
  useEffect(() => {
    if (playerRef.current && !playerReady) {
      setPlayerReady(true);
    }
    // Poll briefly in case ref is set after initial render
    const checkReady = setInterval(() => {
      if (playerRef.current && !playerReady) {
        setPlayerReady(true);
        clearInterval(checkReady);
      }
    }, 50);

    // Clean up after 1 second (Player should definitely be ready by then)
    const timeout = setTimeout(() => clearInterval(checkReady), 1000);

    return () => {
      clearInterval(checkReady);
      clearTimeout(timeout);
    };
  }, [playerRef, playerReady]);

  /**
   * Timeline → Player: Sync play/pause state
   */
  useEffect(() => {
    if (!playerRef.current) return;

    const wasPlaying = wasPlayingRef.current;
    wasPlayingRef.current = isPlaying;

    try {
      if (isPlaying && !wasPlaying) {
        playerRef.current.play();
      } else if (!isPlaying && wasPlaying) {
        playerRef.current.pause();
        // Sync any pending frame that was throttled during playback
        if (pendingFrameRef.current !== null) {
          setCurrentFrame(pendingFrameRef.current);
          pendingFrameRef.current = null;
        }
      }
    } catch (error) {
      console.error('[Remotion Sync] Failed to control playback:', error);
    }
  }, [isPlaying, playerRef, setCurrentFrame]);

  /**
   * Timeline → Player: Sync frame position (scrubbing and seeking)
   * Uses store subscription instead of useEffect to avoid re-renders
   * Depends on playerReady AND isTimelineLoading to handle F5 refresh timing
   */
  useEffect(() => {
    // Wait for both: player ready AND timeline finished loading
    // This prevents the race condition where player syncs to frame 0
    // before loadTimeline() has restored the saved frame
    if (!playerReady || !playerRef.current || isTimelineLoading) return;

    // Initial sync: The subscription only fires on changes, so we need to sync
    // the current frame immediately when the Player mounts (e.g., on project load)
    const initialFrame = usePlaybackStore.getState().currentFrame;
    // Always sync initial frame (even if 0) since we now know timeline is loaded
    lastSyncedFrameRef.current = initialFrame;
    playerRef.current.seekTo(initialFrame);
    console.log('[Remotion Sync] Initial sync to frame:', initialFrame);

    const unsubscribe = usePlaybackStore.subscribe((state, prevState) => {
      if (!playerRef.current) return;

      const currentFrame = state.currentFrame;
      const prevFrame = prevState.currentFrame;

      // No change
      if (currentFrame === prevFrame) return;

      // Check if this is a user-initiated seek (not from Player feedback)
      const frameDiff = Math.abs(currentFrame - lastSyncedFrameRef.current);
      if (frameDiff === 0) {
        return; // Already in sync, no need to seek
      }

      // During playback, ignore single-frame increments (normal playback progression)
      // Only seek if user jumped more than 1 frame (actual seek/scrub)
      if (state.isPlaying && frameDiff === 1) {
        lastSyncedFrameRef.current = currentFrame;
        return;
      }

      // Update lastSyncedFrame IMMEDIATELY to prevent pause handler from
      // overwriting user-initiated seeks (e.g., clicking on ruler while playing)
      lastSyncedFrameRef.current = currentFrame;

      // Ignore Player updates during seek
      ignorePlayerUpdatesRef.current = true;

      try {
        const handleSeeked = () => {
          // After seek completes, trust whatever frame Player is at
          const actualFrame = playerRef.current?.getCurrentFrame();
          if (actualFrame !== undefined) {
            lastSyncedFrameRef.current = actualFrame;
          }

          // Re-enable Player updates
          requestAnimationFrame(() => {
            ignorePlayerUpdatesRef.current = false;
          });

          playerRef.current?.removeEventListener('seeked', handleSeeked);
        };

        playerRef.current.addEventListener('seeked', handleSeeked);
        playerRef.current.seekTo(currentFrame);
      } catch (error) {
        console.error('Failed to seek Remotion Player:', error);
        ignorePlayerUpdatesRef.current = false;
      }
    });

    return unsubscribe;
  }, [playerReady, playerRef, isTimelineLoading]);

  /**
   * Player → Timeline: Listen to frameupdate events
   * Updates timeline scrubber as video plays
   * Throttled to reduce re-renders and prevent audio stuttering
   */
  useEffect(() => {
    if (!playerRef.current) return;

    let lastUpdateTime = 0;
    // Throttle during playback to reduce store updates and prevent audio stuttering.
    // 100ms (10fps) is sufficient for visual feedback during playback.
    // Only TimecodeDisplay and TimelinePlayhead subscribe to currentFrame.
    const THROTTLE_MS = 100;

    const handleFrameUpdate = (e: { detail: { frame: number } }) => {
      // Ignore updates right after we seeked
      if (ignorePlayerUpdatesRef.current) {
        return;
      }

      const newFrame = e.detail.frame;

      // Only update if frame actually changed
      if (newFrame !== lastSyncedFrameRef.current) {
        lastSyncedFrameRef.current = newFrame;
        pendingFrameRef.current = newFrame; // Always store latest frame

        // During active playback, skip most UI updates to prevent audio stuttering
        // Only update every THROTTLE_MS to give some visual feedback
        const isPlaying = usePlaybackStore.getState().isPlaying;
        if (isPlaying) {
          const now = performance.now();
          if (now - lastUpdateTime >= THROTTLE_MS) {
            lastUpdateTime = now;
            setCurrentFrame(newFrame);
            pendingFrameRef.current = null;
          }
        } else {
          // When paused/scrubbing, update immediately for responsive feel
          setCurrentFrame(newFrame);
          pendingFrameRef.current = null;
        }
      }
    };

    playerRef.current.addEventListener('frameupdate', handleFrameUpdate);

    return () => {
      playerRef.current?.removeEventListener('frameupdate', handleFrameUpdate);
    };
  }, [setCurrentFrame, playerRef]);

  /**
   * Player → Timeline: Sync play/pause/ended state from Player
   * Handles cases where Player changes state on its own (buffering, errors, end of playback)
   */
  useEffect(() => {
    if (!playerRef.current) return;

    const { pause } = usePlaybackStore.getState();

    const handlePlayerPlay = () => {
      const storeIsPlaying = usePlaybackStore.getState().isPlaying;

      // If store says we're paused, the store is authoritative
      // Force player back to paused state to match store
      if (!storeIsPlaying) {
        try {
          playerRef.current?.pause();
        } catch (e) {
          // Ignore
        }
        return;
      }

      // Player started playing and store agrees - ensure refs are synced
      if (!wasPlayingRef.current) {
        wasPlayingRef.current = true;
      }
    };

    const handlePlayerPause = () => {
      // Only attempt resume if store says we should be playing
      // This handles Remotion's internal pause/play cycles during buffering/VFR correction
      // Read directly from store to avoid stale closure issues with wasPlayingRef
      const storeIsPlaying = usePlaybackStore.getState().isPlaying;
      if (storeIsPlaying) {
        setTimeout(async () => {
          const stillWantsToPlay = usePlaybackStore.getState().isPlaying;
          if (stillWantsToPlay && playerRef.current) {
            try {
              await playerRef.current.play();
            } catch (e) {
              // Play failed - retry once after a longer delay
              console.warn('[Remotion Sync] Play failed, retrying:', e);
              setTimeout(async () => {
                const stillWants = usePlaybackStore.getState().isPlaying;
                if (stillWants && playerRef.current) {
                  try {
                    await playerRef.current.play();
                  } catch (retryError) {
                    console.error('[Remotion Sync] Play retry failed:', retryError);
                    wasPlayingRef.current = false;
                    pause();
                  }
                }
              }, 100);
            }
          }
        }, 50);
      }
    };

    const handlePlayerEnded = () => {
      wasPlayingRef.current = false;
      pause();
    };

    const handlePlayerError = (e: Event) => {
      console.error('[Remotion Sync] Player error:', e);
      // Read directly from store to avoid stale closure issues
      if (usePlaybackStore.getState().isPlaying) {
        wasPlayingRef.current = false;
        pause();
      }
    };

    // Buffering state events
    const handlePlayerWaiting = () => {
      setIsBuffering(true);
    };

    const handlePlayerResume = () => {
      setIsBuffering(false);
    };

    playerRef.current.addEventListener('play', handlePlayerPlay);
    playerRef.current.addEventListener('pause', handlePlayerPause);
    playerRef.current.addEventListener('ended', handlePlayerEnded);
    playerRef.current.addEventListener('error', handlePlayerError);
    playerRef.current.addEventListener('waiting', handlePlayerWaiting);
    playerRef.current.addEventListener('resume', handlePlayerResume);

    return () => {
      playerRef.current?.removeEventListener('play', handlePlayerPlay);
      playerRef.current?.removeEventListener('pause', handlePlayerPause);
      playerRef.current?.removeEventListener('ended', handlePlayerEnded);
      playerRef.current?.removeEventListener('error', handlePlayerError);
      playerRef.current?.removeEventListener('waiting', handlePlayerWaiting);
      playerRef.current?.removeEventListener('resume', handlePlayerResume);
    };
  }, [playerRef]);

  return {
    isPlaying,
    isBuffering,
  };
}
