/**
 * Waveform Processing Worker
 *
 * Handles audio sample extraction and waveform generation off the main thread.
 * Uses mediabunny for hardware-accelerated audio decoding.
 * Sends progressive updates as samples are processed.
 */

export interface WaveformRequest {
  type: 'generate';
  requestId: string;
  blobUrl: string;
  samplesPerSecond: number;
}

export interface WaveformProgressResponse {
  type: 'progress';
  requestId: string;
  progress: number;
}

export interface WaveformCompleteResponse {
  type: 'complete';
  requestId: string;
  peaks: Float32Array;
  duration: number;
  channels: number;
}

export interface WaveformErrorResponse {
  type: 'error';
  requestId: string;
  error: string;
}

export type WaveformWorkerMessage = WaveformRequest | { type: 'abort'; requestId: string };
export type WaveformWorkerResponse = WaveformProgressResponse | WaveformCompleteResponse | WaveformErrorResponse;

// Track active requests for abort support
const activeRequests = new Map<string, { aborted: boolean }>();

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

  const { requestId, blobUrl, samplesPerSecond } = event.data;
  const state = { aborted: false };
  activeRequests.set(requestId, state);

  try {
    // Send initial progress
    self.postMessage({ type: 'progress', requestId, progress: 5 } as WaveformProgressResponse);

    // Load mediabunny
    const mediabunny = await import('mediabunny');
    const { Input, UrlSource, AudioSampleSink, MP4, WEBM, MATROSKA, MP3, WAVE, FLAC, OGG } = mediabunny;

    if (state.aborted) throw new Error('Aborted');

    // Create input from blob URL
    const input = new Input({
      source: new UrlSource(blobUrl),
      formats: [MP4, WEBM, MATROSKA, MP3, WAVE, FLAC, OGG],
    });

    // Get primary audio track
    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) {
      throw new Error('No audio track found');
    }

    self.postMessage({ type: 'progress', requestId, progress: 10 } as WaveformProgressResponse);

    // Get audio metadata
    const sampleRate = audioTrack.sampleRate;
    const channels = audioTrack.numberOfChannels;
    const duration = await audioTrack.computeDuration();

    if (state.aborted) throw new Error('Aborted');

    // Create audio sample sink
    const sink = new AudioSampleSink(audioTrack);

    // Collect all audio samples
    const allSamples: Float32Array[] = [];
    let totalSamples = 0;

    self.postMessage({ type: 'progress', requestId, progress: 20 } as WaveformProgressResponse);

    // Process samples
    for await (const sample of sink.samples()) {
      try {
        if (state.aborted) {
          throw new Error('Aborted');
        }

        // Convert to AudioBuffer and immediately close sample
        const buffer = sample.toAudioBuffer();

        // Get samples from all channels and mix to mono
        const channelData: Float32Array[] = [];
        for (let c = 0; c < buffer.numberOfChannels; c++) {
          channelData.push(buffer.getChannelData(c));
        }

        // Mix to mono by averaging channels
        const monoSamples = new Float32Array(buffer.length);
        for (let i = 0; i < buffer.length; i++) {
          let sum = 0;
          for (let c = 0; c < channelData.length; c++) {
            sum += channelData[c]![i] ?? 0;
          }
          monoSamples[i] = sum / channelData.length;
        }

        allSamples.push(monoSamples);
        totalSamples += buffer.length;

        // Update progress (20-80% range for sample extraction)
        const progress = 20 + Math.min(60, Math.round((totalSamples / (sampleRate * duration)) * 60));
        self.postMessage({ type: 'progress', requestId, progress } as WaveformProgressResponse);
      } finally {
        // Always close the sample to prevent resource leaks
        sample.close();
      }
    }

    if (state.aborted) throw new Error('Aborted');

    self.postMessage({ type: 'progress', requestId, progress: 80 } as WaveformProgressResponse);

    // Combine all samples into one array
    const combinedSamples = new Float32Array(totalSamples);
    let offset = 0;
    for (const samples of allSamples) {
      combinedSamples.set(samples, offset);
      offset += samples.length;
    }

    // Downsample to target samples per second
    const numOutputSamples = Math.ceil(duration * samplesPerSecond);
    const samplesPerOutput = Math.floor(totalSamples / numOutputSamples);
    const peaks = new Float32Array(numOutputSamples);

    // Extract peak values
    for (let i = 0; i < numOutputSamples; i++) {
      const startIdx = i * samplesPerOutput;
      const endIdx = Math.min(startIdx + samplesPerOutput, totalSamples);

      let maxVal = 0;
      for (let j = startIdx; j < endIdx; j++) {
        const val = Math.abs(combinedSamples[j] ?? 0);
        if (val > maxVal) {
          maxVal = val;
        }
      }
      peaks[i] = maxVal;
    }

    self.postMessage({ type: 'progress', requestId, progress: 90 } as WaveformProgressResponse);

    // Normalize to 0-1 range
    let maxPeak = 0;
    for (let i = 0; i < peaks.length; i++) {
      if (peaks[i]! > maxPeak) {
        maxPeak = peaks[i]!;
      }
    }
    if (maxPeak > 0) {
      for (let i = 0; i < peaks.length; i++) {
        peaks[i] = peaks[i]! / maxPeak;
      }
    }

    // Send complete response with transferable
    const response: WaveformCompleteResponse = {
      type: 'complete',
      requestId,
      peaks,
      duration,
      channels,
    };
    self.postMessage(response, { transfer: [peaks.buffer] });

  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    if (error !== 'Aborted') {
      self.postMessage({ type: 'error', requestId, error } as WaveformErrorResponse);
    }
  } finally {
    activeRequests.delete(requestId);
  }
};
