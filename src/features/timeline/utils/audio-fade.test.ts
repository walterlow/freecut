import { describe, expect, it } from 'vitest';
import {
  getAudioFadeHandleLeft,
  getAudioFadePixels,
  getAudioFadeRatio,
  getAudioFadeSecondsFromOffset,
} from './audio-fade';

describe('audio-fade utils', () => {
  it('converts fade seconds to clipped pixel widths', () => {
    expect(getAudioFadePixels(1, 30, (frame) => frame * 2, 40)).toBe(40);
    expect(getAudioFadePixels(0.5, 30, (frame) => frame, 100)).toBe(15);
    expect(getAudioFadePixels(0, 30, (frame) => frame, 100)).toBe(0);
  });

  it('converts fade seconds into clip-width ratios', () => {
    expect(getAudioFadeRatio(1, 30, 90)).toBeCloseTo(1 / 3, 5);
    expect(getAudioFadeRatio(10, 30, 90)).toBe(1);
    expect(getAudioFadeRatio(0, 30, 90)).toBe(0);
  });

  it('converts pointer offsets into fade seconds for both handles', () => {
    expect(getAudioFadeSecondsFromOffset({
      handle: 'in',
      clipWidthPixels: 100,
      pointerOffsetPixels: 20,
      fps: 30,
      maxDurationFrames: 90,
    })).toBeCloseTo(18 / 30, 5);

    expect(getAudioFadeSecondsFromOffset({
      handle: 'out',
      clipWidthPixels: 100,
      pointerOffsetPixels: 70,
      fps: 30,
      maxDurationFrames: 90,
    })).toBeCloseTo(27 / 30, 5);
  });

  it('returns handle anchor positions inside the clip bounds', () => {
    expect(getAudioFadeHandleLeft({ handle: 'in', clipWidthPixels: 120, fadePixels: 24 })).toBe(24);
    expect(getAudioFadeHandleLeft({ handle: 'out', clipWidthPixels: 120, fadePixels: 24 })).toBe(96);
    expect(getAudioFadeHandleLeft({ handle: 'out', clipWidthPixels: 120, fadePixels: 300 })).toBe(0);
  });
});
