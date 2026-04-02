import { beforeEach, describe, expect, it } from 'vitest';
import type { AudioItem, TimelineTrack, VideoItem } from '@/types/timeline';
import { useSelectionStore } from '@/shared/state/selection';
import { useProjectStore } from '@/features/timeline/deps/projects';
import { useItemsStore } from '../items-store';
import { useTransitionsStore } from '../transitions-store';
import { useKeyframesStore } from '../keyframes-store';
import { useTimelineCommandStore } from '../timeline-command-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { useCompositionsStore } from '../compositions-store';
import { useCompositionNavigationStore } from '../composition-navigation-store';
import { createPreComp, dissolvePreComp } from './composition-actions';
import { splitItem } from './item-actions';

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
    linkedGroupId: 'group-1',
    sourceStart: 0,
    sourceEnd: 60,
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
    durationInFrames: 60,
    label: 'clip.mp4',
    src: 'blob:audio',
    mediaId: 'media-1',
    linkedGroupId: 'group-1',
    sourceStart: 0,
    sourceEnd: 60,
    sourceDuration: 120,
    sourceFps: 30,
    ...overrides,
  };
}

describe('composition-actions split wrappers', () => {
  beforeEach(() => {
    useItemsStore.getState().setTracks([]);
    useItemsStore.getState().setItems([]);
    useTransitionsStore.getState().setTransitions([]);
    useKeyframesStore.getState().setKeyframes([]);
    useCompositionsStore.getState().setCompositions([]);
    useTimelineCommandStore.getState().clearHistory();
    useCompositionNavigationStore.getState().resetToRoot();
    useSelectionStore.getState().clearSelection();
    useTimelineSettingsStore.getState().setFps(30);
    useProjectStore.getState().setCurrentProject({
      id: 'project-1',
      name: 'Project',
      description: '',
      createdAt: 0,
      updatedAt: 0,
      duration: 120,
      metadata: {
        width: 1920,
        height: 1080,
        fps: 30,
      },
    });
  });

  it('creates linked compound video and audio wrappers on paired tracks', () => {
    useItemsStore.getState().setTracks([
      makeTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
      makeTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 1 }),
    ]);
    useItemsStore.getState().setItems([
      makeVideoItem(),
      makeAudioItem(),
    ]);

    useSelectionStore.getState().selectItems(['video-1']);

    const created = createPreComp('Compound 1');

    expect(created).toMatchObject({ type: 'composition', trackId: 'track-v1', label: 'Compound 1' });
    expect(useCompositionsStore.getState().compositions).toHaveLength(1);
    expect(useCompositionsStore.getState().compositions[0]?.tracks.map((track) => `${track.name}:${track.kind}`)).toEqual([
      'V1:video',
      'A1:audio',
    ]);

    const wrapperItems = useItemsStore.getState().items;
    expect(wrapperItems).toHaveLength(2);
    const visualWrapper = wrapperItems.find((item) => item.type === 'composition');
    const audioWrapper = wrapperItems.find((item) => item.type === 'audio' && item.compositionId);
    expect(visualWrapper).toMatchObject({ trackId: 'track-v1', sourceStart: 0, sourceEnd: 60, sourceDuration: 60 });
    expect(audioWrapper).toMatchObject({ trackId: 'track-a1', compositionId: visualWrapper?.compositionId, sourceStart: 0, sourceEnd: 60, sourceDuration: 60 });
    expect(audioWrapper?.linkedGroupId).toBe(visualWrapper?.linkedGroupId);
  });

  it('dissolves linked compound wrappers back to original tracks', () => {
    useItemsStore.getState().setTracks([
      makeTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
      makeTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 1 }),
    ]);
    useItemsStore.getState().setItems([
      makeVideoItem(),
      makeAudioItem(),
    ]);
    useSelectionStore.getState().selectItems(['video-1']);

    createPreComp('Compound 1');

    const visualWrapper = useItemsStore.getState().items.find((item) => item.type === 'composition');
    expect(visualWrapper).toBeDefined();

    expect(dissolvePreComp(visualWrapper!.id)).toBe(true);

    const restoredItems = useItemsStore.getState().items;
    expect(restoredItems).toHaveLength(2);
    expect(restoredItems.find((item) => item.type === 'video')).toMatchObject({ trackId: 'track-v1', from: 0, durationInFrames: 60 });
    expect(restoredItems.find((item) => item.type === 'audio' && !item.compositionId)).toMatchObject({ trackId: 'track-a1', from: 0, durationInFrames: 60 });
    expect(useCompositionsStore.getState().compositions).toHaveLength(0);
  });

  it('dissolves only the selected split wrapper window and keeps sibling wrappers', () => {
    useItemsStore.getState().setTracks([
      makeTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
      makeTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 1 }),
    ]);
    useItemsStore.getState().setItems([
      makeVideoItem(),
      makeAudioItem(),
    ]);
    useSelectionStore.getState().selectItems(['video-1']);

    const created = createPreComp('Compound 1');
    expect(created?.type).toBe('composition');
    splitItem(created!.id, 30);

    expect(dissolvePreComp(created!.id)).toBe(true);

    const items = useItemsStore.getState().items;
    expect(items.find((item) => item.type === 'video' && !item.compositionId)).toMatchObject({ trackId: 'track-v1', from: 0, durationInFrames: 30, sourceStart: 0, sourceEnd: 30 });
    expect(items.find((item) => item.type === 'audio' && !item.compositionId)).toMatchObject({ trackId: 'track-a1', from: 0, durationInFrames: 30, sourceStart: 0, sourceEnd: 30 });
    expect(items.filter((item) => item.type === 'composition')).toHaveLength(1);
    expect(items.filter((item) => item.type === 'audio' && item.compositionId)).toHaveLength(1);
    expect(useCompositionsStore.getState().compositions).toHaveLength(1);
  });

  it('preserves internal transitions when dissolving a compound clip', () => {
    useItemsStore.getState().setTracks([
      makeTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
    ]);
    useItemsStore.getState().setItems([
      makeVideoItem({
        id: 'video-1',
        trackId: 'track-v1',
        from: 0,
        durationInFrames: 60,
        sourceStart: 0,
        sourceEnd: 60,
        sourceDuration: 120,
      }),
      makeVideoItem({
        id: 'video-2',
        trackId: 'track-v1',
        from: 60,
        durationInFrames: 60,
        label: 'clip-2.mp4',
        src: 'blob:video-2',
        mediaId: 'media-2',
        linkedGroupId: undefined,
        sourceStart: 60,
        sourceEnd: 120,
        sourceDuration: 180,
      }),
    ]);
    useTransitionsStore.getState().setTransitions([{
      id: 'transition-1',
      leftClipId: 'video-1',
      rightClipId: 'video-2',
      trackId: 'track-v1',
      type: 'crossfade',
      durationInFrames: 12,
      presentation: 'fade',
      timing: 'linear',
      alignment: 0.5,
    }]);
    useSelectionStore.getState().selectItems(['video-1', 'video-2']);

    const created = createPreComp('Compound 1');
    expect(created?.type).toBe('composition');
    expect(useCompositionsStore.getState().compositions[0]?.transitions).toHaveLength(1);

    expect(dissolvePreComp(created!.id)).toBe(true);

    const restoredItems = useItemsStore.getState().items.filter((item) => item.type === 'video');
    const restoredIds = new Set(restoredItems.map((item) => item.id));
    const restoredTransitions = useTransitionsStore.getState().transitions;

    expect(restoredItems).toHaveLength(2);
    expect(restoredTransitions).toHaveLength(1);
    expect(restoredTransitions[0]).toMatchObject({
      type: 'crossfade',
      durationInFrames: 12,
      trackId: 'track-v1',
      timing: 'linear',
      alignment: 0.5,
    });
    expect(restoredIds.has(restoredTransitions[0]!.leftClipId)).toBe(true);
    expect(restoredIds.has(restoredTransitions[0]!.rightClipId)).toBe(true);
  });
});
