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

/** How far ahead (in seconds) to look for upcoming video clips to pre-warm.
 *  5s gives the worker enough time to init new sources (~1-2s) and buffer
 *  frames before playback reaches them. */
const LOOKAHEAD_SECONDS = 5;

/**
 * Collect pre-warm targets: video items visible at the given frame,
 * plus upcoming clips within LOOKAHEAD_SECONDS that will need streams.
 */
function collectPrewarmTargets(
  tracks: TimelineTrack[],
  timelineFrame: number,
  timelineFps: number,
): Array<{ src: string; sourceTime: number; mediaId?: string }> {
  const targets: Array<{ src: string; sourceTime: number; mediaId?: string }> = [];
  const seen = new Set<string>();
  const lookaheadFrames = Math.round(LOOKAHEAD_SECONDS * timelineFps);

  for (const track of tracks) {
    for (const item of track.items) {
      if (item.type !== 'video') continue;
      const videoItem = item as VideoItem;

      // Skip clips that end before current frame
      const clipEnd = videoItem.from + videoItem.durationInFrames;
      if (clipEnd <= timelineFrame) continue;

      // Skip clips that start beyond the lookahead window
      if (videoItem.from > timelineFrame + lookaheadFrames) continue;

      const mediaId = videoItem.mediaId;
      const activeSrc = (mediaId ? blobUrlManager.get(mediaId) : null) ?? videoItem.src;
      if (!activeSrc || seen.has(activeSrc)) continue;
      seen.add(activeSrc);

      const sourceFps = videoItem.sourceFps ?? timelineFps;
      const speed = videoItem.speed ?? 1;
      const sourceStart = videoItem.sourceStart ?? videoItem.trimStart ?? 0;

      // For visible clips, compute source time at current frame.
      // For upcoming clips, start from their source beginning.
      const localFrame = Math.max(0, timelineFrame - videoItem.from);
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
  const lookaheadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const prewarmAtFrame = useCallback((frame: number, seekExisting = true) => {
    if (!enabledRef.current) return;
    if (frame === prewarmFrameRef.current) return;
    prewarmFrameRef.current = frame;

    const playback = getPlayback();
    const targets = collectPrewarmTargets(tracksRef.current, frame, fpsRef.current);
    for (const { src, sourceTime } of targets) {
      if (!playback.isStreaming(src)) {
        playback.startStream(src, sourceTime);
      } else if (seekExisting) {
        playback.seekStream(src, sourceTime);
      }
    }
  }, [getPlayback]);

  /** During playback, periodically scan for upcoming clips and start their
   *  decode streams early. Only starts NEW streams — existing ones keep running. */
  const runPlaybackLookahead = useCallback(() => {
    if (!enabledRef.current) return;
    const frame = usePlaybackStore.getState().currentFrame;
    const playback = getPlayback();
    const targets = collectPrewarmTargets(tracksRef.current, frame, fpsRef.current);
    for (const { src, sourceTime } of targets) {
      if (!playback.isStreaming(src)) {
        playback.startStream(src, sourceTime);
      }
    }
  }, [getPlayback]);

  // Subscribe to playback state: manage streaming lifecycle and expose provider via ref.
  // The render pump reads streamingFrameProviderRef and sets it on the renderer per-frame,
  // avoiding timing issues with renderer creation/destruction during re-renders.
  useEffect(() => {
    const initialState = usePlaybackStore.getState();

    // Activate provider immediately — it serves both playback and scrub.
    // During scrub, buffered streaming frames are used when available,
    // falling through to DOM video / mediabunny on miss.
    if (enabledRef.current) {
      streamingFrameProviderRef.current = getStreamingFrame;

      if (initialState.isPlaying) {
        getPlayback();
        log.info('Playback already active on mount, streaming provider activated');
      } else {
        prewarmAtFrame(initialState.currentFrame);
      }
    }

    const unsubscribe = usePlaybackStore.subscribe((state, prevState) => {
      if (!enabledRef.current) return;

      const wasPlaying = prevState.isPlaying;
      const isPlaying = state.isPlaying;

      if (isPlaying && !wasPlaying) {
        const playback = getPlayback();
        streamingFrameProviderRef.current = getStreamingFrame;
        prewarmFrameRef.current = null; // clear so next pause re-prewarms
        playback.enableIdleSweep();
        // Start periodic lookahead for upcoming clips during playback
        if (lookaheadTimerRef.current) clearInterval(lookaheadTimerRef.current);
        lookaheadTimerRef.current = setInterval(runPlaybackLookahead, 1000);
        log.info('Playback started, streaming provider activated');
      } else if (!isPlaying && wasPlaying) {
        if (lookaheadTimerRef.current) {
          clearInterval(lookaheadTimerRef.current);
          lookaheadTimerRef.current = null;
        }
        // Keep streamingFrameProviderRef set — scrub uses it too
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
        // User scrubbing while paused — start new streams but don't seek
        // active ones. Forward scrub keeps the buffer valid; backward
        // scrub / large jumps fall through to mediabunny on miss.
        const delta = state.currentFrame - prevState.currentFrame;
        const isLargeJump = Math.abs(delta) > fpsRef.current * 2;
        const isBackward = delta < 0;
        prewarmAtFrame(state.currentFrame, isLargeJump || isBackward);
      }
    });

    return () => {
      unsubscribe();
      streamingFrameProviderRef.current = null;
      if (lookaheadTimerRef.current) {
        clearInterval(lookaheadTimerRef.current);
        lookaheadTimerRef.current = null;
      }
    };
  }, [getPlayback, getStreamingFrame, prewarmAtFrame, runPlaybackLookahead]);

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
        streamingFrameProviderRef.current = getStreamingFrame;
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
        if (lookaheadTimerRef.current) {
          clearInterval(lookaheadTimerRef.current);
          lookaheadTimerRef.current = null;
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
  }, []);

  return { forceCanvasOverlay, streamingFrameProviderRef };
}
