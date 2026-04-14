/**
 * Hook to manage WebCodecs streaming playback lifecycle for transitions.
 *
 * Streaming decode only activates when the playhead approaches or is inside
 * a transition window. Regular playback uses DOM <video> elements — they're
 * lighter and handle audio, proxy toggling, and browser timing natively.
 *
 * During transitions, two clips must render simultaneously to a canvas.
 * The streaming worker pre-decodes both clips' frames so the transition
 * compositor can blend them without relying on DOM video timing.
 *
 * Toggle via window.__DEBUG__?.setStreamingPlayback(true) to force
 * streaming for ALL clips (original PoC behavior).
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { usePlaybackStore } from '@/shared/state/playback';
import { createStreamingPlayback, type StreamingPlayback } from '../utils/streaming-playback';
import { STREAMING_PLAYBACK_ENABLED } from '../utils/preview-constants';
import { createLogger } from '@/shared/logging/logger';
import type { TimelineTrack, TimelineItem, VideoItem } from '@/types/timeline';
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager';
import { resolveProxyUrl } from '../deps/media-library-contract';
import type { ResolvedTransitionWindow } from '@/domain/timeline/transitions/transition-planner';

const log = createLogger('StreamingPlaybackCtrl');

/** How far ahead (in seconds) to start streaming transition clips.
 *  The worker needs ~1-2s to init + buffer, so 3s provides headroom. */
const TRANSITION_PREWARM_SECONDS = 3;

/** How far ahead (in seconds) to force the canvas overlay before a transition.
 *  By this point the streaming buffers should be warm. */
const TRANSITION_OVERLAY_LEAD_SECONDS = 0.5;

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
  src: string;
  sourceTime: number;
  mediaId?: string;
}

/**
 * Collect pre-warm targets: only video clips that participate in transitions
 * within the lookahead window. For "force all" mode (debug toggle), collects
 * ALL visible video clips.
 */
function collectTransitionPrewarmTargets(
  transitionWindows: ReadonlyArray<ResolvedTransitionWindow<TimelineItem>>,
  timelineFrame: number,
  timelineFps: number,
  useProxy: boolean,
): TransitionPrewarmTarget[] {
  const targets: TransitionPrewarmTarget[] = [];
  const seen = new Set<string>();
  const prewarmFrames = Math.round(TRANSITION_PREWARM_SECONDS * timelineFps);

  for (const tw of transitionWindows) {
    // Skip transitions that ended before current frame
    if (tw.endFrame <= timelineFrame) continue;
    // Skip transitions beyond the prewarm window
    if (tw.startFrame > timelineFrame + prewarmFrames) continue;

    // Both clips participate in this transition
    for (const clip of [tw.leftClip, tw.rightClip]) {
      if (clip.type !== 'video') continue;
      const videoItem = clip as VideoItem;
      const src = resolveVideoSrc(videoItem, useProxy);
      if (!src || seen.has(src)) continue;
      seen.add(src);

      const sourceTime = computeSourceTime(videoItem, timelineFrame, timelineFps);
      targets.push({ src, sourceTime, mediaId: videoItem.mediaId });
    }
  }

  return targets;
}

