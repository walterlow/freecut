/**
 * Canvas Audio Processing System
 *
 * Handles audio extraction, processing, mixing, and encoding for client-side export.
 * Supports audio from video items and standalone audio items.
 */

import type { RemotionInputProps } from '@/types/export';
import type { VideoItem, AudioItem } from '@/types/timeline';
import { createLogger } from '@/lib/logger';

const log = createLogger('CanvasAudio');

/**
 * Audio segment representing a timeline item's audio
 */
export interface AudioSegment {
  itemId: string;
  trackId: string;
  src: string;
  startFrame: number;        // Timeline position
  durationFrames: number;
  sourceStartFrame: number;  // In source media (for trim)
  volume: number;            // -60 to +12 dB
  fadeInFrames: number;
  fadeOutFrames: number;
  speed: number;             // Playback rate
  muted: boolean;
  type: 'video' | 'audio';
}

/**
 * Decoded audio data
 */
export interface DecodedAudio {
  itemId: string;
  sampleRate: number;
  channels: number;
  samples: Float32Array[];   // Per-channel samples
  duration: number;          // Duration in seconds
}

/**
 * Audio processing configuration
 */
export interface AudioProcessingConfig {
  sampleRate: number;
  channels: number;
  fps: number;
  totalFrames: number;
}

/**
 * Extract audio segments from composition.
 *
 * @param composition - The composition with tracks
 * @returns Array of audio segments to process
 */
export function extractAudioSegments(composition: RemotionInputProps): AudioSegment[] {
  const { tracks = [] } = composition;
  const segments: AudioSegment[] = [];

  for (const track of tracks) {
    if (track.visible === false) continue;

    for (const item of track.items) {
      if (item.type === 'video') {
        const videoItem = item as VideoItem;
        if (!videoItem.src) continue;

        segments.push({
          itemId: item.id,
          trackId: track.id,
          src: videoItem.src,
          startFrame: item.from,
          durationFrames: item.durationInFrames,
          sourceStartFrame: videoItem.trimStart ?? videoItem.sourceStart ?? 0,
          volume: item.volume ?? 0, // dB
          fadeInFrames: item.audioFadeIn ?? 0,
          fadeOutFrames: item.audioFadeOut ?? 0,
          speed: videoItem.speed ?? 1,
          muted: track.muted ?? false,
          type: 'video',
        });
      } else if (item.type === 'audio') {
        const audioItem = item as AudioItem;
        if (!audioItem.src) continue;

        segments.push({
          itemId: item.id,
          trackId: track.id,
          src: audioItem.src,
          startFrame: item.from,
          durationFrames: item.durationInFrames,
          sourceStartFrame: item.trimStart ?? 0,
          volume: item.volume ?? 0, // dB
          fadeInFrames: item.audioFadeIn ?? 0,
          fadeOutFrames: item.audioFadeOut ?? 0,
          speed: 1, // Audio items don't have speed in current types
          muted: track.muted ?? false,
          type: 'audio',
        });
      }
    }
  }

  log.info('Extracted audio segments', {
    count: segments.length,
    videoCount: segments.filter((s) => s.type === 'video').length,
    audioCount: segments.filter((s) => s.type === 'audio').length,
  });

  return segments;
}

/**
 * Decode audio from a media source using Web Audio API.
 *
 * @param src - Source URL (blob URL or regular URL)
 * @param itemId - Item ID for logging
 * @returns Decoded audio data
 */
