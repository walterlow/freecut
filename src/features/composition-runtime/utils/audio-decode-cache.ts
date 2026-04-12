/**
 * Preview Audio Decode Cache
 *
 * Caches decoded AudioBuffers for custom-decoded audio tracks so that
 * split clips from the same source share a single decode.
 *
 * Storage: Decoded audio is persisted to IndexedDB in 10-second bins
 * (Int16 @ 22050 Hz stereo ~ 0.84 MB/bin). This avoids large single
 * records and allows progressive persistence during decode.
 *
 * On refresh, bins are loaded from IndexedDB in parallel and
 * reassembled into an AudioBuffer with no re-decode needed.
 *
 * Surround (5.1/7.1) sources are downmixed to stereo during decode
 * to keep memory reasonable.
 */

import { createLogger } from '@/shared/logging/logger';
import { createMediabunnyInputSource } from '@/infrastructure/browser/mediabunny-input-source';
import {
  getDecodedPreviewAudio,
  saveDecodedPreviewAudio,
  deleteDecodedPreviewAudio,
} from '@/infrastructure/storage/indexeddb/decoded-preview-audio';
import { getMedia } from '@/infrastructure/storage/indexeddb/media';
import { ensureAc3DecoderRegistered, isAc3AudioCodec } from '@/shared/media/ac3-decoder';
import type { DecodedPreviewAudioMeta, DecodedPreviewAudioBin } from '@/types/storage';
import { persistPreviewAudioConform } from './preview-audio-conform';

const log = createLogger('PreviewAudioCache');
export type PreviewAudioSource = string | Blob;

const cache = new Map<string, AudioBuffer>();
const playbackSliceCache = new Map<string, PlaybackAudioSlice>();
const pendingDecodes = new Map<string, Promise<AudioBuffer>>();
const pendingPlaybackSliceDecodes = new Map<string, {
  requestedStartTime: number;
  requestedCoverageEndTime: number;
  promise: Promise<PlaybackAudioSlice>;
}>();
/** LRU access order — most recently accessed at the end. */
const accessOrder: string[] = [];

/** Max audio cache memory budget in bytes (~200MB). */
const MAX_CACHE_BYTES = 200 * 1024 * 1024;
let currentCacheBytes = 0;

function estimateBufferBytes(buffer: AudioBuffer): number {
  return buffer.numberOfChannels * buffer.length * 4; // Float32 = 4 bytes per sample
}

function touchCacheEntry(mediaId: string): void {
  const idx = accessOrder.indexOf(mediaId);
  if (idx >= 0) accessOrder.splice(idx, 1);
  accessOrder.push(mediaId);
}

function evictIfNeeded(): void {
  while (currentCacheBytes > MAX_CACHE_BYTES && accessOrder.length > 0) {
    const evictId = accessOrder.shift()!;
    const buffer = cache.get(evictId);
    if (buffer) {
      currentCacheBytes -= estimateBufferBytes(buffer);
      cache.delete(evictId);
      log.debug('LRU evicted audio cache entry', { mediaId: evictId, freedMB: (estimateBufferBytes(buffer) / (1024 * 1024)).toFixed(1) });
    }
  }
}
const DEFAULT_PLAYABLE_PARTIAL_READY_SECONDS = 2;
const PLAYABLE_PARTIAL_TIMEOUT_MS = 8000;
const PLAYABLE_PARTIAL_PREROLL_SECONDS = 0.25;
const STARTUP_PLAYABLE_PARTIAL_READY_SECONDS = 1;
const PENDING_PLAYBACK_SLICE_REUSE_HEADROOM_SECONDS = 1;

/** Sample rate for IndexedDB storage; 22050 Hz is sufficient for preview. */
const STORAGE_SAMPLE_RATE = 22050;

/** Bin duration in seconds for chunked IndexedDB storage. */
const BIN_DURATION_SEC = 10;

export interface PlaybackAudioSlice {
  buffer: AudioBuffer;
  startTime: number;
  isComplete: boolean;
}

function getPlaybackSliceCoverageEnd(slice: PlaybackAudioSlice): number {
  return slice.startTime + slice.buffer.duration;
}

function playbackSliceCoversTarget(
  slice: PlaybackAudioSlice,
  targetTimeSeconds: number,
  minReadySeconds: number,
): boolean {
  return (
    targetTimeSeconds >= (slice.startTime - 0.05)
    && getPlaybackSliceCoverageEnd(slice) >= (targetTimeSeconds + minReadySeconds - 0.05)
  );
}

