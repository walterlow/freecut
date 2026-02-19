/**
 * Canvas Audio Processing System
 *
 * Handles audio extraction, processing, mixing, and encoding for client-side export.
 * Supports audio from video items and standalone audio items.
 */

import type { CompositionInputProps } from '@/types/export';
import type { VideoItem, AudioItem, CompositionItem } from '@/types/timeline';
import type { Keyframe as VolumeKeyframe } from '@/types/keyframe';
import { createLogger } from '@/lib/logger';
import { resolveTransitionWindows } from '@/lib/transitions/transition-planner';
import { getPropertyKeyframes, interpolatePropertyValue } from '@/features/keyframes/utils/interpolation';
import { useCompositionsStore } from '../../timeline/stores/compositions-store';
import { blobUrlManager } from '@/lib/blob-url-manager';
import { resolveMediaUrl } from '@/features/preview/utils/media-resolver';

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
interface AudioSegment {
  itemId: string;
  trackId: string;
  src: string;
  startFrame: number;        // Timeline position
  durationFrames: number;
  sourceStartFrame: number;  // In source media (for trim)
  volume: number;            // -60 to +12 dB
  fadeInFrames: number;
  fadeOutFrames: number;
  useEqualPowerFades: boolean;
  speed: number;             // Playback rate
  muted: boolean;
  type: 'video' | 'audio';
  volumeKeyframes?: VolumeKeyframe[];  // Animated volume keyframes
  itemFrom: number;                     // Item's timeline start frame (for keyframe offset)
}

/**
 * Decoded audio data
 */
interface DecodedAudio {
  itemId: string;
  sampleRate: number;
  channels: number;
  samples: Float32Array[];   // Per-channel samples
  duration: number;          // Duration in seconds
}

/**
 * Audio processing configuration
 */
