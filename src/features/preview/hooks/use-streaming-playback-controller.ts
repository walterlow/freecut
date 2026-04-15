/**
 * Hook to manage WebCodecs streaming playback lifecycle for preview playback.
 *
 * Full-playback streaming is the default path. A transition-only rollback mode
 * remains available through the debug API for comparison and fallback.
 *
 * Toggle via window.__DEBUG__?.setStreamingPlaybackMode('all' | 'transitions')
 * between full-playback streaming and transition-only mode.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { usePlaybackStore } from '@/shared/state/playback';
import { createStreamingPlayback, type StreamingPlayback } from '@/features/preview/utils/streaming-playback';
import {
  DEFAULT_STREAMING_PLAYBACK_MODE,
  type StreamingPlaybackMode,
} from '@/features/preview/utils/preview-constants';
import { createLogger } from '@/shared/logging/logger';
import type { TimelineTrack, TimelineItem, VideoItem } from '@/types/timeline';
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager';
import { resolveProxyUrl } from '@/features/preview/deps/media-library-contract';
import type { ResolvedTransitionWindow } from '@/domain/timeline/transitions/transition-planner';
import type { PreviewStreamingAudioProvider } from '@/shared/state/preview-bridge';

const log = createLogger('StreamingPlaybackCtrl');

/** How far ahead (in seconds) to start streaming transition clips.
 *  The worker needs ~1-2s to init + buffer, so 3s provides headroom. */
const TRANSITION_PREWARM_SECONDS = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the best source URL for a video item (proxy when enabled). */
function resolveVideoSrc(item: VideoItem, useProxy: boolean): string | null {
  const mediaId = item.mediaId;
  const proxyUrl = useProxy && mediaId ? resolveProxyUrl(mediaId) : null;
  return proxyUrl ?? (mediaId ? blobUrlManager.get(mediaId) : null) ?? item.src;
}

/** Compute source time for a video item at a given timeline frame. */
function computeSourceTime(item: VideoItem, timelineFrame: number, timelineFps: number): number {
  const sourceFps = item.sourceFps ?? timelineFps;
  const speed = item.speed ?? 1;
  const sourceStart = item.sourceStart ?? item.trimStart ?? 0;
  const localFrame = Math.max(0, timelineFrame - item.from);
  return sourceStart / sourceFps + (localFrame / timelineFps) * speed;
}

interface TransitionPrewarmTarget {
  streamKey: string;
  src: string;
  sourceTime: number;
}

/**
 * Collect pre-warm targets for the fallback transition-only mode. Uses
 * transition windows for timing only, and finds the actual clips from the
 * raw timeline tracks (which have full item properties like mediaId, src,
 * sourceFps, etc.).
 */
function collectTransitionPrewarmTargets(
  transitionWindows: ReadonlyArray<ResolvedTransitionWindow<TimelineItem>>,
  tracks: TimelineTrack[],
  timelineFrame: number,
  timelineFps: number,
  useProxy: boolean,
): TransitionPrewarmTarget[] {
  const targets: TransitionPrewarmTarget[] = [];
  const seen = new Set<string>();
  const prewarmFrames = Math.round(TRANSITION_PREWARM_SECONDS * timelineFps);

  // Collect frame ranges of upcoming transitions
  const transitionRanges: Array<{ start: number; end: number }> = [];
  for (const tw of transitionWindows) {
    if (tw.endFrame <= timelineFrame) continue;
    if (tw.startFrame > timelineFrame + prewarmFrames) continue;
    transitionRanges.push({ start: tw.startFrame, end: tw.endFrame });
  }

  if (transitionRanges.length === 0) return targets;

  // Find video clips from the raw timeline that overlap any transition range
  for (const track of tracks) {
    for (const item of track.items) {
      if (item.type !== 'video') continue;
      const videoItem = item as VideoItem;
      const clipEnd = videoItem.from + videoItem.durationInFrames;

      const overlapsTransition = transitionRanges.some(
        (tr) => videoItem.from < tr.end && clipEnd > tr.start,
      );
      if (!overlapsTransition) continue;

      const src = resolveVideoSrc(videoItem, useProxy);
      const streamKey = videoItem.id;
      if (!src || seen.has(streamKey)) continue;
      seen.add(streamKey);

      const sourceTime = computeSourceTime(videoItem, timelineFrame, timelineFps);
      targets.push({ streamKey, src, sourceTime });
    }
  }

  return targets;
}

/**
 * Collect all visible video clips as playback pre-warm targets.
 */
