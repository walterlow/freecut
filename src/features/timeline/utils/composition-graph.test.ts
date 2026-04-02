import { describe, expect, it } from 'vitest';
import type { TimelineTrack } from '@/types/timeline';
import type { SubComposition } from '../stores/compositions-store';
import {
  collectReachableCompositionIdsFromTracks,
  compositionReferencesComposition,
  wouldCreateCompositionCycle,
} from './composition-graph';

function makeComposition(overrides: Partial<SubComposition> & Pick<SubComposition, 'id' | 'name'>): SubComposition {
  return {
    id: overrides.id,
    name: overrides.name,
    items: [],
    tracks: [],
    transitions: [],
    keyframes: [],
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 60,
    ...overrides,
  };
}

describe('composition-graph', () => {
  it('detects recursive references through nested compound clips', () => {
    const compositionById = {
      'comp-a': makeComposition({
        id: 'comp-a',
        name: 'A',
        items: [{
          id: 'item-a',
          type: 'composition',
          compositionId: 'comp-b',
          trackId: 'track-a',
          from: 0,
          durationInFrames: 30,
          label: 'B',
          compositionWidth: 1920,
          compositionHeight: 1080,
        }],
      }),
      'comp-b': makeComposition({
        id: 'comp-b',
        name: 'B',
        items: [{
          id: 'item-b',
          type: 'composition',
          compositionId: 'comp-c',
          trackId: 'track-b',
          from: 0,
          durationInFrames: 30,
          label: 'C',
          compositionWidth: 1920,
          compositionHeight: 1080,
        }],
      }),
      'comp-c': makeComposition({
        id: 'comp-c',
        name: 'C',
      }),
    };

    expect(compositionReferencesComposition('comp-a', 'comp-c', compositionById)).toBe(true);
    expect(wouldCreateCompositionCycle({
      parentCompositionId: 'comp-c',
      insertedCompositionId: 'comp-a',
      compositionById,
    })).toBe(true);
    expect(wouldCreateCompositionCycle({
      parentCompositionId: 'comp-a',
      insertedCompositionId: 'comp-c',
      compositionById,
    })).toBe(false);
  });

  it('collects all nested reachable compound clips from root tracks', () => {
    const compositionById = {
      'comp-a': makeComposition({
        id: 'comp-a',
        name: 'A',
        items: [{
          id: 'item-a',
          type: 'composition',
          compositionId: 'comp-b',
          trackId: 'track-a',
          from: 0,
          durationInFrames: 30,
          label: 'B',
          compositionWidth: 1920,
          compositionHeight: 1080,
        }],
      }),
      'comp-b': makeComposition({
        id: 'comp-b',
        name: 'B',
        items: [{
          id: 'item-b',
          type: 'composition',
          compositionId: 'comp-c',
          trackId: 'track-b',
          from: 0,
          durationInFrames: 30,
          label: 'C',
          compositionWidth: 1920,
          compositionHeight: 1080,
        }],
      }),
      'comp-c': makeComposition({
        id: 'comp-c',
        name: 'C',
      }),
    };
    const tracks: TimelineTrack[] = [{
      id: 'root-track',
      name: 'V1',
      kind: 'video',
      height: 80,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 0,
      items: [{
        id: 'root-item',
        type: 'composition',
        compositionId: 'comp-a',
        trackId: 'root-track',
        from: 0,
        durationInFrames: 30,
        label: 'A',
        compositionWidth: 1920,
        compositionHeight: 1080,
      }],
    }];

    expect(collectReachableCompositionIdsFromTracks(tracks, compositionById)).toEqual([
      'comp-a',
      'comp-b',
      'comp-c',
    ]);
  });

  it('follows audio-type wrappers with compositionId', () => {
    const compositionById = {
      'comp-audio': makeComposition({
        id: 'comp-audio',
        name: 'Audio Comp',
        items: [{
          id: 'nested-video',
          type: 'video',
          trackId: 'nested-track',
          from: 0,
          durationInFrames: 30,
          label: 'Video',
          src: 'blob:video',
          mediaId: 'media-1',
        }],
      }),
    };
    const tracks: TimelineTrack[] = [{
      id: 'root-track',
      name: 'A1',
      kind: 'audio',
      height: 80,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 0,
      items: [{
        id: 'audio-wrapper',
        type: 'audio',
        compositionId: 'comp-audio',
        trackId: 'root-track',
        from: 0,
        durationInFrames: 30,
        label: 'Audio Comp',
        src: '',
      }],
    }];

    expect(collectReachableCompositionIdsFromTracks(tracks, compositionById)).toEqual([
      'comp-audio',
    ]);
  });
});
