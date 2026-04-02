import { describe, expect, it } from 'vitest';
import type { TimelineTrack, VideoItem } from '@/types/timeline';
import {
  buildDroppedCompositionTimelineItems,
  compositionHasOwnedAudio,
} from './dropped-composition';

function makeTrack(overrides: Partial<TimelineTrack> & Pick<TimelineTrack, 'id' | 'name' | 'order' | 'kind'>): TimelineTrack {
  return {
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
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
    durationInFrames: 60,
    label: 'clip.mp4',
    src: 'blob:video',
    mediaId: 'media-1',
    sourceStart: 0,
    sourceEnd: 60,
    sourceDuration: 120,
    sourceFps: 30,
    ...overrides,
  };
}

describe('dropped-composition', () => {
  it('detects owned audio through nested compound clips and builds a linked wrapper pair', () => {
    const compositionById = {
      'comp-child': {
        id: 'comp-child',
        name: 'Child',
        tracks: [
          makeTrack({ id: 'child-v1', name: 'V1', kind: 'video', order: 0 }),
          makeTrack({ id: 'child-a1', name: 'A1', kind: 'audio', order: 1 }),
        ],
        items: [
          {
            id: 'child-video',
            type: 'composition',
            trackId: 'child-v1',
            from: 0,
            durationInFrames: 40,
            label: 'Grandchild',
            compositionId: 'comp-grandchild',
            linkedGroupId: 'linked-1',
            compositionWidth: 1920,
            compositionHeight: 1080,
            transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
            sourceStart: 0,
            sourceEnd: 40,
            sourceDuration: 40,
            sourceFps: 30,
          },
          {
            id: 'child-audio',
            type: 'audio',
            trackId: 'child-a1',
            from: 0,
            durationInFrames: 40,
            label: 'Grandchild',
            compositionId: 'comp-grandchild',
            linkedGroupId: 'linked-1',
            src: '',
            sourceStart: 0,
            sourceEnd: 40,
            sourceDuration: 40,
            sourceFps: 30,
          },
        ],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 40,
      },
      'comp-grandchild': {
        id: 'comp-grandchild',
        name: 'Grandchild',
        tracks: [makeTrack({ id: 'grand-a1', name: 'A1', kind: 'audio', order: 0 })],
        items: [{
          id: 'grand-audio',
          type: 'audio',
          trackId: 'grand-a1',
          from: 0,
          durationInFrames: 40,
          label: 'audio.wav',
          src: 'blob:audio',
          mediaId: 'media-audio',
          sourceStart: 0,
          sourceEnd: 40,
          sourceDuration: 40,
          sourceFps: 30,
        }],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 40,
      },
    };
    const composition = {
      id: 'comp-parent',
      name: 'Parent',
      tracks: [makeTrack({ id: 'parent-v1', name: 'V1', kind: 'video', order: 0 })],
      items: [
        {
          id: 'nested-child',
          type: 'composition',
          trackId: 'parent-v1',
          from: 0,
          durationInFrames: 40,
          label: 'Child',
          compositionId: 'comp-child',
          compositionWidth: 1920,
          compositionHeight: 1080,
          transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
          sourceStart: 0,
          sourceEnd: 40,
          sourceDuration: 40,
          sourceFps: 30,
        },
        makeVideoItem({ id: 'parent-video', trackId: 'parent-v1', from: 50, mediaId: 'media-video' }),
      ],
      transitions: [],
      keyframes: [],
      fps: 30,
      width: 1920,
      height: 1080,
      durationInFrames: 90,
    };

    expect(compositionHasOwnedAudio({
      composition,
      compositionById,
    })).toBe(true);

    const droppedItems = buildDroppedCompositionTimelineItems({
      compositionId: composition.id,
      composition,
      label: composition.name,
      placements: [
        { trackId: 'track-v1', from: 12, durationInFrames: 90, mediaType: 'video' },
        { trackId: 'track-a1', from: 12, durationInFrames: 90, mediaType: 'audio' },
      ],
    });

    expect(droppedItems).toHaveLength(2);
    expect(droppedItems[0]).toMatchObject({
      type: 'composition',
      trackId: 'track-v1',
      from: 12,
      sourceStart: 0,
      sourceEnd: 90,
      sourceDuration: 90,
      sourceFps: 30,
    });
    expect(droppedItems[1]).toMatchObject({
      type: 'audio',
      trackId: 'track-a1',
      from: 12,
      sourceStart: 0,
      sourceEnd: 90,
      sourceDuration: 90,
      sourceFps: 30,
    });
    expect(droppedItems[0]?.linkedGroupId).toBe(droppedItems[1]?.linkedGroupId);
  });
});
