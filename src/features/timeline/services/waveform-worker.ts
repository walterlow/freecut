/**
 * Waveform Processing Worker
 *
 * Handles audio sample extraction and waveform generation off the main thread.
 * Uses mediabunny for hardware-accelerated audio decoding.
 * Sends progressive updates as samples are processed.
 */

import { ensureAc3DecoderRegistered, isAc3AudioCodec } from '@/shared/media/ac3-decoder';

export interface WaveformRequest {
  type: 'generate';
  requestId: string;
  blobUrl: string;
  samplesPerSecond: number;
  binDurationSec?: number;
}

export interface WaveformProgressResponse {
  type: 'progress';
  requestId: string;
  progress: number;
}

export interface WaveformInitResponse {
  type: 'init';
  requestId: string;
  duration: number;
  channels: number;
  sampleRate: number;
  totalSamples: number;
}

export interface WaveformChunkResponse {
  type: 'chunk';
  requestId: string;
  startIndex: number;
  peaks: Float32Array;
}

export interface WaveformCompleteResponse {
  type: 'complete';
  requestId: string;
  maxPeak: number;
}

export interface WaveformErrorResponse {
  type: 'error';
  requestId: string;
  error: string;
}

export type WaveformWorkerMessage = WaveformRequest | { type: 'abort'; requestId: string };
export type WaveformWorkerResponse =
  | WaveformProgressResponse
  | WaveformInitResponse
  | WaveformChunkResponse
  | WaveformCompleteResponse
  | WaveformErrorResponse;

// Track active requests for abort support
const activeRequests = new Map<string, { aborted: boolean }>();

async function getMediabunny() {
  return import('mediabunny');
}

