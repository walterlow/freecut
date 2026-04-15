/**
 * Hook to manage WebCodecs streaming playback lifecycle for preview playback.
 *
 * Full-playback streaming is the only preview playback path.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { usePlaybackStore } from '@/shared/state/playback';
import { createStreamingPlayback, type StreamingPlayback } from '@/features/preview/utils/streaming-playback';
import { createLogger } from '@/shared/logging/logger';
import type { TimelineTrack, VideoItem } from '@/types/timeline';
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager';
import { resolveProxyUrl } from '@/features/preview/deps/media-library-contract';
import type { PreviewStreamingAudioProvider } from '@/shared/state/preview-bridge';

const log = createLogger('StreamingPlaybackCtrl');

/** How far ahead (in seconds) to start streaming playback clips.
 *  The worker needs ~1-2s to init + buffer, so 3s provides headroom. */
const TRANSITION_PREWARM_SECONDS = 3;
const STREAM_KEY_SEPARATOR = '::';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the best source URL for a video item (proxy when enabled). */
function resolveOriginalVideoSrc(item: VideoItem): string | null {
  return (item.mediaId ? blobUrlManager.get(item.mediaId) : null) ?? item.src;
}

function resolveProxyVideoSrc(item: VideoItem): string | null {
  return item.mediaId ? resolveProxyUrl(item.mediaId) : null;
}

function resolveVideoSrc(item: VideoItem, useProxy: boolean): string | null {
  return (useProxy ? resolveProxyVideoSrc(item) : null) ?? resolveOriginalVideoSrc(item);
}

function resolveAlternateVideoSrc(item: VideoItem, useProxy: boolean): string | null {
  const alternateSrc = useProxy ? resolveOriginalVideoSrc(item) : resolveProxyVideoSrc(item);
  const primarySrc = resolveVideoSrc(item, useProxy);
  if (!alternateSrc || alternateSrc === primarySrc) {
    return null;
  }
  return alternateSrc;
}

function buildStreamKey(itemId: string, src: string): string {
  return `${itemId}${STREAM_KEY_SEPARATOR}${src}`;
}

/** Compute source time for a video item at a given timeline frame. */
function computeSourceTime(item: VideoItem, timelineFrame: number, timelineFps: number): number {
  const sourceFps = item.sourceFps ?? timelineFps;
  const speed = item.speed ?? 1;
  const sourceStart = item.sourceStart ?? item.trimStart ?? 0;
  const localFrame = Math.max(0, timelineFrame - item.from);
  return sourceStart / sourceFps + (localFrame / timelineFps) * speed;
}

interface PlaybackPrewarmTarget {
  itemId: string;
  streamKey: string;
  src: string;
  sourceTime: number;
}

/**
 * Collect all visible video clips as playback pre-warm targets.
 */
function collectAllPrewarmTargets(
  tracks: TimelineTrack[],
  timelineFrame: number,
  timelineFps: number,
  useProxy: boolean,
): PlaybackPrewarmTarget[] {
  const targets: PlaybackPrewarmTarget[] = [];
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
      const streamKey = src ? buildStreamKey(videoItem.id, src) : videoItem.id;
      if (!src || seen.has(streamKey)) continue;
      seen.add(streamKey);

      const sourceTime = computeSourceTime(videoItem, timelineFrame, timelineFps);
      targets.push({ itemId: videoItem.id, streamKey, src, sourceTime });
    }
  }

  return targets;
}