function collectAllPrewarmTargets(
  tracks: TimelineTrack[],
  timelineFrame: number,
  timelineFps: number,
  useProxy: boolean,
): TransitionPrewarmTarget[] {
  const targets: TransitionPrewarmTarget[] = [];
  const seen = new Set<string>();
  const lookaheadFrames = Math.round(TRANSITION_PREWARM_SECONDS * timelineFps);

  for (const track of tracks) {
    for (const item of track.items) {
      if (item.type !== 'video') continue;
      const videoItem = item as VideoItem;
      const clipEnd = videoItem.from + videoItem.durationInFrames;
      if (clipEnd <= timelineFrame) continue;
      if (videoItem.from > timelineFrame + lookaheadFrames) continue;

      const src = resolveVideoSrc(videoItem, useProxy);
      const streamKey = videoItem.id;
      if (!src || seen.has(streamKey)) continue;
      seen.add(streamKey);

      const sourceTime = computeSourceTime(videoItem, timelineFrame, timelineFps);
      targets.push({ streamKey, src, sourceTime });
    }
  }

  return targets;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseStreamingPlaybackControllerParams {
  fps: number;
  combinedTracks: TimelineTrack[];
  playbackTransitionWindows: ReadonlyArray<ResolvedTransitionWindow<TimelineItem>>;
}

interface UseStreamingPlaybackControllerResult {
  /** Current streaming playback mode configuration. */
  streamingPlaybackMode: StreamingPlaybackMode;
  /** Whether the canvas overlay must be forced for streaming playback. */
  forceCanvasOverlay: boolean;
  /** Ref to the streaming frame provider function. */
  streamingFrameProviderRef: React.RefObject<((streamKey: string, src: string, sourceTime: number) => ImageBitmap | null) | null>;
  /** Stable audio provider backed by the active streaming playback session. */
  streamingAudioProvider: PreviewStreamingAudioProvider;
}

export function useStreamingPlaybackController({
  fps,
  combinedTracks,
  playbackTransitionWindows,
}: UseStreamingPlaybackControllerParams): UseStreamingPlaybackControllerResult {
  const playbackRef = useRef<StreamingPlayback | null>(null);
  /** Current streaming mode: full-playback streaming or transition-only rollback mode. */
  const [streamingPlaybackMode, setStreamingPlaybackModeState] = useState<StreamingPlaybackMode>(
    DEFAULT_STREAMING_PLAYBACK_MODE,
  );
  const modeRef = useRef<StreamingPlaybackMode>(streamingPlaybackMode);
  const [forceCanvasOverlay, setForceCanvasOverlay] = useState(false);
  const streamingFrameProviderRef = useRef<((streamKey: string, src: string, sourceTime: number) => ImageBitmap | null) | null>(null);

  const getPlayback = useCallback((): StreamingPlayback => {
    if (!playbackRef.current) {
      playbackRef.current = createStreamingPlayback();
    }
    return playbackRef.current;
  }, []);

  const getStreamingFrame = useCallback((streamKey: string, src: string, sourceTime: number): ImageBitmap | null => {
    if (!playbackRef.current) return null;
    return playbackRef.current.getFrame(streamKey, src, sourceTime);
  }, []);
  const streamingAudioProvider = useRef<PreviewStreamingAudioProvider>({
    getAudioChunks: (streamKey, startTimestamp, endTimestamp) => (
      playbackRef.current?.getAudioChunks(streamKey, startTimestamp, endTimestamp) ?? []
    ),
    getSourceInfo: (streamKey) => {
      const info = playbackRef.current?.getSourceInfo(streamKey) ?? null;
      return info ? { hasAudio: info.hasAudio } : null;
    },
    isStreaming: (streamKey) => playbackRef.current?.isStreaming(streamKey) ?? false,
  }).current;

  // Refs for latest values
  const tracksRef = useRef(combinedTracks);
  const fpsRef = useRef(fps);
  const useProxy = usePlaybackStore((s) => s.useProxy);
  const useProxyRef = useRef(useProxy);
  const transitionWindowsRef = useRef(playbackTransitionWindows);
  tracksRef.current = combinedTracks;
  fpsRef.current = fps;
  useProxyRef.current = useProxy;
  transitionWindowsRef.current = playbackTransitionWindows;

  const prewarmFrameRef = useRef<number | null>(null);
  const lookaheadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    modeRef.current = streamingPlaybackMode;
  }, [streamingPlaybackMode]);

  const syncOverlayMode = useCallback(() => {
    const isPlaying = usePlaybackStore.getState().isPlaying;
    setForceCanvasOverlay(isPlaying && modeRef.current === 'all');
  }, []);

  // Collect targets based on mode: full-playback streaming or transition-only mode.
  const getTargets = useCallback((frame: number) => {
    if (modeRef.current === 'all') {
      return collectAllPrewarmTargets(tracksRef.current, frame, fpsRef.current, useProxyRef.current);
    }
    return collectTransitionPrewarmTargets(
      transitionWindowsRef.current, tracksRef.current, frame, fpsRef.current, useProxyRef.current,
    );
  }, []);

  const prewarmAtFrame = useCallback((frame: number, seekExisting = true) => {
    if (frame === prewarmFrameRef.current) return;
    prewarmFrameRef.current = frame;

    const playback = getPlayback();
    const targets = getTargets(frame);
    for (const { streamKey, src, sourceTime } of targets) {
      if (!playback.isStreaming(streamKey)) {
        playback.startStream(streamKey, src, sourceTime);
      } else if (seekExisting) {
        playback.seekStream(streamKey, sourceTime);
      }
    }
  }, [getPlayback, getTargets]);

  /** During playback, scan for upcoming clips and keep stream positions advancing. */
  const runPlaybackLookahead = useCallback(() => {
    const state = usePlaybackStore.getState();
    const frame = state.currentFrame;
    const playback = getPlayback();

    // Start streams for upcoming playback clips, and keep existing
    // streams decoding ahead by sending position updates.
    const targets = getTargets(frame);
    for (const { streamKey, src, sourceTime } of targets) {
      if (!playback.isStreaming(streamKey)) {
        playback.startStream(streamKey, src, sourceTime);
      } else {
        playback.updatePosition(streamKey, sourceTime);
      }
    }

  }, [getPlayback, getTargets]);

  // Subscribe to playback state
  useEffect(() => {
    const initialState = usePlaybackStore.getState();

    streamingFrameProviderRef.current = getStreamingFrame;
    if (initialState.isPlaying) {
      getPlayback();
      syncOverlayMode();
      if (lookaheadTimerRef.current) clearInterval(lookaheadTimerRef.current);
      lookaheadTimerRef.current = setInterval(runPlaybackLookahead, 500);
    } else {
      prewarmAtFrame(initialState.currentFrame);
    }

    const unsubscribe = usePlaybackStore.subscribe((state, prevState) => {

      const wasPlaying = prevState.isPlaying;
      const isPlaying = state.isPlaying;

      if (isPlaying && !wasPlaying) {
        const playback = getPlayback();
        streamingFrameProviderRef.current = getStreamingFrame;
        prewarmFrameRef.current = null;
        playback.enableIdleSweep();
        syncOverlayMode();
        if (lookaheadTimerRef.current) clearInterval(lookaheadTimerRef.current);
        lookaheadTimerRef.current = setInterval(runPlaybackLookahead, 500);
        // Run immediately to check transition proximity
        runPlaybackLookahead();
        log.info('Playback started, streaming provider activated');
      } else if (!isPlaying && wasPlaying) {
        setForceCanvasOverlay(false);
        if (lookaheadTimerRef.current) {
          clearInterval(lookaheadTimerRef.current);
          lookaheadTimerRef.current = null;
        }
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
        prewarmAtFrame(state.currentFrame);
      } else if (!isPlaying && state.currentFrame !== prevState.currentFrame) {
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
  }, [getPlayback, getStreamingFrame, prewarmAtFrame, runPlaybackLookahead, syncOverlayMode]);

  // Restart streams when proxy toggle changes
  useEffect(() => {
    const playback = playbackRef.current;
    if (playback) {
      streamingFrameProviderRef.current = null;
      playback.stopAll();
      prewarmFrameRef.current = null;
      prewarmAtFrame(usePlaybackStore.getState().currentFrame);
      requestAnimationFrame(() => {
        streamingFrameProviderRef.current = getStreamingFrame;
      });
    }
  }, [useProxy, prewarmAtFrame, getStreamingFrame]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      playbackRef.current?.dispose();
      playbackRef.current = null;
    };
  }, []);

  // Debug toggle
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const debugApi = (window as unknown as Record<string, unknown>).__DEBUG__ as
      Record<string, unknown> | undefined;
    if (!debugApi) return;

    const setStreamingPlaybackMode = (mode: StreamingPlaybackMode) => {
      setStreamingPlaybackModeState(mode);
      modeRef.current = mode;
      log.info(`Streaming playback mode: ${mode}`);
      syncOverlayMode();

      const state = usePlaybackStore.getState();
      prewarmFrameRef.current = null;
      if (mode === 'all') {
        prewarmAtFrame(state.currentFrame);
      } else {
        playbackRef.current?.stopAll();
      }
    };

    debugApi.setStreamingPlaybackMode = setStreamingPlaybackMode;
    debugApi.setStreamingPlayback = (forceAll: boolean) => {
      setStreamingPlaybackMode(forceAll ? 'all' : 'transitions');
    };

    debugApi.streamingPlaybackMetrics = () => {
      return playbackRef.current?.getMetrics() ?? null;
    };

    return () => {
      delete debugApi.setStreamingPlaybackMode;
      delete debugApi.setStreamingPlayback;
      delete debugApi.streamingPlaybackMetrics;
    };
  }, [prewarmAtFrame, syncOverlayMode]);

  return {
    streamingPlaybackMode,
    forceCanvasOverlay,
    streamingFrameProviderRef,
    streamingAudioProvider,
  };
}
