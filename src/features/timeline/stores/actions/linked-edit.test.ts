import { describe, expect, it } from 'vitest';
import type { AudioItem, TimelineItem, VideoItem } from '@/types/timeline';
import {
  buildLinkedLeftShiftUpdates,
  buildSynchronizedLinkedMoveUpdatesForEdit,
  expandIdsWithLinkedItems,
  getLinkedItemsForEdit,
  getMatchingSynchronizedLinkedCounterpartForEdit,
  getSynchronizedLinkedCounterpartPairForEdit,
  getSynchronizedLinkedItemsForEdit,
} from './linked-edit';

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
    label: 'clip.wav',
    src: 'blob:audio',
    mediaId: 'media-1',
    linkedGroupId: 'group-1',
    originId: 'origin-1',
    ...overrides,
  };
}

describe('linked-edit helpers', () => {
  it('returns only the anchor item when linked selection is disabled', () => {
    const items: TimelineItem[] = [
      makeVideoItem(),
      makeAudioItem(),
    ];

    expect(expandIdsWithLinkedItems(items, ['video-1', 'video-1'], false)).toEqual(['video-1']);
    expect(getLinkedItemsForEdit(items, 'video-1', false).map((item) => item.id)).toEqual(['video-1']);
    expect(getSynchronizedLinkedItemsForEdit(items, 'video-1', false).map((item) => item.id)).toEqual(['video-1']);
    expect(getSynchronizedLinkedCounterpartPairForEdit(items, 'video-1', 'audio-1', false)).toBeNull();
    expect(
      getMatchingSynchronizedLinkedCounterpartForEdit(items, 'video-1', 'audio-track', 'audio', false)
    ).toBeNull();
  });

  it('keeps linked companions aligned for left-shift updates when enabled', () => {
    const items: TimelineItem[] = [
      makeVideoItem({ id: 'video-2', from: 90, linkedGroupId: 'group-2' }),
      makeAudioItem({ id: 'audio-2', from: 90, linkedGroupId: 'group-2' }),
      {
        id: 'caption-2',
        type: 'text',
        trackId: 'caption-track',
        from: 90,
        durationInFrames: 60,
        label: 'Caption',
        text: 'Caption',
        color: '#fff',
        textRole: 'caption',
        captionSource: { type: 'transcript', clipId: 'video-2', mediaId: 'media-1' },
      },
    ];

    expect(
      buildLinkedLeftShiftUpdates(items, new Map([
        ['video-2', 30],
      ]), true)
    ).toEqual([
      { id: 'video-2', from: 60 },
      { id: 'audio-2', from: 60 },
      { id: 'caption-2', from: 60 },
    ]);
  });

  it('uses synchronized linked move updates only when linked selection is enabled', () => {
    const items: TimelineItem[] = [
      makeVideoItem({ id: 'video-2', from: 90, linkedGroupId: 'group-2' }),
      makeAudioItem({ id: 'audio-2', from: 90, linkedGroupId: 'group-2' }),
    ];

    expect(
      buildSynchronizedLinkedMoveUpdatesForEdit(items, new Map([
        ['video-2', 12],
      ]), false)
    ).toEqual([
      { id: 'video-2', from: 102 },
    ]);

    expect(
      buildSynchronizedLinkedMoveUpdatesForEdit(items, new Map([
        ['video-2', 12],
      ]), true)
    ).toEqual([
      { id: 'video-2', from: 102 },
      { id: 'audio-2', from: 102 },
    ]);
  });

  it('finds synchronized counterparts when linked selection is enabled', () => {
    const items: TimelineItem[] = [
      makeVideoItem({ id: 'video-left', from: 0, linkedGroupId: 'group-left' }),
      makeAudioItem({ id: 'audio-left', from: 0, linkedGroupId: 'group-left' }),
      makeVideoItem({ id: 'video-right', from: 60, linkedGroupId: 'group-right', mediaId: 'media-2', originId: 'origin-2' }),
      makeAudioItem({ id: 'audio-right', from: 60, linkedGroupId: 'group-right', mediaId: 'media-2', originId: 'origin-2' }),
    ];

    expect(getSynchronizedLinkedItemsForEdit(items, 'video-left', true).map((item) => item.id)).toEqual([
      'video-left',
      'audio-left',
    ]);
    expect(getSynchronizedLinkedCounterpartPairForEdit(items, 'video-left', 'video-right', true)).toEqual({
      leftCounterpart: items[1],
      rightCounterpart: items[3],
    });
    expect(
      getMatchingSynchronizedLinkedCounterpartForEdit(items, 'video-left', 'audio-track', 'audio', true)?.id
    ).toBe('audio-left');
  });

  it('includes attached captions when expanding ids for deletion', () => {
    const items: TimelineItem[] = [
      makeVideoItem({ id: 'video-1', linkedGroupId: undefined }),
      {
        id: 'caption-1',
        type: 'text',
        trackId: 'caption-track',
        from: 0,
        durationInFrames: 60,
        label: 'Caption',
        text: 'Caption',
        color: '#fff',
        textRole: 'caption',
        captionSource: { type: 'transcript', clipId: 'video-1', mediaId: 'media-1' },
      },
    ];

    expect(expandIdsWithLinkedItems(items, ['video-1'], false)).toEqual(['video-1', 'caption-1']);
  });
});