function collectAlternateActiveTargets(
  tracks: TimelineTrack[],
  timelineFrame: number,
  timelineFps: number,
  useProxy: boolean,
): PlaybackPrewarmTarget[] {
  const targets: PlaybackPrewarmTarget[] = [];

  for (const track of tracks) {
    for (const item of track.items) {
      if (item.type !== 'video') continue;
      const videoItem = item as VideoItem;
      const clipEnd = videoItem.from + videoItem.durationInFrames;
      if (videoItem.from > timelineFrame || clipEnd <= timelineFrame) continue;

      const src = resolveAlternateVideoSrc(videoItem, useProxy);
      if (!src) continue;

      const sourceTime = computeSourceTime(videoItem, timelineFrame, timelineFps);
      targets.push({
        itemId: videoItem.id,
        streamKey: buildStreamKey(videoItem.id, src),
        src,
        sourceTime,
      });
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
}

interface UseStreamingPlaybackControllerResult {
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
}: UseStreamingPlaybackControllerParams): UseStreamingPlaybackControllerResult {
  const playbackRef = useRef<StreamingPlayback | null>(null);
  const [forceCanvasOverlay, setForceCanvasOverlay] = useState(false);
  const streamingFrameProviderRef = useRef<((streamKey: string, src: string, sourceTime: number) => ImageBitmap | null) | null>(null);
  const activeStreamKeyByItemRef = useRef(new Map<string, string>());
  const desiredStreamKeyByItemRef = useRef(new Map<string, string>());
  const alternateStreamKeyByItemRef = useRef(new Map<string, string>());
  const streamSrcByKeyRef = useRef(new Map<string, string>());

  const getPlayback = useCallback((): StreamingPlayback => {
    if (!playbackRef.current) {
      playbackRef.current = createStreamingPlayback();
    }
    return playbackRef.current;
  }, []);

  const clearStreamMappings = useCallback(() => {
    activeStreamKeyByItemRef.current.clear();
    desiredStreamKeyByItemRef.current.clear();
    alternateStreamKeyByItemRef.current.clear();
    streamSrcByKeyRef.current.clear();
  }, []);

  const getResolvedStreamKey = useCallback((itemId: string): string => {
    return (
      activeStreamKeyByItemRef.current.get(itemId)
      ?? desiredStreamKeyByItemRef.current.get(itemId)
      ?? itemId
    );
  }, []);

  const getResolvedStreamSrc = useCallback((itemId: string, fallbackSrc?: string): string | null => {
    const resolvedKey = getResolvedStreamKey(itemId);
    return streamSrcByKeyRef.current.get(resolvedKey) ?? fallbackSrc ?? null;
  }, [getResolvedStreamKey]);

  const markDesiredStream = useCallback((itemId: string, streamKey: string, src: string) => {
    desiredStreamKeyByItemRef.current.set(itemId, streamKey);
    streamSrcByKeyRef.current.set(streamKey, src);
    if (!activeStreamKeyByItemRef.current.has(itemId)) {
      activeStreamKeyByItemRef.current.set(itemId, streamKey);
    }
  }, []);

  const promoteActiveStream = useCallback((itemId: string, nextStreamKey: string) => {
    const playback = playbackRef.current;
    const previousStreamKey = activeStreamKeyByItemRef.current.get(itemId);
    if (previousStreamKey === nextStreamKey) {
      return;
    }

    activeStreamKeyByItemRef.current.set(itemId, nextStreamKey);
    if (playback && previousStreamKey) {
      playback.stopStream(previousStreamKey);
      streamSrcByKeyRef.current.delete(previousStreamKey);
    }
  }, []);

  const getStreamingFrame = useCallback((streamKey: string, src: string, sourceTime: number): ImageBitmap | null => {
    const playback = playbackRef.current;
    if (!playback) return null;

    const itemId = streamKey;
    const desiredStreamKey = desiredStreamKeyByItemRef.current.get(itemId);
    if (desiredStreamKey) {
      const activeStreamKey = activeStreamKeyByItemRef.current.get(itemId);
      if (activeStreamKey && activeStreamKey !== desiredStreamKey) {
        const desiredSrc = streamSrcByKeyRef.current.get(desiredStreamKey) ?? src;
        const warmedFrame = playback.getFrame(desiredStreamKey, desiredSrc, sourceTime);
        if (warmedFrame) {
          promoteActiveStream(itemId, desiredStreamKey);
          return warmedFrame;
        }
      }
    }

    const resolvedStreamKey = getResolvedStreamKey(itemId);
    const resolvedSrc = getResolvedStreamSrc(itemId, src) ?? src;
    streamSrcByKeyRef.current.set(resolvedStreamKey, resolvedSrc);
    return playback.getFrame(resolvedStreamKey, resolvedSrc, sourceTime);
  }, [getResolvedStreamKey, getResolvedStreamSrc, promoteActiveStream]);
  const streamingAudioProvider = useRef<PreviewStreamingAudioProvider>({
    getAudioChunks: (streamKey, startTimestamp, endTimestamp) => {
      const resolvedStreamKey = getResolvedStreamKey(streamKey);
      return playbackRef.current?.getAudioChunks(resolvedStreamKey, startTimestamp, endTimestamp) ?? [];
    },
    getSourceInfo: (streamKey) => {
      const resolvedStreamKey = getResolvedStreamKey(streamKey);
      const info = playbackRef.current?.getSourceInfo(resolvedStreamKey) ?? null;
      return info ? { hasAudio: info.hasAudio } : null;
    },
    isStreaming: (streamKey) => {
      const resolvedStreamKey = getResolvedStreamKey(streamKey);
      return playbackRef.current?.isStreaming(resolvedStreamKey) ?? false;
    },
  }).current;

  // Refs for latest values
  const tracksRef = useRef(combinedTracks);
  const fpsRef = useRef(fps);
  const useProxy = usePlaybackStore((s) => s.useProxy);
  const useProxyRef = useRef(useProxy);
  tracksRef.current = combinedTracks;
  fpsRef.current = fps;
  useProxyRef.current = useProxy;

  const prewarmFrameRef = useRef<number | null>(null);
  const lookaheadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const syncOverlayMode = useCallback(() => {
    const isPlaying = usePlaybackStore.getState().isPlaying;
    setForceCanvasOverlay(isPlaying);
  }, []);

  const getTargets = useCallback((frame: number) => {
    return collectAllPrewarmTargets(tracksRef.current, frame, fpsRef.current, useProxyRef.current);
  }, []);

  const getAlternateTargets = useCallback((frame: number) => {
    return collectAlternateActiveTargets(tracksRef.current, frame, fpsRef.current, useProxyRef.current);
  }, []);

  const prewarmAtFrame = useCallback((frame: number, seekExisting = true) => {
    if (frame === prewarmFrameRef.current) return;
    prewarmFrameRef.current = frame;

    const playback = getPlayback();
    const targets = getTargets(frame);
    for (const { itemId, streamKey, src, sourceTime } of targets) {
      markDesiredStream(itemId, streamKey, src);
      if (!playback.isStreaming(streamKey)) {
        playback.startStream(streamKey, src, sourceTime);
      } else if (seekExisting) {
        playback.seekStream(streamKey, sourceTime);
      }
    }
  }, [getPlayback, getTargets, markDesiredStream]);

  const prewarmAlternateAtFrame = useCallback((frame: number) => {
    const playback = getPlayback();
    const targets = getAlternateTargets(frame);
    const nextAlternateKeysByItem = new Map<string, string>();

    for (const { itemId, streamKey, src, sourceTime } of targets) {
      nextAlternateKeysByItem.set(itemId, streamKey);
      streamSrcByKeyRef.current.set(streamKey, src);

      const previousAlternateKey = alternateStreamKeyByItemRef.current.get(itemId);
      if (previousAlternateKey && previousAlternateKey !== streamKey) {
        const activeStreamKey = activeStreamKeyByItemRef.current.get(itemId);
        const desiredStreamKey = desiredStreamKeyByItemRef.current.get(itemId);
        if (previousAlternateKey !== activeStreamKey && previousAlternateKey !== desiredStreamKey) {
          playback.stopStream(previousAlternateKey);
          streamSrcByKeyRef.current.delete(previousAlternateKey);
        }
      }

      if (!playback.isStreaming(streamKey)) {
        playback.startStream(streamKey, src, sourceTime);
      } else {
        playback.updatePosition(streamKey, sourceTime);
      }
    }

    for (const [itemId, previousAlternateKey] of alternateStreamKeyByItemRef.current) {
      if (nextAlternateKeysByItem.get(itemId) === previousAlternateKey) continue;
      const activeStreamKey = activeStreamKeyByItemRef.current.get(itemId);
      const desiredStreamKey = desiredStreamKeyByItemRef.current.get(itemId);
      if (previousAlternateKey !== activeStreamKey && previousAlternateKey !== desiredStreamKey) {
        playback.stopStream(previousAlternateKey);
        streamSrcByKeyRef.current.delete(previousAlternateKey);
      }
    }

    alternateStreamKeyByItemRef.current = nextAlternateKeysByItem;
  }, [getAlternateTargets, getPlayback]);

  /** During playback, scan for upcoming clips and keep stream positions advancing. */
  const runPlaybackLookahead = useCallback(() => {
    const state = usePlaybackStore.getState();
    const frame = state.currentFrame;
    const playback = getPlayback();

    // Start streams for upcoming playback clips, and keep existing
    // streams decoding ahead by sending position updates.
    const targets = getTargets(frame);
    for (const { itemId, streamKey, src, sourceTime } of targets) {
      markDesiredStream(itemId, streamKey, src);
      if (!playback.isStreaming(streamKey)) {
        playback.startStream(streamKey, src, sourceTime);
      } else {
        playback.updatePosition(streamKey, sourceTime);
      }
    }

    prewarmAlternateAtFrame(frame);

  }, [getPlayback, getTargets, markDesiredStream, prewarmAlternateAtFrame]);

  // Subscribe to playback state
  useEffect(() => {
    const initialState = usePlaybackStore.getState();

    streamingFrameProviderRef.current = getStreamingFrame;
    if (initialState.isPlaying) {
      getPlayback();
      syncOverlayMode();
      if (lookaheadTimerRef.current) clearInterval(lookaheadTimerRef.current);
      lookaheadTimerRef.current = setInterval(runPlaybackLookahead, 500);
      prewarmAlternateAtFrame(initialState.currentFrame);
    } else {
      prewarmAtFrame(initialState.currentFrame);
      prewarmAlternateAtFrame(initialState.currentFrame);
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
        log.info('Playback started, streaming handoff path active');
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
        clearStreamMappings();
        prewarmAtFrame(state.currentFrame);
        prewarmAlternateAtFrame(state.currentFrame);
      } else if (!isPlaying && state.currentFrame !== prevState.currentFrame) {
        const delta = state.currentFrame - prevState.currentFrame;
        const isLargeJump = Math.abs(delta) > fpsRef.current * 2;
        const isBackward = delta < 0;
        prewarmAtFrame(state.currentFrame, isLargeJump || isBackward);
        prewarmAlternateAtFrame(state.currentFrame);
      }
    });

    return () => {
      unsubscribe();
      streamingFrameProviderRef.current = null;
      if (lookaheadTimerRef.current) {
        clearInterval(lookaheadTimerRef.current);
        lookaheadTimerRef.current = null;
      }
      clearStreamMappings();
    };
  }, [clearStreamMappings, getPlayback, getStreamingFrame, prewarmAlternateAtFrame, prewarmAtFrame, runPlaybackLookahead, syncOverlayMode]);

  // Refresh desired and alternate stream candidates when proxy preference changes.
  useEffect(() => {
    if (playbackRef.current) {
      prewarmFrameRef.current = null;
      prewarmAtFrame(usePlaybackStore.getState().currentFrame);
      prewarmAlternateAtFrame(usePlaybackStore.getState().currentFrame);
    }
  }, [useProxy, prewarmAlternateAtFrame, prewarmAtFrame]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      playbackRef.current?.dispose();
      playbackRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const debugApi = (window as unknown as Record<string, unknown>).__DEBUG__ as
      Record<string, unknown> | undefined;
    if (!debugApi) return;

    debugApi.streamingPlaybackMetrics = () => {
      return playbackRef.current?.getMetrics() ?? null;
    };

    return () => {
      delete debugApi.streamingPlaybackMetrics;
    };
  }, [prewarmAtFrame, syncOverlayMode]);

  return {
    forceCanvasOverlay,
    streamingFrameProviderRef,
    streamingAudioProvider,
  };
}
