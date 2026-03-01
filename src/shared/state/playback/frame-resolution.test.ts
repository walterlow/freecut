import { describe, expect, it } from 'vitest';
import { getResolvedPlaybackFrame } from './frame-resolution';

describe('getResolvedPlaybackFrame', () => {
  it('uses currentFrame while playing', () => {
    expect(getResolvedPlaybackFrame({
      currentFrame: 120,
      previewFrame: 90,
      displayedFrame: 80,
      isPlaying: true,
      currentFrameEpoch: 4,
      previewFrameEpoch: 5,
    })).toBe(120);
  });

  it('uses displayedFrame when paused and overlay frame exists', () => {
    expect(getResolvedPlaybackFrame({
      currentFrame: 120,
      previewFrame: 140,
      displayedFrame: 132,
      isPlaying: false,
      currentFrameEpoch: 4,
      previewFrameEpoch: 5,
    })).toBe(132);
  });

  it('falls back to previewFrame/currentFrame ordering when displayedFrame is null', () => {
    expect(getResolvedPlaybackFrame({
      currentFrame: 120,
      previewFrame: 140,
      displayedFrame: null,
      isPlaying: false,
      currentFrameEpoch: 4,
      previewFrameEpoch: 5,
    })).toBe(140);
    expect(getResolvedPlaybackFrame({
      currentFrame: 120,
      previewFrame: 140,
      displayedFrame: null,
      isPlaying: false,
      currentFrameEpoch: 6,
      previewFrameEpoch: 5,
    })).toBe(120);
  });
});