/**
 * Collect ALL visible video clips as pre-warm targets (force-all mode).
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
      if (!src || seen.has(src)) continue;
      seen.add(src);

      const sourceTime = computeSourceTime(videoItem, timelineFrame, timelineFps);
      targets.push({ src, sourceTime, mediaId: videoItem.mediaId });
    }
  }

  return targets;
}

/** Check if a frame is within the overlay-lead window of any transition. */
function isFrameNearTransition(
  frame: number,
  windows: ReadonlyArray<ResolvedTransitionWindow<TimelineItem>>,
  leadFrames: number,
  cooldownFrames: number,
): boolean {
  for (const tw of windows) {
    if (frame >= tw.startFrame - leadFrames && frame < tw.endFrame + cooldownFrames) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseStreamingPlaybackControllerParams {
  fps: number;
  combinedTracks: TimelineTrack[];
  playbackTransitionWindows: ReadonlyArray<ResolvedTransitionWindow<TimelineItem>>;
  playbackTransitionCooldownFrames: number;
}

interface UseStreamingPlaybackControllerResult {
  /** Whether the canvas overlay must be forced (near a transition during playback). */
  forceCanvasOverlay: boolean;
  /** Ref to the streaming frame provider function. */
  streamingFrameProviderRef: React.RefObject<((src: string, sourceTime: number, mediaId?: string) => ImageBitmap | null) | null>;
}

export function useStreamingPlaybackController({
  fps,
  combinedTracks,
  playbackTransitionWindows,
  playbackTransitionCooldownFrames,
}: UseStreamingPlaybackControllerParams): UseStreamingPlaybackControllerResult {
  const playbackRef = useRef<StreamingPlayback | null>(null);
  /** When true, stream ALL clips (debug toggle). When false, only transition clips. */
  const forceAllRef = useRef(STREAMING_PLAYBACK_ENABLED);
  const [forceCanvasOverlay, setForceCanvasOverlay] = useState(false);
  const streamingFrameProviderRef = useRef<((src: string, sourceTime: number, mediaId?: string) => ImageBitmap | null) | null>(null);

  const getPlayback = useCallback((): StreamingPlayback => {
    if (!playbackRef.current) {
      playbackRef.current = createStreamingPlayback();
    }
    return playbackRef.current;
  }, []);

  const getStreamingFrame = useCallback((src: string, sourceTime: number, mediaId?: string): ImageBitmap | null => {
    if (!playbackRef.current) return null;
    return playbackRef.current.getFrame(src, sourceTime, mediaId);
  }, []);

  // Refs for latest values
  const tracksRef = useRef(combinedTracks);
  const fpsRef = useRef(fps);
  const useProxy = usePlaybackStore((s) => s.useProxy);
  const useProxyRef = useRef(useProxy);
  const transitionWindowsRef = useRef(playbackTransitionWindows);
  const cooldownFramesRef = useRef(playbackTransitionCooldownFrames);
  tracksRef.current = combinedTracks;
  fpsRef.current = fps;
  useProxyRef.current = useProxy;
  transitionWindowsRef.current = playbackTransitionWindows;
  cooldownFramesRef.current = playbackTransitionCooldownFrames;

  const prewarmFrameRef = useRef<number | null>(null);
  const lookaheadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Collect targets based on mode: transition-only or force-all
  const getTargets = useCallback((frame: number) => {
    if (forceAllRef.current) {
      return collectAllPrewarmTargets(tracksRef.current, frame, fpsRef.current, useProxyRef.current);
    }
    return collectTransitionPrewarmTargets(
      transitionWindowsRef.current, frame, fpsRef.current, useProxyRef.current,
    );
  }, []);

  const prewarmAtFrame = useCallback((frame: number, seekExisting = true) => {
    if (frame === prewarmFrameRef.current) return;
    prewarmFrameRef.current = frame;

    const playback = getPlayback();
    const targets = getTargets(frame);
    for (const { src, sourceTime } of targets) {
      if (!playback.isStreaming(src)) {
        playback.startStream(src, sourceTime);
      } else if (seekExisting) {
        playback.seekStream(src, sourceTime);
      }
    }
  }, [getPlayback, getTargets]);

  /** During playback, scan for upcoming transition clips and manage overlay. */
  const runPlaybackLookahead = useCallback(() => {
    const state = usePlaybackStore.getState();
    const frame = state.currentFrame;
    const playback = getPlayback();

    // Start streams for upcoming transition clips
    const targets = getTargets(frame);
    for (const { src, sourceTime } of targets) {
      if (!playback.isStreaming(src)) {
        playback.startStream(src, sourceTime);
      }
    }

    // Toggle canvas overlay based on proximity to transitions
    if (!forceAllRef.current) {
      const overlayLeadFrames = Math.round(TRANSITION_OVERLAY_LEAD_SECONDS * fpsRef.current);
      const nearTransition = isFrameNearTransition(
        frame, transitionWindowsRef.current, overlayLeadFrames, cooldownFramesRef.current,
      );
      setForceCanvasOverlay(nearTransition);
    }
  }, [getPlayback, getTargets]);

  // Subscribe to playback state
  useEffect(() => {
    const initialState = usePlaybackStore.getState();

    streamingFrameProviderRef.current = getStreamingFrame;
    if (initialState.isPlaying) {
      getPlayback();
      if (forceAllRef.current) setForceCanvasOverlay(true);
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
        if (forceAllRef.current) setForceCanvasOverlay(true);
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
  }, [getPlayback, getStreamingFrame, prewarmAtFrame, runPlaybackLookahead]);

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

    debugApi.setStreamingPlayback = (forceAll: boolean) => {
      forceAllRef.current = forceAll;
      log.info(`Streaming playback: ${forceAll ? 'force all clips' : 'transitions only'}`);

      if (forceAll) {
        const state = usePlaybackStore.getState();
        if (state.isPlaying) setForceCanvasOverlay(true);
        prewarmFrameRef.current = null;
        prewarmAtFrame(state.currentFrame);
      } else {
        setForceCanvasOverlay(false);
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
