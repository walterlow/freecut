import { describe, expect, it } from 'vitest';
import type { AudioItem, CompositionItem, TimelineTrack, VideoItem } from '@/types/timeline';
import {
  getCompositionOwnedAudioSources,
  getCompositionVisualSegments,
  summarizeCompositionClipContent,
} from './composition-clip-summary';

function makeTrack(overrides: Partial<TimelineTrack> & Pick<TimelineTrack, 'id' | 'name' | 'order'>): TimelineTrack {
  return {
    kind: 'video',
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    items: [],
    ...overrides,
  };
}

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'video-1',
    type: 'video',
    trackId: 'track-v1',
    from: 0,
    durationInFrames: 30,
    label: 'Video',
    src: 'blob:video',
    mediaId: 'media-video',
    sourceStart: 0,
    sourceEnd: 30,
    sourceDuration: 120,
    sourceFps: 30,
    ...overrides,
  };
}

function makeAudioItem(overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id: 'audio-1',
    type: 'audio',
    trackId: 'track-a1',
    from: 0,
    durationInFrames: 30,
    label: 'Audio',
    src: 'blob:audio',
    mediaId: 'media-audio',
    sourceStart: 0,
    sourceEnd: 30,
    sourceDuration: 120,
    sourceFps: 30,
    ...overrides,
  };
}

function makeCompositionItem(overrides: Partial<CompositionItem> = {}): CompositionItem {
  return {
    id: 'comp-1',
    type: 'composition',
    trackId: 'track-v1',
    from: 0,
    durationInFrames: 30,
    label: 'Compound',
    compositionId: 'child-comp',
    compositionWidth: 1920,
    compositionHeight: 1080,
    transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
    sourceStart: 0,
    sourceEnd: 30,
    sourceDuration: 30,
    sourceFps: 30,
    speed: 1,
    ...overrides,
  };
}

