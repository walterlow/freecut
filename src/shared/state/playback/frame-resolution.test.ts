import { describe, expect, it } from 'vitest';
import { getResolvedPlaybackFrame } from './frame-resolution';

describe('getResolvedPlaybackFrame', () => {
  it('uses currentFrame while playing', () => {
    expect(getResolvedPlaybackFrame({
      currentFrame: 120,
      previewFrame: 90,
      displayedFrame: 80,
      isPlaying: true,
    })).toBe(120);
  });

  it('uses displayedFrame when paused and overlay frame exists', () => {
    expect(getResolvedPlaybackFrame({
      currentFrame: 120,
      previewFrame: 140,
      displayedFrame: 132,
      isPlaying: false,
    })).toBe(132);
  });

  it('uses previewFrame when paused and displayedFrame is null', () => {
    expect(getResolvedPlaybackFrame({
      currentFrame: 120,
      previewFrame: 140,
      displayedFrame: null,
      isPlaying: false,
    })).toBe(140);
  });

  it('falls back to currentFrame when paused and previewFrame is null', () => {
    expect(getResolvedPlaybackFrame({
      currentFrame: 120,
      previewFrame: null,
      displayedFrame: null,
      isPlaying: false,
    })).toBe(120);
  });
});
