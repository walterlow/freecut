import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '@/types/timeline';
import { findBestCanvasDropPlacement } from './drop-placement';

function makeTrack(
  id: string,
  order: number,
  overrides: Partial<TimelineTrack> = {}
): TimelineTrack {
  return {
    id,
    name: id,
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order,
    items: [],
    ...overrides,
  };
}

function makeVideoItem(
  id: string,
  trackId: string,
  from: number,
  durationInFrames: number
): TimelineItem {
  return {
    id,
    type: 'video',
    trackId,
    from,
    durationInFrames,
    label: id,
    mediaId: `${id}-media`,
    src: 'blob:test',
  };
}

describe('findBestCanvasDropPlacement', () => {
  it('uses the active track when the playhead slot is free', () => {
    const placement = findBestCanvasDropPlacement({
      tracks: [
        makeTrack('track-1', 0),
        makeTrack('track-2', 1),
      ],
      items: [],
      activeTrackId: 'track-2',
      proposedFrame: 120,
      durationInFrames: 60,
    });

    expect(placement).toEqual({
      trackId: 'track-2',
      from: 120,
      preservedTime: true,
    });
  });

  it('switches to another track before shifting time', () => {
    const placement = findBestCanvasDropPlacement({
      tracks: [
        makeTrack('track-1', 0),
        makeTrack('track-2', 1),
      ],
      items: [
        makeVideoItem('busy', 'track-2', 100, 80),
      ],
      activeTrackId: 'track-2',
      proposedFrame: 120,
      durationInFrames: 40,
    });

    expect(placement).toEqual({
      trackId: 'track-1',
      from: 120,
      preservedTime: true,
    });
  });

  it('falls back to the nearest available slot when every track is occupied at the playhead', () => {
    const placement = findBestCanvasDropPlacement({
      tracks: [
        makeTrack('track-1', 0),
        makeTrack('track-2', 1),
      ],
      items: [
        makeVideoItem('track-1-busy', 'track-1', 100, 80),
        makeVideoItem('track-2-busy', 'track-2', 100, 100),
      ],
      activeTrackId: 'track-2',
      proposedFrame: 120,
      durationInFrames: 30,
    });

    expect(placement).toEqual({
      trackId: 'track-2',
      from: 70,
      preservedTime: false,
    });
  });
});
