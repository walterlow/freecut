import React, { useEffect, useState } from 'react';
import { PitchCorrectedAudio } from './pitch-corrected-audio';
import { CustomDecoderBufferedAudio } from './custom-decoder-buffered-audio';
import { getOrDecodeAudio } from '../utils/audio-decode-cache';
import { createLogger } from '@/shared/logging/logger';
import { getDecodedPreviewAudio } from '@/infrastructure/storage/indexeddb';
import type { DecodedPreviewAudioBin, DecodedPreviewAudioMeta } from '@/types/storage';

const log = createLogger('CustomDecoderAudio');

interface CustomDecoderAudioProps {
  src: string;
  mediaId: string;
  itemId: string;
  trimBefore?: number;
  sourceFps?: number;
  volume?: number;
  playbackRate?: number;
  muted?: boolean;
  durationInFrames: number;
  audioFadeIn?: number;
  audioFadeOut?: number;
  crossfadeFadeIn?: number;
  crossfadeFadeOut?: number;
}

interface DecodedWavEntry {
  url: string | null;
  promise: Promise<string> | null;
  refs: number;
}

const decodedWavUrlCache = new Map<string, DecodedWavEntry>();

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function floatToInt16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

function createWavHeader(sampleRate: number, channels: number, totalFrames: number): ArrayBuffer {
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const pcmByteLength = totalFrames * blockAlign;
  const headerSize = 44;

  const header = new ArrayBuffer(headerSize);
  const view = new DataView(header);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmByteLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, 'data');
  view.setUint32(40, pcmByteLength, true);
  return header;
}

function interleaveStereoInt16(left: Int16Array, right: Int16Array, frames: number): ArrayBuffer {
  const interleaved = new Int16Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    interleaved[i * 2] = left[i] ?? 0;
    interleaved[i * 2 + 1] = right[i] ?? 0;
  }
  return interleaved.buffer;
}

function binKey(mediaId: string, index: number): string {
  return `${mediaId}:bin:${index}`;
}

async function tryBuildWavBlobFromStoredBins(mediaId: string): Promise<Blob | null> {
  const metaRecord = await getDecodedPreviewAudio(mediaId);
  if (!(metaRecord && 'kind' in metaRecord && metaRecord.kind === 'meta')) {
    return null;
  }

  const meta = metaRecord as DecodedPreviewAudioMeta;
  if (meta.sampleRate <= 0 || meta.totalFrames <= 0 || meta.binCount <= 0) {
    return null;
  }

  const binPromises = Array.from({ length: meta.binCount }, (_, i) =>
    getDecodedPreviewAudio(binKey(mediaId, i))
  );
  const bins = await Promise.all(binPromises);

  const parts: BlobPart[] = [createWavHeader(meta.sampleRate, 2, meta.totalFrames)];
  let frameOffset = 0;

  for (let i = 0; i < bins.length; i++) {
    const record = bins[i];
    if (!(record && 'kind' in record && record.kind === 'bin')) {
      return null;
    }
    const bin = record as DecodedPreviewAudioBin;
    if (bin.binIndex !== i || bin.frames <= 0) {
      return null;
    }

    const left = new Int16Array(bin.left);
    const right = new Int16Array(bin.right);
    if (left.length !== bin.frames || right.length !== bin.frames) {
      return null;
    }
    if (frameOffset + bin.frames > meta.totalFrames) {
      return null;
    }

    parts.push(interleaveStereoInt16(left, right, bin.frames));
    frameOffset += bin.frames;
  }

  if (frameOffset !== meta.totalFrames) {
    return null;
  }

  return new Blob(parts, { type: 'audio/wav' });
}

function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const channels = Math.max(1, Math.min(2, buffer.numberOfChannels));
  const frameCount = buffer.length;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const pcmByteLength = frameCount * blockAlign;
  const headerSize = 44;

  const out = new ArrayBuffer(headerSize + pcmByteLength);
  const view = new DataView(out);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmByteLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, 'data');
  view.setUint32(40, pcmByteLength, true);

  const left = buffer.getChannelData(0);
  const right = channels > 1
    ? buffer.getChannelData(1)
    : left;

  let offset = headerSize;
  for (let i = 0; i < frameCount; i++) {
    view.setInt16(offset, floatToInt16(left[i] ?? 0), true);
    offset += 2;
    if (channels > 1) {
      view.setInt16(offset, floatToInt16(right[i] ?? 0), true);
      offset += 2;
    }
  }

  return new Blob([out], { type: 'audio/wav' });
}