function pendingPlaybackSliceCoversTarget(
  request: {
    requestedStartTime: number;
    requestedCoverageEndTime: number;
  },
  targetTimeSeconds: number,
  minReadySeconds: number,
): boolean {
  const reusableHeadroomSeconds = Math.min(
    minReadySeconds,
    PENDING_PLAYBACK_SLICE_REUSE_HEADROOM_SECONDS,
  );

  return (
    request.requestedStartTime <= (targetTimeSeconds + 0.05)
    && request.requestedCoverageEndTime >= (targetTimeSeconds + reusableHeadroomSeconds - 0.05)
  );
}

function rememberPlaybackSlice(mediaId: string, slice: PlaybackAudioSlice): void {
  if (slice.isComplete) {
    playbackSliceCache.delete(mediaId);
    return;
  }

  const existing = playbackSliceCache.get(mediaId);
  if (!existing) {
    playbackSliceCache.set(mediaId, slice);
    return;
  }

  const existingCoverageEnd = getPlaybackSliceCoverageEnd(existing);
  const nextCoverageEnd = getPlaybackSliceCoverageEnd(slice);
  if (
    nextCoverageEnd > existingCoverageEnd + 0.05
    || slice.startTime < existing.startTime - 0.05
  ) {
    playbackSliceCache.set(mediaId, slice);
  }
}

// ---------------------------------------------------------------------------
// Int16 <-> Float32 conversion
// ---------------------------------------------------------------------------

function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]!));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16;
}

function int16ToFloat32(int16: Int16Array): Float32Array {
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    const s = int16[i]!;
    float32[i] = s / (s < 0 ? 0x8000 : 0x7FFF);
  }
  return float32;
}

// ---------------------------------------------------------------------------
// Resampling
// ---------------------------------------------------------------------------

async function downsampleBuffer(buffer: AudioBuffer, targetRate: number): Promise<AudioBuffer> {
  if (buffer.sampleRate <= targetRate) return buffer;

  const ratio = targetRate / buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const sourceFrames = buffer.length;
  const targetFrames = Math.ceil(sourceFrames * ratio);

  // Manual linear interpolation — ~10x faster than OfflineAudioContext
  // for preview-quality downsampling (22050 Hz). Quality is sufficient
  // since we're going from 48kHz?22kHz with anti-aliasing handled by
  // the Nyquist limit at the target rate.
  const ctx = new OfflineAudioContext(numChannels, targetFrames, targetRate);
  const outBuffer = ctx.createBuffer(numChannels, targetFrames, targetRate);

  for (let ch = 0; ch < numChannels; ch++) {
    const input = buffer.getChannelData(ch);
    const output = outBuffer.getChannelData(ch);
    for (let i = 0; i < targetFrames; i++) {
      const srcPos = i / ratio;
      const idx = Math.floor(srcPos);
      const frac = srcPos - idx;
      const s0 = input[idx] ?? 0;
      const s1 = input[idx + 1] ?? s0;
      output[i] = s0 + (s1 - s0) * frac;
    }
  }

  return outBuffer;
}

// ---------------------------------------------------------------------------
// Bin key helpers
// ---------------------------------------------------------------------------

