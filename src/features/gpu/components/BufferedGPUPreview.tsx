/**
 * Buffered GPU Preview Component
 *
 * Uses the WASM-powered frame buffer for smooth GPU-accelerated playback.
 * This component bridges the BufferedPlaybackController with GPU rendering.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useBufferedPlayback } from '../hooks/use-buffered-playback';
import { useMediaSource } from '../hooks/use-media-source';
import { useRenderBackend } from '../hooks/use-render-backend';
import type { PlaybackStats } from '../playback';

export interface BufferedGPUPreviewProps {
  /** Video source URL */
  src: string;
  /** Current frame to display (for initial position and scrubbing) */
  currentFrame: number;
  /** Frames per second */
  fps: number;
  /** Render width */
  width: number;
  /** Render height */
  height: number;
  /** Whether playback is active */
  isPlaying: boolean;
  /** Background color */
  backgroundColor?: string;
  /** Callback when frame is rendered */
  onFrameRendered?: (frameNumber: number) => void;
  /** Callback on error */
  onError?: (error: string) => void;
  /** Callback with playback stats */
  onStats?: (stats: PlaybackStats) => void;
}

/**
 * Buffered GPU Preview with WASM frame buffer
 */
export function BufferedGPUPreview({
  src,
  currentFrame,
  fps,
  width,
  height,
  isPlaying,
  backgroundColor = '#000000',
  onFrameRendered,
  onError,
  onStats,
}: BufferedGPUPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastFrameRef = useRef<number>(-1);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize media source
  const { source, isLoading: sourceLoading, error: sourceError } = useMediaSource(src);

  // Initialize render backend
  const { backend, error: backendError } = useRenderBackend(canvasRef, {
    preferredBackend: 'webgpu',
  });

  // Initialize buffered playback controller
  const {
    state,
    stats,
    isReady,
    error: playbackError,
    setSource,
    play,
    pause,
    seek,
  } = useBufferedPlayback({
    bufferCapacity: Math.ceil(fps * 2), // 2 seconds buffer
    syncThresholdMs: 40,
    targetBufferFill: 0.5,
  });

  // Report errors
  useEffect(() => {
    const error = sourceError || backendError || playbackError;
    if (error) {
      onError?.(error);
    }
  }, [sourceError, backendError, playbackError, onError]);

  // Report stats
  useEffect(() => {
    if (stats) {
      onStats?.(stats);
    }
  }, [stats, onStats]);

  // Set source when ready
  useEffect(() => {
    if (source && isReady && !isInitialized) {
      try {
        setSource(source);
        setIsInitialized(true);
      } catch (err) {
        onError?.(err instanceof Error ? err.message : 'Failed to set source');
      }
    }
  }, [source, isReady, isInitialized, setSource, onError]);

  // Sync play/pause state
  useEffect(() => {
    if (!isInitialized) return;

    if (isPlaying && state !== 'playing' && state !== 'buffering') {
      play().catch((err) => {
        onError?.(err instanceof Error ? err.message : 'Failed to play');
      });
    } else if (!isPlaying && state === 'playing') {
      pause();
    }
  }, [isPlaying, state, isInitialized, play, pause, onError]);

  // Sync seek when currentFrame changes significantly (user scrubbing)
  useEffect(() => {
    if (!isInitialized || isPlaying) return;

    const frameDiff = Math.abs(currentFrame - lastFrameRef.current);
    if (frameDiff > 1) {
      // User is scrubbing - seek to the frame
      seek(currentFrame).catch((err) => {
        onError?.(err instanceof Error ? err.message : 'Failed to seek');
      });
    }

    lastFrameRef.current = currentFrame;
  }, [currentFrame, isInitialized, isPlaying, seek, onError]);

  // Render frame callback
  const renderFrame = useCallback(
    (frame: VideoFrame) => {
      if (!canvasRef.current || !backend) return;

      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;

      // Clear with background color
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, width, height);

      // Draw frame
      try {
        ctx.drawImage(frame, 0, 0, width, height);
      } catch {
        // Frame may have been closed
      }
    },
    [backend, backgroundColor, width, height]
  );

  // Subscribe to frame events from playback controller
  useEffect(() => {
    if (!isInitialized) return;

    const controller = (window as any).__bufferedPlaybackController;
    if (!controller) return;

    const handleFrame = ({ frame, frameNumber, shouldDrop }: any) => {
      if (shouldDrop) return;

      renderFrame(frame);
      onFrameRendered?.(frameNumber);
    };

    controller.on('frame', handleFrame);

    return () => {
      controller.off('frame', handleFrame);
    };
  }, [isInitialized, renderFrame, onFrameRendered]);

  // Calculate loading state
  const isLoading = sourceLoading || !isReady || !isInitialized;
  const isBuffering = state === 'buffering';

  return (
    <div
      className="relative w-full h-full flex items-center justify-center"
      style={{ backgroundColor }}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
        }}
      />

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="text-white text-sm">
            {sourceLoading ? 'Loading source...' : 'Initializing...'}
          </div>
        </div>
      )}

      {/* Buffering indicator */}
      {isBuffering && !isLoading && (
        <div className="absolute top-2 left-2 flex items-center gap-2 bg-black/70 px-2 py-1 rounded">
          <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <span className="text-white text-xs">
            Buffering... {stats ? `${Math.round((stats.buffer.frameCount / stats.buffer.capacity) * 100)}%` : ''}
          </span>
        </div>
      )}

      {/* Stats overlay (debug) */}
      {stats && import.meta.env.DEV && (
        <div className="absolute bottom-2 left-2 text-[10px] font-mono text-white/70 bg-black/50 px-1 rounded">
          {stats.buffer.state} | {stats.buffer.frameCount}/{stats.buffer.capacity} frames |
          dropped: {stats.buffer.framesDropped} | drift: {stats.sync.driftMs.toFixed(1)}ms
        </div>
      )}
    </div>
  );
}

export default BufferedGPUPreview;
