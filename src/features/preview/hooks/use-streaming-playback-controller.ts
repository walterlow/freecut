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
import type { TimelineTrack, VideoItem } from '@/types/timeline';
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager';

const log = createLogger('StreamingPlaybackCtrl');

/** Collect (activeSrc, sourceTime, mediaId) for video items visible at the given frame. */
function collectVisibleVideoPrewarmTargets(
  tracks: TimelineTrack[],
  timelineFrame: number,
  timelineFps: number,
): Array<{ src: string; sourceTime: number; mediaId?: string }> {
  const targets: Array<{ src: string; sourceTime: number; mediaId?: string }> = [];

  for (const track of tracks) {
    for (const item of track.items) {
      if (item.type !== 'video') continue;
      const videoItem = item as VideoItem;
      const localFrame = timelineFrame - videoItem.from;
      if (localFrame < 0 || localFrame >= videoItem.durationInFrames) continue;

      // Resolve active blob URL via mediaId (item.src may be stale)
      const mediaId = videoItem.mediaId;
      const activeSrc = (mediaId ? blobUrlManager.get(mediaId) : null) ?? videoItem.src;
      if (!activeSrc) continue;

      const sourceFps = videoItem.sourceFps ?? timelineFps;
      const speed = videoItem.speed ?? 1;
      const sourceStart = videoItem.sourceStart ?? videoItem.trimStart ?? 0;
      const sourceTime = sourceStart / sourceFps + (localFrame / timelineFps) * speed;

      targets.push({ src: activeSrc, sourceTime, mediaId });
    }
  }

  return targets;
}

interface UseStreamingPlaybackControllerParams {
  fps: number;
  combinedTracks: TimelineTrack[];
}

interface UseStreamingPlaybackControllerResult {
  /** Whether streaming playback is enabled — when true, the canvas overlay
   *  must be forced during playback (same as GPU effects). */
  forceCanvasOverlay: boolean;
  /** Ref to the streaming frame provider function. The render pump should
   *  set this on the renderer before each frame via setStreamingFrameProvider. */
  streamingFrameProviderRef: React.RefObject<((src: string, sourceTime: number, mediaId?: string) => ImageBitmap | null) | null>;
}

export function useStreamingPlaybackController({
  fps,
  combinedTracks,
}: UseStreamingPlaybackControllerParams): UseStreamingPlaybackControllerResult {
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

  // Pre-warm: start decoding at the current playhead so the buffer has frames
  // before play starts. Restarts on seek. Tracks ref holds the latest value.
  const tracksRef = useRef(combinedTracks);
  const fpsRef = useRef(fps);
  tracksRef.current = combinedTracks;
  fpsRef.current = fps;
  const prewarmFrameRef = useRef<number | null>(null);

  const prewarmAtFrame = useCallback((frame: number) => {
    if (!enabledRef.current) return;
    if (frame === prewarmFrameRef.current) return;
    prewarmFrameRef.current = frame;

    const playback = getPlayback();
    const targets = collectVisibleVideoPrewarmTargets(tracksRef.current, frame, fpsRef.current);
    for (const { src, sourceTime } of targets) {
      if (!playback.isStreaming(src)) {
        playback.startStream(src, sourceTime);
      } else {
        playback.seekStream(src, sourceTime);
      }
    }
  }, [getPlayback]);

  // Subscribe to playback state: manage streaming lifecycle and expose provider via ref.
  // The render pump reads streamingFrameProviderRef and sets it on the renderer per-frame,
  // avoiding timing issues with renderer creation/destruction during re-renders.
  useEffect(() => {
    const initialState = usePlaybackStore.getState();

    // If already playing on mount, activate immediately
    if (enabledRef.current && initialState.isPlaying) {
      getPlayback();
      streamingFrameProviderRef.current = getStreamingFrame;
      log.info('Playback already active on mount, streaming provider activated');
    }

    // Pre-warm at the current frame while paused
    if (enabledRef.current && !initialState.isPlaying) {
      prewarmAtFrame(initialState.currentFrame);
    }

    const unsubscribe = usePlaybackStore.subscribe((state, prevState) => {
      if (!enabledRef.current) return;

      const wasPlaying = prevState.isPlaying;
      const isPlaying = state.isPlaying;

      if (isPlaying && !wasPlaying) {
        getPlayback();
        streamingFrameProviderRef.current = getStreamingFrame;
        prewarmFrameRef.current = null; // clear so next pause re-prewarms
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
        // Pre-warm at the stop position
        prewarmAtFrame(state.currentFrame);
      } else if (!isPlaying && state.currentFrame !== prevState.currentFrame) {
        // User seeked while paused — pre-warm at new position
        prewarmAtFrame(state.currentFrame);
      }
    });

    return () => {
      unsubscribe();
      streamingFrameProviderRef.current = null;
    };
  }, [getPlayback, getStreamingFrame, prewarmAtFrame]);

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

      if (enabled) {
        // Start pre-warm immediately at current playhead
        const state = usePlaybackStore.getState();
        if (!state.isPlaying) {
          prewarmFrameRef.current = null; // force re-prewarm
          prewarmAtFrame(state.currentFrame);
        }
      } else {
        streamingFrameProviderRef.current = null;
        playbackRef.current?.stopAll();
        prewarmFrameRef.current = null;
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
