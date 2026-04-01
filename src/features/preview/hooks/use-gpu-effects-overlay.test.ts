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
  it('does not force continuous overlay for transitions alone', () => {
    expect(shouldForceContinuousPreviewOverlay([createVideoItem()], 1, 0)).toBe(false);
  });

  it('forces continuous overlay for enabled gpu effects on the active frame', () => {
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

    expect(shouldForceContinuousPreviewOverlay([effectedItem], 0, 0)).toBe(true);
  });

  it('does not force continuous overlay for gpu effects on inactive clips', () => {
    const effectedItem = createVideoItem({
      effects: [
        {
          id: 'effect-1',
          enabled: true,
          effect: {
            type: 'gpu-effect',
            gpuEffectType: 'gpu-halftone',
            params: { amount: 0.5 },
          },
        },
      ],
    });

    expect(shouldForceContinuousPreviewOverlay([effectedItem], 0, 120)).toBe(false);
  });

  it('forces continuous overlay for non-normal blend modes on the active frame', () => {
    const blendedItem = createVideoItem({
      blendMode: 'screen',
    });

    expect(shouldForceContinuousPreviewOverlay([blendedItem], 0, 0)).toBe(true);
  });

  it('does not force continuous overlay for non-normal blend modes on inactive clips', () => {
    const blendedItem = createVideoItem({
      blendMode: 'screen',
    });

    expect(shouldForceContinuousPreviewOverlay([blendedItem], 0, 120)).toBe(false);
  });

  it('forces continuous overlay for preview-only gpu effects on the active frame', () => {
    const previewedItem = createVideoItem();

    expect(
      shouldForceContinuousPreviewOverlay(
        [previewedItem],
        0,
        0,
        new Map([
          [
            previewedItem.id,
            [
              {
                id: 'effect-preview',
                enabled: true,
                effect: {
                  type: 'gpu-effect',
                  gpuEffectType: 'gpu-sepia',
                  params: { amount: 0.8 },
                },
              },
            ],
          ],
        ]),
      ),
    ).toBe(true);
  });
});
