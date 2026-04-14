/**
 * Hook to manage WebCodecs streaming playback lifecycle.
 *
 * When enabled, creates a streaming decode worker that runs mediabunny's
 * forward samples() generator for each visible video source. Decoded
 * ImageBitmaps are buffered and provided to the canvas render pipeline,
 * bypassing HTML5 <video> elements entirely.
 *
 * This is experimental — toggle via window.__DEBUG__?.setStreamingPlayback(true)
 */

import { useEffect, useRef, useCallback } from 'react';
import { usePlaybackStore } from '@/shared/state/playback';
import { createStreamingPlayback, type StreamingPlayback } from '../utils/streaming-playback';
import { STREAMING_PLAYBACK_ENABLED } from '../utils/preview-constants';
import { createLogger } from '@/shared/logging/logger';
import type { TimelineTrack, VideoItem } from '@/types/timeline';

const log = createLogger('StreamingPlaybackCtrl');

type PreviewRenderer = {
  setStreamingFrameProvider?: (
    provider: ((src: string, sourceTime: number) => ImageBitmap | null) | undefined,
  ) => void;
};

/** Collect src → startTimestamp for all video items visible at the given frame. */
function collectVisibleVideoSources(
  tracks: TimelineTrack[],
  timelineFrame: number,
  timelineFps: number,
): Map<string, number> {
  const sources = new Map<string, number>();

  for (const track of tracks) {
    for (const item of track.items) {
      if (item.type !== 'video' || !item.src) continue;
      const videoItem = item as VideoItem;
      const localFrame = timelineFrame - videoItem.from;
      if (localFrame < 0 || localFrame >= videoItem.durationInFrames) continue;

      const sourceFps = videoItem.sourceFps ?? timelineFps;
      const speed = videoItem.speed ?? 1;
      const sourceStart = videoItem.sourceStart ?? videoItem.trimStart ?? 0;
      const sourceTime = sourceStart / sourceFps + (localFrame / timelineFps) * speed;

      // Keep the earliest start time per source
      const existing = sources.get(videoItem.src);
      if (existing === undefined || sourceTime < existing) {
        sources.set(videoItem.src, sourceTime);
      }
    }
  }

  return sources;
}

interface UseStreamingPlaybackControllerParams {
  fps: number;
  combinedTracks: TimelineTrack[];
  scrubRendererRef: React.RefObject<PreviewRenderer | null>;
}

export function useStreamingPlaybackController({
  fps,
  combinedTracks,
  scrubRendererRef,
}: UseStreamingPlaybackControllerParams): void {
  const playbackRef = useRef<StreamingPlayback | null>(null);
  const enabledRef = useRef(STREAMING_PLAYBACK_ENABLED);
  const activeSourcesRef = useRef(new Set<string>());

  // Create/get the streaming playback instance
  const getPlayback = useCallback((): StreamingPlayback => {
    if (!playbackRef.current) {
      playbackRef.current = createStreamingPlayback();
    }
    return playbackRef.current;
  }, []);

  // Frame provider callback for the renderer
  const getStreamingFrame = useCallback((src: string, sourceTime: number): ImageBitmap | null => {
    if (!playbackRef.current) return null;
    return playbackRef.current.getFrame(src, sourceTime);
  }, []);

  // Subscribe to playback state changes
  useEffect(() => {
    const unsubscribe = usePlaybackStore.subscribe((state, prevState) => {
      if (!enabledRef.current) return;

      const wasPlaying = prevState.isPlaying;
      const isPlaying = state.isPlaying;

      if (isPlaying && !wasPlaying) {
        // Playback started — start streaming for visible video sources
        const playback = getPlayback();
        const currentFrame = state.currentFrame;
        const sources = collectVisibleVideoSources(combinedTracks, currentFrame, fps);

        log.info('Starting streaming playback', {
          frame: currentFrame,
          sources: sources.size,
        });

        for (const [src, startTime] of sources) {
          playback.startStream(src, startTime);
          activeSourcesRef.current.add(src);
        }

        // Set the frame provider on the renderer
        const renderer = scrubRendererRef.current;
        if (renderer?.setStreamingFrameProvider) {
          renderer.setStreamingFrameProvider(getStreamingFrame);
        }
      } else if (!isPlaying && wasPlaying) {
        // Playback stopped — stop all streams
        const playback = playbackRef.current;
        if (playback) {
          log.info('Stopping streaming playback', {
            metrics: playback.getMetrics(),
          });
          playback.stopAll();
          activeSourcesRef.current.clear();
        }

        // Clear the frame provider
        const renderer = scrubRendererRef.current;
        if (renderer?.setStreamingFrameProvider) {
          renderer.setStreamingFrameProvider(undefined);
        }
      }
    });

    return unsubscribe;
  }, [combinedTracks, fps, getPlayback, getStreamingFrame, scrubRendererRef]);

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
      log.info(`Streaming playback ${enabled ? 'enabled' : 'disabled'}`);

      if (!enabled) {
        // Stop any active streams
        const playback = playbackRef.current;
        if (playback) {
          playback.stopAll();
          activeSourcesRef.current.clear();
        }
        const renderer = scrubRendererRef.current;
        if (renderer?.setStreamingFrameProvider) {
          renderer.setStreamingFrameProvider(undefined);
        }
      }
    };

    debugApi.streamingPlaybackMetrics = () => {
      return playbackRef.current?.getMetrics() ?? null;
    };

    return () => {
      delete debugApi.setStreamingPlayback;
      delete debugApi.streamingPlaybackMetrics;
    };
  }, [scrubRendererRef]);
}