function binKey(mediaId: string, binIndex: number): string {
  return `${mediaId}:bin:${binIndex}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createInputSource(
  mb: Awaited<typeof import('mediabunny')>,
  src: PreviewAudioSource,
) {
  return createMediabunnyInputSource(mb, src);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a cached AudioBuffer or decode one via mediabunny.
 * Checks: memory cache -> IndexedDB bins -> decode (persists bins progressively).
 * Concurrent calls for the same mediaId share a single promise.
 */
function ensureDecodeStarted(mediaId: string, src: PreviewAudioSource): Promise<AudioBuffer> {
  const pending = pendingDecodes.get(mediaId);
  if (pending) return pending;

  const promise = loadOrDecodeAudio(mediaId, src)
    .then((buffer) => {
      cache.set(mediaId, buffer);
      playbackSliceCache.delete(mediaId);
      currentCacheBytes += estimateBufferBytes(buffer);
      touchCacheEntry(mediaId);
      evictIfNeeded();
      return buffer;
    })
    .finally(() => {
      pendingDecodes.delete(mediaId);
    });

  pendingDecodes.set(mediaId, promise);
  return promise;
}

export async function getOrDecodeAudio(mediaId: string, src: PreviewAudioSource): Promise<AudioBuffer> {
  const cached = cache.get(mediaId);
  if (cached) {
    touchCacheEntry(mediaId);
    return cached;
  }
  return ensureDecodeStarted(mediaId, src);
}

export async function startPreviewAudioConform(
  mediaId: string,
  src: PreviewAudioSource,
): Promise<void> {
  const buffer = await ensureDecodeStarted(mediaId, src);
  await persistPreviewAudioConform(mediaId, buffer);
}

export async function startPreviewAudioStartupWarm(
  mediaId: string,
  src: PreviewAudioSource,
  options?: {
    targetTimeSeconds?: number;
    minReadySeconds?: number;
  },
): Promise<void> {
  await getOrDecodeAudioSliceForPlayback(mediaId, src, {
    targetTimeSeconds: Math.max(0, options?.targetTimeSeconds ?? 0),
    minReadySeconds: Math.max(
      0.25,
      options?.minReadySeconds ?? STARTUP_PLAYABLE_PARTIAL_READY_SECONDS,
    ),
    waitTimeoutMs: 0,
  });
}

/** Returns true when a full decode/rebuild is currently in progress. */
export function isPreviewAudioDecodePending(mediaId: string): boolean {
  return pendingDecodes.has(mediaId);
}

async function loadPartialFromBins(
  mediaId: string,
  targetTimeSeconds: number,
  minReadySeconds: number,
  preRollSeconds: number,
): Promise<PlaybackAudioSlice | null> {
  const metaRecord = await getDecodedPreviewAudio(mediaId);
  let storedSampleRate = (metaRecord && 'kind' in metaRecord && metaRecord.kind === 'meta'
    && Number.isFinite(metaRecord.sampleRate) && metaRecord.sampleRate > 0)
    ? metaRecord.sampleRate
    : 0;
  const binDurationSec = (metaRecord && 'kind' in metaRecord && metaRecord.kind === 'meta'
    && Number.isFinite(metaRecord.binDurationSec) && metaRecord.binDurationSec > 0)
    ? metaRecord.binDurationSec
    : BIN_DURATION_SEC;
  const requestedStartTime = Math.max(0, targetTimeSeconds - preRollSeconds);
  const requestedCoverageEndTime = targetTimeSeconds + minReadySeconds;
  const startBinIndex = Math.max(0, Math.floor(requestedStartTime / binDurationSec));
  const bins: DecodedPreviewAudioBin[] = [];
  let totalFrames = 0;
  const sliceStartTime = startBinIndex * binDurationSec;
  let coverageEndTime = sliceStartTime;
  // Load contiguous bins around the requested target until we cover the
  // desired playback headroom or hit a gap in persisted decode bins.
  for (let i = startBinIndex; i < startBinIndex + 512; i++) {
    const record = await getDecodedPreviewAudio(binKey(mediaId, i));
    if (!(record && 'kind' in record && record.kind === 'bin')) {
      break;
    }
    const bin = record as DecodedPreviewAudioBin;
    if (bin.binIndex !== i || bin.frames <= 0) {
      break;
    }
    // Derive sample rate from first bin when meta is unavailable.
    if (storedSampleRate <= 0 && bin.sampleRate && Number.isFinite(bin.sampleRate) && bin.sampleRate > 0) {
      storedSampleRate = bin.sampleRate;
    }
    bins.push(bin);
    totalFrames += bin.frames;
    if (storedSampleRate > 0) {
      coverageEndTime = sliceStartTime + (totalFrames / storedSampleRate);
    }
    if (coverageEndTime >= requestedCoverageEndTime - 0.05) {
      break;
    }
  }
  if (storedSampleRate <= 0) {
    storedSampleRate = STORAGE_SAMPLE_RATE;
  }
  if (bins.length === 0 || totalFrames <= 0) {
    return null;
  }
  const offlineCtx = new OfflineAudioContext(2, totalFrames, storedSampleRate);
  const buffer = offlineCtx.createBuffer(2, totalFrames, storedSampleRate);
  const leftChannel = buffer.getChannelData(0);
  const rightChannel = buffer.getChannelData(1);
  let offset = 0;
  for (const bin of bins) {
    const left = new Int16Array(bin.left);
    const right = new Int16Array(bin.right);
    const frames = Math.min(bin.frames, left.length, right.length);
    if (frames <= 0) continue;
    leftChannel.set(int16ToFloat32(left.subarray(0, frames)), offset);
    rightChannel.set(int16ToFloat32(right.subarray(0, frames)), offset);
    offset += frames;
  }
  if (offset <= 0) {
    return null;
  }
  return {
    buffer,
    startTime: sliceStartTime,
    isComplete: false,
  };
}
async function decodeAudioWindow(
  mediaId: string,
  src: PreviewAudioSource,
  startTime: number,
  durationSeconds: number,
  ac3RetryAttempted: boolean = false,
): Promise<PlaybackAudioSlice> {
  const shouldRegisterAc3 = ac3RetryAttempted || await shouldPreRegisterAc3Decoder(mediaId);

  try {
    if (shouldRegisterAc3) {
      await ensureAc3DecoderRegistered();
    }

    const mb = await import('mediabunny');
    const input = new mb.Input({
      formats: mb.ALL_FORMATS,
      source: createInputSource(mb, src),
    });

    try {
      const audioTrack = await input.getPrimaryAudioTrack();
      if (!audioTrack) {
        throw new Error(`No audio track found for media ${mediaId}`);
      }

      const safeStartTime = Math.max(0, startTime);
      const targetCoverageEndTime = safeStartTime + Math.max(0.5, durationSeconds);
      const sink = new mb.AudioBufferSink(audioTrack);

      let sliceStartTime: number | null = null;
      let coverageEndTime = safeStartTime;
      let sampleRate = 48000;
      let totalFrames = 0;
      const leftChunks: Float32Array[] = [];
      const rightChunks: Float32Array[] = [];
      const seenBufferKeys = new Set<string>();

      const appendWrappedBuffer = (wrappedBuffer: { buffer: AudioBuffer; timestamp: number; duration: number }) => {
        const audioBuffer = wrappedBuffer.buffer;
        const frameCount = audioBuffer.length;
        const channelCount = Math.max(1, audioBuffer.numberOfChannels);
        if (frameCount === 0) {
          return;
        }

        const dedupeKey = `${wrappedBuffer.timestamp}:${wrappedBuffer.duration}`;
        if (seenBufferKeys.has(dedupeKey)) {
          return;
        }
        seenBufferKeys.add(dedupeKey);

        if (sliceStartTime === null) {
          sliceStartTime = wrappedBuffer.timestamp;
        }
        coverageEndTime = Math.max(coverageEndTime, wrappedBuffer.timestamp + wrappedBuffer.duration);
        if (audioBuffer.sampleRate > 0) {
          sampleRate = audioBuffer.sampleRate;
        }

        const channels: Float32Array[] = [];
        for (let c = 0; c < channelCount; c++) {
          channels.push(audioBuffer.getChannelData(c));
        }
        const { left, right } = downmixToStereo(channels, frameCount);
        leftChunks.push(left);
        rightChunks.push(right);
        totalFrames += frameCount;
      };

      const initialWrappedBuffer = await sink.getBuffer(safeStartTime);
      if (initialWrappedBuffer) {
        appendWrappedBuffer(initialWrappedBuffer);
      }

      const iteratorStartTime = sliceStartTime ?? safeStartTime;
      for await (const wrappedBuffer of sink.buffers(iteratorStartTime, targetCoverageEndTime)) {
        appendWrappedBuffer(wrappedBuffer);
        if (coverageEndTime >= targetCoverageEndTime) {
          break;
        }
      }

      if (totalFrames <= 0 || sliceStartTime === null) {
        throw new Error(`Audio window decode produced no output for media ${mediaId}`);
      }

      const buffer = await buildPreviewStereoBuffer(leftChunks, rightChunks, totalFrames, sampleRate);
      return {
        buffer,
        startTime: sliceStartTime,
        isComplete: false,
      };
    } finally {
      input.dispose();
    }
  } catch (err) {
    if (!ac3RetryAttempted && !shouldRegisterAc3) {
      try {
        return await decodeAudioWindow(mediaId, src, startTime, durationSeconds, true);
      } catch {
        // Keep original error as primary failure.
      }
    }
    throw err;
  }
}

/**
 * Playback-first helper for custom-decoded audio:
 * returns a partial buffer as soon as enough decoded bins are available,
 * while full decode continues in the background.
 */
export async function getOrDecodeAudioSliceForPlayback(
  mediaId: string,
  src: PreviewAudioSource,
  options?: {
    minReadySeconds?: number;
    waitTimeoutMs?: number;
    targetTimeSeconds?: number;
    preRollSeconds?: number;
  }
): Promise<PlaybackAudioSlice> {
  const cached = cache.get(mediaId);
  if (cached) {
    touchCacheEntry(mediaId);
    return {
      buffer: cached,
      startTime: 0,
      isComplete: true,
    };
  }

  const minReadySeconds = Math.max(1, options?.minReadySeconds ?? DEFAULT_PLAYABLE_PARTIAL_READY_SECONDS);
  const waitTimeoutMs = Math.max(0, options?.waitTimeoutMs ?? PLAYABLE_PARTIAL_TIMEOUT_MS);
  const targetTimeSeconds = Math.max(0, options?.targetTimeSeconds ?? 0);
  const preRollSeconds = Math.max(0, options?.preRollSeconds ?? PLAYABLE_PARTIAL_PREROLL_SECONDS);
  const pendingFullDecodePromise = pendingDecodes.get(mediaId) ?? null;

  const cachedPlaybackSlice = playbackSliceCache.get(mediaId);
  if (cachedPlaybackSlice && playbackSliceCoversTarget(cachedPlaybackSlice, targetTimeSeconds, minReadySeconds)) {
    return cachedPlaybackSlice;
  }

  const pendingPlaybackSlice = pendingPlaybackSliceDecodes.get(mediaId);
  if (
    pendingPlaybackSlice
    && pendingPlaybackSliceCoversTarget(
      pendingPlaybackSlice,
      targetTimeSeconds,
      minReadySeconds,
    )
  ) {
    return pendingPlaybackSlice.promise;
  }

  const partialStartTime = Math.max(0, targetTimeSeconds - preRollSeconds);
  const partialDurationSeconds = minReadySeconds + preRollSeconds;
  const requiredCoverageEnd = targetTimeSeconds + minReadySeconds;
  const partialPromise = (async (): Promise<PlaybackAudioSlice> => {
    // If bins are already present from a previous run/decode, use them immediately
    // only when they cover the current target plus enough headroom to keep
    // playback continuous. Returning a slice that merely contains the current
    // position can strand the preview path at the tail of the rebuilt bins.
    const immediatePartial = await loadPartialFromBins(
      mediaId,
      targetTimeSeconds,
      minReadySeconds,
      preRollSeconds,
    );
    if (
      immediatePartial
      && playbackSliceCoversTarget(immediatePartial, targetTimeSeconds, minReadySeconds)
    ) {
      rememberPlaybackSlice(mediaId, immediatePartial);
      return immediatePartial;
    }

    try {
      const slice = await decodeAudioWindow(
        mediaId,
        src,
        partialStartTime,
        partialDurationSeconds,
      );
      rememberPlaybackSlice(mediaId, slice);
      return slice;
    } catch (windowError) {
      log.warn('Targeted preview audio window decode failed, falling back to full decode', {
        mediaId,
        targetTimeSeconds,
        error: windowError,
      });
    }

    return {
      buffer: await getOrDecodeAudio(mediaId, src),
      startTime: 0,
      isComplete: true,
    };
  })();

  pendingPlaybackSliceDecodes.set(mediaId, {
    requestedStartTime: partialStartTime,
    requestedCoverageEndTime: requiredCoverageEnd,
    promise: partialPromise,
  });

  try {
    if (waitTimeoutMs > 0) {
      return await Promise.race([
        partialPromise,
        (async () => {
          await sleep(waitTimeoutMs);
          return {
            buffer: await (pendingFullDecodePromise ?? getOrDecodeAudio(mediaId, src)),
            startTime: 0,
            isComplete: true,
          } satisfies PlaybackAudioSlice;
        })(),
      ]);
    }
    return await partialPromise;
  } finally {
    const pendingSlice = pendingPlaybackSliceDecodes.get(mediaId);
    if (pendingSlice?.promise === partialPromise) {
      pendingPlaybackSliceDecodes.delete(mediaId);
    }
  }
}

export async function getOrDecodeAudioForPlayback(
  mediaId: string,
  src: PreviewAudioSource,
  options?: {
    minReadySeconds?: number;
    waitTimeoutMs?: number;
    targetTimeSeconds?: number;
    preRollSeconds?: number;
  }
): Promise<AudioBuffer> {
  const slice = await getOrDecodeAudioSliceForPlayback(mediaId, src, options);
  return slice.buffer;
}

/** Clear all cached preview audio buffers (call on project unload). */
export function clearPreviewAudioCache(): void {
  cache.clear();
  playbackSliceCache.clear();
  pendingPlaybackSliceDecodes.clear();
  accessOrder.length = 0;
  currentCacheBytes = 0;
  log.debug('Preview audio cache cleared');
}

// ---------------------------------------------------------------------------
// Load from IndexedDB bins
// ---------------------------------------------------------------------------

async function loadOrDecodeAudio(mediaId: string, src: PreviewAudioSource): Promise<AudioBuffer> {
  // Try IndexedDB
  try {
    const cached = await getDecodedPreviewAudio(mediaId);
    if (cached && 'kind' in cached && cached.kind === 'meta') {
      try {
        return await loadFromBins(cached as DecodedPreviewAudioMeta);
      } catch (err) {
        log.warn('Cached decoded audio is incomplete/invalid, re-decoding', { mediaId, err });
        await deleteDecodedPreviewAudio(mediaId).catch(() => undefined);
      }
    } else if (cached) {
      // Legacy single-record cache format - remove and re-decode.
      await deleteDecodedPreviewAudio(mediaId).catch(() => undefined);
    }
  } catch (err) {
    log.warn('Failed to load from IndexedDB, will decode', { mediaId, err });
  }

  // Full decode with progressive bin persistence
  return decodeFullAudio(mediaId, src);
}

async function loadFromBins(meta: DecodedPreviewAudioMeta): Promise<AudioBuffer> {
  const { mediaId, sampleRate, totalFrames, binCount } = meta;

  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isFinite(totalFrames) || totalFrames <= 0 || binCount <= 0) {
    throw new Error('Invalid decoded preview audio meta');
  }

  const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate);
  const buffer = offlineCtx.createBuffer(2, totalFrames, sampleRate);
  const leftChannel = buffer.getChannelData(0);
  const rightChannel = buffer.getChannelData(1);

  // Load all bins in parallel
  const binPromises = Array.from({ length: binCount }, (_, i) =>
    getDecodedPreviewAudio(binKey(mediaId, i))
  );
  const bins = await Promise.all(binPromises);

  let offset = 0;
  for (let i = 0; i < bins.length; i++) {
    const bin = bins[i];
    if (!(bin && 'kind' in bin && bin.kind === 'bin')) {
      throw new Error(`Missing decoded audio bin ${i}`);
    }

    const b = bin as DecodedPreviewAudioBin;
    if (b.frames <= 0) {
      throw new Error(`Invalid frame count in decoded audio bin ${i}`);
    }

    const leftInt16 = new Int16Array(b.left);
    const rightInt16 = new Int16Array(b.right);

    if (leftInt16.length !== b.frames || rightInt16.length !== b.frames) {
      throw new Error(`Corrupt decoded audio bin ${i}`);
    }
    if (offset + b.frames > totalFrames) {
      throw new Error(`Decoded audio bins exceed expected frame length (${mediaId})`);
    }

    leftChannel.set(int16ToFloat32(leftInt16), offset);
    rightChannel.set(int16ToFloat32(rightInt16), offset);
    offset += b.frames;
  }

  if (offset !== totalFrames) {
    throw new Error(`Decoded audio bins incomplete: ${offset}/${totalFrames} frames`);
  }

  log.info('Loaded decoded audio from IndexedDB', {
    mediaId,
    binCount,
    sampleRate,
    duration: buffer.duration.toFixed(2),
    sizeMB: ((totalFrames * 2 * 2) / (1024 * 1024)).toFixed(1),
  });

  return buffer;
}

// ---------------------------------------------------------------------------
// Downmix surround -> stereo (ITU-R BS.775)
// ---------------------------------------------------------------------------

/**
 * Downmix N-channel audio to stereo using standard ITU-R BS.775 coefficients.
 * 5.1 layout: L R C LFE Ls Rs
 * 7.1 layout: L R C LFE Ls Rs Lrs Rrs (rear surrounds folded into Ls/Rs)
 *
 * For mono/stereo input, returns the data unchanged (or duplicated for mono).
 */
function downmixToStereo(
  channels: Float32Array[],
  totalFrames: number,
): { left: Float32Array; right: Float32Array } {
  const numCh = channels.length;

  if (numCh <= 2) {
    const left = channels[0] ?? new Float32Array(totalFrames);
    const right = channels[1] ?? left;
    return { left, right };
  }

  // ITU coefficients for 5.1 downmix
  const centerGain = 0.7071; // -3 dB
  const lfeGain = 0;         // discard LFE for preview
  const surroundGain = 0.7071;

  const left = new Float32Array(totalFrames);
  const right = new Float32Array(totalFrames);

  const L = channels[0]!;
  const R = channels[1]!;
  const C = channels[2];
  const LFE = channels[3]; // used with lfeGain (0)
  const Ls = channels[4];
  const Rs = channels[5];
  // 7.1 rear surrounds (fold into Ls/Rs)
  const Lrs = channels[6];
  const Rrs = channels[7];

  for (let i = 0; i < totalFrames; i++) {
    let l = L[i]!;
    let r = R[i]!;

    if (C) {
      const c = C[i]! * centerGain;
      l += c;
      r += c;
    }
    if (lfeGain !== 0 && LFE) {
      const lfe = LFE[i]! * lfeGain;
      l += lfe;
      r += lfe;
    }
    if (Ls) l += Ls[i]! * surroundGain;
    if (Rs) r += Rs[i]! * surroundGain;
    if (Lrs) l += Lrs[i]! * surroundGain;
    if (Rrs) r += Rrs[i]! * surroundGain;

    left[i] = l;
    right[i] = r;
  }

  return { left, right };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assembleChunks(chunks: Float32Array[], totalFrames: number): Float32Array {
  const result = new Float32Array(totalFrames);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function buildPreviewStereoBuffer(
  leftChunks: Float32Array[],
  rightChunks: Float32Array[],
  totalFrames: number,
  sampleRate: number,
): Promise<AudioBuffer> {
  const left = assembleChunks(leftChunks, totalFrames);
  const right = assembleChunks(rightChunks, totalFrames);

  const tempCtx = new OfflineAudioContext(2, totalFrames, sampleRate);
  const tempBuffer = tempCtx.createBuffer(2, totalFrames, sampleRate);
  tempBuffer.getChannelData(0).set(left);
  tempBuffer.getChannelData(1).set(right);

  return downsampleBuffer(tempBuffer, STORAGE_SAMPLE_RATE);
}

/**
 * Downsample, convert to Int16, and persist one bin to IndexedDB.
 * Returns persisted Int16 data so playback can be assembled without
 * retaining a massive full-resolution decode in memory.
 */
async function persistBin(
  mediaId: string,
  binIdx: number,
  leftChunks: Float32Array[],
  rightChunks: Float32Array[],
  frames: number,
  sampleRate: number,
): Promise<{
  binIndex: number;
  frames: number;
  sampleRate: number;
  left: Int16Array;
  right: Int16Array;
}> {
  const downsampled = await buildPreviewStereoBuffer(leftChunks, rightChunks, frames, sampleRate);

  const leftInt16 = float32ToInt16(downsampled.getChannelData(0));
  const rightInt16 = float32ToInt16(downsampled.getChannelData(1));

  await saveDecodedPreviewAudio({
    id: binKey(mediaId, binIdx),
    mediaId,
    kind: 'bin',
    binIndex: binIdx,
    left: leftInt16.buffer as ArrayBuffer,
    right: rightInt16.buffer as ArrayBuffer,
    frames: downsampled.length,
    sampleRate: downsampled.sampleRate,
    createdAt: Date.now(),
  });

  return {
    binIndex: binIdx,
    frames: downsampled.length,
    sampleRate: downsampled.sampleRate,
    left: leftInt16,
    right: rightInt16,
  };
}

// ---------------------------------------------------------------------------
// Full decode with progressive bin persistence
// ---------------------------------------------------------------------------

async function shouldPreRegisterAc3Decoder(mediaId: string): Promise<boolean> {
  try {
    const media = await getMedia(mediaId);
    if (!media) return false;

    const codec = media.mimeType.startsWith('audio/')
      ? media.codec
      : media.audioCodec;
    return isAc3AudioCodec(codec);
  } catch (err) {
    log.debug('Failed to load media metadata for AC-3 decoder pre-check', { mediaId, err });
    return false;
  }
}

async function decodeFullAudio(
  mediaId: string,
  src: PreviewAudioSource,
  ac3RetryAttempted: boolean = false,
): Promise<AudioBuffer> {
  log.info('Decoding audio for preview', {
    mediaId,
    src: typeof src === 'string'
      ? src.substring(0, 50)
      : `[blob:${src.type || 'application/octet-stream'} size=${src.size}]`,
  });
  const shouldRegisterAc3 = ac3RetryAttempted || await shouldPreRegisterAc3Decoder(mediaId);

  try {
    if (shouldRegisterAc3) {
      await ensureAc3DecoderRegistered();
    }

    const mb = await import('mediabunny');
    const input = new mb.Input({
      formats: mb.ALL_FORMATS,
      source: createInputSource(mb, src),
    });
    const audioTrack = await input.getPrimaryAudioTrack();
    try {
      if (!audioTrack) {
        throw new Error(`No audio track found for media ${mediaId}`);
      }

      const sink = new mb.AudioSampleSink(audioTrack);

      let sampleRate = 48000;

      // Per-bin accumulation for progressive persistence
      let binLeftChunks: Float32Array[] = [];
      let binRightChunks: Float32Array[] = [];
      let binAccumFrames = 0;
      let binIndex = 0;
      const binFlushPromises: Array<Promise<{
        binIndex: number;
        frames: number;
        sampleRate: number;
        left: Int16Array;
        right: Int16Array;
      }>> = [];

      for await (const sample of sink.samples()) {
        try {
          const sampleData = sample as {
            numberOfFrames?: number;
            numberOfChannels?: number;
            sampleRate?: number;
            copyTo: (destination: Float32Array, options: { planeIndex: number; format: 'f32-planar' }) => void;
          };
          const frameCount = Math.max(0, sampleData.numberOfFrames ?? 0);
          const channelCount = Math.max(1, sampleData.numberOfChannels ?? 1);
          if (frameCount === 0) {
            continue;
          }
          if (sampleData.sampleRate && sampleData.sampleRate > 0) {
            sampleRate = sampleData.sampleRate;
          }

          // Extract channels and downmix to stereo immediately.
          const channels: Float32Array[] = [];
          for (let c = 0; c < channelCount; c++) {
            const channelData = new Float32Array(frameCount);
            sampleData.copyTo(channelData, { planeIndex: c, format: 'f32-planar' });
            channels.push(channelData);
          }
          const { left, right } = downmixToStereo(channels, frameCount);

          // Accumulate for current bin
          binLeftChunks.push(left);
          binRightChunks.push(right);
          binAccumFrames += frameCount;

          // Flush bin when it reaches the target duration
          const binFramesAtSource = BIN_DURATION_SEC * sampleRate;
          if (binAccumFrames >= binFramesAtSource) {
            binFlushPromises.push(
              persistBin(mediaId, binIndex, binLeftChunks, binRightChunks, binAccumFrames, sampleRate)
            );
            binIndex++;
            binLeftChunks = [];
            binRightChunks = [];
            binAccumFrames = 0;
          }
        } finally {
          sample.close();
        }
      }

      // Flush final partial bin
      if (binAccumFrames > 0) {
        binFlushPromises.push(
          persistBin(mediaId, binIndex, binLeftChunks, binRightChunks, binAccumFrames, sampleRate)
        );
        binIndex++;
      }

      // Wait for all bins and assemble playback buffer from downsampled bins.
      const totalBins = binIndex;
      const persistedBins = await Promise.all(binFlushPromises);
      persistedBins.sort((a, b) => a.binIndex - b.binIndex);

      const storedTotalFrames = persistedBins.reduce((sum, b) => sum + b.frames, 0);
      if (persistedBins.length === 0 || storedTotalFrames === 0) {
        throw new Error(`Audio decode produced no output for media ${mediaId}`);
      }

      const storedSampleRate = persistedBins[0]?.sampleRate ?? STORAGE_SAMPLE_RATE;
      const outCtx = new OfflineAudioContext(2, storedTotalFrames, storedSampleRate);
      const combined = outCtx.createBuffer(2, storedTotalFrames, storedSampleRate);
      const outLeft = combined.getChannelData(0);
      const outRight = combined.getChannelData(1);

      let offset = 0;
      for (const bin of persistedBins) {
        outLeft.set(int16ToFloat32(bin.left), offset);
        outRight.set(int16ToFloat32(bin.right), offset);
        offset += bin.frames;
      }
      if (offset !== storedTotalFrames) {
        throw new Error(`Decoded audio assembly mismatch: ${offset}/${storedTotalFrames} frames`);
      }

      log.info('Audio decoded for preview', {
        mediaId,
        sampleRate: storedSampleRate,
        duration: combined.duration.toFixed(2),
        bins: totalBins,
        sizeMB: ((storedTotalFrames * 2 * 2) / (1024 * 1024)).toFixed(1),
      });

      void persistPreviewAudioConform(mediaId, combined);

      // Save meta last as the decode-complete marker.
      void saveDecodedPreviewAudio({
        id: mediaId,
        mediaId,
        kind: 'meta',
        sampleRate: storedSampleRate,
        totalFrames: storedTotalFrames,
        binCount: totalBins,
        binDurationSec: BIN_DURATION_SEC,
        createdAt: Date.now(),
      }).then(() => {
        log.info('All bins persisted to IndexedDB', { mediaId, binCount: totalBins });
      }).catch((err) => {
        log.warn('Failed to persist bins to IndexedDB', { mediaId, err });
      });

      return combined;
    } finally {
      input.dispose();
    }
  } catch (err) {
    if (!ac3RetryAttempted && !shouldRegisterAc3) {
      try {
        return await decodeFullAudio(mediaId, src, true);
      } catch {
        // Keep original decode error as the primary failure signal.
      }
    }
    throw err;
  }
}
