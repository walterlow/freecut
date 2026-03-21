import { describe, expect, it } from 'vitest';
import { buildTransitionShadowWarmupRequests } from './transition-shadow-warmup';
import type { VideoItem } from '@/types/timeline';

function createVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'item-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 60,
    label: 'Video',
    src: 'blob:video',
    sourceFps: 30,
    sourceStart: 0,
    ...overrides,
  };
}

describe('buildTransitionShadowWarmupRequests', () => {
  it('returns no requests when there are no shadow items', () => {
    expect(buildTransitionShadowWarmupRequests(createVideoItem(), [])).toEqual([]);
  });

  it('warms an extra lane for same-source split transitions', () => {
    const requests = buildTransitionShadowWarmupRequests(
      createVideoItem({ src: 'blob:shared', sourceStart: 120 }),
      [createVideoItem({ id: 'shadow', src: 'blob:shared', sourceStart: 240 })],
    );

    expect(requests).toEqual([
      {
        sourceUrl: 'blob:shared',
        minTotalLanes: 2,
        targetTimeSeconds: [8],
      },
    ]);
  });

  it('groups warmup requests by source', () => {
    const requests = buildTransitionShadowWarmupRequests(
      createVideoItem({ src: 'blob:left', sourceStart: 30 }),
      [
        createVideoItem({ id: 'shadow-a', src: 'blob:left', sourceStart: 60 }),
        createVideoItem({ id: 'shadow-b', src: 'blob:right', sourceStart: 90 }),
      ],
    );

    expect(requests).toEqual([
      {
        sourceUrl: 'blob:left',
        minTotalLanes: 2,
        targetTimeSeconds: [2],
      },
      {
        sourceUrl: 'blob:right',
        minTotalLanes: 1,
        targetTimeSeconds: [3],
      },
    ]);
  });
});
