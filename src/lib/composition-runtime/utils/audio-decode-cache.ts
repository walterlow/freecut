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

import { createLogger } from '@/lib/logger';
import {
  getDecodedPreviewAudio,
  saveDecodedPreviewAudio,
  deleteDecodedPreviewAudio,
} from '@/lib/storage/indexeddb/decoded-preview-audio';
import type { DecodedPreviewAudioMeta, DecodedPreviewAudioBin } from '@/types/storage';

const log = createLogger('PreviewAudioCache');

const cache = new Map<string, AudioBuffer>();
const pendingDecodes = new Map<string, Promise<AudioBuffer>>();
let ac3Registered = false;
const PLAYABLE_PARTIAL_POLL_MS = 150;
const PLAYABLE_PARTIAL_TIMEOUT_MS = 8000;

/** Sample rate for IndexedDB storage; 22050 Hz is sufficient for preview. */
const STORAGE_SAMPLE_RATE = 22050;

/** Bin duration in seconds for chunked IndexedDB storage. */
const BIN_DURATION_SEC = 10;

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
  const targetFrames = Math.ceil(buffer.length * ratio);
  const offlineCtx = new OfflineAudioContext(buffer.numberOfChannels, targetFrames, targetRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start();
  return offlineCtx.startRendering();
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a cached AudioBuffer or decode one via mediabunny.
 * Checks: memory cache -> IndexedDB bins -> decode (persists bins progressively).
 * Concurrent calls for the same mediaId share a single promise.
 */
function ensureDecodeStarted(mediaId: string, src: string): Promise<AudioBuffer> {
  const pending = pendingDecodes.get(mediaId);
  if (pending) return pending;

  const promise = loadOrDecodeAudio(mediaId, src)
    .then((buffer) => {
      cache.set(mediaId, buffer);
      return buffer;
    })
    .finally(() => {
      pendingDecodes.delete(mediaId);
    });

  pendingDecodes.set(mediaId, promise);
  return promise;
}

export async function getOrDecodeAudio(mediaId: string, src: string): Promise<AudioBuffer> {
  const cached = cache.get(mediaId);
  if (cached) return cached;
  return ensureDecodeStarted(mediaId, src);
}

/** Returns true when a full decode/rebuild is currently in progress. */
export function isPreviewAudioDecodePending(mediaId: string): boolean {
  return pendingDecodes.has(mediaId);
}

async function loadPartialFromBins(
  mediaId: string,
  minSeconds: number,
): Promise<AudioBuffer | null> {
  const metaRecord = await getDecodedPreviewAudio(mediaId);
  let storedSampleRate = (metaRecord && 'kind' in metaRecord && metaRecord.kind === 'meta'
    && Number.isFinite(metaRecord.sampleRate) && metaRecord.sampleRate > 0)
    ? metaRecord.sampleRate
    : 0;
  const bins: DecodedPreviewAudioBin[] = [];
  let totalFrames = 0;
  let minFrames = storedSampleRate > 0 ? Math.max(1, Math.floor(minSeconds * storedSampleRate)) : 0;

  // Load contiguous bins from the beginning until we have enough playable audio.
  for (let i = 0; i < 512; i++) {
    const record = await getDecodedPreviewAudio(binKey(mediaId, i));
    if (!(record && 'kind' in record && record.kind === 'bin')) {
      break;
    }

    const bin = record as DecodedPreviewAudioBin;
    if (bin.binIndex !== i || bin.frames <= 0) {
      break;
    }

    // Derive sample rate from first bin when meta is unavailable
    if (storedSampleRate <= 0 && bin.sampleRate && Number.isFinite(bin.sampleRate) && bin.sampleRate > 0) {
      storedSampleRate = bin.sampleRate;
      minFrames = Math.max(1, Math.floor(minSeconds * storedSampleRate));
    }

    bins.push(bin);
    totalFrames += bin.frames;
    if (minFrames > 0 && totalFrames >= minFrames) {
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

  return buffer;
}

/**
 * Playback-first helper for custom-decoded audio:
 * returns a partial buffer as soon as enough decoded bins are available,
 * while full decode continues in the background.
 */
export async function getOrDecodeAudioForPlayback(
  mediaId: string,
  src: string,
  options?: {
    minReadySeconds?: number;
    waitTimeoutMs?: number;
  }
): Promise<AudioBuffer> {
  const cached = cache.get(mediaId);
  if (cached) return cached;

  const minReadySeconds = Math.max(1, options?.minReadySeconds ?? 8);
  const waitTimeoutMs = Math.max(0, options?.waitTimeoutMs ?? PLAYABLE_PARTIAL_TIMEOUT_MS);
  const fullDecodePromise = ensureDecodeStarted(mediaId, src);

  // If bins are already present from a previous run/decode, use them immediately.
  const immediatePartial = await loadPartialFromBins(mediaId, minReadySeconds);
  if (immediatePartial) {
    return immediatePartial;
  }

  // Poll briefly for the first playable bins before falling back to full decode wait.
  const deadline = Date.now() + waitTimeoutMs;
  while (Date.now() < deadline && pendingDecodes.has(mediaId)) {
    const partial = await loadPartialFromBins(mediaId, minReadySeconds);
    if (partial) {
      return partial;
    }
    await sleep(PLAYABLE_PARTIAL_POLL_MS);
  }

  return fullDecodePromise;
}

/** Clear all cached preview audio buffers (call on project unload). */
export function clearPreviewAudioCache(): void {
  cache.clear();
  log.debug('Preview audio cache cleared');
}

// ---------------------------------------------------------------------------
// Load from IndexedDB bins
// ---------------------------------------------------------------------------

async function loadOrDecodeAudio(mediaId: string, src: string): Promise<AudioBuffer> {
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
  const left = assembleChunks(leftChunks, frames);
  const right = assembleChunks(rightChunks, frames);

  // Build temp AudioBuffer at source rate for downsampling
  const tempCtx = new OfflineAudioContext(2, frames, sampleRate);
  const tempBuffer = tempCtx.createBuffer(2, frames, sampleRate);
  tempBuffer.getChannelData(0).set(left);
  tempBuffer.getChannelData(1).set(right);

  const downsampled = await downsampleBuffer(tempBuffer, STORAGE_SAMPLE_RATE);

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

async function decodeFullAudio(mediaId: string, src: string): Promise<AudioBuffer> {
  log.info('Decoding audio for preview', { mediaId, src: src.substring(0, 50) });

  const mb = await import('mediabunny');
  if (!ac3Registered) {
    const { registerAc3Decoder } = await import('@mediabunny/ac3');
    registerAc3Decoder();
    ac3Registered = true;
  }

  const input = new mb.Input({
    formats: mb.ALL_FORMATS,
    source: new mb.UrlSource(src),
  });

  const audioTrack = await input.getPrimaryAudioTrack();
  if (!audioTrack) {
    throw new Error(`No audio track found for media ${mediaId}`);
  }

  const duration = await input.computeDuration();
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

  for await (const sample of sink.samples(0, duration)) {
    const buf = sample.toAudioBuffer();
    sampleRate = buf.sampleRate;

    // Extract channels and downmix to stereo immediately
    const channels: Float32Array[] = [];
    for (let c = 0; c < buf.numberOfChannels; c++) {
      channels.push(new Float32Array(buf.getChannelData(c)));
    }
    const { left, right } = downmixToStereo(channels, buf.length);

    // Accumulate for current bin
    binLeftChunks.push(left);
    binRightChunks.push(right);
    binAccumFrames += buf.length;

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

    sample.close();
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
}