async function getOrCreateDecodedWavUrl(mediaId: string, src: string): Promise<string> {
  const existing = decodedWavUrlCache.get(mediaId);
  if (existing) {
    existing.refs += 1;
    if (existing.url) {
      return existing.url;
    }
    if (existing.promise) {
      return existing.promise;
    }
  }

  const entry: DecodedWavEntry = {
    url: null,
    promise: null,
    refs: 1,
  };
  decodedWavUrlCache.set(mediaId, entry);

  entry.promise = (async () => {
    // Fast path: rebuild WAV directly from persisted Int16 bins.
    const storedBlob = await tryBuildWavBlobFromStoredBins(mediaId);
    if (storedBlob) {
      const url = URL.createObjectURL(storedBlob);
      entry.url = url;
      entry.promise = null;
      return url;
    }

    // Fallback: decode/reassemble buffer, then encode WAV.
    const audioBuffer = await getOrDecodeAudio(mediaId, src);
    const wavBlob = audioBufferToWavBlob(audioBuffer);
    const url = URL.createObjectURL(wavBlob);
    entry.url = url;
    entry.promise = null;
    return url;
  })().catch((error) => {
    decodedWavUrlCache.delete(mediaId);
    throw error;
  });

  return entry.promise;
}

function releaseDecodedWavUrl(mediaId: string): void {
  const entry = decodedWavUrlCache.get(mediaId);
  if (!entry) return;

  entry.refs -= 1;
  if (entry.refs > 0) return;

  const revoke = (url: string) => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  };

  if (entry.url) {
    revoke(entry.url);
  } else if (entry.promise) {
    entry.promise.then(revoke).catch(() => undefined);
  }

  decodedWavUrlCache.delete(mediaId);
}

const CustomDecoderPitchPreservedAudio: React.FC<CustomDecoderAudioProps> = ({
  src,
  mediaId,
  itemId,
  trimBefore = 0,
  sourceFps,
  volume = 0,
  playbackRate = 1,
  muted = false,
  durationInFrames,
  audioFadeIn = 0,
  audioFadeOut = 0,
  crossfadeFadeIn,
  crossfadeFadeOut,
}) => {
  const [decodedSrc, setDecodedSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!mediaId || !src) return;

    let cancelled = false;
    setDecodedSrc(null);

    getOrCreateDecodedWavUrl(mediaId, src)
      .then((url) => {
        if (cancelled) return;
        setDecodedSrc(url);
        log.info('Decoded WAV source ready', { mediaId });
      })
      .catch((err) => {
        if (cancelled) return;
        log.error('Failed to prepare decoded WAV source', { mediaId, err });
      });

    return () => {
      cancelled = true;
      releaseDecodedWavUrl(mediaId);
    };
  }, [mediaId, src]);

  if (!decodedSrc) return null;

  return (
    <PitchCorrectedAudio
      src={decodedSrc}
      itemId={itemId}
      trimBefore={trimBefore}
      sourceFps={sourceFps}
      volume={volume}
      playbackRate={playbackRate}
      muted={muted}
      durationInFrames={durationInFrames}
      audioFadeIn={audioFadeIn}
      audioFadeOut={audioFadeOut}
      crossfadeFadeIn={crossfadeFadeIn}
      crossfadeFadeOut={crossfadeFadeOut}
    />
  );
};

/**
 * Custom decoder adapter for codecs that native media elements cannot decode
 * reliably (for example AC-3/E-AC-3 and PCM endian variants).
 *
 * - playbackRate === 1: use buffered WebAudio playback directly from decoded bins
 *   for fastest startup after refresh.
 * - playbackRate !== 1: delegate to PitchCorrectedAudio via decoded WAV URL
 *   to preserve pitch on speed changes.
 */
export const CustomDecoderAudio: React.FC<CustomDecoderAudioProps> = React.memo((props) => {
  const playbackRate = props.playbackRate ?? 1;
  const shouldUseBufferedPlayback = Math.abs(playbackRate - 1) <= 0.0001;

  if (shouldUseBufferedPlayback) {
    return <CustomDecoderBufferedAudio {...props} playbackRate={playbackRate} />;
  }

  return <CustomDecoderPitchPreservedAudio {...props} playbackRate={playbackRate} />;
});