export async function decodeAudioFromSource(
  src: string,
  itemId: string
): Promise<DecodedAudio> {
  log.debug('Decoding audio', { itemId, src: src.substring(0, 50) });

  try {
    // Fetch the audio data
    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();

    // Decode using Web Audio API
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Extract samples per channel
    const samples: Float32Array[] = [];
    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
      samples.push(audioBuffer.getChannelData(i));
    }

    await audioContext.close();

    log.debug('Decoded audio', {
      itemId,
      sampleRate: audioBuffer.sampleRate,
      channels: audioBuffer.numberOfChannels,
      duration: audioBuffer.duration,
      samples: samples[0]?.length,
    });

    return {
      itemId,
      sampleRate: audioBuffer.sampleRate,
      channels: audioBuffer.numberOfChannels,
      samples,
      duration: audioBuffer.duration,
    };
  } catch (error) {
    log.error('Failed to decode audio', { itemId, error });
    throw error;
  }
}

/**
 * Convert dB to linear gain.
 */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Apply volume (in dB) to audio samples.
 */
export function applyVolume(
  samples: Float32Array,
  volumeDb: number
): Float32Array {
  const gain = dbToGain(volumeDb);
  const output = new Float32Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    output[i] = samples[i]! * gain;
  }

  return output;
}

/**
 * Apply fade in/out to audio samples.
 *
 * @param samples - Audio samples
 * @param fadeInSamples - Number of samples for fade in
 * @param fadeOutSamples - Number of samples for fade out
 * @param useEqualPower - Use equal-power (sin/cos) fades for smoother crossfades
 */
export function applyFades(
  samples: Float32Array,
  fadeInSamples: number,
  fadeOutSamples: number,
  useEqualPower: boolean = false
): Float32Array {
  const output = new Float32Array(samples.length);
  output.set(samples);

  // Apply fade in
  if (fadeInSamples > 0) {
    for (let i = 0; i < fadeInSamples && i < output.length; i++) {
      const progress = i / fadeInSamples;
      const gain = useEqualPower
        ? Math.sin(progress * Math.PI / 2)
        : progress;
      output[i] = output[i]! * gain;
    }
  }

  // Apply fade out
  if (fadeOutSamples > 0) {
    const fadeOutStart = output.length - fadeOutSamples;
    for (let i = 0; i < fadeOutSamples; i++) {
      const sampleIndex = fadeOutStart + i;
      if (sampleIndex < 0 || sampleIndex >= output.length) continue;

      const progress = i / fadeOutSamples;
      const gain = useEqualPower
        ? Math.cos(progress * Math.PI / 2)
        : 1 - progress;
      output[sampleIndex] = output[sampleIndex]! * gain;
    }
  }

  return output;
}

/**
 * Apply speed change to audio samples.
 * Note: This uses simple linear interpolation which WILL change pitch.
 * For pitch-preserved speed change, a more complex algorithm (WSOLA/phase vocoder) is needed.
 *
 * @param samples - Input audio samples
 * @param speed - Playback rate (1.0 = normal, 2.0 = double speed, 0.5 = half speed)
 * @param sampleRate - Sample rate for logging
 */
export function applySpeed(
  samples: Float32Array,
  speed: number,
  sampleRate: number
): Float32Array {
  if (speed === 1.0) return samples;

  // Log warning about pitch change
  log.warn('Audio speed change will affect pitch - no pitch correction in client export', {
    speed,
    sampleRate,
  });

  const outputLength = Math.floor(samples.length / speed);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = i * speed;
    const index0 = Math.floor(sourceIndex);
    const index1 = Math.min(index0 + 1, samples.length - 1);
    const fraction = sourceIndex - index0;

    // Linear interpolation
    output[i] = samples[index0]! * (1 - fraction) + samples[index1]! * fraction;
  }

  return output;
}

/**
 * Resample audio to target sample rate.
 */
export function resample(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number
): Float32Array {
  if (sourceSampleRate === targetSampleRate) return samples;

  const ratio = targetSampleRate / sourceSampleRate;
  const outputLength = Math.floor(samples.length * ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = i / ratio;
    const index0 = Math.floor(sourceIndex);
    const index1 = Math.min(index0 + 1, samples.length - 1);
    const fraction = sourceIndex - index0;

    output[i] = samples[index0]! * (1 - fraction) + samples[index1]! * fraction;
  }

  return output;
}

