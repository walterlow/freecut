/**
 * Waveform Worker - Web Worker for generating audio waveform data
 *
 * Decodes audio and extracts peak amplitude data for waveform visualization.
 * Returns normalized peaks (0-1) that can be rendered as bars.
 */

export interface WaveformWorkerRequest {
  type: 'generate-waveform' | 'abort';
  payload: {
    requestId: string;
    mediaId?: string;
    blobUrl?: string;
    samplesPerSecond?: number; // Default: 100 samples/second
  };
}

export interface WaveformWorkerResponse {
  type: 'waveform-ready' | 'progress' | 'error' | 'aborted';
  payload: {
    requestId: string;
    mediaId?: string;
    peaks?: Float32Array;
    duration?: number;
    sampleRate?: number;
    channels?: number;
    progress?: number;
    error?: string;
  };
}

// Track active requests for abort support
const activeRequests = new Map<string, { aborted: boolean }>();

/**
 * Decode audio and extract peak data
 */
async function generateWaveform(
  requestId: string,
  blobUrl: string,
  samplesPerSecond: number,
  port: MessagePort
): Promise<{ peaks: Float32Array; duration: number; sampleRate: number; channels: number }> {
  const requestState = activeRequests.get(requestId);
  if (!requestState) {
    throw new Error('Request not found');
  }

  // Report initial progress
  port.postMessage({
    type: 'progress',
    payload: { requestId, progress: 10 },
  } as WaveformWorkerResponse);

  // Fetch the audio file
  const response = await fetch(blobUrl);
  const arrayBuffer = await response.arrayBuffer();

  if (requestState.aborted) {
    throw new Error('Aborted');
  }

  port.postMessage({
    type: 'progress',
    payload: { requestId, progress: 30 },
  } as WaveformWorkerResponse);

  // Create offline audio context for decoding
  // Use a standard sample rate for decoding
  const audioContext = new OfflineAudioContext(2, 44100, 44100);
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  if (requestState.aborted) {
    throw new Error('Aborted');
  }

  port.postMessage({
    type: 'progress',
    payload: { requestId, progress: 50 },
  } as WaveformWorkerResponse);

  const duration = audioBuffer.duration;
  const channels = audioBuffer.numberOfChannels;

  // Calculate number of samples we want
  const numSamples = Math.ceil(duration * samplesPerSecond);

  // Samples per output sample
  const samplesPerOutputSample = Math.floor(audioBuffer.length / numSamples);

  // Extract peaks from channel data
  const peaks = new Float32Array(numSamples);

  // Get channel data (mix to mono if stereo)
  const channelData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    channelData.push(audioBuffer.getChannelData(c));
  }

  // Process in chunks for progress reporting
  const chunkSize = Math.ceil(numSamples / 10);

  for (let i = 0; i < numSamples; i++) {
    if (requestState.aborted) {
      throw new Error('Aborted');
    }

    const startSample = i * samplesPerOutputSample;
    const endSample = Math.min(startSample + samplesPerOutputSample, audioBuffer.length);

    // Find max absolute value across all channels in this range
    let maxVal = 0;

    for (let s = startSample; s < endSample; s++) {
      for (let c = 0; c < channels; c++) {
        const channel = channelData[c];
        if (channel) {
          const val = Math.abs(channel[s] ?? 0);
          if (val > maxVal) {
            maxVal = val;
          }
        }
      }
    }

    peaks[i] = maxVal;

    // Report progress every chunk
    if (i > 0 && i % chunkSize === 0) {
      const progress = 50 + Math.floor((i / numSamples) * 45);
      port.postMessage({
        type: 'progress',
        payload: { requestId, progress },
      } as WaveformWorkerResponse);
    }
  }

  // Normalize peaks to 0-1 range
  let maxPeak = 0;
  for (let i = 0; i < peaks.length; i++) {
    const peakValue = peaks[i] ?? 0;
    if (peakValue > maxPeak) {
      maxPeak = peakValue;
    }
  }

  if (maxPeak > 0) {
    for (let i = 0; i < peaks.length; i++) {
      peaks[i] = (peaks[i] ?? 0) / maxPeak;
    }
  }

  return {
    peaks,
    duration,
    sampleRate: samplesPerSecond, // Return the output sample rate
    channels,
  };
}

/**
 * Message handler
 */
self.onmessage = async (event: MessageEvent<WaveformWorkerRequest>) => {
  const { type, payload } = event.data;
  const port = event.ports[0];

  if (!port) {
    console.error('No message port provided');
    return;
  }

  try {
    switch (type) {
      case 'generate-waveform': {
        const {
          requestId,
          mediaId,
          blobUrl,
          samplesPerSecond = 100,
        } = payload;

        if (!requestId || !blobUrl) {
          throw new Error('Missing required parameters: requestId, blobUrl');
        }

        // Track this request for abort support
        activeRequests.set(requestId, { aborted: false });

        try {
          const { peaks, duration, sampleRate, channels } = await generateWaveform(
            requestId,
            blobUrl,
            samplesPerSecond,
            port
          );

          const response: WaveformWorkerResponse = {
            type: 'waveform-ready',
            payload: {
              requestId,
              mediaId,
              peaks,
              duration,
              sampleRate,
              channels,
            },
          };

          // Transfer the peaks ArrayBuffer
          port.postMessage(response, [peaks.buffer]);
        } finally {
          activeRequests.delete(requestId);
        }
        break;
      }

      case 'abort': {
        const { requestId } = payload;
        const requestState = activeRequests.get(requestId);
        if (requestState) {
          requestState.aborted = true;
        }

        const response: WaveformWorkerResponse = {
          type: 'aborted',
          payload: { requestId },
        };
        port.postMessage(response);
        break;
      }

      default:
        throw new Error(`Unknown action type: ${type}`);
    }
  } catch (error) {
    const response: WaveformWorkerResponse = {
      type: 'error',
      payload: {
        requestId: payload.requestId,
        error: error instanceof Error ? error.message : String(error),
      },
    };
    port.postMessage(response);
  }
};

// Export for TypeScript module
export {};
