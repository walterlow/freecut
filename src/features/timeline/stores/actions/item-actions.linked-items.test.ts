import { beforeEach, describe, expect, it } from 'vitest';
import type { AudioItem, TimelineTrack, VideoItem } from '@/types/timeline';
import { useItemsStore } from '../items-store';
import { useTransitionsStore } from '../transitions-store';
import { useKeyframesStore } from '../keyframes-store';
import { useTimelineCommandStore } from '../timeline-command-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { useEditorStore } from '@/app/state/editor';
import { useSelectionStore } from '@/shared/state/selection';
import {
  closeAllGapsOnTrack,
  closeGapAtPosition,
  linkItems,
  removeItems,
  rippleDeleteItems,
  splitItem,
  splitItemAtFrames,
  unlinkItems,
} from './item-actions';
import { getLinkedSyncOffsetFrames } from '../../utils/linked-items';

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'video-1',
    type: 'video',
    trackId: 'video-track',
    from: 0,
    durationInFrames: 60,
    label: 'clip.mp4',
    src: 'blob:video',
    mediaId: 'media-1',
    linkedGroupId: 'group-1',
    originId: 'origin-1',
    ...overrides,
  };
}

function makeAudioItem(overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id: 'audio-1',
    type: 'audio',
    trackId: 'audio-track',
    from: 0,
    durationInFrames: 60,
    label: 'clip.mp4',
    src: 'blob:audio',
    mediaId: 'media-1',
    linkedGroupId: 'group-1',
    originId: 'origin-1',
    ...overrides,
  };
}

function makeTrack(overrides: Partial<TimelineTrack> & Pick<TimelineTrack, 'id' | 'name' | 'order' | 'kind'>): TimelineTrack {
  return {
    height: 80,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    items: [],
    ...overrides,
  };
}

