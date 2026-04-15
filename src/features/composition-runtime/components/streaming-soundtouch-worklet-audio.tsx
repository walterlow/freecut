import React, { useEffect, useRef, useState } from 'react';
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge';
import { useGizmoStore } from '@/features/composition-runtime/deps/stores';
import { usePlaybackStore } from '@/features/composition-runtime/deps/stores';
import { createLogger } from '@/shared/logging/logger';
import { getAudioPitchRatioFromSemitones } from '@/shared/utils/audio-pitch';
import type { AudioPlaybackProps } from './audio-playback-props';
import { useAudioPlaybackState } from './hooks/use-audio-playback-state';
import { getAudioTargetTimeSeconds } from '../utils/video-timing';
import {
  createPreviewClipAudioGraph,
  rampPreviewClipEq,
  rampPreviewClipGain,
  type PreviewClipAudioGraph,
} from '../utils/preview-audio-graph';
import {
  ensureSoundTouchPreviewWorkletLoaded,
  serializeAudioBufferForSoundTouchPreview,
  SOUND_TOUCH_PREVIEW_PROCESSOR_NAME,
} from '../utils/soundtouch-preview-worklet';
import type { SoundTouchPreviewProcessorMessage } from '../utils/soundtouch-preview-shared';

const log = createLogger('StreamingSoundTouchAudio');
const SEEK_TOLERANCE_SECONDS = 0.05;
const DRIFT_RESYNC_BEHIND_THRESHOLD_SECONDS = -0.2;
const DRIFT_RESYNC_AHEAD_THRESHOLD_SECONDS = 0.5;
const STREAM_LOOKBEHIND_SECONDS = 0.35;
const STREAM_LOOKAHEAD_SECONDS = 2.5;
const STREAM_RESET_INTERVAL_SECONDS = 2;

interface StreamingSoundTouchWorkletAudioProps extends AudioPlaybackProps {
  streamKey: string;
  fallback?: React.ReactNode;
}

function getChunkKey(chunk: {
  timestamp: number;
  duration: number;
  buffer: AudioBuffer;
}): string {
  return `${chunk.timestamp}:${chunk.duration}:${chunk.buffer.sampleRate}:${chunk.buffer.length}`;
}

