import React, { useEffect, useRef } from 'react';
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge';
import { createStreamingPlaybackAudioScheduler } from '@/features/composition-runtime/deps/streaming-playback-audio-scheduler';
import { getAudioTargetTimeSeconds } from '../utils/video-timing';
import {
  createPreviewClipAudioGraph,
  rampPreviewClipEq,
  rampPreviewClipGain,
  type PreviewClipAudioGraph,
} from '../utils/preview-audio-graph';
import type { AudioPlaybackProps } from './audio-playback-props';
import { useAudioPlaybackState } from './hooks/use-audio-playback-state';

interface StreamingPlaybackBufferedAudioProps extends AudioPlaybackProps {
  streamKey: string;
  sourceStartOffsetSec?: number;
  fallback: React.ReactNode;
}

export const StreamingPlaybackBufferedAudio: React.FC<StreamingPlaybackBufferedAudioProps> = React.memo(({
  streamKey,
  fallback,
  sourceStartOffsetSec = 0,
  itemId,
  liveGainItemIds,
  trimBefore = 0,
  sourceFps,
  volume = 0,
  playbackRate = 1,
  muted = false,
  durationInFrames,
  audioFadeIn = 0,
  audioFadeOut = 0,
  audioFadeInCurve = 0,
  audioFadeOutCurve = 0,
  audioFadeInCurveX = 0.52,
  audioFadeOutCurveX = 0.52,
  audioEqStages,
  clipFadeSpans,
  contentStartOffsetFrames = 0,
  contentEndOffsetFrames = 0,
  fadeInDelayFrames = 0,
  fadeOutLeadFrames = 0,
  crossfadeFadeIn,
  crossfadeFadeOut,
  volumeMultiplier = 1,
}) => {
  const { frame, fps, playing, resolvedVolume, resolvedAudioEqStages } = useAudioPlaybackState({
    itemId,
    liveGainItemIds,
    volume,
    muted,
    durationInFrames,
    audioFadeIn,
    audioFadeOut,
    audioFadeInCurve,
    audioFadeOutCurve,
    audioFadeInCurveX,
    audioFadeOutCurveX,
    audioEqStages,
    clipFadeSpans,
    contentStartOffsetFrames,
    contentEndOffsetFrames,
    fadeInDelayFrames,
    fadeOutLeadFrames,
    crossfadeFadeIn,
    crossfadeFadeOut,
    volumeMultiplier,
  });
  const visualPlaybackMode = usePreviewBridgeStore((s) => s.visualPlaybackMode);
  const streamingAudioProvider = usePreviewBridgeStore((s) => s.streamingAudioProvider);
  const graphRef = useRef<PreviewClipAudioGraph | null>(null);
  const schedulerRef = useRef(createStreamingPlaybackAudioScheduler());

  const shouldUseStreamingAudio = (
    visualPlaybackMode === 'streaming'
    && streamingAudioProvider !== null
    && streamingAudioProvider.isStreaming(streamKey)
    && streamingAudioProvider.getSourceInfo(streamKey)?.hasAudio !== false
  );

  useEffect(() => {
    if (!shouldUseStreamingAudio) {
      schedulerRef.current.stop();
      if (graphRef.current) {
        graphRef.current.dispose();
        graphRef.current = null;
      }
      return;
    }

    const graph = createPreviewClipAudioGraph();
    if (!graph) {
      return;
    }
    graphRef.current = graph;
    rampPreviewClipGain(graph, Math.max(0, resolvedVolume));
    rampPreviewClipEq(graph, resolvedAudioEqStages);

    return () => {
      schedulerRef.current.stop();
      if (graphRef.current === graph) {
        graph.dispose();
        graphRef.current = null;
      }
    };
  }, [resolvedAudioEqStages, resolvedVolume, shouldUseStreamingAudio]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    rampPreviewClipGain(graph, Math.max(0, resolvedVolume));
  }, [resolvedVolume]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    rampPreviewClipEq(graph, resolvedAudioEqStages);
  }, [resolvedAudioEqStages]);

  useEffect(() => {
    if (!shouldUseStreamingAudio || !streamingAudioProvider) {
      return;
    }

    const graph = graphRef.current;
    if (!graph) {
      return;
    }

    if (playing && graph.context.state === 'suspended') {
      void graph.context.resume().catch(() => undefined);
    }

    const effectiveSourceFps = sourceFps ?? fps;
    const targetTime = Math.max(
      0,
      getAudioTargetTimeSeconds(trimBefore, effectiveSourceFps, frame, playbackRate, fps) - sourceStartOffsetSec,
    );

    schedulerRef.current.sync({
      playback: {
        getAudioChunks: streamingAudioProvider.getAudioChunks,
      },
      streamKey,
      targetTime,
      graph,
      playing,
      playbackRate,
    });
  }, [
    fps,
    frame,
    playbackRate,
    playing,
    shouldUseStreamingAudio,
    sourceFps,
    sourceStartOffsetSec,
    streamKey,
    streamingAudioProvider,
    trimBefore,
  ]);

  useEffect(() => () => {
    schedulerRef.current.dispose();
  }, []);

  if (!shouldUseStreamingAudio) {
    return <>{fallback}</>;
  }

  return null;
});
