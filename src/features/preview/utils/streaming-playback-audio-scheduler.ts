import type { StreamingAudioChunk, StreamingPlayback } from './streaming-playback';

const AUDIO_LOOKAHEAD_SECONDS = 0.75;
const AUDIO_LOOKBEHIND_SECONDS = 0.1;
const SEEK_RESYNC_THRESHOLD_SECONDS = 0.35;
const MIN_REMAINING_CHUNK_SECONDS = 0.01;

interface ScheduledChunkSource {
  key: string;
  source: AudioBufferSourceNode;
  endTime: number;
}

export interface StreamingPlaybackAudioSchedulerMetrics {
  syncCalls: number;
  resyncs: number;
  chunksScheduled: number;
  scheduledSources: number;
}

export interface StreamingPlaybackAudioScheduler {
  sync(args: {
    playback: StreamingPlayback;
    streamKey: string;
    targetTime: number;
    graph: {
      context: Pick<AudioContext, 'currentTime' | 'createBufferSource'>;
      sourceInputNode: AudioNode | object;
    };
    playing: boolean;
    playbackRate?: number;
  }): void;
  stop(): void;
  dispose(): void;
  getMetrics(): StreamingPlaybackAudioSchedulerMetrics;
}

function getChunkKey(chunk: StreamingAudioChunk): string {
  return `${chunk.timestamp}:${chunk.duration}:${chunk.buffer.sampleRate}:${chunk.buffer.length}`;
}

export function createStreamingPlaybackAudioScheduler(): StreamingPlaybackAudioScheduler {
  const scheduled = new Map<string, ScheduledChunkSource>();
  let lastTargetTime: number | null = null;
  let syncCalls = 0;
  let resyncs = 0;
  let chunksScheduled = 0;

  const clearScheduled = (): void => {
    for (const entry of scheduled.values()) {
      try {
        entry.source.stop();
      } catch {
        // Ignore sources that have already ended.
      }
      try {
        entry.source.disconnect();
      } catch {
        // Best-effort cleanup only.
      }
    }
    scheduled.clear();
  };

  const pruneScheduled = (targetTime: number): void => {
    for (const [key, entry] of scheduled) {
      if (entry.endTime <= targetTime + MIN_REMAINING_CHUNK_SECONDS) {
        scheduled.delete(key);
      }
    }
  };

  const scheduleChunk = (
    chunk: StreamingAudioChunk,
    targetTime: number,
    graph: {
      context: Pick<AudioContext, 'currentTime' | 'createBufferSource'>;
      sourceInputNode: AudioNode | object;
    },
  ): void => {
    const chunkEnd = chunk.timestamp + chunk.duration;
    if (chunkEnd <= targetTime + MIN_REMAINING_CHUNK_SECONDS) {
      return;
    }

    const key = getChunkKey(chunk);
    if (scheduled.has(key)) {
      return;
    }

    const ctx = graph.context;
    const source = ctx.createBufferSource();
    source.buffer = chunk.buffer;
    source.playbackRate.value = 1;
    source.connect(graph.sourceInputNode);

    const offset = Math.max(0, Math.min(targetTime - chunk.timestamp, chunk.buffer.duration - 0.001));
    const startDelay = Math.max(0, chunk.timestamp - targetTime);
    const startAt = ctx.currentTime + startDelay;

    const scheduledEntry: ScheduledChunkSource = {
      key,
      source,
      endTime: chunkEnd,
    };
    scheduled.set(key, scheduledEntry);
    source.onended = () => {
      source.disconnect();
      if (scheduled.get(key)?.source === source) {
        scheduled.delete(key);
      }
    };

    source.start(startAt, offset);
    chunksScheduled += 1;
  };

  return {
    sync({
      playback,
      streamKey,
      targetTime,
      graph,
      playing,
      playbackRate = 1,
    }): void {
      syncCalls += 1;

      if (!playing || Math.abs(playbackRate - 1) > 0.0001) {
        lastTargetTime = null;
        clearScheduled();
        return;
      }

      if (lastTargetTime !== null && Math.abs(targetTime - lastTargetTime) > SEEK_RESYNC_THRESHOLD_SECONDS) {
        resyncs += 1;
        clearScheduled();
      }
      lastTargetTime = targetTime;

      pruneScheduled(targetTime);

      const chunks = playback.getAudioChunks(
        streamKey,
        Math.max(0, targetTime - AUDIO_LOOKBEHIND_SECONDS),
        targetTime + AUDIO_LOOKAHEAD_SECONDS,
      );

      for (const chunk of chunks) {
        scheduleChunk(chunk, targetTime, graph);
      }
    },

    stop(): void {
      lastTargetTime = null;
      clearScheduled();
    },

    dispose(): void {
      lastTargetTime = null;
      clearScheduled();
    },

    getMetrics(): StreamingPlaybackAudioSchedulerMetrics {
      return {
        syncCalls,
        resyncs,
        chunksScheduled,
        scheduledSources: scheduled.size,
      };
    },
  };
}
