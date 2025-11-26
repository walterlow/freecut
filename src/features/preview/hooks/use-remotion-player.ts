import { useEffect, useRef, type RefObject } from 'react';
import type { PlayerRef } from '@remotion/player';
import { usePlaybackStore } from '../stores/playback-store';

/**
 * Hook for integrating Remotion Player with timeline playback state
 *
 * Sync strategy:
 * - Timeline seeks trigger Player seeks (both playing and paused)
 * - Player updates are ignored briefly after seeks to prevent loops
 * - Player fires timeupdate → updates timeline scrubber position
 * - Play/pause state is synced bidirectionally
 *
 * @param playerRef - Ref to the Remotion Player instance
 * @returns Player sync handlers and current playback state
 */
export function useRemotionPlayer(playerRef: RefObject<PlayerRef>) {
  // Granular selectors
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame);

  // Refs for tracking state without causing re-renders
  const lastSyncedFrameRef = useRef<number>(0);
  const ignorePlayerUpdatesRef = useRef<boolean>(false);
  const wasPlayingRef = useRef(isPlaying);

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
        // Don't sync frame on pause - the timeline state is authoritative
        // The currentFrame effect will handle seeking the player to the correct position
      }
    } catch (error) {
      console.error('Failed to control Remotion Player playback:', error);
    }
  }, [isPlaying, playerRef]);

  /**
   * Timeline → Player: Sync frame position (scrubbing and seeking)
   * Works both when paused AND when playing
   */
  useEffect(() => {
    if (!playerRef.current) return;

    // Check if this is a user-initiated seek (not from Player feedback)
    const frameDiff = Math.abs(currentFrame - lastSyncedFrameRef.current);
    if (frameDiff === 0) {
      return; // Already in sync, no need to seek
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
          // Don't sync back to timeline - this creates loops
          // The timeupdate event will handle updates during playback
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
  }, [currentFrame, playerRef, isPlaying, setCurrentFrame]);

  /**
   * Player → Timeline: Listen to timeupdate events
   * Updates timeline scrubber as video plays
   */
  useEffect(() => {
    if (!playerRef.current) return;

    const handleTimeUpdate = (e: { detail: { frame: number } }) => {
      // Ignore updates right after we seeked
      if (ignorePlayerUpdatesRef.current) {
        return;
      }

      const newFrame = e.detail.frame;

      // Only update if frame actually changed
      if (newFrame !== lastSyncedFrameRef.current) {
        lastSyncedFrameRef.current = newFrame;
        setCurrentFrame(newFrame);
      }
    };

    playerRef.current.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      playerRef.current?.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [setCurrentFrame, playerRef]);

  return {
    isPlaying,
    currentFrame,
  };
}