/**
 * Mix multiple audio tracks together.
 *
 * @param segments - Processed audio segments with timing
 * @param config - Audio processing configuration
 * @returns Mixed stereo audio samples
 */
export function mixAudioTracks(
  segments: Array<{
    samples: Float32Array[];
    startSample: number;
    muted: boolean;
  }>,
  config: AudioProcessingConfig
): Float32Array[] {
  const { sampleRate, channels, fps, totalFrames } = config;
  const totalSamples = Math.ceil((totalFrames / fps) * sampleRate);

  // Create output buffers (stereo)
  const output: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    output.push(new Float32Array(totalSamples));
  }

  // Mix each segment
  for (const segment of segments) {
    if (segment.muted) continue;

    for (let c = 0; c < channels; c++) {
      const channelSamples = segment.samples[c % segment.samples.length];
      if (!channelSamples) continue;

      const outputChannel = output[c]!;

      for (let i = 0; i < channelSamples.length; i++) {
        const outputIndex = segment.startSample + i;
        if (outputIndex < 0 || outputIndex >= totalSamples) continue;

        // Simple additive mixing
        const sample = channelSamples[i];
        const currentValue = outputChannel[outputIndex];
        if (sample !== undefined && currentValue !== undefined) {
          outputChannel[outputIndex] = currentValue + sample;
        }
      }
    }
  }

  // Normalize to prevent clipping
  let maxSample = 0;
  for (const channel of output) {
    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i];
      if (sample !== undefined) {
        maxSample = Math.max(maxSample, Math.abs(sample));
      }
    }
  }

  if (maxSample > 1.0) {
    log.debug('Normalizing audio to prevent clipping', { maxSample });
    const normalizeGain = 0.95 / maxSample;
    for (const channel of output) {
      for (let i = 0; i < channel.length; i++) {
        const sample = channel[i];
        if (sample !== undefined) {
          channel[i] = sample * normalizeGain;
        }
      }
    }
  }

  return output;
}

/**
 * Process all audio for the composition.
 *
 * @param composition - The composition with tracks
 * @param signal - Optional abort signal
 * @returns Processed audio ready for encoding
 */
