import { describe, expect, it } from 'vitest';

import type { TimelineItem } from '@/types/timeline';

import { resolveSelectedVideoWarmCandidate } from './selected-video-prewarm';

function createItemsById(items: TimelineItem[]): Map<string, TimelineItem> {
  return new Map(items.map((item) => [item.id, item]));
}

describe('resolveSelectedVideoWarmCandidate', () => {
  it('returns a warm candidate for the selected video item', () => {
    const itemsById = createItemsById([
      {
        id: 'video-1',
        type: 'video',
        trackId: 'track-1',
        from: 100,
        durationInFrames: 60,
        label: 'Video',
        src: 'blob:video-1',
        sourceStart: 240,
        sourceFps: 60,
        speed: 2,
      },
    ]);

    const candidate = resolveSelectedVideoWarmCandidate(['video-1'], itemsById, 115, 30);

    expect(candidate).toEqual({
      item: itemsById.get('video-1'),
      sourceTimeSeconds: 5,
      withinClip: true,
    });
  });

  it('marks the candidate as outside the clip when the playhead is elsewhere', () => {
    const itemsById = createItemsById([
      {
        id: 'video-1',
        type: 'video',
        trackId: 'track-1',
        from: 100,
        durationInFrames: 60,
        label: 'Video',
        src: 'blob:video-1',
      },
    ]);

    const candidate = resolveSelectedVideoWarmCandidate(['video-1'], itemsById, 40, 30);

    expect(candidate?.withinClip).toBe(false);
  });

  it('returns null for non-video selections', () => {
    const itemsById = createItemsById([
      {
        id: 'text-1',
        type: 'text',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 60,
        label: 'Text',
        text: 'Hello',
        color: '#fff',
      },
    ]);

    expect(resolveSelectedVideoWarmCandidate(['text-1'], itemsById, 10, 30)).toBeNull();
  });
});