export const StreamingSoundTouchWorkletAudio: React.FC<StreamingSoundTouchWorkletAudioProps> = React.memo(({
  streamKey,
  itemId,
  volume = 0,
  playbackRate = 1,
  trimBefore = 0,
  sourceFps,
  fallback,
  muted = false,
  durationInFrames,
  audioFadeIn = 0,
  audioFadeOut = 0,
  audioFadeInCurve = 0,
  audioFadeOutCurve = 0,
  audioFadeInCurveX = 0.52,
  audioFadeOutCurveX = 0.52,
  audioPitchSemitones,
  audioPitchCents,
  audioPitchShiftSemitones,
  audioEqStages,
  clipFadeSpans,
  contentStartOffsetFrames = 0,
  contentEndOffsetFrames = 0,
  fadeInDelayFrames = 0,
  fadeOutLeadFrames = 0,
  crossfadeFadeIn,
  crossfadeFadeOut,
  liveGainItemIds,
  volumeMultiplier = 1,
}) => {
  const {
    frame,
    fps,
    playing,
    resolvedVolume: finalVolume,
    resolvedPitchShiftSemitones,
    resolvedAudioEqStages,
  } = useAudioPlaybackState({
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
    audioPitchSemitones,
    audioPitchCents,
    audioPitchShiftSemitones,
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
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const graphRef = useRef<PreviewClipAudioGraph | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const [nodeReady, setNodeReady] = useState(false);
  const [fallbackRequested, setFallbackRequested] = useState(false);
  const needsInitialSyncRef = useRef(true);
  const lastSyncWallClockRef = useRef(Date.now());
  const lastSyncContextTimeRef = useRef(0);
  const lastStartOffsetRef = useRef(0);
  const lastStartRateRef = useRef(playbackRate);
  const lastFrameRef = useRef(-1);
  const lastPostedPlayingRef = useRef<boolean | null>(null);
  const appendedChunkKeysRef = useRef<Set<string>>(new Set());
  const resetAnchorTimeRef = useRef<number | null>(null);

  const shouldUseStreamingAudio = (
    isPlaying
    && visualPlaybackMode === 'streaming'
    && streamingAudioProvider !== null
    && streamingAudioProvider.isStreaming(streamKey)
    && streamingAudioProvider.getSourceInfo(streamKey)?.hasAudio !== false
  );

  const postMessage = (message: SoundTouchPreviewProcessorMessage): void => {
    nodeRef.current?.port.postMessage(message);
  };

  const postSeekSeconds = (seconds: number, sampleRate: number): void => {
    postMessage({
      type: 'seek',
      frame: Math.max(0, Math.floor(seconds * sampleRate)),
    });
  };

  const resetBufferedChunks = (): void => {
    appendedChunkKeysRef.current.clear();
    resetAnchorTimeRef.current = null;
    postMessage({ type: 'reset' });
    lastPostedPlayingRef.current = null;
  };

  useEffect(() => {
    if (!shouldUseStreamingAudio) {
      setFallbackRequested(false);
      setNodeReady(false);
      if (nodeRef.current) {
        try {
          nodeRef.current.port.postMessage({ type: 'reset' });
        } catch {
          // Ignore teardown races.
        }
        nodeRef.current.disconnect();
        nodeRef.current = null;
      }
      if (graphRef.current) {
        graphRef.current.dispose();
        graphRef.current = null;
      }
      appendedChunkKeysRef.current.clear();
      resetAnchorTimeRef.current = null;
      return;
    }

    const graph = createPreviewClipAudioGraph();
    if (!graph) {
      setFallbackRequested(true);
      return;
    }
    graphRef.current = graph;

    let cancelled = false;
    const teardownNode = () => {
      resetBufferedChunks();
      nodeRef.current?.disconnect();
      nodeRef.current = null;
      setNodeReady(false);
      graph.dispose();
      if (graphRef.current === graph) {
        graphRef.current = null;
      }
    };

    ensureSoundTouchPreviewWorkletLoaded(graph.context)
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        if (!loaded) {
          teardownNode();
          setFallbackRequested(true);
          return;
        }

        let node: AudioWorkletNode;
        try {
          node = new AudioWorkletNode(graph.context, SOUND_TOUCH_PREVIEW_PROCESSOR_NAME, {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
            channelCountMode: 'explicit',
            channelInterpretation: 'speakers',
          });
        } catch (error) {
          log.warn('Failed to construct streaming SoundTouch preview node', { error });
          teardownNode();
          setFallbackRequested(true);
          return;
        }

        node.connect(graph.sourceInputNode);
        nodeRef.current = node;
        graph.outputGainNode.gain.value = muted ? 0 : Math.max(0, finalVolume);
        setFallbackRequested(false);
        setNodeReady(true);
      })
      .catch((error) => {
        if (!cancelled) {
          log.warn('Failed to initialize streaming SoundTouch preview node', { error });
          teardownNode();
          setFallbackRequested(true);
        }
      });

    return () => {
      cancelled = true;
      teardownNode();
    };
  }, [finalVolume, muted, shouldUseStreamingAudio]);

  useEffect(() => {
    const resume = () => {
      const graph = graphRef.current;
      if (graph?.context.state === 'suspended') {
        void graph.context.resume().catch(() => undefined);
      }
    };

    window.addEventListener('pointerdown', resume, { capture: true });
    window.addEventListener('keydown', resume, { capture: true });

    return () => {
      window.removeEventListener('pointerdown', resume, { capture: true });
      window.removeEventListener('keydown', resume, { capture: true });
    };
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    rampPreviewClipGain(graph, muted ? 0 : Math.max(0, finalVolume));
  }, [finalVolume, muted]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    rampPreviewClipEq(graph, resolvedAudioEqStages);
  }, [resolvedAudioEqStages]);

  useEffect(() => {
    if (!nodeReady) return;
    postMessage({
      type: 'set-tempo',
      tempo: Math.max(0.01, playbackRate),
    });
  }, [nodeReady, playbackRate]);

  useEffect(() => {
    if (!nodeReady) return;
    postMessage({
      type: 'set-pitch',
      pitch: getAudioPitchRatioFromSemitones(resolvedPitchShiftSemitones),
    });
  }, [nodeReady, resolvedPitchShiftSemitones]);

  useEffect(() => {
    if (!shouldUseStreamingAudio || !streamingAudioProvider || !nodeReady) {
      return;
    }

    const graph = graphRef.current;
    if (!graph) return;

    const effectiveSourceFps = sourceFps ?? fps;
    const sourceTimeSeconds = getAudioTargetTimeSeconds(trimBefore, effectiveSourceFps, frame, playbackRate, fps);
    const clipStartTimeSeconds = Math.max(0, trimBefore / effectiveSourceFps);
    const isPremounted = frame < 0;
    const targetTimeSeconds = isPremounted
      ? clipStartTimeSeconds
      : Math.max(0, sourceTimeSeconds);

    const shouldResetChunks = (
      resetAnchorTimeRef.current === null
      || Math.abs(targetTimeSeconds - resetAnchorTimeRef.current) > STREAM_RESET_INTERVAL_SECONDS
    );
    if (shouldResetChunks) {
      resetBufferedChunks();
      resetAnchorTimeRef.current = targetTimeSeconds;
    }

    const chunks = streamingAudioProvider.getAudioChunks(
      streamKey,
      Math.max(0, targetTimeSeconds - STREAM_LOOKBEHIND_SECONDS),
      targetTimeSeconds + STREAM_LOOKAHEAD_SECONDS,
    );
    for (const chunk of chunks) {
      const key = getChunkKey(chunk);
      if (appendedChunkKeysRef.current.has(key)) {
        continue;
      }
      const serialized = serializeAudioBufferForSoundTouchPreview(chunk.buffer, graph.context.sampleRate);
      postMessage({
        type: 'append-source',
        startFrame: Math.max(0, Math.floor(chunk.timestamp * graph.context.sampleRate)),
        leftChannel: serialized.leftChannel.buffer as ArrayBuffer,
        rightChannel: serialized.rightChannel.buffer as ArrayBuffer,
        frameCount: serialized.frameCount,
        sampleRate: serialized.sampleRate,
      });
      appendedChunkKeysRef.current.add(key);
    }
  }, [fps, frame, nodeReady, playbackRate, shouldUseStreamingAudio, sourceFps, streamKey, streamingAudioProvider, trimBefore]);

  useEffect(() => {
    const graph = graphRef.current;
    const node = nodeRef.current;
    if (!graph || !node || !nodeReady || !shouldUseStreamingAudio) {
      return;
    }

    const effectiveSourceFps = sourceFps ?? fps;
    const sourceTimeSeconds = getAudioTargetTimeSeconds(trimBefore, effectiveSourceFps, frame, playbackRate, fps);
    const clipStartTimeSeconds = Math.max(0, trimBefore / effectiveSourceFps);
    const isPremounted = frame < 0;
    const targetTimeSeconds = isPremounted
      ? clipStartTimeSeconds
      : Math.max(0, sourceTimeSeconds);
    const clampedTargetTime = Math.max(0, targetTimeSeconds);

    const frameChanged = frame !== lastFrameRef.current;
    lastFrameRef.current = frame;

    if (isPremounted) {
      if (lastPostedPlayingRef.current !== false) {
        postMessage({ type: 'set-playing', playing: false });
        lastPostedPlayingRef.current = false;
      }
      if (Math.abs(lastStartOffsetRef.current - clipStartTimeSeconds) > SEEK_TOLERANCE_SECONDS) {
        postSeekSeconds(clipStartTimeSeconds, graph.context.sampleRate);
        lastStartOffsetRef.current = clipStartTimeSeconds;
      }
      needsInitialSyncRef.current = true;
      return;
    }

    if (playing) {
      if (graph.context.state === 'suspended') {
        void graph.context.resume().catch(() => undefined);
      }

      const now = graph.context.currentTime;
      const expectedOffset = lastStartOffsetRef.current
        + Math.max(0, now - lastSyncContextTimeRef.current) * lastStartRateRef.current;
      const drift = expectedOffset - clampedTargetTime;
      const timeSinceLastSync = Date.now() - lastSyncWallClockRef.current;
      const audioBehind = drift < DRIFT_RESYNC_BEHIND_THRESHOLD_SECONDS;
      const audioFarAhead = drift > DRIFT_RESYNC_AHEAD_THRESHOLD_SECONDS;
      const needsSync = needsInitialSyncRef.current || audioFarAhead || (audioBehind && timeSinceLastSync > 500);

      if (needsSync) {
        postSeekSeconds(clampedTargetTime, graph.context.sampleRate);
        lastSyncContextTimeRef.current = now;
        lastSyncWallClockRef.current = Date.now();
        lastStartOffsetRef.current = clampedTargetTime;
        lastStartRateRef.current = playbackRate;
        needsInitialSyncRef.current = false;
      }

      if (lastPostedPlayingRef.current !== true) {
        postMessage({ type: 'set-playing', playing: true });
        lastPostedPlayingRef.current = true;
      }
    } else {
      if (lastPostedPlayingRef.current !== false) {
        postMessage({ type: 'set-playing', playing: false });
        lastPostedPlayingRef.current = false;
      }

      const playbackState = usePlaybackStore.getState();
      const isPreviewScrubbing =
        !playbackState.isPlaying
        && playbackState.previewFrame !== null
        && useGizmoStore.getState().activeGizmo === null;

      if (frameChanged && !isPreviewScrubbing) {
        postSeekSeconds(clampedTargetTime, graph.context.sampleRate);
        lastStartOffsetRef.current = clampedTargetTime;
      }

      needsInitialSyncRef.current = true;
    }
  }, [fps, frame, nodeReady, playbackRate, playing, shouldUseStreamingAudio, sourceFps, trimBefore]);

  if (!shouldUseStreamingAudio) {
    return <>{fallback}</>;
  }

  if (fallbackRequested && fallback) {
    return <>{fallback}</>;
  }

  if (fallbackRequested) {
    return null;
  }

  return null;
});
