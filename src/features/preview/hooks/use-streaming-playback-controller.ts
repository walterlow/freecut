/**
 * Hook to manage WebCodecs streaming playback lifecycle.
 *
 * When enabled, creates a streaming decode worker that runs mediabunny's
 * forward samples() generator for each visible video source. Decoded
 * ImageBitmaps are buffered and provided to the canvas render pipeline,
 * bypassing HTML5 <video> elements entirely.
 *
 * The coordinator is self-managing: getFrame() lazily auto-starts streams
 * for new sources and idle cleanup stops streams that are no longer needed.
 *
 * The hook exposes a `streamingFrameProviderRef` that the render pump reads
 * on each frame and sets on the renderer. This avoids timing issues with
 * renderer creation/destruction during re-renders.
 *
 * Toggle via window.__DEBUG__?.setStreamingPlayback(true)
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { usePlaybackStore } from '@/shared/state/playback';
import { createStreamingPlayback, type StreamingPlayback } from '../utils/streaming-playback';
import { STREAMING_PLAYBACK_ENABLED } from '../utils/preview-constants';
import { createLogger } from '@/shared/logging/logger';

const log = createLogger('StreamingPlaybackCtrl');

interface UseStreamingPlaybackControllerResult {
  /** Whether streaming playback is enabled — when true, the canvas overlay
   *  must be forced during playback (same as GPU effects). */
  forceCanvasOverlay: boolean;
  /** Ref to the streaming frame provider function. The render pump should
   *  set this on the renderer before each frame via setStreamingFrameProvider. */
  streamingFrameProviderRef: React.RefObject<((src: string, sourceTime: number, mediaId?: string) => ImageBitmap | null) | null>;
}

export function useStreamingPlaybackController(): UseStreamingPlaybackControllerResult {
  const playbackRef = useRef<StreamingPlayback | null>(null);
  const enabledRef = useRef(STREAMING_PLAYBACK_ENABLED);
  const [forceCanvasOverlay, setForceCanvasOverlay] = useState(STREAMING_PLAYBACK_ENABLED);
  const streamingFrameProviderRef = useRef<((src: string, sourceTime: number, mediaId?: string) => ImageBitmap | null) | null>(null);

  const getPlayback = useCallback((): StreamingPlayback => {
    if (!playbackRef.current) {
      playbackRef.current = createStreamingPlayback();
    }
    return playbackRef.current;
  }, []);

  // Frame provider callback — the coordinator handles everything internally
  const getStreamingFrame = useCallback((src: string, sourceTime: number, mediaId?: string): ImageBitmap | null => {
    if (!playbackRef.current) return null;
    return playbackRef.current.getFrame(src, sourceTime, mediaId);
  }, []);

  // Subscribe to playback state: manage streaming lifecycle and expose provider via ref.
  // The render pump reads streamingFrameProviderRef and sets it on the renderer per-frame,
  // avoiding timing issues with renderer creation/destruction during re-renders.
  useEffect(() => {
    // If already playing when this effect mounts, activate immediately
    if (enabledRef.current && usePlaybackStore.getState().isPlaying) {
      getPlayback();
      streamingFrameProviderRef.current = getStreamingFrame;
      log.info('Playback already active on mount, streaming provider activated');
    }

    const unsubscribe = usePlaybackStore.subscribe((state, prevState) => {
      if (!enabledRef.current) return;

      const wasPlaying = prevState.isPlaying;
      const isPlaying = state.isPlaying;

      if (isPlaying && !wasPlaying) {
        getPlayback();
        streamingFrameProviderRef.current = getStreamingFrame;
        log.info('Playback started, streaming provider activated');
      } else if (!isPlaying && wasPlaying) {
        streamingFrameProviderRef.current = null;
        const playback = playbackRef.current;
        if (playback) {
          const metrics = playback.getMetrics();
          log.info('Playback stopped', {
            received: metrics.totalFramesReceived,
            drawn: metrics.totalFramesDrawn,
            missed: metrics.totalFramesMissed,
          });
          playback.stopAll();
        }
      }
    });

    return () => {
      unsubscribe();
      streamingFrameProviderRef.current = null;
    };
  }, [getPlayback, getStreamingFrame]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      playbackRef.current?.dispose();
      playbackRef.current = null;
    };
  }, []);

  // Expose debug toggle
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const debugApi = (window as unknown as Record<string, unknown>).__DEBUG__ as
      Record<string, unknown> | undefined;
    if (!debugApi) return;

    debugApi.setStreamingPlayback = (enabled: boolean) => {
      enabledRef.current = enabled;
      setForceCanvasOverlay(enabled);
      log.info(`Streaming playback ${enabled ? 'enabled' : 'disabled'}`);

      if (!enabled) {
        streamingFrameProviderRef.current = null;
        playbackRef.current?.stopAll();
      }
    };

    debugApi.streamingPlaybackMetrics = () => {
      return playbackRef.current?.getMetrics() ?? null;
    };

    return () => {
      delete debugApi.setStreamingPlayback;
      delete debugApi.streamingPlaybackMetrics;
    };
  }, []);

  return { forceCanvasOverlay, streamingFrameProviderRef };
}