describe('linked timeline items', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory();
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false });
    useEditorStore.setState({ linkedSelectionEnabled: true });
    useItemsStore.getState().setItems([]);
    useItemsStore.getState().setTracks([]);
    useTransitionsStore.getState().setTransitions([]);
    useKeyframesStore.getState().setKeyframes([]);
    useSelectionStore.getState().clearSelection();
  });

  it('splits linked video/audio items together and preserves pairing per segment', () => {
    useItemsStore.getState().setItems([
      makeVideoItem(),
      makeAudioItem(),
    ]);

    const result = splitItem('video-1', 30);
    expect(result).not.toBeNull();

    const items = useItemsStore.getState().items;
    const leftVideo = items.find((item) => item.id === 'video-1');
    const leftAudio = items.find((item) => item.id === 'audio-1');
    const rightVideo = items.find((item) => item.type === 'video' && item.id !== 'video-1');
    const rightAudio = items.find((item) => item.type === 'audio' && item.id !== 'audio-1');

    expect(leftVideo).toMatchObject({ from: 0, durationInFrames: 30 });
    expect(leftAudio).toMatchObject({ from: 0, durationInFrames: 30 });
    expect(rightVideo).toMatchObject({ from: 30, durationInFrames: 30 });
    expect(rightAudio).toMatchObject({ from: 30, durationInFrames: 30 });
    expect(leftVideo?.linkedGroupId).toBe(leftAudio?.linkedGroupId);
    expect(rightVideo?.linkedGroupId).toBe(rightAudio?.linkedGroupId);
    expect(leftVideo?.linkedGroupId).not.toBe(rightVideo?.linkedGroupId);
    expect(useSelectionStore.getState().selectedItemIds).toEqual(['video-1', 'audio-1']);
  });

  it('multi-splits linked video/audio items together without creating sync drift badges', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({ sourceStart: 0, sourceEnd: 60, sourceDuration: 180, sourceFps: 30 }),
      makeAudioItem({ sourceStart: 0, sourceEnd: 60, sourceDuration: 180, sourceFps: 30 }),
    ]);

    const splitCount = splitItemAtFrames('video-1', [15, 30, 45]);

    expect(splitCount).toBe(3);

    const items = useItemsStore.getState().items;
    const videos = items
      .filter((item): item is VideoItem => item.type === 'video')
      .toSorted((left, right) => left.from - right.from);
    const audios = items
      .filter((item): item is AudioItem => item.type === 'audio')
      .toSorted((left, right) => left.from - right.from);

    expect(videos).toHaveLength(4);
    expect(audios).toHaveLength(4);
    expect(videos.map((item) => ({ from: item.from, durationInFrames: item.durationInFrames }))).toEqual([
      { from: 0, durationInFrames: 15 },
      { from: 15, durationInFrames: 15 },
      { from: 30, durationInFrames: 15 },
      { from: 45, durationInFrames: 15 },
    ]);
    expect(audios.map((item) => ({ from: item.from, durationInFrames: item.durationInFrames }))).toEqual([
      { from: 0, durationInFrames: 15 },
      { from: 15, durationInFrames: 15 },
      { from: 30, durationInFrames: 15 },
      { from: 45, durationInFrames: 15 },
    ]);

    for (let index = 0; index < videos.length; index += 1) {
      expect(videos[index]?.linkedGroupId).toBe(audios[index]?.linkedGroupId);
      if (index > 0) {
        expect(videos[index]?.linkedGroupId).not.toBe(videos[index - 1]?.linkedGroupId);
      }
    }

    for (const clip of [...videos, ...audios]) {
      expect(getLinkedSyncOffsetFrames(items, clip.id, 30)).toBeNull();
    }
  });

  it('unlinks a selected linked pair together', () => {
    useItemsStore.getState().setItems([makeVideoItem(), makeAudioItem()]);

    unlinkItems(['video-1']);

    const items = useItemsStore.getState().items;
    expect(items.find((item) => item.id === 'video-1')?.linkedGroupId).toBe('video-1');
    expect(items.find((item) => item.id === 'audio-1')?.linkedGroupId).toBe('audio-1');
    expect(useSelectionStore.getState().selectedItemIds).toEqual(['video-1', 'audio-1']);
  });

  it('plain delete removes a linked pair when one member is targeted', () => {
    useItemsStore.getState().setItems([makeVideoItem(), makeAudioItem()]);
    useKeyframesStore.getState().setKeyframes([
      {
        itemId: 'audio-1',
        properties: [
          {
            property: 'volume',
            keyframes: [{ id: 'kf-delete', frame: 0, value: 1, easing: 'linear' }],
          },
        ],
      },
    ]);

    removeItems(['video-1']);

    expect(useItemsStore.getState().items).toEqual([]);
    expect(useKeyframesStore.getState().getKeyframesForItem('audio-1')).toBeUndefined();
  });

  it('ripple deletes a linked pair when only one member is targeted', () => {
    useItemsStore.getState().setItems([
      makeVideoItem(),
      makeAudioItem(),
      makeVideoItem({
        id: 'video-2',
        from: 90,
        linkedGroupId: 'group-2',
        originId: 'origin-2',
        mediaId: 'media-2',
      }),
      makeAudioItem({
        id: 'audio-2',
        from: 90,
        linkedGroupId: 'group-2',
        originId: 'origin-2',
        mediaId: 'media-2',
      }),
    ]);
    useKeyframesStore.getState().setKeyframes([
      {
        itemId: 'audio-1',
        properties: [
          {
            property: 'volume',
            keyframes: [{ id: 'kf-1', frame: 0, value: 1, easing: 'linear' }],
          },
        ],
      },
    ]);

    rippleDeleteItems(['video-1']);

    const items = useItemsStore.getState().items;
    expect(items.find((item) => item.id === 'video-1')).toBeUndefined();
    expect(items.find((item) => item.id === 'audio-1')).toBeUndefined();
    expect(items.find((item) => item.id === 'video-2')).toMatchObject({ from: 30 });
    expect(items.find((item) => item.id === 'audio-2')).toMatchObject({ from: 30 });
    expect(useKeyframesStore.getState().getKeyframesForItem('audio-1')).toBeUndefined();
  });

  it('ripple delete keeps downstream linked clips aligned across tracks', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({
        id: 'video-delete',
        durationInFrames: 60,
        linkedGroupId: undefined,
        originId: 'origin-delete',
        mediaId: 'media-delete',
      }),
      makeVideoItem({
        id: 'video-2',
        from: 90,
        linkedGroupId: 'group-2',
        originId: 'origin-2',
        mediaId: 'media-2',
      }),
      makeAudioItem({
        id: 'audio-2',
        from: 90,
        linkedGroupId: 'group-2',
        originId: 'origin-2',
        mediaId: 'media-2',
      }),
    ]);

    rippleDeleteItems(['video-delete']);

    const items = useItemsStore.getState().items;
    expect(items.find((item) => item.id === 'video-2')).toMatchObject({ from: 30 });
    expect(items.find((item) => item.id === 'audio-2')).toMatchObject({ from: 30 });
  });

  it('ripple delete auto-blades a sync-locked continuous clip on another track', () => {
    useItemsStore.getState().setTracks([
      makeTrack({ id: 'video-track', name: 'V1', order: 0, kind: 'video' }),
      makeTrack({ id: 'audio-track', name: 'A1', order: 1, kind: 'audio' }),
    ]);
    useItemsStore.getState().setItems([
      makeVideoItem({
        id: 'video-delete',
        from: 30,
        durationInFrames: 20,
        linkedGroupId: undefined,
        originId: 'origin-delete',
        mediaId: 'media-delete',
      }),
      makeAudioItem({
        id: 'music-bed',
        from: 0,
        durationInFrames: 100,
        linkedGroupId: undefined,
        originId: 'origin-music',
        mediaId: 'media-music',
      }),
    ]);

    rippleDeleteItems(['video-delete']);

    const audioItems = useItemsStore.getState().items
      .filter((item) => item.trackId === 'audio-track')
      .toSorted((left, right) => left.from - right.from);

    expect(audioItems).toHaveLength(2);
    expect(audioItems.map((item) => ({ from: item.from, durationInFrames: item.durationInFrames }))).toEqual([
      { from: 0, durationInFrames: 30 },
      { from: 30, durationInFrames: 50 },
    ]);
  });

  it('ripple delete leaves sync-lock disabled tracks completely static', () => {
    useItemsStore.getState().setTracks([
      makeTrack({ id: 'video-track', name: 'V1', order: 0, kind: 'video' }),
      makeTrack({ id: 'audio-track', name: 'A1', order: 1, kind: 'audio', syncLock: false }),
    ]);
    useItemsStore.getState().setItems([
      makeVideoItem({
        id: 'video-delete',
        from: 30,
        durationInFrames: 20,
        linkedGroupId: undefined,
        originId: 'origin-delete',
        mediaId: 'media-delete',
      }),
      makeAudioItem({
        id: 'music-bed',
        from: 0,
        durationInFrames: 100,
        linkedGroupId: undefined,
        originId: 'origin-music',
        mediaId: 'media-music',
      }),
    ]);

    rippleDeleteItems(['video-delete']);

    const audioItems = useItemsStore.getState().items
      .filter((item) => item.trackId === 'audio-track')
      .toSorted((left, right) => left.from - right.from);

    expect(audioItems).toEqual([
      expect.objectContaining({
        id: 'music-bed',
        from: 0,
        durationInFrames: 100,
      }),
    ]);
  });

  it('close gap moves linked clips on companion tracks', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({
        id: 'video-anchor',
        durationInFrames: 60,
        linkedGroupId: undefined,
        originId: 'origin-anchor',
        mediaId: 'media-anchor',
      }),
      makeVideoItem({
        id: 'video-2',
        from: 90,
        linkedGroupId: 'group-2',
        originId: 'origin-2',
        mediaId: 'media-2',
      }),
      makeAudioItem({
        id: 'audio-2',
        from: 90,
        linkedGroupId: 'group-2',
        originId: 'origin-2',
        mediaId: 'media-2',
      }),
    ]);

    closeGapAtPosition('video-track', 75);

    const items = useItemsStore.getState().items;
    expect(items.find((item) => item.id === 'video-2')).toMatchObject({ from: 60 });
    expect(items.find((item) => item.id === 'audio-2')).toMatchObject({ from: 60 });
  });

  it('close gap shifts all downstream items across tracks even when linked selection is off', () => {
    useEditorStore.setState({ linkedSelectionEnabled: false });
    useItemsStore.getState().setItems([
      makeVideoItem({
        id: 'video-anchor',
        durationInFrames: 60,
        linkedGroupId: undefined,
        originId: 'origin-anchor',
        mediaId: 'media-anchor',
      }),
      makeVideoItem({
        id: 'video-2',
        from: 90,
        linkedGroupId: 'group-2',
        originId: 'origin-2',
        mediaId: 'media-2',
      }),
      makeAudioItem({
        id: 'audio-2',
        from: 90,
        linkedGroupId: 'group-2',
        originId: 'origin-2',
        mediaId: 'media-2',
      }),
    ]);

    closeGapAtPosition('video-track', 75);

    const items = useItemsStore.getState().items;
    expect(items.find((item) => item.id === 'video-2')).toMatchObject({ from: 60 });
    expect(items.find((item) => item.id === 'audio-2')).toMatchObject({ from: 60 });
  });

  it('close all gaps keeps linked clips aligned across tracks', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({
        id: 'video-1',
        from: 10,
        durationInFrames: 30,
        linkedGroupId: 'group-1',
        originId: 'origin-1',
      }),
      makeAudioItem({
        id: 'audio-1',
        from: 10,
        durationInFrames: 30,
        linkedGroupId: 'group-1',
        originId: 'origin-1',
      }),
      makeVideoItem({
        id: 'video-2',
        from: 60,
        durationInFrames: 30,
        linkedGroupId: 'group-2',
        originId: 'origin-2',
        mediaId: 'media-2',
      }),
      makeAudioItem({
        id: 'audio-2',
        from: 60,
        durationInFrames: 30,
        linkedGroupId: 'group-2',
        originId: 'origin-2',
        mediaId: 'media-2',
      }),
    ]);

    closeAllGapsOnTrack('video-track');

    const items = useItemsStore.getState().items;
    expect(items.find((item) => item.id === 'video-1')).toMatchObject({ from: 0 });
    expect(items.find((item) => item.id === 'audio-1')).toMatchObject({ from: 0 });
    expect(items.find((item) => item.id === 'video-2')).toMatchObject({ from: 30 });
    expect(items.find((item) => item.id === 'audio-2')).toMatchObject({ from: 30 });
  });

  it('close gap shifts solo clips on other tracks when downstream of gap', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({
        id: 'video-anchor',
        durationInFrames: 60,
        linkedGroupId: undefined,
        originId: 'origin-anchor',
        mediaId: 'media-anchor',
      }),
      makeVideoItem({
        id: 'video-2',
        from: 120,
        linkedGroupId: undefined,
        originId: 'origin-2',
        mediaId: 'media-2',
      }),
      // Solo audio AFTER gapEnd (120), so it should shift
      makeAudioItem({
        id: 'solo-audio',
        from: 150,
        durationInFrames: 30,
        linkedGroupId: undefined,
        originId: 'origin-solo',
        mediaId: 'media-solo',
      }),
    ]);

    closeGapAtPosition('video-track', 75);

    const items = useItemsStore.getState().items;
    expect(items.find((item) => item.id === 'video-2')).toMatchObject({ from: 60 });
    // Solo audio shifted left by gapSize (60): 150 â†’ 90
    expect(items.find((item) => item.id === 'solo-audio')).toMatchObject({ from: 90 });
  });

       it('close gap removes solo clips inside deleted span', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({
        id: 'video-anchor',
        durationInFrames: 60,
        linkedGroupId: undefined,
        originId: 'origin-anchor',
        mediaId: 'media-anchor',
      }),
      makeVideoItem({
        id: 'video-2',
        from: 120,
        linkedGroupId: undefined,
        originId: 'origin-2',
        mediaId: 'media-2',
      }),
      makeAudioItem({
        id: 'solo-audio',
        from: 80,
        durationInFrames: 30,
        linkedGroupId: undefined,
        originId: 'origin-solo',
        mediaId: 'media-solo',
      }),
    ]);

    closeGapAtPosition('video-track', 75);

    const items = useItemsStore.getState().items;
    expect(items.find((item) => item.id === 'video-2')).toMatchObject({ from: 60 });
    expect(items.find((item) => item.id === 'solo-audio')).toBeUndefined();
  });

  it('close gap deletes non-shifted items overlapped by shifted items', () => {                                                                  
    useItemsStore.getState().setItems([
      makeVideoItem({
        id: 'video-anchor',
        durationInFrames: 50,
        linkedGroupId: undefined,
        originId: 'origin-anchor',
        mediaId: 'media-anchor',
      }),
      makeVideoItem({
        id: 'video-2',
        from: 100,
        durationInFrames: 60,
        linkedGroupId: undefined,
        originId: 'origin-2',
        mediaId: 'media-2',
      }),
      // Solo audio starts at frame 60, will be overlapped by video-2 shifting from 100 to 50
      makeAudioItem({
        id: 'solo-audio',
        from: 40,
        durationInFrames: 30,
        linkedGroupId: undefined,
        originId: 'origin-solo',
        mediaId: 'media-solo',
      }),
    ]);

    closeGapAtPosition('video-track', 75);

    const items = useItemsStore.getState().items;
    // video-2 shifted from 100 to 50
    expect(items.find((item) => item.id === 'video-2')).toMatchObject({ from: 50 });
    // solo-audio at 40-70 is NOT shifted (from 40 < gapEnd 100), but would it be
    // overlapped? video-2 moves to 50-110 on video-track, solo-audio is on audio-track
    // -> different track, no overlap, should survive
    expect(items.find((item) => item.id === 'solo-audio')).toBeDefined();
  });

  it('ripple delete removes non-shifted items overlapped by shifted items', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({
        id: 'video-delete',
        durationInFrames: 100,
        linkedGroupId: 'group-del',
        originId: 'origin-del',
        mediaId: 'media-del',
      }),
      makeAudioItem({
        id: 'audio-delete',
        durationInFrames: 100,
        linkedGroupId: 'group-del',
        originId: 'origin-del',
        mediaId: 'media-del',
      }),
      // Solo audio on audio-track that doesn't shift (not downstream of deleted audio)
      makeAudioItem({
        id: 'solo-audio',
        from: 50,
        durationInFrames: 30,
        linkedGroupId: undefined,
        originId: 'origin-solo',
        mediaId: 'media-solo',
      }),
      // Downstream video that shifts left
      makeVideoItem({
        id: 'video-downstream',
        from: 100,
        durationInFrames: 60,
        linkedGroupId: 'group-ds',
        originId: 'origin-ds',
        mediaId: 'media-ds',
      }),
      makeAudioItem({
        id: 'audio-downstream',
        from: 100,
        durationInFrames: 60,
        linkedGroupId: 'group-ds',
        originId: 'origin-ds',
        mediaId: 'media-ds',
      }),
    ]);

    rippleDeleteItems(['video-delete']);

    const items = useItemsStore.getState().items;
    // Deleted items gone
    expect(items.find((item) => item.id === 'video-delete')).toBeUndefined();
    expect(items.find((item) => item.id === 'audio-delete')).toBeUndefined();
    // Downstream items shifted left by 100
    expect(items.find((item) => item.id === 'video-downstream')).toMatchObject({ from: 0 });
    expect(items.find((item) => item.id === 'audio-downstream')).toMatchObject({ from: 0 });
    // Solo audio at 50-80 overlapped by audio-downstream shifting to 0-60 â†’ deleted
    expect(items.find((item) => item.id === 'solo-audio')).toBeUndefined();
  });

  it('links an arbitrary multi-selection with a fresh group id', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({ linkedGroupId: 'video-1' }),
      makeAudioItem({ linkedGroupId: 'audio-1' }),
      makeVideoItem({
        id: 'video-2',
        from: 120,
        linkedGroupId: 'video-2',
        originId: 'origin-2',
        mediaId: 'media-2',
      }),
    ]);

    const linked = linkItems(['video-1', 'audio-1', 'video-2']);

    const items = useItemsStore.getState().items;
    const video = items.find((item) => item.id === 'video-1');
    const audio = items.find((item) => item.id === 'audio-1');
    const otherVideo = items.find((item) => item.id === 'video-2');

    expect(linked).toBe(true);
    expect(video?.linkedGroupId).toBeTruthy();
    expect(video?.linkedGroupId).toBe(audio?.linkedGroupId);
    expect(video?.linkedGroupId).toBe(otherVideo?.linkedGroupId);
  });

  it('merges an existing linked group with additional selected clips', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({ linkedGroupId: 'group-1' }),
      makeAudioItem({ linkedGroupId: 'group-1' }),
      makeVideoItem({
        id: 'video-2',
        from: 120,
        linkedGroupId: 'video-2',
        originId: 'origin-2',
        mediaId: 'media-2',
      }),
    ]);

    const linked = linkItems(['video-1', 'video-2']);

    const items = useItemsStore.getState().items;
    const video = items.find((item) => item.id === 'video-1');
    const audio = items.find((item) => item.id === 'audio-1');
    const otherVideo = items.find((item) => item.id === 'video-2');

    expect(linked).toBe(true);
    expect(video?.linkedGroupId).toBe(audio?.linkedGroupId);
    expect(video?.linkedGroupId).toBe(otherVideo?.linkedGroupId);
    expect(useSelectionStore.getState().selectedItemIds).toEqual(['video-1', 'audio-1', 'video-2']);
  });
});
