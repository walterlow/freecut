import { describe, expect, it } from 'vitest';
import { shouldForceContinuousPreviewOverlay } from './use-gpu-effects-overlay';
import type { TimelineItem } from '@/types/timeline';

function createVideoItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: 'item-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 90,
    label: 'Video',
    src: 'blob:video',
    ...overrides,
  } as TimelineItem;
}

describe('shouldForceContinuousPreviewOverlay', () => {
  it('forces continuous overlay for active transitions', () => {
    expect(shouldForceContinuousPreviewOverlay([createVideoItem()], 1)).toBe(true);
  });

  it('forces continuous overlay for enabled gpu effects', () => {
    const effectedItem = createVideoItem({
      effects: [
        {
          id: 'effect-1',
          enabled: true,
          effect: {
            type: 'gpu-effect',
            gpuEffectType: 'gpu-blur',
            params: { amount: 0.5 },
          },
        },
      ],
    });

    expect(shouldForceContinuousPreviewOverlay([effectedItem], 0)).toBe(true);
  });

  it('forces continuous overlay for non-normal blend modes', () => {
    const blendedItem = createVideoItem({
      blendMode: 'screen',
    });

    expect(shouldForceContinuousPreviewOverlay([blendedItem], 0)).toBe(true);
  });
});
