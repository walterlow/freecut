/**
 * useClockFrame Hook
 *
 * Bridges the player's Clock system with the GPU rendering pipeline.
 * Provides frame-accurate updates from the player clock.
 */

import { useState, useEffect, useRef } from 'react';

// Import clock context from player
// This creates a dependency on the player module
import { useClockFrame as usePlayerClockFrame } from '@/features/player/clock';

/**
 * Re-export the player's clock frame hook for GPU components
 *
 * This hook provides the current frame number from the player's clock.
 * GPU components use this to stay in sync with playback.
 */
export { usePlayerClockFrame as useClockFrame };

/**
 * Hook to get frame updates with throttling for heavy rendering
 *
 * When GPU rendering is expensive, this hook limits updates to
 * prevent frame drops during playback.
 *
 * @param maxFps - Maximum frames per second to update (default: 30)
 */
export function useThrottledClockFrame(maxFps: number = 30): number {
  const currentFrame = usePlayerClockFrame();
  const [throttledFrame, setThrottledFrame] = useState(currentFrame);
  const lastUpdateRef = useRef(0);
  const frameInterval = 1000 / maxFps;

  useEffect(() => {
    const now = performance.now();
    const elapsed = now - lastUpdateRef.current;

    if (elapsed >= frameInterval) {
      setThrottledFrame(currentFrame);
      lastUpdateRef.current = now;
    }
  }, [currentFrame, frameInterval]);

  return throttledFrame;
}

/**
 * Hook to detect playback state changes
 *
 * Returns whether playback just started, is playing, or just stopped.
 * Useful for pre-warming GPU resources on play.
 */
export function usePlaybackStateChange(): {
  isPlaying: boolean;
  justStarted: boolean;
  justStopped: boolean;
} {
  const [isPlaying, setIsPlaying] = useState(false);
  const [justStarted, setJustStarted] = useState(false);
  const [justStopped, setJustStopped] = useState(false);
  const prevPlayingRef = useRef(false);

  const currentFrame = usePlayerClockFrame();
  const lastFrameRef = useRef(currentFrame);

  useEffect(() => {
    // Detect playing by frame changes
    const frameChanged = currentFrame !== lastFrameRef.current;
    lastFrameRef.current = currentFrame;

    const wasPlaying = prevPlayingRef.current;
    const nowPlaying = frameChanged;

    if (nowPlaying && !wasPlaying) {
      setJustStarted(true);
      setTimeout(() => setJustStarted(false), 100);
    } else if (!nowPlaying && wasPlaying) {
      setJustStopped(true);
      setTimeout(() => setJustStopped(false), 100);
    }

    prevPlayingRef.current = nowPlaying;
    setIsPlaying(nowPlaying);
  }, [currentFrame]);

  return { isPlaying, justStarted, justStopped };
}

/**
 * Hook to get frame timing information
 *
 * Useful for debugging performance and frame drops.
 */
export function useFrameTiming(): {
  currentFrame: number;
  actualFps: number;
  frameDrops: number;
} {
  const currentFrame = usePlayerClockFrame();
  const [actualFps, setActualFps] = useState(0);
  const [frameDrops, setFrameDrops] = useState(0);

  const framesRef = useRef<number[]>([]);
  const lastFrameRef = useRef(currentFrame);
  const dropsRef = useRef(0);

  useEffect(() => {
    const now = performance.now();
    framesRef.current.push(now);

    // Keep only last second of timestamps
    const oneSecondAgo = now - 1000;
    framesRef.current = framesRef.current.filter((t) => t > oneSecondAgo);

    // Calculate FPS
    setActualFps(framesRef.current.length);

    // Detect frame drops (skipped more than 2 frames)
    const frameSkip = Math.abs(currentFrame - lastFrameRef.current);
    if (frameSkip > 2 && lastFrameRef.current !== 0) {
      dropsRef.current += frameSkip - 1;
      setFrameDrops(dropsRef.current);
    }

    lastFrameRef.current = currentFrame;
  }, [currentFrame]);

  return { currentFrame, actualFps, frameDrops };
}
