/**
 * Canvas Audio Processing System
 *
 * Handles audio extraction, processing, mixing, and encoding for client-side export.
 * Supports audio from video items and standalone audio items.
 */

import type { CompositionInputProps } from '@/types/export';
import type { VideoItem, AudioItem } from '@/types/timeline';
import { createLogger } from '@/lib/logger';
import { resolveTransitionWindows } from '@/lib/transitions/transition-planner';

const log = createLogger('CanvasAudio');

// =============================================================================
// PERFORMANCE OPTIMIZATION: Audio Decode Cache
// =============================================================================

/**
 * Cache for decoded audio to avoid re-decoding the same source file.
 * Key: source URL, Value: decoded audio data
 */
const audioDecodeCache = new Map<string, DecodedAudio>();

/**
 * Clear the audio decode cache (call after export completes)
 */
export function clearAudioDecodeCache(): void {
  audioDecodeCache.clear();
  log.debug('Audio decode cache cleared');
}

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
export function extractAudioSegments(composition: CompositionInputProps): AudioSegment[] {
  const { tracks = [], transitions = [] } = composition;
  const segments: AudioSegment[] = [];
  const audioOnlySegments: AudioSegment[] = [];
  const videoById = new Map<string, { item: VideoItem; trackId: string; muted: boolean }>();
  const extensionByClipId = new Map<string, { before: number; after: number }>();

  const ensureExtension = (clipId: string): { before: number; after: number } => {
    const existing = extensionByClipId.get(clipId);
    if (existing) return existing;
    const created = { before: 0, after: 0 };
    extensionByClipId.set(clipId, created);
    return created;
  };

  const getVideoTrimBefore = (item: VideoItem): number => {
    return item.sourceStart ?? item.trimStart ?? item.offset ?? 0;
  };

  const isContinuousAudioTransition = (left: VideoItem, right: VideoItem): boolean => {
    const leftSpeed = left.speed ?? 1;
    const rightSpeed = right.speed ?? 1;
    if (Math.abs(leftSpeed - rightSpeed) > 0.0001) return false;

    const sameMedia = (left.mediaId && right.mediaId && left.mediaId === right.mediaId)
      || (!!left.src && !!right.src && left.src === right.src);
    if (!sameMedia) return false;

    if (left.originId && right.originId && left.originId !== right.originId) return false;

    const expectedRightFrom = left.from + left.durationInFrames;
    if (right.from !== expectedRightFrom) return false;

    const leftTrim = getVideoTrimBefore(left);
    const rightTrim = getVideoTrimBefore(right);
    const expectedRightTrim = leftTrim + Math.round(left.durationInFrames * leftSpeed);

    return Math.abs(rightTrim - expectedRightTrim) <= 1;
  };

  for (const track of tracks) {
    if (track.visible === false) continue;

    for (const item of track.items) {
      if (item.type === 'video') {
        const videoItem = item as VideoItem;
        if (!videoItem.src) continue;
        videoById.set(item.id, {
          item: videoItem,
          trackId: track.id,
          muted: track.muted ?? false,
        });
      } else if (item.type === 'audio') {
        const audioItem = item as AudioItem;
        if (!audioItem.src) continue;

        // Use sourceStart as primary for consistency with video items
        // This ensures split audio clips and IO markers work correctly
        audioOnlySegments.push({
          itemId: item.id,
          trackId: track.id,
          src: audioItem.src,
          startFrame: item.from,
          durationFrames: item.durationInFrames,
          sourceStartFrame: audioItem.sourceStart ?? item.trimStart ?? 0,
          volume: item.volume ?? 0, // dB
          fadeInFrames: item.audioFadeIn ?? 0,
          fadeOutFrames: item.audioFadeOut ?? 0,
          speed: audioItem.speed ?? 1, // Playback speed from BaseTimelineItem
          muted: track.muted ?? false,
          type: 'audio',
        });
      }
    }
  }

  const videoItemsById = new Map<string, VideoItem>();
  for (const [id, entry] of videoById) {
    videoItemsById.set(id, entry.item);
  }
  const resolvedWindows = resolveTransitionWindows(transitions, videoItemsById);

  for (const window of resolvedWindows) {
    const leftEntry = videoById.get(window.transition.leftClipId);
    const rightEntry = videoById.get(window.transition.rightClipId);
    if (!leftEntry || !rightEntry) continue;

    const left = leftEntry.item;
    const right = rightEntry.item;
    if (isContinuousAudioTransition(left, right)) continue;

    const rightPreRoll = Math.max(0, right.from - window.startFrame);
    const leftPostRoll = Math.max(0, window.endFrame - (left.from + left.durationInFrames));

    if (rightPreRoll > 0) {
      const rightExt = ensureExtension(right.id);
      rightExt.before = Math.max(rightExt.before, rightPreRoll);
    }

    if (leftPostRoll > 0) {
      const leftExt = ensureExtension(left.id);
      leftExt.after = Math.max(leftExt.after, leftPostRoll);
    }
  }

  const expandedVideoSegments: AudioSegment[] = [];
  for (const [, entry] of videoById) {
    const videoItem = entry.item;
    const speed = videoItem.speed ?? 1;
    const baseTrimBefore = getVideoTrimBefore(videoItem);
    const extension = extensionByClipId.get(videoItem.id) ?? { before: 0, after: 0 };
    const maxBeforeBySource = speed > 0 ? Math.floor(baseTrimBefore / speed) : 0;
    const before = Math.max(0, Math.min(extension.before, maxBeforeBySource));
    const after = Math.max(0, extension.after);

    expandedVideoSegments.push({
      itemId: videoItem.id,
      trackId: entry.trackId,
      src: videoItem.src,
      startFrame: videoItem.from - before,
      durationFrames: videoItem.durationInFrames + before + after,
      sourceStartFrame: baseTrimBefore - (before * speed),
      volume: videoItem.volume ?? 0,
      fadeInFrames: before === 0 ? (videoItem.audioFadeIn ?? 0) : 0,
      fadeOutFrames: after === 0 ? (videoItem.audioFadeOut ?? 0) : 0,
      speed,
      muted: entry.muted,
      type: 'video',
    });
  }

  segments.push(...expandedVideoSegments, ...audioOnlySegments);

  log.info('Extracted audio segments', {
    count: segments.length,
    videoCount: segments.filter((s) => s.type === 'video').length,
    audioCount: segments.filter((s) => s.type === 'audio').length,
  });

  return segments;
}

