/**
 * useBufferedPlayback Hook
 *
 * React hook for using the buffered playback controller with WASM frame buffer.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  BufferedPlaybackController,
  createBufferedPlaybackController,
  type PlaybackState,
  type PlaybackConfig,
  type PlaybackStats,
  type PlaybackFrame,
} from '../playback';
import type { ManagedMediaSource } from '../media';

export interface UseBufferedPlaybackOptions extends PlaybackConfig {
  /** Auto-initialize on mount (default: true) */
  autoInit?: boolean;
}

export interface UseBufferedPlaybackResult {
  /** Current playback state */
  state: PlaybackState;
  /** Current frame being displayed */
  currentFrame: PlaybackFrame | null;
  /** Playback statistics */
  stats: PlaybackStats | null;
  /** Whether controller is ready */
  isReady: boolean;
  /** Any error that occurred */
  error: string | null;
  /** Set the media source */
  setSource: (source: ManagedMediaSource) => void;
  /** Start playback */
  play: () => Promise<void>;
  /** Pause playback */
  pause: () => void;
  /** Seek to frame */
  seek: (frameNumber: number) => Promise<void>;
  /** Stop playback */
  stop: () => void;
  /** Get the controller directly (for advanced use) */
  getController: () => BufferedPlaybackController | null;
}

/**
 * Hook for buffered video playback with WASM frame buffer
 */
export function useBufferedPlayback(
  options: UseBufferedPlaybackOptions = {}
): UseBufferedPlaybackResult {
  const { autoInit = true, ...config } = options;

  const controllerRef = useRef<BufferedPlaybackController | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [state, setState] = useState<PlaybackState>('idle');
  const [currentFrame, setCurrentFrame] = useState<PlaybackFrame | null>(null);
  const [stats, setStats] = useState<PlaybackStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize controller
  useEffect(() => {
    if (!autoInit) return;

    let mounted = true;

    const init = async () => {
      try {
        const controller = await createBufferedPlaybackController(config);

        if (!mounted) {
          controller.dispose();
          return;
        }

        controllerRef.current = controller;

        // Set up event listeners
        controller.on('statechange', ({ state }) => {
          if (mounted) setState(state);
        });

        controller.on('frame', (frame) => {
          if (mounted) setCurrentFrame(frame);
        });

        controller.on('error', ({ message }) => {
          if (mounted) setError(message);
        });

        setIsReady(true);
        setError(null);
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to initialize playback');
        }
      }
    };

    init();

    return () => {
      mounted = false;
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
  }, [autoInit]);

  // Update stats periodically during playback
  useEffect(() => {
    if (state !== 'playing' && state !== 'buffering') return;

    const interval = setInterval(() => {
      const controller = controllerRef.current;
      if (controller) {
        setStats(controller.getStats());
      }
    }, 100);

    return () => clearInterval(interval);
  }, [state]);

  const setSource = useCallback((source: ManagedMediaSource) => {
    const controller = controllerRef.current;
    if (!controller) {
      setError('Controller not initialized');
      return;
    }

    try {
      controller.setSource(source);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set source');
    }
  }, []);

  const play = useCallback(async () => {
    const controller = controllerRef.current;
    if (!controller) {
      setError('Controller not initialized');
      return;
    }

    try {
      await controller.play();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to play');
    }
  }, []);

  const pause = useCallback(() => {
    controllerRef.current?.pause();
  }, []);

  const seek = useCallback(async (frameNumber: number) => {
    const controller = controllerRef.current;
    if (!controller) return;

    try {
      await controller.seek(frameNumber);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to seek');
    }
  }, []);

  const stop = useCallback(() => {
    controllerRef.current?.stop();
    setCurrentFrame(null);
    setStats(null);
  }, []);

  const getController = useCallback(() => controllerRef.current, []);

  return {
    state,
    currentFrame,
    stats,
    isReady,
    error,
    setSource,
    play,
    pause,
    seek,
    stop,
    getController,
  };
}
