/**
 * Hook to manage WebCodecs streaming playback lifecycle for preview playback.
 *
 * Full-playback streaming is the only preview playback path.
 */

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { usePlaybackStore } from '@/shared/state/playback';
import { createStreamingPlayback, type StreamingPlayback } from '@/features/preview/utils/streaming-playback';
import { createMainThreadAudioSource, type MainThreadAudioSource } from '@/features/preview/utils/main-thread-audio-source';
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
const PLAYBACK_LOOKAHEAD_INTERVAL_MS = 150;
const MAIN_THREAD_AUDIO_RESYNC_THRESHOLD_SECONDS = 0.35;

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
  const mainThreadAudioRef = useRef<MainThreadAudioSource | null>(null);
  /** Stream keys that have an active main-thread audio source. */
  const mainThreadAudioKeysRef = useRef(new Set<string>());
  const mainThreadAudioTargetTimesRef = useRef(new Map<string, number>());
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
    if (!mainThreadAudioRef.current) {
      mainThreadAudioRef.current = createMainThreadAudioSource({
        pushAudioChunk: (streamKey, chunk) => playbackRef.current?.pushAudioChunk(streamKey, chunk),
        getStreamGeneration: (streamKey) => playbackRef.current?.getStreamGeneration(streamKey) ?? -1,
      });
    }
    mainThreadAudioRef.current.warmup();
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
  /** Resolve the stream key that carries audio for an item.  When the primary
   *  stream has no audio (e.g. proxy files strip audio), fall back to the
   *  alternate stream which points at the original file. */
  const getAudioStreamKey = useCallback((itemId: string): string => {
    const primaryKey = getResolvedStreamKey(itemId);
    const primaryInfo = playbackRef.current?.getSourceInfo(primaryKey);
    if (primaryInfo && !primaryInfo.hasAudio) {
      const alternateKey = alternateStreamKeyByItemRef.current.get(itemId);
      if (alternateKey) {
        const alternateInfo = playbackRef.current?.getSourceInfo(alternateKey);
        if (alternateInfo?.hasAudio) return alternateKey;
      }
    }
    return primaryKey;
  }, [getResolvedStreamKey]);

  const streamingAudioProvider = useRef<PreviewStreamingAudioProvider>({
    getAudioChunks: (streamKey: string, startTimestamp: number, endTimestamp: number) => {
      const audioKey = getAudioStreamKey(streamKey);
      return playbackRef.current?.getAudioChunks(audioKey, startTimestamp, endTimestamp) ?? [];
    },
    getSourceInfo: (streamKey: string) => {
      const audioKey = getAudioStreamKey(streamKey);
      const info = playbackRef.current?.getSourceInfo(audioKey) ?? null;
      return info ? { hasAudio: info.hasAudio } : null;
    },
    isStreaming: (streamKey: string) => {
      const audioKey = getAudioStreamKey(streamKey);
      return playbackRef.current?.isStreaming(audioKey) ?? false;
    },
  }).current;

  // Refs for latest values
  const tracksRef = useRef(combinedTracks);
  const fpsRef = useRef(fps);
  const useProxy = usePlaybackStore((s) => s.useProxy);
  const useProxyRef = useRef(useProxy);
  const videoItemsById = useMemo(() => {
    const byId = new Map<string, VideoItem>();
    for (const track of combinedTracks) {
      for (const item of track.items) {
        if (item.type === 'video') {
          byId.set(item.id, item as VideoItem);
        }
      }
    }
    return byId;
  }, [combinedTracks]);
  const videoItemsByIdRef = useRef(videoItemsById);
  tracksRef.current = combinedTracks;
  fpsRef.current = fps;
  useProxyRef.current = useProxy;
  videoItemsByIdRef.current = videoItemsById;

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

  const prunePausedStreams = useCallback((frame: number) => {
    const playback = playbackRef.current;
    if (!playback) return;

    const keepKeys = new Set<string>([
      ...getTargets(frame).map((target) => target.streamKey),
      ...getAlternateTargets(frame).map((target) => target.streamKey),
    ]);

    for (const [streamKey] of streamSrcByKeyRef.current) {
      if (keepKeys.has(streamKey)) continue;
      playback.stopStream(streamKey);
      streamSrcByKeyRef.current.delete(streamKey);
      if (mainThreadAudioKeysRef.current.has(streamKey)) {
        mainThreadAudioRef.current?.stop(streamKey);
        mainThreadAudioKeysRef.current.delete(streamKey);
      }
      mainThreadAudioTargetTimesRef.current.delete(streamKey);
    }

    for (const [itemId, streamKey] of desiredStreamKeyByItemRef.current) {
      if (!keepKeys.has(streamKey)) desiredStreamKeyByItemRef.current.delete(itemId);
    }
    for (const [itemId, streamKey] of alternateStreamKeyByItemRef.current) {
      if (!keepKeys.has(streamKey)) alternateStreamKeyByItemRef.current.delete(itemId);
    }
    for (const [itemId, streamKey] of activeStreamKeyByItemRef.current) {
      if (!keepKeys.has(streamKey)) activeStreamKeyByItemRef.current.delete(itemId);
    }
  }, [getAlternateTargets, getTargets]);

  /** Helper: compute source time for an item at a frame. */
  const computeSourceTimeForItem = useCallback((itemId: string, frame: number): number | null => {
    const item = videoItemsByIdRef.current.get(itemId);
    if (item) return computeSourceTime(item, frame, fpsRef.current);
    return null;
  }, []);

  /** Check each active stream and start main-thread audio decoding for streams
   *  whose worker reports hasAudio=false (e.g. proxy files or unsupported codecs).
   *  Uses the original file URL (alternate src) as the audio source. */
  const syncMainThreadAudio = useCallback((frame: number) => {
    const playback = playbackRef.current;
    const mtAudio = mainThreadAudioRef.current;
    if (!playback || !mtAudio) return;

    for (const [itemId, streamKey] of desiredStreamKeyByItemRef.current) {
      const primaryInfo = playback.getSourceInfo(streamKey);
      const alternateKey = alternateStreamKeyByItemRef.current.get(itemId);
      const alternateInfo = alternateKey ? playback.getSourceInfo(alternateKey) : null;

      // Prefer worker-decoded audio whenever either stream can already supply it.
      // The main-thread fallback is only for cases where neither worker stream
      // has usable audio.
      if (primaryInfo?.hasAudio || alternateInfo?.hasAudio) {
        if (mainThreadAudioKeysRef.current.has(streamKey)) {
          mtAudio.stop(streamKey);
          mainThreadAudioKeysRef.current.delete(streamKey);
          mainThreadAudioTargetTimesRef.current.delete(streamKey);
        }
        continue;
      }

      if (mainThreadAudioKeysRef.current.has(streamKey)) {
        const sourceTime = computeSourceTimeForItem(itemId, frame);
        if (sourceTime !== null) {
          const previousTargetTime = mainThreadAudioTargetTimesRef.current.get(streamKey);
          if (
            previousTargetTime === undefined
            || Math.abs(sourceTime - previousTargetTime) > MAIN_THREAD_AUDIO_RESYNC_THRESHOLD_SECONDS
          ) {
            mtAudio.seek(streamKey, sourceTime);
          } else {
            mtAudio.updatePosition(streamKey, sourceTime);
          }
          mainThreadAudioTargetTimesRef.current.set(streamKey, sourceTime);
        }
        continue;
      }

      // Wait until the worker has reported source info before deciding it truly
      // cannot supply audio.
      if (!primaryInfo) continue;

      // Worker can't decode audio — find the original file's src for audio
      const audioSrc = alternateKey
        ? streamSrcByKeyRef.current.get(alternateKey)
        : streamSrcByKeyRef.current.get(streamKey);
      if (!audioSrc) continue;

      const sourceTime = computeSourceTimeForItem(itemId, frame);
      if (sourceTime === null) continue;

      // Mark hasAudio=true on the primary stream so the scheduler knows audio is available
      playback.setSourceHasAudio(streamKey, true);
      mainThreadAudioKeysRef.current.add(streamKey);
      mainThreadAudioTargetTimesRef.current.set(streamKey, sourceTime);
      mtAudio.start(streamKey, audioSrc, sourceTime);
      log.info('Started main-thread audio decode', { streamKey: streamKey.substring(0, 20), audioSrc: audioSrc.substring(0, 40) });
    }
  }, [computeSourceTimeForItem]);

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
    syncMainThreadAudio(frame);

  }, [getPlayback, getTargets, markDesiredStream, prewarmAlternateAtFrame, syncMainThreadAudio]);

  // Subscribe to playback state
  useEffect(() => {
    const initialState = usePlaybackStore.getState();

    streamingFrameProviderRef.current = getStreamingFrame;
    if (initialState.isPlaying) {
      getPlayback();
      syncOverlayMode();
      if (lookaheadTimerRef.current) clearInterval(lookaheadTimerRef.current);
      lookaheadTimerRef.current = setInterval(runPlaybackLookahead, PLAYBACK_LOOKAHEAD_INTERVAL_MS);
      prewarmAlternateAtFrame(initialState.currentFrame);
      syncMainThreadAudio(initialState.currentFrame);
    } else {
      prewarmAtFrame(initialState.currentFrame);
      prewarmAlternateAtFrame(initialState.currentFrame);
      syncMainThreadAudio(initialState.currentFrame);
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
        lookaheadTimerRef.current = setInterval(runPlaybackLookahead, PLAYBACK_LOOKAHEAD_INTERVAL_MS);
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
          playback.disableIdleSweep();
          const metrics = playback.getMetrics();
          log.info('Playback stopped', {
            received: metrics.totalFramesReceived,
            drawn: metrics.totalFramesDrawn,
            missed: metrics.totalFramesMissed,
            audioChunksReceived: metrics.totalAudioChunksReceived,
            audioStartupLastMs: metrics.audioStartupLastMs,
            audioStartupAvgMs: metrics.audioStartupAvgMs,
            audioSeekLastMs: metrics.audioSeekLastMs,
            audioSeekAvgMs: metrics.audioSeekAvgMs,
            pendingAudioWarmups: metrics.pendingAudioWarmups,
          });
        }
        prewarmAtFrame(state.currentFrame, false);
        prewarmAlternateAtFrame(state.currentFrame);
        prunePausedStreams(state.currentFrame);
        syncMainThreadAudio(state.currentFrame);
      } else if (!isPlaying && state.currentFrame !== prevState.currentFrame) {
        const delta = state.currentFrame - prevState.currentFrame;
        const isLargeJump = Math.abs(delta) > fpsRef.current * 2;
        const isBackward = delta < 0;
        prewarmAtFrame(state.currentFrame, isLargeJump || isBackward);
        prewarmAlternateAtFrame(state.currentFrame);
        prunePausedStreams(state.currentFrame);
        syncMainThreadAudio(state.currentFrame);
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
      mainThreadAudioTargetTimesRef.current.clear();
    };
  }, [clearStreamMappings, getPlayback, getStreamingFrame, prewarmAlternateAtFrame, prewarmAtFrame, prunePausedStreams, runPlaybackLookahead, syncMainThreadAudio, syncOverlayMode]);

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
      mainThreadAudioRef.current?.dispose();
      mainThreadAudioRef.current = null;
      mainThreadAudioKeysRef.current.clear();
      mainThreadAudioTargetTimesRef.current.clear();
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