/**
 * Decode audio from a media source using mediabunny for efficient range extraction.
 * Only decodes the portion of audio actually needed, not the entire file.
 *
 * @param src - Source URL (blob URL or regular URL)
 * @param itemId - Item ID for logging
 * @param startTime - Start time in seconds (optional, defaults to 0)
 * @param endTime - End time in seconds (optional, defaults to full duration)
 * @returns Decoded audio data for the specified range
 */
export async function decodeAudioFromSource(
  src: string,
  itemId: string,
  startTime?: number,
  endTime?: number
): Promise<DecodedAudio> {
  // Check cache first (only for full file decodes for backward compatibility)
  if (startTime === undefined && endTime === undefined) {
    const cached = audioDecodeCache.get(src);
    if (cached) {
      log.debug('Using cached decoded audio', { itemId, src: src.substring(0, 50) });
      return { ...cached, itemId };
    }
  }

  log.debug('Decoding audio with mediabunny', {
    itemId,
    src: src.substring(0, 50),
    startTime,
    endTime,
  });

  try {
    // Try mediabunny first for efficient range extraction
    const mb = await import('mediabunny');

    // Fetch and create input
    const response = await fetch(src);
    const blob = await response.blob();

    const input = new mb.Input({
      formats: mb.ALL_FORMATS,
      source: new mb.BlobSource(blob),
    });

    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) {
      throw new Error('No audio track found');
    }

    const duration = await input.computeDuration();
    const actualStartTime = startTime ?? 0;
    const actualEndTime = endTime ?? duration;

    log.debug('Extracting audio range', {
      itemId,
      startTime: actualStartTime,
      endTime: actualEndTime,
      totalDuration: duration,
    });

    // Create audio sample sink and extract only needed range
    const sink = new mb.AudioSampleSink(audioTrack);

    // Collect audio samples for the range
    const audioBuffers: AudioBuffer[] = [];
    let totalFrames = 0;
    let sampleRate = 48000;
    let channels = 2;

    for await (const sample of sink.samples(actualStartTime, actualEndTime)) {
      const audioBuffer = sample.toAudioBuffer();
      audioBuffers.push(audioBuffer);
      totalFrames += audioBuffer.length;
      sampleRate = audioBuffer.sampleRate;
      channels = audioBuffer.numberOfChannels;
      sample.close();
    }

    // Combine all audio buffers into single Float32Arrays
    const samples: Float32Array[] = [];
    for (let c = 0; c < channels; c++) {
      samples.push(new Float32Array(totalFrames));
    }

    let offset = 0;
    for (const buffer of audioBuffers) {
      for (let c = 0; c < channels; c++) {
        const channelData = buffer.getChannelData(c % buffer.numberOfChannels);
        samples[c]!.set(channelData, offset);
      }
      offset += buffer.length;
    }

    const result: DecodedAudio = {
      itemId,
      sampleRate,
      channels,
      samples,
      duration: actualEndTime - actualStartTime,
    };

    log.debug('Decoded audio with mediabunny', {
      itemId,
      sampleRate,
      channels,
      duration: result.duration,
      samples: samples[0]?.length,
    });

    // Cache if full file decode
    if (startTime === undefined && endTime === undefined) {
      audioDecodeCache.set(src, result);
    }

    return result;
  } catch (error) {
    // Fall back to Web Audio API for full decode
    log.warn('Mediabunny audio decode failed, using fallback', { itemId, error });
    return decodeAudioFallback(src, itemId);
  }
}

