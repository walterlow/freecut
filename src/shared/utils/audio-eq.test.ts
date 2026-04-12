import { describe, expect, it } from 'vitest';
import {
  applyAudioEqStages,
  areAudioEqStagesEqual,
  clampAudioEqGainDb,
  resolvePreviewAudioEqStages,
} from './audio-eq';

function makeSineWave(frequencyHz: number, sampleRate = 48000, seconds = 0.25): Float32Array {
  const length = Math.floor(sampleRate * seconds);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    samples[i] = Math.sin(2 * Math.PI * frequencyHz * (i / sampleRate));
  }
  return samples;
}

function rms(samples: Float32Array): number {
  let total = 0;
  for (let i = 0; i < samples.length; i++) {
    total += samples[i]! * samples[i]!;
  }
  return Math.sqrt(total / Math.max(1, samples.length));
}

describe('audio-eq', () => {
  it('clamps gains into the supported range', () => {
    expect(clampAudioEqGainDb(40)).toBe(18);
    expect(clampAudioEqGainDb(-40)).toBe(-18);
    expect(clampAudioEqGainDb(Number.NaN)).toBe(0);
  });

  it('applies preview overrides only to the last EQ stage', () => {
    const resolved = resolvePreviewAudioEqStages(
      [
        { lowGainDb: 1, midGainDb: 2, highGainDb: 3 },
        { lowGainDb: 4, midGainDb: 5, highGainDb: 6 },
      ],
      { audioEqMidGainDb: 8 },
    );

    expect(resolved).toEqual([
      { lowGainDb: 1, midGainDb: 2, highGainDb: 3 },
      { lowGainDb: 4, midGainDb: 8, highGainDb: 6 },
    ]);
  });

  it('compares stage arrays structurally', () => {
    expect(areAudioEqStagesEqual(
      [{ lowGainDb: 1, midGainDb: 0, highGainDb: 0 }],
      [{ lowGainDb: 1, midGainDb: 0, highGainDb: 0 }],
    )).toBe(true);
    expect(areAudioEqStagesEqual(
      [{ lowGainDb: 1, midGainDb: 0, highGainDb: 0 }],
      [{ lowGainDb: 0, midGainDb: 0, highGainDb: 0 }],
    )).toBe(false);
  });

  it('boosts and cuts the expected frequency band', () => {
    const lowTone = makeSineWave(100);
    const highTone = makeSineWave(8000);

    const lowBoosted = applyAudioEqStages([lowTone], 48000, [
      { lowGainDb: 9, midGainDb: 0, highGainDb: 0 },
    ])[0]!;
    const lowCut = applyAudioEqStages([lowTone], 48000, [
      { lowGainDb: -9, midGainDb: 0, highGainDb: 0 },
    ])[0]!;
    const highBoosted = applyAudioEqStages([highTone], 48000, [
      { lowGainDb: 0, midGainDb: 0, highGainDb: 9 },
    ])[0]!;

    expect(rms(lowBoosted) / rms(lowTone)).toBeGreaterThan(1.5);
    expect(rms(lowCut) / rms(lowTone)).toBeLessThan(0.75);
    expect(rms(highBoosted) / rms(highTone)).toBeGreaterThan(1.5);
  });
});
