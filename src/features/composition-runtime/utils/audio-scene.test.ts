import { describe, expect, it } from 'vitest';
import {
  buildCompoundAudioTransitionSegments,
  buildStandaloneAudioSegments,
  buildTransitionVideoAudioSegments,
} from './audio-scene';

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
        trackVolumeDb: -3,
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
        trackVolumeDb: -3,
        trackVisible: true,
      },
    ], 30);

    expect(segments).toEqual([
      expect.objectContaining({
        itemId: 'audio-1',
        from: 0,
        durationInFrames: 50,
        trimBefore: 0,
        volumeDb: -3,
      }),
    ]);
  });

  it('adds track gain to clip gain for standalone audio', () => {
    const segments = buildStandaloneAudioSegments([
      {
        id: 'audio-1',
        type: 'audio',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 30,
        src: 'audio.mp3',
        label: 'Audio 1',
        volume: -6,
        muted: false,
        trackVolumeDb: 4,
        trackVisible: true,
      },
    ], 30);

    expect(segments[0]?.volumeDb).toBe(-2);
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
        trackVolumeDb: 2,
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
        trackVolumeDb: 2,
        trackVisible: true,
      },
    ], [
      {
        id: 'transition-1',
        type: 'crossfade',
        leftClipId: 'video-1',
        rightClipId: 'video-2',
        trackId: 'track-1',
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
        src: 'video.mp4',
        crossfadeFadeOut: 10,
      }),
      expect.objectContaining({
        itemId: 'video-2',
        from: 20,
        durationInFrames: 30,
        src: 'video-2.mp4',
        crossfadeFadeIn: 10,
      }),
    ]);
  });

  it('uses original audio sources for video-backed audio segments when proxies are active', () => {
    const segments = buildTransitionVideoAudioSegments([
      {
        id: 'video-1',
        type: 'video',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 30,
        src: 'proxy://video-1',
        audioSrc: 'blob://video-1',
        label: 'Video 1',
        mediaId: 'media-1',
        sourceStart: 0,
        sourceFps: 30,
        muted: false,
        trackVolumeDb: 0,
        trackVisible: true,
      },
    ], [], 30);

    expect(segments).toEqual([
      expect.objectContaining({
        itemId: 'video-1',
        src: 'blob://video-1',
      }),
    ]);
  });

  it('expands synchronized linked audio companions around a cut-centered transition', () => {
    const segments = buildTransitionVideoAudioSegments([
      {
        id: 'audio-1',
        type: 'audio',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 30,
        src: 'audio-1.wav',
        label: 'Audio 1',
        mediaId: 'media-1',
        sourceStart: 0,
        sourceEnd: 35,
        sourceDuration: 120,
        sourceFps: 30,
        muted: false,
        trackVolumeDb: 0,
        trackVisible: true,
      },
      {
        id: 'audio-2',
        type: 'audio',
        trackId: 'track-1',
        from: 30,
        durationInFrames: 30,
        src: 'audio-2.wav',
        label: 'Audio 2',
        mediaId: 'media-2',
        sourceStart: 5,
        sourceEnd: 35,
        sourceDuration: 120,
        sourceFps: 30,
        muted: false,
        trackVolumeDb: 0,
        trackVisible: true,
      },
    ], [
      {
        id: 'transition-audio-1',
        type: 'crossfade',
        leftClipId: 'audio-1',
        rightClipId: 'audio-2',
        trackId: 'track-1',
        durationInFrames: 10,
        timing: 'linear',
        presentation: 'fade',
      },
    ], 30);

    expect(segments).toEqual([
      expect.objectContaining({
        itemId: 'audio-1',
        from: 0,
        durationInFrames: 35,
        crossfadeFadeOut: 10,
      }),
      expect.objectContaining({
        itemId: 'audio-2',
        from: 25,
        durationInFrames: 35,
        crossfadeFadeIn: 10,
      }),
    ]);
  });

  it('builds compound wrapper audio transition segments with overlap fades', () => {
    const segments = buildCompoundAudioTransitionSegments([
      {
        id: 'compound-audio-1',
        type: 'audio',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 30,
        label: 'Compound Audio 1',
        compositionId: 'comp-1',
        sourceStart: 0,
        sourceEnd: 35,
        sourceDuration: 120,
        sourceFps: 30,
        muted: false,
        trackVolumeDb: 0,
        trackVisible: true,
        src: '',
      },
      {
        id: 'compound-audio-2',
        type: 'audio',
        trackId: 'track-1',
        from: 30,
        durationInFrames: 30,
        label: 'Compound Audio 2',
        compositionId: 'comp-2',
        sourceStart: 5,
        sourceEnd: 35,
        sourceDuration: 120,
        sourceFps: 30,
        muted: false,
        trackVolumeDb: 0,
        trackVisible: true,
        src: '',
      },
    ], [
      {
        id: 'transition-compound-audio-1',
        type: 'crossfade',
        leftClipId: 'compound-audio-1',
        rightClipId: 'compound-audio-2',
        trackId: 'track-1',
        durationInFrames: 10,
        timing: 'linear',
        presentation: 'fade',
      },
    ], 30);

    expect(segments).toEqual([
      expect.objectContaining({
        itemId: 'compound-audio-1',
        from: 0,
        durationInFrames: 35,
        crossfadeFadeOut: 10,
      }),
      expect.objectContaining({
        itemId: 'compound-audio-2',
        from: 25,
        durationInFrames: 35,
        crossfadeFadeIn: 10,
      }),
    ]);
  });
});