/**
 * Fallback audio decoder using Web Audio API (decodes entire file)
 */
async function decodeAudioFallback(src: string, itemId: string): Promise<DecodedAudio> {
  // Check cache
  const cached = audioDecodeCache.get(src);
  if (cached) {
    log.debug('Using cached decoded audio (fallback)', { itemId });
    return { ...cached, itemId };
  }

  log.debug('Decoding audio with Web Audio API fallback', { itemId, src: src.substring(0, 50) });

  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();

  const offlineContext = new OfflineAudioContext(2, 1, 48000);
  const audioBuffer = await offlineContext.decodeAudioData(arrayBuffer);

  const samples: Float32Array[] = [];
  for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
    samples.push(audioBuffer.getChannelData(i));
  }

  const result: DecodedAudio = {
    itemId,
    sampleRate: audioBuffer.sampleRate,
    channels: audioBuffer.numberOfChannels,
    samples,
    duration: audioBuffer.duration,
  };

  // Cache the result
  audioDecodeCache.set(src, result);

  log.debug('Decoded audio (fallback)', {
    itemId,
    sampleRate: audioBuffer.sampleRate,
    channels: audioBuffer.numberOfChannels,
    duration: audioBuffer.duration,
    samples: samples[0]?.length,
  });

  return result;
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
 * Apply speed change to audio samples with pitch preservation using SoundTouch algorithm.
 * Uses the low-level SoundTouch API for offline processing, which provides the same
 * WSOLA-based time stretching that browsers use for `preservesPitch`.
 *
 * @param samples - Input audio samples (mono)
 * @param speed - Playback rate (1.0 = normal, 2.0 = double speed, 0.5 = half speed)
 * @param sampleRate - Sample rate for the audio
 */
