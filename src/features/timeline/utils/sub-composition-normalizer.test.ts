import { describe, expect, it } from 'vitest';
import type { ShapeItem, TimelineTrack } from '@/types/timeline';
import { DEFAULT_TRACK_HEIGHT } from '../constants';
import {
  hydrateTracksFromItems,
  normalizeSubComposition,
} from './sub-composition-normalizer';

function makeTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id: 'track-1',
    name: 'Track 1',
    height: DEFAULT_TRACK_HEIGHT,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 0,
    items: [],
    ...overrides,
  };
}

function makeShape(overrides: Partial<ShapeItem> = {}): ShapeItem {
  return {
    id: 'shape-1',
    type: 'shape',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 30,
    label: 'Shape',
    shapeType: 'rectangle',
    fillColor: '#fff',
    ...overrides,
  };
}

describe('sub-composition-normalizer', () => {
  it('hydrates track items from the canonical items list', () => {
    const mask = makeShape({ id: 'mask', trackId: 'mask-track', isMask: true });
    const content = makeShape({ id: 'content', trackId: 'content-track' });
    const tracks = [
      makeTrack({ id: 'mask-track', order: 1 }),
      makeTrack({ id: 'content-track', order: 0 }),
    ];

    const normalized = normalizeSubComposition({
      id: 'sub-1',
      name: 'Sub',
      items: [mask, content],
      tracks,
    });

    expect(normalized.tracks[0]?.id).toBe('content-track');
    expect(normalized.tracks[0]?.items).toEqual([content]);
    expect(normalized.tracks[1]?.id).toBe('mask-track');
    expect(normalized.tracks[1]?.items).toEqual([mask]);
  });

  it('replaces stale track item arrays with the canonical item mapping', () => {
    const actual = makeShape({ id: 'actual', trackId: 'track-1' });
    const stale = makeShape({ id: 'stale', trackId: 'track-1' });

    const hydrated = hydrateTracksFromItems([actual], [
      makeTrack({ id: 'track-1', items: [stale] }),
    ]);

    expect(hydrated[0]?.items).toEqual([actual]);
  });

  it('creates fallback metadata for items whose track ids are missing', () => {
    const orphan = makeShape({ id: 'orphan', trackId: 'missing-track' });

    const hydrated = hydrateTracksFromItems([orphan], []);

    expect(hydrated).toHaveLength(1);
    expect(hydrated[0]?.id).toBe('missing-track');
    expect(hydrated[0]?.visible).toBe(true);
    expect(hydrated[0]?.items).toEqual([orphan]);
  });
});
