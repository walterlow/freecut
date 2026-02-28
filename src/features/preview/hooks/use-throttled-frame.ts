/**
 * Throttled frame hook for UI components that display animated values.
 *
 * By default, this hook ONLY updates when playback is paused (scrubbing or stopped).
 * This is optimal for property panels that don't need real-time updates during playback.
 *
 * USAGE:
 * - Use this for property panels, keyframe toggles, etc. that show animated values
 * - DO NOT use for playhead position or timecode display (use direct DOM updates)
 * - DO NOT use for critical frame-accurate operations (use store subscription)
 */

import { useState, useEffect, useRef } from 'react';
import { usePlaybackStore } from '@/shared/state/playback';

interface UseThrottledFrameOptions {
  /**
   * If true, updates during playback at throttled rate.
   * If false (default), only updates when paused/scrubbing.
   */
  updateDuringPlayback?: boolean;
  /** Update rate in ms when updateDuringPlayback is true. Default 100ms (10fps). */
  throttleMs?: number;
}

/**
 * Returns currentFrame that only updates when paused (default).
 *
 * Updates when:
 * - Playback stops (immediately syncs to current frame)
 * - User scrubs while paused (immediate updates)
 * - Component mounts
 *
 * Does NOT update during playback by default (set updateDuringPlayback: true to enable).
 */
export function useThrottledFrame(options: UseThrottledFrameOptions = {}) {
  const { updateDuringPlayback = false, throttleMs = 100 } = options;

  // Local state that triggers re-renders
  const [frame, setFrame] = useState(() =>
    usePlaybackStore.getState().currentFrame
  );

  // Refs for tracking state without re-renders
  const lastUpdateTimeRef = useRef(0);
  useEffect(() => {
    let wasPlaying = usePlaybackStore.getState().isPlaying;

    const unsubscribe = usePlaybackStore.subscribe((state) => {
      const isPlaying = state.isPlaying;
      const currentFrame = state.currentFrame;

      // Always update when playback stops (sync to final frame)
      if (wasPlaying && !isPlaying) {
        setFrame(currentFrame);
        wasPlaying = isPlaying;
        return;
      }

      wasPlaying = isPlaying;

      // When paused, update immediately (scrubbing)
      if (!isPlaying) {
        setFrame(currentFrame);
        return;
      }

      // During playback - skip updates unless explicitly enabled
      if (!updateDuringPlayback) {
        return;
      }

      // Throttled updates during playback
      const now = performance.now();
      const timeSinceLastUpdate = now - lastUpdateTimeRef.current;

      if (timeSinceLastUpdate >= throttleMs) {
        setFrame(currentFrame);
        lastUpdateTimeRef.current = now;
      }
    });

    return () => {
      unsubscribe();
    };
  }, [updateDuringPlayback, throttleMs]);

  return frame;
}