interface AudioProcessingConfig {
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
function extractAudioSegments(composition: CompositionInputProps, fps: number): AudioSegment[] {
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

  const hasExplicitTrimStart = (item: VideoItem): boolean => {
    return item.sourceStart !== undefined || item.trimStart !== undefined || item.offset !== undefined;
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
    if (Math.abs(right.from - expectedRightFrom) > 2) return false;

    const leftTrim = getVideoTrimBefore(left);
    const rightTrim = getVideoTrimBefore(right);
    const computedLeftSourceEnd = leftTrim + Math.round(left.durationInFrames * leftSpeed);
    const storedLeftSourceEnd = left.sourceEnd;
    const computedContinuous = Math.abs(rightTrim - computedLeftSourceEnd) <= 2;
    const storedContinuous = storedLeftSourceEnd !== undefined
      ? Math.abs(rightTrim - storedLeftSourceEnd) <= 2
      : false;

    if (computedContinuous || storedContinuous) return true;

    const rightMissingTrimStart = !hasExplicitTrimStart(right);
    return rightMissingTrimStart;
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
        const audioItemKeyframes = composition.keyframes?.find((k) => k.itemId === item.id);
        const audioVolumeKfs = getPropertyKeyframes(audioItemKeyframes, 'volume');
        audioOnlySegments.push({
          itemId: item.id,
          trackId: track.id,
          src: audioItem.src,
          startFrame: item.from,
          durationFrames: item.durationInFrames,
          sourceStartFrame: audioItem.sourceStart ?? item.trimStart ?? 0,
          volume: item.volume ?? 0, // dB
          fadeInFrames: (item.audioFadeIn ?? 0) * fps,
          fadeOutFrames: (item.audioFadeOut ?? 0) * fps,
          useEqualPowerFades: false,
          speed: audioItem.speed ?? 1, // Playback speed from BaseTimelineItem
          muted: track.muted ?? false,
          type: 'audio',
          volumeKeyframes: audioVolumeKfs.length > 0 ? audioVolumeKfs : undefined,
          itemFrom: item.from,
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

  const resolvedTrimBeforeById = new Map<string, number>();
  const sortableVideoEntries = Array.from(videoById.entries()).map(([id, entry]) => ({
    id,
    trackId: entry.trackId,
    item: entry.item,
  }));
  const sortedByTrackAndTime = sortableVideoEntries.toSorted((a, b) => {
    if (a.trackId !== b.trackId) return a.trackId.localeCompare(b.trackId);
    if (a.item.from !== b.item.from) return a.item.from - b.item.from;
    return a.id.localeCompare(b.id);
  });

  const previousByTrack = new Map<string, VideoItem>();
  for (const entry of sortedByTrackAndTime) {
    const clip = entry.item;
    const explicitTrimBefore = getVideoTrimBefore(clip);
    let resolvedTrimBefore = explicitTrimBefore;

    if (!hasExplicitTrimStart(clip)) {
      const previous = previousByTrack.get(entry.trackId);
      if (previous) {
        const previousSpeed = previous.speed ?? 1;
        const clipSpeed = clip.speed ?? 1;
        const sameSpeed = Math.abs(previousSpeed - clipSpeed) <= 0.0001;
        const sameMedia = (previous.mediaId && clip.mediaId && previous.mediaId === clip.mediaId)
          || (!!previous.src && !!clip.src && previous.src === clip.src);
        const adjacent = Math.abs(clip.from - (previous.from + previous.durationInFrames)) <= 2;
        const sameOrigin = previous.originId && clip.originId
          ? previous.originId === clip.originId
          : true;

        if (sameSpeed && sameMedia && adjacent && sameOrigin) {
          const previousTrimBefore = resolvedTrimBeforeById.get(previous.id) ?? getVideoTrimBefore(previous);
          resolvedTrimBefore = previousTrimBefore + Math.round(previous.durationInFrames * previousSpeed);
        }
      }
    }

    resolvedTrimBeforeById.set(clip.id, resolvedTrimBefore);
    previousByTrack.set(entry.trackId, clip);
  }

  type ExpandedVideoAudioSegment = AudioSegment & {
    clip: VideoItem;
    beforeFrames: number;
    afterFrames: number;
  };

  const expandedVideoSegments: ExpandedVideoAudioSegment[] = [];
  for (const [, entry] of videoById) {
    const videoItem = entry.item;
    const speed = videoItem.speed ?? 1;
    const baseTrimBefore = resolvedTrimBeforeById.get(videoItem.id) ?? getVideoTrimBefore(videoItem);
    const extension = extensionByClipId.get(videoItem.id) ?? { before: 0, after: 0 };
    const maxBeforeBySource = speed > 0 ? Math.floor(baseTrimBefore / speed) : 0;
    const before = Math.max(0, Math.min(extension.before, maxBeforeBySource));
    const after = Math.max(0, extension.after);

    const videoItemKeyframes = composition.keyframes?.find((k) => k.itemId === videoItem.id);
    const videoVolumeKfs = getPropertyKeyframes(videoItemKeyframes, 'volume');

    expandedVideoSegments.push({
      itemId: videoItem.id,
      trackId: entry.trackId,
      clip: videoItem,
      src: videoItem.src,
      startFrame: videoItem.from - before,
      durationFrames: videoItem.durationInFrames + before + after,
      sourceStartFrame: baseTrimBefore - (before * speed),
      volume: videoItem.volume ?? 0,
      fadeInFrames: before > 0 ? before : ((videoItem.audioFadeIn ?? 0) * fps),
      fadeOutFrames: after > 0 ? after : ((videoItem.audioFadeOut ?? 0) * fps),
      useEqualPowerFades: before > 0 || after > 0,
      speed,
      muted: entry.muted,
      type: 'video',
      beforeFrames: before,
      afterFrames: after,
      volumeKeyframes: videoVolumeKfs.length > 0 ? videoVolumeKfs : undefined,
      itemFrom: videoItem.from,
    });
  }

  const sortedVideoSegments = expandedVideoSegments.toSorted((a, b) => {
    if (a.startFrame !== b.startFrame) return a.startFrame - b.startFrame;
    return a.itemId.localeCompare(b.itemId);
  });

  const canMergeContinuousBoundary = (
    left: ExpandedVideoAudioSegment,
    right: ExpandedVideoAudioSegment
  ): boolean => {
    if (!isContinuousAudioTransition(left.clip, right.clip)) return false;
    if (left.src !== right.src) return false;
    if (Math.abs(left.speed - right.speed) > 0.0001) return false;
    if (Math.abs(left.volume - right.volume) > 0.0001) return false;
    if (left.muted !== right.muted) return false;
    if (left.afterFrames !== 0 || right.beforeFrames !== 0) return false;
    if (left.volumeKeyframes || right.volumeKeyframes) return false;
    return true;
  };

  const mergedVideoSegments: AudioSegment[] = [];
  let active: ExpandedVideoAudioSegment | null = null;

  const toAudioSegment = (segment: ExpandedVideoAudioSegment): AudioSegment => ({
    itemId: segment.itemId,
    trackId: segment.trackId,
    src: segment.src,
    startFrame: segment.startFrame,
    durationFrames: segment.durationFrames,
    sourceStartFrame: segment.sourceStartFrame,
    volume: segment.volume,
    fadeInFrames: segment.fadeInFrames,
    fadeOutFrames: segment.fadeOutFrames,
    useEqualPowerFades: segment.useEqualPowerFades,
    speed: segment.speed,
    muted: segment.muted,
    type: segment.type,
    volumeKeyframes: segment.volumeKeyframes,
    itemFrom: segment.itemFrom,
  });

  for (const segment of sortedVideoSegments) {
    if (!active) {
      active = { ...segment };
      continue;
    }

    if (canMergeContinuousBoundary(active, segment)) {
      const mergedEnd = segment.startFrame + segment.durationFrames;
      active.durationFrames = mergedEnd - active.startFrame;
      active.fadeOutFrames = segment.fadeOutFrames;
      active.useEqualPowerFades = segment.useEqualPowerFades;
      active.clip = segment.clip;
      active.afterFrames = segment.afterFrames;
      continue;
    }

    mergedVideoSegments.push(toAudioSegment(active));
    active = { ...segment };
  }

  if (active) {
    mergedVideoSegments.push(toAudioSegment(active));
  }

  segments.push(...mergedVideoSegments, ...audioOnlySegments);

  // === Extract audio from sub-compositions (pre-comps) ===
  // Composition items reference sub-comps that may contain video/audio items with audio.
  // We offset each sub-comp audio segment by the composition item's timeline position.
  for (const track of tracks) {
    if (track.visible === false) continue;
    for (const item of track.items) {
      if (item.type !== 'composition') continue;
      const compItem = item as CompositionItem;
      const subComp = useCompositionsStore.getState().getComposition(compItem.compositionId);
      if (!subComp) continue;

      const compFrom = compItem.from;
      const sourceOffset = compItem.sourceStart ?? compItem.trimStart ?? 0;
      const trackMuted = track.muted ?? false;

      for (const subItem of subComp.items) {
        if (subItem.type !== 'video' && subItem.type !== 'audio') continue;

        // Check sub-track muted state
        const subTrack = subComp.tracks.find((t) => t.id === subItem.trackId);
        const subTrackMuted = subTrack?.muted ?? false;

        // Prefer fresh blob URL from manager (stored src may be stale/revoked)
        const src = (subItem.mediaId ? blobUrlManager.get(subItem.mediaId) : null)
          ?? (subItem as VideoItem | AudioItem).src ?? '';
        if (!src) continue;

        const subItemKeyframes = subComp.keyframes?.find((k) => k.itemId === subItem.id);
        const subVolumeKfs = getPropertyKeyframes(subItemKeyframes, 'volume');

        // Map sub-comp timing to main timeline:
        // Sub-item from is relative to sub-comp start (0-based).
        // startFrame on main timeline = compFrom + subItem.from - sourceOffset
        const startFrame = compFrom + subItem.from - sourceOffset;

        // Clamp to composition item bounds on the main timeline
        const compEnd = compFrom + compItem.durationInFrames;
        const effectiveStart = Math.max(startFrame, compFrom);
        const effectiveEnd = Math.min(startFrame + subItem.durationInFrames, compEnd);
        const effectiveDuration = effectiveEnd - effectiveStart;
        if (effectiveDuration <= 0) continue;

        // Compute source offset if the sub-item was clipped by the composition bounds
        const subItemClipStart = effectiveStart - startFrame;
        const baseSourceStart = subItem.sourceStart ?? subItem.trimStart ?? 0;
        const speed = subItem.speed ?? 1;
        const effectiveSourceStart = baseSourceStart + Math.round(subItemClipStart * speed);

        // Adjust fade durations for clipped portions — if the sub-item was
        // trimmed by composition bounds the fade should be shortened accordingly.
        const rawFadeInFrames = (subItem.audioFadeIn ?? 0) * fps;
        const rawFadeOutFrames = (subItem.audioFadeOut ?? 0) * fps;
        const clippedStartFrames = effectiveStart - startFrame; // frames clipped from start
        const clippedEndFrames = (startFrame + subItem.durationInFrames) - effectiveEnd; // frames clipped from end
        const adjustedFadeInFrames = Math.max(0, rawFadeInFrames - clippedStartFrames);
        const adjustedFadeOutFrames = Math.max(0, rawFadeOutFrames - clippedEndFrames);

        segments.push({
          itemId: subItem.id,
          trackId: track.id,
          src,
          startFrame: effectiveStart,
          durationFrames: effectiveDuration,
          sourceStartFrame: effectiveSourceStart,
          volume: subItem.volume ?? 0,
          fadeInFrames: adjustedFadeInFrames,
          fadeOutFrames: adjustedFadeOutFrames,
          useEqualPowerFades: false,
          speed,
          muted: trackMuted || subTrackMuted,
          type: subItem.type as 'video' | 'audio',
          volumeKeyframes: subVolumeKfs.length > 0 ? subVolumeKfs : undefined,
          itemFrom: startFrame,
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
 * Decode audio from a media source using mediabunny for efficient range extraction.
 * Only decodes the portion of audio actually needed, not the entire file.
 *
 * @param src - Source URL (blob URL or regular URL)
 * @param itemId - Item ID for logging
 * @param startTime - Start time in seconds (optional, defaults to 0)
 * @param endTime - End time in seconds (optional, defaults to full duration)
 * @returns Decoded audio data for the specified range
 */
async function decodeAudioFromSource(
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
    const { registerAc3Decoder } = await import('@mediabunny/ac3');
    registerAc3Decoder();

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
function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Apply volume (in dB) to audio samples.
 */
function applyVolume(
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
 * Apply animated volume envelope from keyframes to audio samples.
 * Interpolates dB value per-frame and applies per-sample gain.
 *
 * @param samples - Audio samples for one channel
 * @param volumeKeyframes - Volume keyframes (frame-relative to item start)
 * @param staticVolumeDb - Static volume dB fallback
 * @param segmentStartFrame - Timeline frame where this segment starts
 * @param itemFrom - Timeline frame where the original item starts
 * @param fps - Frames per second
 * @param sampleRate - Audio sample rate
 */
function applyAnimatedVolume(
  samples: Float32Array,
  volumeKeyframes: VolumeKeyframe[],
  staticVolumeDb: number,
  segmentStartFrame: number,
  itemFrom: number,
  fps: number,
  sampleRate: number
): Float32Array {
  const output = new Float32Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    // Convert sample index to timeline frame
    const timelineFrame = segmentStartFrame + (i / sampleRate) * fps;
    // Convert to item-relative frame for keyframe interpolation
    const relativeFrame = timelineFrame - itemFrom;
    const db = interpolatePropertyValue(volumeKeyframes, relativeFrame, staticVolumeDb);
    const gain = dbToGain(db);
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
function applyFades(
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
 * Apply speed change to audio with pitch preservation using SoundTouch algorithm.
 * Processes all channels together through a single SoundTouch instance so that
 * WSOLA overlap windows are consistent across channels (prevents phase drift
 * between L/R that causes a hollow sound).
 *
 * @param channels - Input audio channels (mono or stereo)
 * @param speed - Playback rate (1.0 = normal, 2.0 = double speed, 0.5 = half speed)
 * @param sampleRate - Sample rate for the audio
 * @returns Processed channels with the same channel count
 */
async function applySpeed(
  channels: Float32Array[],
  speed: number,
  sampleRate: number
): Promise<Float32Array[]> {
  if (speed === 1.0) return channels;
  if (channels.length === 0 || channels[0]!.length === 0) return channels;

  const numChannels = channels.length;
  const samplesPerChannel = channels[0]!.length;

  log.debug('Applying pitch-preserved speed change (SoundTouch)', { speed, sampleRate, numChannels });

  try {
    const soundtouch = await import('soundtouchjs');
    const st = new soundtouch.SoundTouch();

    st.tempo = speed;
    st.pitch = 1.0;
    st.rate = 1.0;

    // SoundTouch processes interleaved stereo. Interleave all channels
    // (for mono, duplicate to stereo so SoundTouch gets valid input).
    const stereoInput = new Float32Array(samplesPerChannel * 2);
    const left = channels[0]!;
    const right = numChannels >= 2 ? channels[1]! : left;
    for (let i = 0; i < samplesPerChannel; i++) {
      stereoInput[i * 2] = left[i]!;
      stereoInput[i * 2 + 1] = right[i]!;
    }

    let inputOffset = 0;
    const source = {
      extract: (target: Float32Array, numFrames: number): number => {
        const samplesToRead = Math.min(numFrames * 2, stereoInput.length - inputOffset);
        if (samplesToRead <= 0) return 0;

        for (let i = 0; i < samplesToRead; i++) {
          target[i] = stereoInput[inputOffset + i]!;
        }
        inputOffset += samplesToRead;
        return samplesToRead / 2;
      }
    };

    const filter = new soundtouch.SimpleFilter(source, st);

    const expectedOutputLength = Math.floor(samplesPerChannel / speed);
    const stereoOutput = new Float32Array(expectedOutputLength * 2);

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

    // De-interleave back to separate channels
    const actualOutputLength = Math.floor(outputOffset / 2);
    const outputChannels: Float32Array[] = [];

    // Always extract both L and R from the interleaved output
    const outLeft = new Float32Array(actualOutputLength);
    const outRight = new Float32Array(actualOutputLength);
    for (let i = 0; i < actualOutputLength; i++) {
      outLeft[i] = stereoOutput[i * 2]!;
      outRight[i] = stereoOutput[i * 2 + 1]!;
    }

    if (numChannels >= 2) {
      outputChannels.push(outLeft, outRight);
      // Pass through any additional channels beyond stereo (rare)
      for (let c = 2; c < numChannels; c++) {
        outputChannels.push(outLeft); // duplicate left for extra channels
      }
    } else {
      // Mono source: return left channel only
      outputChannels.push(outLeft);
    }

    log.debug('SoundTouch time stretch complete', {
      inputLength: samplesPerChannel,
      outputLength: actualOutputLength,
      expectedLength: expectedOutputLength,
      speed,
      numChannels,
    });

    return outputChannels;
  } catch (error) {
    log.warn('SoundTouch failed, falling back to simple resampling', { error });

    // Fallback: simple resampling per-channel (will change pitch)
    const outputLength = Math.floor(samplesPerChannel / speed);
    return channels.map((samples) => {
      const output = new Float32Array(outputLength);
      for (let i = 0; i < outputLength; i++) {
        const sourceIndex = i * speed;
        const index0 = Math.floor(sourceIndex);
        const index1 = Math.min(index0 + 1, samples.length - 1);
        const fraction = sourceIndex - index0;
        output[i] = samples[index0]! * (1 - fraction) + samples[index1]! * fraction;
      }
      return output;
    });
  }
}

/**
 * Resample audio to target sample rate using OfflineAudioContext for high-quality
 * sinc interpolation (matches browser-native resampling quality).
 */
async function resample(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number
): Promise<Float32Array> {
  if (sourceSampleRate === targetSampleRate) return samples;

  const duration = samples.length / sourceSampleRate;
  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil(duration * targetSampleRate),
    targetSampleRate
  );

  const buffer = offlineCtx.createBuffer(1, samples.length, sourceSampleRate);
  buffer.getChannelData(0).set(samples);

  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

/**
 * Mix multiple audio tracks together.
 *
 * @param segments - Processed audio segments with timing
 * @param config - Audio processing configuration
 * @returns Mixed stereo audio samples
 */
function mixAudioTracks(
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

  // Soft-clip to prevent harsh digital clipping while preserving overall loudness.
  // This matches browser preview behavior where audio peaks are naturally saturated
  // rather than the entire mix being reduced in volume.
  let clippedSamples = 0;
  for (const channel of output) {
    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i];
      if (sample !== undefined && Math.abs(sample) > 1.0) {
        // tanh soft limiter: smoothly compresses peaks above 1.0
        channel[i] = Math.tanh(sample);
        clippedSamples++;
      }
    }
  }
  if (clippedSamples > 0) {
    log.debug('Soft-clipped audio peaks', { clippedSamples });
  }

  return output;
}

/**
 * Pre-resolve sub-composition media URLs so extractAudioSegments can access them.
 * blobUrlManager.get() is synchronous but may not have URLs for sub-comp items
 * until they're acquired via resolveMediaUrl (async OPFS read).
 */
async function resolveSubCompMediaUrls(composition: CompositionInputProps): Promise<void> {
  const tracks = composition.tracks ?? [];
  const urlResolutions: Promise<void>[] = [];
  for (const track of tracks) {
    for (const item of track.items) {
      if (item.type !== 'composition') continue;
      const compItem = item as CompositionItem;
      const subComp = useCompositionsStore.getState().getComposition(compItem.compositionId);
      if (!subComp) continue;
      for (const subItem of subComp.items) {
        if (subItem.type !== 'video' && subItem.type !== 'audio') continue;
        if (subItem.mediaId && !blobUrlManager.get(subItem.mediaId)) {
          urlResolutions.push(resolveMediaUrl(subItem.mediaId).then(() => {}));
        }
      }
    }
  }
  if (urlResolutions.length > 0) {
    log.debug('Pre-resolving sub-comp audio URLs', { count: urlResolutions.length });
    await Promise.all(urlResolutions);
  }
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

  await resolveSubCompMediaUrls(composition);

  // Extract audio segments
  const segments = extractAudioSegments(composition, fps);

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

      // Process audio channels.
      // Note: decoded audio is already trimmed to the range we requested.

      // Apply speed across ALL channels at once to maintain phase coherence
      // between L/R (SoundTouch WSOLA finds shared overlap windows).
      let processedChannels = decoded.samples;
      if (segment.speed !== 1.0) {
        processedChannels = await applySpeed(processedChannels, segment.speed, decoded.sampleRate);
      }

      // Apply per-channel volume, fades, and resampling
      const fadeInSamples = Math.floor(
        (segment.fadeInFrames / fps) * decoded.sampleRate
      );
      const fadeOutSamples = Math.floor(
        (segment.fadeOutFrames / fps) * decoded.sampleRate
      );

      for (let c = 0; c < processedChannels.length; c++) {
        let channelSamples = processedChannels[c]!;

        // Apply volume (animated if keyframes exist, static otherwise)
        if (segment.volumeKeyframes && segment.volumeKeyframes.length > 0) {
          channelSamples = applyAnimatedVolume(
            channelSamples,
            segment.volumeKeyframes,
            segment.volume,
            segment.startFrame,
            segment.itemFrom,
            fps,
            decoded.sampleRate
          );
        } else if (segment.volume !== 0) {
          channelSamples = applyVolume(channelSamples, segment.volume);
        }

        // Apply fades
        if (fadeInSamples > 0 || fadeOutSamples > 0) {
          channelSamples = applyFades(
            channelSamples,
            fadeInSamples,
            fadeOutSamples,
            segment.useEqualPowerFades
          );
        }

        // Resample to target sample rate
        if (decoded.sampleRate !== config.sampleRate) {
          channelSamples = await resample(channelSamples, decoded.sampleRate, config.sampleRate);
        }

        processedChannels[c] = channelSamples;
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
 * Check if composition has any audio content.
 * Async because sub-composition media URLs may need to be resolved from OPFS
 * before extractAudioSegments can see valid src values.
 */
export async function hasAudioContent(composition: CompositionInputProps): Promise<boolean> {
  await resolveSubCompMediaUrls(composition);
  const segments = extractAudioSegments(composition, composition.fps);
  return segments.some((s) => !s.muted);
}