self.onmessage = async (event: MessageEvent<WaveformWorkerMessage>) => {
  const { type } = event.data;

  if (type === 'abort') {
    const state = activeRequests.get(event.data.requestId);
    if (state) {
      state.aborted = true;
    }
    return;
  }

  if (type !== 'generate') return;

  const { requestId, blobUrl, samplesPerSecond, binDurationSec = 30 } = event.data;
  const state = { aborted: false };
  activeRequests.set(requestId, state);

  let disposeInput: { dispose?: () => void } | null = null;

  try {
    // Send initial progress
    self.postMessage({ type: 'progress', requestId, progress: 5 } as WaveformProgressResponse);

    // Load mediabunny. Register AC-3 decoder lazily only for matching codecs.
    const mediabunny = await getMediabunny();
    const { Input, UrlSource, AudioSampleSink, ALL_FORMATS } = mediabunny;

    if (state.aborted) throw new Error('Aborted');

    // Create input from blob URL
    const input = new Input({
      source: new UrlSource(blobUrl),
      formats: ALL_FORMATS,
    });
    disposeInput = input as { dispose?: () => void };

    // Get primary audio track
    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) {
      throw new Error('No audio track found');
    }

    const audioCodec = typeof audioTrack.codec === 'string' ? audioTrack.codec : undefined;
    if (isAc3AudioCodec(audioCodec)) {
      await ensureAc3DecoderRegistered();
    }

    self.postMessage({ type: 'progress', requestId, progress: 10 } as WaveformProgressResponse);

    // Get audio metadata
    const trackSampleRate = audioTrack.sampleRate || 0;
    const fallbackSampleRate = trackSampleRate > 0 ? trackSampleRate : 48000;
    const channels = audioTrack.numberOfChannels || 1;
    const duration = await audioTrack.computeDuration();

    if (state.aborted) throw new Error('Aborted');

    // Create audio sample sink
    const sink = new AudioSampleSink(audioTrack);

    const numOutputSamples = Math.max(1, Math.ceil(duration * samplesPerSecond));
    const peaks = new Float32Array(numOutputSamples);
    const binSampleCount = Math.max(1, Math.round(samplesPerSecond * binDurationSec));
    let processedEndTimeSec = 0;
    let nextChunkStart = 0;
    let maxPeak = 0;

    self.postMessage({ type: 'progress', requestId, progress: 20 } as WaveformProgressResponse);
    self.postMessage({
      type: 'init',
      requestId,
      duration,
      channels,
      sampleRate: samplesPerSecond,
      totalSamples: numOutputSamples,
    } as WaveformInitResponse);

    const emitChunk = (start: number, end: number) => {
      if (end <= start) return;
      const chunk = peaks.slice(start, end);
      self.postMessage(
        {
          type: 'chunk',
          requestId,
          startIndex: start,
          peaks: chunk,
        } as WaveformChunkResponse,
        { transfer: [chunk.buffer] }
      );
    };

    // Process samples
    for await (const sample of sink.samples()) {
      try {
        if (state.aborted) {
          throw new Error('Aborted');
        }

        // Avoid toAudioBuffer() in workers (AudioBuffer is not available in worker globals).
        const frameCount = sample.numberOfFrames;
        const channelCount = Math.max(1, sample.numberOfChannels);
        const sampleData = sample as {
          sampleRate?: number;
          timestamp?: number;
          duration?: number;
        };
        const sampleRate = (sampleData.sampleRate && sampleData.sampleRate > 0)
          ? sampleData.sampleRate
          : fallbackSampleRate;
        const sampleDurationSec = (sampleData.duration && sampleData.duration > 0)
          ? sampleData.duration
          : frameCount / sampleRate;
        const sampleTimestampSec = Number.isFinite(sampleData.timestamp)
          ? Math.max(0, sampleData.timestamp as number)
          : processedEndTimeSec;
        const sampleStartOutputIndex = Math.max(0, Math.floor(sampleTimestampSec * samplesPerSecond));
        const channelData: Float32Array[] = [];
        for (let c = 0; c < channelCount; c++) {
          const ch = new Float32Array(frameCount);
          sample.copyTo(ch, { planeIndex: c, format: 'f32-planar' });
          channelData.push(ch);
        }

        for (let i = 0; i < frameCount; i++) {
          let sum = 0;
          for (let c = 0; c < channelCount; c++) {
            sum += channelData[c]![i] ?? 0;
          }

          const mono = sum / channelCount;
          const peak = Math.abs(mono);
          const outputIndex = Math.min(
            numOutputSamples - 1,
            sampleStartOutputIndex + Math.floor((i * samplesPerSecond) / sampleRate)
          );

          if (peak > peaks[outputIndex]!) {
            peaks[outputIndex] = peak;
            if (peak > maxPeak) {
              maxPeak = peak;
            }
          }
        }

        processedEndTimeSec = Math.max(
          processedEndTimeSec,
          sampleTimestampSec + sampleDurationSec
        );

        // Flush full bins that can no longer change.
        const completedOutputExclusive = Math.min(
          numOutputSamples,
          Math.floor(processedEndTimeSec * samplesPerSecond)
        );
        while (nextChunkStart + binSampleCount <= completedOutputExclusive) {
          const end = nextChunkStart + binSampleCount;
          emitChunk(nextChunkStart, end);
          nextChunkStart = end;
        }

        // Update progress (20-80% range for sample extraction)
        const progress = 20 + Math.min(
          60,
          Math.round((processedEndTimeSec / Math.max(duration, 0.001)) * 60)
        );
        self.postMessage({ type: 'progress', requestId, progress } as WaveformProgressResponse);
      } finally {
        // Always close the sample to prevent resource leaks
        sample.close();
      }
    }

    if (state.aborted) throw new Error('Aborted');

    self.postMessage({ type: 'progress', requestId, progress: 80 } as WaveformProgressResponse);

    // Flush remaining tail.
    if (nextChunkStart < numOutputSamples) {
      emitChunk(nextChunkStart, numOutputSamples);
    }

    self.postMessage({ type: 'progress', requestId, progress: 90 } as WaveformProgressResponse);
    self.postMessage({ type: 'progress', requestId, progress: 95 } as WaveformProgressResponse);

    // Send completion marker with peak stats.
    const response: WaveformCompleteResponse = {
      type: 'complete',
      requestId,
      maxPeak,
    };
    self.postMessage(response);

  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    if (error !== 'Aborted') {
      self.postMessage({ type: 'error', requestId, error } as WaveformErrorResponse);
    }
  } finally {
    disposeInput?.dispose?.();
    activeRequests.delete(requestId);
  }
};