export async function applySpeed(
  samples: Float32Array,
  speed: number,
  sampleRate: number
): Promise<Float32Array> {
  if (speed === 1.0) return samples;
  if (samples.length === 0) return samples;

  log.debug('Applying pitch-preserved speed change (SoundTouch)', { speed, sampleRate });

  try {
    // Dynamically import SoundTouchJS
    const soundtouch = await import('soundtouchjs');

    // Create SoundTouch processor
    const st = new soundtouch.SoundTouch();

    // Set tempo (speed change) while keeping pitch at 1.0
    st.tempo = speed;
    st.pitch = 1.0;
    st.rate = 1.0;

    // SoundTouch processes interleaved stereo, so we need to convert
    // mono to stereo (duplicate channel) for processing
    const stereoInput = new Float32Array(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      stereoInput[i * 2] = samples[i]!;     // Left
      stereoInput[i * 2 + 1] = samples[i]!; // Right (duplicate)
    }

    // Create a source that feeds samples to SoundTouch
    let inputOffset = 0;
    const source = {
      extract: (target: Float32Array, numFrames: number): number => {
        const samplesToRead = Math.min(numFrames * 2, stereoInput.length - inputOffset);
        if (samplesToRead <= 0) return 0;

        for (let i = 0; i < samplesToRead; i++) {
          target[i] = stereoInput[inputOffset + i]!;
        }
        inputOffset += samplesToRead;
        return samplesToRead / 2; // Return number of frames
      }
    };

    // Create filter to process audio
    const filter = new soundtouch.SimpleFilter(source, st);

    // Calculate expected output length
    const expectedOutputLength = Math.floor(samples.length / speed);
    const stereoOutput = new Float32Array(expectedOutputLength * 2);

    // Extract processed samples in chunks
    let outputOffset = 0;
    const chunkSize = 4096;
    const chunk = new Float32Array(chunkSize * 2);

    while (outputOffset < stereoOutput.length) {
      const framesExtracted = filter.extract(chunk, chunkSize);
      if (framesExtracted === 0) break;

      const samplesToWrite = Math.min(framesExtracted * 2, stereoOutput.length - outputOffset);
      for (let i = 0; i < samplesToWrite; i++) {
        stereoOutput[outputOffset + i] = chunk[i]!;
      }
      outputOffset += framesExtracted * 2;
    }

    // Convert back to mono (take left channel)
    const actualOutputLength = Math.floor(outputOffset / 2);
    const output = new Float32Array(actualOutputLength);
    for (let i = 0; i < actualOutputLength; i++) {
      output[i] = stereoOutput[i * 2]!;
    }

    log.debug('SoundTouch time stretch complete', {
      inputLength: samples.length,
      outputLength: output.length,
      expectedLength: expectedOutputLength,
      speed,
    });

    return output;
  } catch (error) {
    log.warn('SoundTouch failed, falling back to simple resampling', { error });

    // Fallback: simple resampling (will change pitch)
    const outputLength = Math.floor(samples.length / speed);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const sourceIndex = i * speed;
      const index0 = Math.floor(sourceIndex);
      const index1 = Math.min(index0 + 1, samples.length - 1);
      const fraction = sourceIndex - index0;
      output[i] = samples[index0]! * (1 - fraction) + samples[index1]! * fraction;
    }

    return output;
  }
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
  composition: CompositionInputProps,
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
      // Calculate the time range we actually need from the source
      const sourceStartTime = segment.sourceStartFrame / fps;
      // Account for speed: at 2x speed, we need twice as much source audio
      const sourceDurationNeeded = (segment.durationFrames / fps) * segment.speed;
      const sourceEndTime = sourceStartTime + sourceDurationNeeded;

      // Decode ONLY the needed range using mediabunny (huge performance improvement!)
      const decoded = await decodeAudioFromSource(
        segment.src,
        segment.itemId,
        sourceStartTime,
        sourceEndTime
      );

      // Process each channel
      // Note: decoded audio is already trimmed to the range we requested
      const processedChannels: Float32Array[] = [];

      for (let c = 0; c < decoded.channels; c++) {
        let channelSamples = decoded.samples[c]!;

        // Since we decoded exactly the range we need with mediabunny,
        // we don't need to slice - the audio is already the exact portion needed.
        // Just apply speed, volume, and fades.

        // Apply speed with pitch preservation (using SoundTouch)
        if (segment.speed !== 1.0) {
          channelSamples = await applySpeed(channelSamples, segment.speed, decoded.sampleRate);
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
export function hasAudioContent(composition: CompositionInputProps): boolean {
  const segments = extractAudioSegments(composition);
  return segments.some((s) => !s.muted);
}
