import { describe, expect, it } from 'vitest';
import { buildStandaloneAudioSegments, buildTransitionVideoAudioSegments } from './audio-scene';

describe('audio scene', () => {
  it('merges continuous standalone audio segments', () => {
    const segments = buildStandaloneAudioSegments([
      {
        id: 'audio-1',
        type: 'audio',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 30,
        src: 'audio.mp3',
        label: 'Audio 1',
        mediaId: 'media-1',
        sourceStart: 0,
        sourceFps: 30,
        muted: false,
        trackVisible: true,
      },
      {
        id: 'audio-2',
        type: 'audio',
        trackId: 'track-1',
        from: 30,
        durationInFrames: 20,
        src: 'audio.mp3',
        label: 'Audio 2',
        mediaId: 'media-1',
        sourceFps: 30,
        muted: false,
        trackVisible: true,
      },
    ], 30);

    expect(segments).toEqual([
      expect.objectContaining({
        itemId: 'audio-1',
        from: 0,
        durationInFrames: 50,
        trimBefore: 0,
      }),
    ]);
  });

  it('expands transition video audio segments with overlap fades', () => {
    const segments = buildTransitionVideoAudioSegments([
      {
        id: 'video-1',
        type: 'video',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 30,
        src: 'video.mp4',
        label: 'Video 1',
        mediaId: 'media-1',
        sourceStart: 0,
        sourceFps: 30,
        muted: false,
        trackVisible: true,
      },
      {
        id: 'video-2',
        type: 'video',
        trackId: 'track-1',
        from: 20,
        durationInFrames: 30,
        src: 'video-2.mp4',
        label: 'Video 2',
        mediaId: 'media-2',
        sourceStart: 0,
        sourceFps: 30,
        muted: false,
        trackVisible: true,
      },
    ], [
      {
        id: 'transition-1',
        leftClipId: 'video-1',
        rightClipId: 'video-2',
        durationInFrames: 10,
        timing: 'linear',
        presentation: 'fade',
      },
    ], 30);

    expect(segments).toEqual([
      expect.objectContaining({
        itemId: 'video-1',
        from: 0,
        durationInFrames: 30,
        crossfadeFadeOut: 10,
      }),
      expect.objectContaining({
        itemId: 'video-2',
        from: 20,
        durationInFrames: 30,
        crossfadeFadeIn: 10,
      }),
    ]);
  });
});
