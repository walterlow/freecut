import { describe, expect, it } from 'vitest';
import type { CachedWaveform } from '../services/waveform-cache';
import { mixCompoundClipWaveformPeaks } from './compound-clip-waveform';

function makeWaveform(peaks: number[], sampleRate = 10): CachedWaveform {
  return {
    peaks: new Float32Array(peaks),
    duration: peaks.length / sampleRate,
    sampleRate,
    channels: 1,
    stereo: false,
    sizeBytes: peaks.length * Float32Array.BYTES_PER_ELEMENT,
    lastAccessed: Date.now(),
    isComplete: true,
  };
}

describe('mixCompoundClipWaveformPeaks', () => {
  it('mixes overlapping owned audio sources into a single waveform proxy', () => {
    const waveformsByMediaId = new Map<string, CachedWaveform>([
      ['media-a', makeWaveform([0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2])],
      ['media-b', makeWaveform([0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3])],
    ]);

    const result = mixCompoundClipWaveformPeaks({
      sources: [
        {
          itemId: 'audio-a',
          mediaId: 'media-a',
          from: 0,
          durationInFrames: 4,
          sourceStart: 0,
          sourceFps: 4,
          speed: 1,
        },
        {
          itemId: 'audio-b',
          mediaId: 'media-b',
          from: 2,
          durationInFrames: 2,
          sourceStart: 0,
          sourceFps: 4,
          speed: 1,
        },
      ],
      waveformsByMediaId,
      durationInFrames: 4,
      fps: 4,
    });

    expect(result.sampleRate).toBe(10);
    expect(result.peaks[0]).toBeCloseTo(0.2, 5);
    expect(result.peaks[4]).toBeCloseTo(0.2, 5);
    expect(result.peaks[5]).toBeCloseTo(Math.hypot(0.2, 0.3), 5);
    expect(result.peaks[8]).toBeCloseTo(Math.hypot(0.2, 0.3), 5);
  });

  it('uses sourceStart and speed when sampling source waveforms', () => {
    const waveformsByMediaId = new Map<string, CachedWaveform>([
      ['media-a', makeWaveform([0.1, 0.2, 0.3, 0.4, 0.5], 5)],
    ]);

    const result = mixCompoundClipWaveformPeaks({
      sources: [{
        itemId: 'audio-a',
        mediaId: 'media-a',
        from: 0,
        durationInFrames: 2,
        sourceStart: 1,
        sourceFps: 2,
        speed: 2,
      }],
      waveformsByMediaId,
      durationInFrames: 2,
      fps: 2,
    });

    expect(result.peaks[0]).toBeCloseTo(0.3, 5);
    expect(result.peaks[1]).toBeCloseTo(0.5, 5);
    expect(result.peaks[2]).toBe(0);
    expect(result.peaks[3]).toBe(0);
  });
});