describe('composition-clip-summary', () => {
  it('finds nested visual media and maps its effective source window', () => {
    const compositionById = {
      'child-comp': {
        id: 'child-comp',
        name: 'Child',
        items: [
          makeVideoItem({
            id: 'child-video',
            trackId: 'child-track-v1',
            from: 5,
            durationInFrames: 20,
            mediaId: 'nested-visual',
            sourceStart: 100,
            sourceEnd: 120,
            sourceDuration: 240,
            sourceFps: 30,
          }),
        ],
        tracks: [makeTrack({ id: 'child-track-v1', name: 'V1', order: 0, kind: 'video' })],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 40,
      },
    };

    const summary = summarizeCompositionClipContent({
      items: [
        makeCompositionItem({
          id: 'parent-wrapper',
          trackId: 'track-v1',
          compositionId: 'child-comp',
          durationInFrames: 5,
          sourceStart: 5,
          sourceEnd: 15,
          sourceDuration: 40,
          speed: 2,
        }),
      ],
      tracks: [makeTrack({ id: 'track-v1', name: 'V1', order: 0, kind: 'video' })],
      fps: 30,
      compositionById,
    });

    expect(summary.visualMediaId).toBe('nested-visual');
    expect(summary.visualSource).toMatchObject({
      itemId: 'child-video',
      mediaId: 'nested-visual',
      sourceStart: 100,
      sourceDuration: 240,
      sourceFps: 30,
      speed: 2,
    });
  });

  it('collects nested audio once when a compound clip has linked visual and audio wrappers', () => {
    const compositionById = {
      'child-comp': {
        id: 'child-comp',
        name: 'Child',
        items: [
          makeVideoItem({
            id: 'child-video',
            trackId: 'child-track-v1',
            linkedGroupId: 'linked-1',
            mediaId: 'nested-video',
          }),
          makeAudioItem({
            id: 'child-audio',
            trackId: 'child-track-a1',
            linkedGroupId: 'linked-1',
            mediaId: 'nested-audio',
          }),
        ],
        tracks: [
          makeTrack({ id: 'child-track-v1', name: 'V1', order: 0, kind: 'video' }),
          makeTrack({ id: 'child-track-a1', name: 'A1', order: 1, kind: 'audio' }),
        ],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 30,
      },
    };

    const sources = getCompositionOwnedAudioSources({
      items: [
        makeCompositionItem({
          id: 'parent-visual',
          trackId: 'track-v1',
          compositionId: 'child-comp',
          linkedGroupId: 'linked-parent',
        }),
        makeAudioItem({
          id: 'parent-audio',
          trackId: 'track-a1',
          compositionId: 'child-comp',
          mediaId: undefined,
          src: '',
          linkedGroupId: 'linked-parent',
        }),
      ],
      tracks: [
        makeTrack({ id: 'track-v1', name: 'V1', order: 0, kind: 'video' }),
        makeTrack({ id: 'track-a1', name: 'A1', order: 1, kind: 'audio' }),
      ],
      fps: 30,
      compositionById,
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      itemId: 'child-audio',
      mediaId: 'nested-audio',
      from: 0,
      durationInFrames: 30,
      sourceStart: 0,
      sourceFps: 30,
      speed: 1,
    });
  });

  it('returns ordered visual segments for a compound clip spanning two sub-comp videos', () => {
    const compositionById = {
      'child-comp': {
        id: 'child-comp',
        name: 'Child',
        items: [
          makeVideoItem({
            id: 'child-video-a',
            trackId: 'child-track-v1',
            from: 0,
            durationInFrames: 60,
            mediaId: 'media-a',
            sourceStart: 0,
            sourceEnd: 60,
            sourceDuration: 600,
            sourceFps: 30,
          }),
          makeVideoItem({
            id: 'child-video-b',
            trackId: 'child-track-v1',
            from: 60,
            durationInFrames: 60,
            mediaId: 'media-b',
            sourceStart: 0,
            sourceEnd: 60,
            sourceDuration: 600,
            sourceFps: 30,
          }),
        ],
        tracks: [makeTrack({ id: 'child-track-v1', name: 'V1', order: 0, kind: 'video' })],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 120,
      },
    };

    const wrapper = makeCompositionItem({
      id: 'parent-wrapper',
      trackId: 'track-v1',
      compositionId: 'child-comp',
      from: 0,
      durationInFrames: 120,
      sourceStart: 0,
      sourceEnd: 120,
      sourceDuration: 120,
      sourceFps: 30,
      speed: 1,
    });

    const segments = getCompositionVisualSegments({
      wrapper,
      parentFps: 30,
      compositionById,
    });

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      itemId: 'child-video-a',
      mediaId: 'media-a',
      from: 0,
      durationInFrames: 60,
    });
    expect(segments[1]).toMatchObject({
      itemId: 'child-video-b',
      mediaId: 'media-b',
      from: 60,
      durationInFrames: 60,
    });
  });

  it('sorts segments so topmost tracks render last (painted on top)', () => {
    const compositionById = {
      'child-comp': {
        id: 'child-comp',
        name: 'Child',
        items: [
          makeVideoItem({
            id: 'bottom-video',
            trackId: 'child-track-v2',
            from: 0,
            durationInFrames: 60,
            mediaId: 'media-bottom',
          }),
          makeVideoItem({
            id: 'top-video',
            trackId: 'child-track-v1',
            from: 0,
            durationInFrames: 60,
            mediaId: 'media-top',
          }),
        ],
        tracks: [
          makeTrack({ id: 'child-track-v1', name: 'V1', order: 0, kind: 'video' }),
          makeTrack({ id: 'child-track-v2', name: 'V2', order: 1, kind: 'video' }),
        ],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 60,
      },
    };

    const wrapper = makeCompositionItem({
      compositionId: 'child-comp',
      durationInFrames: 60,
      sourceEnd: 60,
      sourceDuration: 60,
    });

    const segments = getCompositionVisualSegments({
      wrapper,
      parentFps: 30,
      compositionById,
    });

    expect(segments.map((s) => s.itemId)).toEqual(['bottom-video', 'top-video']);
  });

  it('recurses into a nested composition to surface its inner video segments', () => {
    const compositionById = {
      'inner-comp': {
        id: 'inner-comp',
        name: 'Inner',
        items: [
          makeVideoItem({
            id: 'inner-video',
            trackId: 'inner-track-v1',
            from: 0,
            durationInFrames: 60,
            mediaId: 'inner-media',
            sourceStart: 0,
            sourceEnd: 60,
            sourceDuration: 600,
            sourceFps: 30,
          }),
        ],
        tracks: [makeTrack({ id: 'inner-track-v1', name: 'V1', order: 0, kind: 'video' })],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 60,
      },
      'outer-comp': {
        id: 'outer-comp',
        name: 'Outer',
        items: [
          makeCompositionItem({
            id: 'nested-wrapper',
            trackId: 'outer-track-v1',
            compositionId: 'inner-comp',
            from: 0,
            durationInFrames: 60,
            sourceStart: 0,
            sourceEnd: 60,
            sourceDuration: 60,
            sourceFps: 30,
          }),
          makeVideoItem({
            id: 'outer-video',
            trackId: 'outer-track-v1',
            from: 60,
            durationInFrames: 60,
            mediaId: 'outer-media',
            sourceStart: 0,
            sourceEnd: 60,
            sourceDuration: 600,
            sourceFps: 30,
          }),
        ],
        tracks: [makeTrack({ id: 'outer-track-v1', name: 'V1', order: 0, kind: 'video' })],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 120,
      },
    };

    const wrapper = makeCompositionItem({
      id: 'parent-wrapper',
      compositionId: 'outer-comp',
      durationInFrames: 120,
      sourceStart: 0,
      sourceEnd: 120,
      sourceDuration: 120,
      sourceFps: 30,
    });

    const segments = getCompositionVisualSegments({
      wrapper,
      parentFps: 30,
      compositionById,
    });

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      itemId: 'inner-video',
      mediaId: 'inner-media',
      from: 0,
      durationInFrames: 60,
    });
    expect(segments[1]).toMatchObject({
      itemId: 'outer-video',
      mediaId: 'outer-media',
      from: 60,
      durationInFrames: 60,
    });
  });

  it('guards against cyclic composition references', () => {
    const compositionById = {
      'self-ref': {
        id: 'self-ref',
        name: 'Self',
        items: [
          makeCompositionItem({
            id: 'self-wrapper',
            trackId: 'self-track',
            compositionId: 'self-ref',
            from: 0,
            durationInFrames: 30,
            sourceEnd: 30,
            sourceDuration: 30,
          }),
        ],
        tracks: [makeTrack({ id: 'self-track', name: 'V1', order: 0, kind: 'video' })],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 30,
      },
    };

    const wrapper = makeCompositionItem({
      compositionId: 'self-ref',
      durationInFrames: 30,
      sourceEnd: 30,
      sourceDuration: 30,
    });

    const segments = getCompositionVisualSegments({
      wrapper,
      parentFps: 30,
      compositionById,
    });

    expect(segments).toEqual([]);
  });

  it('returns empty segments when wrapper is not a composition', () => {
    const segments = getCompositionVisualSegments({
      wrapper: makeVideoItem(),
      parentFps: 30,
      compositionById: {},
    });
    expect(segments).toEqual([]);
  });
});
