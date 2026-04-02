import { beforeEach, describe, expect, it } from 'vitest';
import type { AudioItem, TimelineTrack, VideoItem } from '@/types/timeline';
import { useItemsStore } from './items-store';
import { useTransitionsStore } from './transitions-store';
import { useKeyframesStore } from './keyframes-store';
import { useCompositionsStore } from './compositions-store';
import { useCompositionNavigationStore } from './composition-navigation-store';
import { usePlaybackStore } from '@/shared/state/playback';

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

describe('composition-navigation-store', () => {
  beforeEach(() => {
    useItemsStore.getState().setTracks([]);
    useItemsStore.getState().setItems([]);
    useTransitionsStore.getState().setTransitions([]);
    useKeyframesStore.getState().setKeyframes([]);
    useCompositionsStore.getState().setCompositions([]);
    useCompositionNavigationStore.getState().resetToRoot();
    usePlaybackStore.getState().setCurrentFrame(0);
  });

  it('maps playhead using the specific wrapper instance used to enter a compound clip', () => {
    useItemsStore.getState().setTracks([
      makeTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
      makeTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 1 }),
    ]);
    useItemsStore.getState().setItems([
      {
        id: 'comp-a-first-video',
        type: 'composition',
        trackId: 'track-v1',
        from: 0,
        durationInFrames: 40,
        label: 'Comp A',
        compositionId: 'comp-a',
        compositionWidth: 1920,
        compositionHeight: 1080,
        transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
      },
      {
        id: 'comp-a-second-video',
        type: 'composition',
        trackId: 'track-v1',
        from: 80,
        durationInFrames: 40,
        label: 'Comp A',
        compositionId: 'comp-a',
        linkedGroupId: 'group-2',
        compositionWidth: 1920,
        compositionHeight: 1080,
        transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
      },
      {
        id: 'comp-a-second-audio',
        type: 'audio',
        trackId: 'track-a1',
        from: 80,
        durationInFrames: 40,
        label: 'Comp A',
        compositionId: 'comp-a',
        linkedGroupId: 'group-2',
        src: '',
      } satisfies AudioItem,
    ]);
    useCompositionsStore.getState().setCompositions([
      {
        id: 'comp-a',
        name: 'Comp A',
        tracks: [makeTrack({ id: 'comp-track-v1', name: 'V1', kind: 'video', order: 0 })],
        items: [makeVideoItem({ id: 'nested-video', trackId: 'comp-track-v1' })],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 40,
      },
    ]);

    usePlaybackStore.getState().setCurrentFrame(95);

    useCompositionNavigationStore.getState().enterComposition('comp-a', 'Comp A', 'comp-a-second-audio');

    expect(useCompositionNavigationStore.getState().activeCompositionId).toBe('comp-a');
    expect(usePlaybackStore.getState().currentFrame).toBe(15);
  });
});