export async function processAudio(
  composition: RemotionInputProps,
  signal?: AbortSignal
): Promise<{
  samples: Float32Array[];
  sampleRate: number;
  channels: number;
} | null> {
  const { fps, durationInFrames = 0 } = composition;

  // Extract audio segments
  const segments = extractAudioSegments(composition);

  // Filter out muted segments early
  const activeSegments = segments.filter((s) => !s.muted);

  if (activeSegments.length === 0) {
    log.info('No audio segments to process');
    return null;
  }

  // Configuration
  const config: AudioProcessingConfig = {
    sampleRate: 48000, // Standard export sample rate
    channels: 2, // Stereo
    fps,
    totalFrames: durationInFrames,
  };

  log.info('Processing audio', {
    segmentCount: activeSegments.length,
    sampleRate: config.sampleRate,
    channels: config.channels,
    durationSeconds: durationInFrames / fps,
  });

  // Decode and process each segment
  const processedSegments: Array<{
    samples: Float32Array[];
    startSample: number;
    muted: boolean;
  }> = [];

  for (const segment of activeSegments) {
    if (signal?.aborted) {
      throw new DOMException('Audio processing cancelled', 'AbortError');
    }

    try {
      // Decode audio
      const decoded = await decodeAudioFromSource(segment.src, segment.itemId);

      // Process each channel
      const processedChannels: Float32Array[] = [];

      for (let c = 0; c < decoded.channels; c++) {
        let channelSamples = decoded.samples[c]!;

        // Extract the relevant portion based on trim
        const sourceStartSample = Math.floor(
          (segment.sourceStartFrame / fps) * decoded.sampleRate
        );
        const durationSamples = Math.floor(
          (segment.durationFrames / fps) * decoded.sampleRate
        );

        // Handle speed change (affects how much source audio we need)
        const sourceNeededSamples = Math.floor(durationSamples * segment.speed);

        // Extract portion
        const endSample = Math.min(
          sourceStartSample + sourceNeededSamples,
          channelSamples.length
        );
        channelSamples = channelSamples.slice(sourceStartSample, endSample);

        // Apply speed (with pitch change warning)
        if (segment.speed !== 1.0) {
          channelSamples = applySpeed(channelSamples, segment.speed, decoded.sampleRate);
        }

        // Apply volume
        if (segment.volume !== 0) {
          channelSamples = applyVolume(channelSamples, segment.volume);
        }

        // Calculate fade samples
        const fadeInSamples = Math.floor(
          (segment.fadeInFrames / fps) * decoded.sampleRate
        );
        const fadeOutSamples = Math.floor(
          (segment.fadeOutFrames / fps) * decoded.sampleRate
        );

        // Apply fades
        if (fadeInSamples > 0 || fadeOutSamples > 0) {
          channelSamples = applyFades(channelSamples, fadeInSamples, fadeOutSamples, false);
        }

        // Resample to target sample rate
        if (decoded.sampleRate !== config.sampleRate) {
          channelSamples = resample(channelSamples, decoded.sampleRate, config.sampleRate);
        }

        processedChannels.push(channelSamples);
      }

      // Calculate start position in output
      const startSample = Math.floor((segment.startFrame / fps) * config.sampleRate);

      processedSegments.push({
        samples: processedChannels,
        startSample,
        muted: segment.muted,
      });

      log.debug('Processed audio segment', {
        itemId: segment.itemId,
        type: segment.type,
        startSample,
        outputSamples: processedChannels[0]?.length,
      });
    } catch (error) {
      log.error('Failed to process audio segment', {
        itemId: segment.itemId,
        error,
      });
      // Continue with other segments
    }
  }

  if (processedSegments.length === 0) {
    log.warn('No audio segments were successfully processed');
    return null;
  }

  // Mix all segments
  const mixedSamples = mixAudioTracks(processedSegments, config);

  log.info('Audio processing complete', {
    outputSamples: mixedSamples[0]?.length,
    channels: mixedSamples.length,
    durationSeconds: (mixedSamples[0]?.length ?? 0) / config.sampleRate,
  });

  return {
    samples: mixedSamples,
    sampleRate: config.sampleRate,
    channels: config.channels,
  };
}

/**
 * Create an AudioBuffer from processed audio data.
 * This AudioBuffer can then be used with mediabunny's AudioBufferSource.
 *
 * @param audioData - Processed audio samples
 * @returns AudioBuffer ready for encoding
 */
export function createAudioBuffer(
  audioData: { samples: Float32Array[]; sampleRate: number; channels: number }
): AudioBuffer {
  // Create AudioBuffer from Float32Arrays
  const audioContext = new OfflineAudioContext(
    audioData.channels,
    audioData.samples[0]?.length ?? 0,
    audioData.sampleRate
  );

  const audioBuffer = audioContext.createBuffer(
    audioData.channels,
    audioData.samples[0]?.length ?? 0,
    audioData.sampleRate
  );

  // Copy samples to AudioBuffer
  for (let c = 0; c < audioData.channels; c++) {
    const channelData = audioBuffer.getChannelData(c);
    const samples = audioData.samples[c];
    if (samples) {
      channelData.set(samples);
    }
  }

  return audioBuffer;
}

/**
 * Audio encoding configuration for mediabunny
 */
export interface AudioEncodingOptions {
  codec: 'aac' | 'opus' | 'mp3';
  bitrate: number;
}

/**
 * Check if composition has any audio content.
 */
export function hasAudioContent(composition: RemotionInputProps): boolean {
  const segments = extractAudioSegments(composition);
  return segments.some((s) => !s.muted);
}
