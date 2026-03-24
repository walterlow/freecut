import { describe, expect, it } from 'vitest';
import type { AudioItem, TimelineItem, VideoItem } from '@/types/timeline';
import { getAudioSectionItems } from './audio-section-utils';

function makeVideoItem(id: string, volume = 0): VideoItem {
  return {
    id,
    type: 'video',
    trackId: 'video-track',
    from: 0,
    durationInFrames: 60,
    label: `${id}.mp4`,
    src: 'blob:video',
    mediaId: id,
    volume,
  } as VideoItem;
}

function makeAudioItem(id: string, volume = 0): AudioItem {
  return {
    id,
    type: 'audio',
    trackId: 'audio-track',
    from: 0,
    durationInFrames: 60,
    label: `${id}.wav`,
    src: 'blob:audio',
    mediaId: id,
    volume,
  } as AudioItem;
}

describe('getAudioSectionItems', () => {
  it('prefers selected audio clips over linked video clips', () => {
    const items: TimelineItem[] = [
      makeVideoItem('video-1', 0),
      makeAudioItem('audio-1', -6),
    ];

    expect(getAudioSectionItems(items)).toEqual([items[1]]);
  });

  it('falls back to video clips when no audio clips are selected', () => {
    const items: TimelineItem[] = [
      makeVideoItem('video-1', -3),
      makeVideoItem('video-2', -3),
    ];

    expect(getAudioSectionItems(items)).toEqual(items);
  });
});
