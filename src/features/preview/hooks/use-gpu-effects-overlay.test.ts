import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '@/types/timeline';
import { shouldForceCompositionRendererOverlay } from './use-gpu-effects-overlay';

function createItem(overrides: Partial<TimelineItem>): TimelineItem {
  return {
    id: 'item-1',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 60,
    label: 'Item',
    type: 'image',
    src: 'blob:test',
    ...overrides,
  } as TimelineItem;
}

describe('shouldForceCompositionRendererOverlay', () => {
  it('returns false for plain items without overlay-only features', () => {
    expect(shouldForceCompositionRendererOverlay({
      items: [createItem({})],
      transitions: [],
      isCornerPinEditing: false,
      previewCornerPin: null,
      hasMaskPreview: false,
      compositionById: {},
    })).toBe(false);
  });

  it('returns true when an adjustment layer has enabled effects', () => {
    expect(shouldForceCompositionRendererOverlay({
      items: [
        createItem({
          id: 'adjustment-1',
          type: 'adjustment',
          effects: [
            {
              id: 'fx-1',
              enabled: true,
              effect: {
                type: 'gpu-effect',
                gpuEffectType: 'gpu-brightness',
                params: { amount: 0.25 },
              },
            },
          ],
        }),
      ],
      transitions: [],
      isCornerPinEditing: false,
      previewCornerPin: null,
      hasMaskPreview: false,
      compositionById: {},
    })).toBe(true);
  });

  it('returns true when the timeline contains an authored shape mask', () => {
    expect(shouldForceCompositionRendererOverlay({
      items: [
        createItem({
          id: 'mask-shape-1',
          type: 'shape',
          shapeType: 'rectangle',
          fillColor: '#ffffff',
          isMask: true,
        }),
      ],
      transitions: [],
      isCornerPinEditing: false,
      previewCornerPin: null,
      hasMaskPreview: false,
      compositionById: {},
    })).toBe(true);
  });

  it('returns true during live corner pin preview', () => {
    expect(shouldForceCompositionRendererOverlay({
      items: [createItem({})],
      transitions: [],
      isCornerPinEditing: false,
      previewCornerPin: {
        topLeft: [12, 0],
        topRight: [0, 0],
        bottomRight: [0, 0],
        bottomLeft: [0, 0],
      },
      hasMaskPreview: false,
      compositionById: {},
    })).toBe(true);
  });

  it('returns true during live clip-mask preview edits', () => {
    expect(shouldForceCompositionRendererOverlay({
      items: [createItem({})],
      transitions: [],
      isCornerPinEditing: false,
      previewCornerPin: null,
      hasMaskPreview: true,
      compositionById: {},
    })).toBe(true);
  });

  it('returns true when a composition item contains internal transitions', () => {
    expect(shouldForceCompositionRendererOverlay({
      items: [
        createItem({
          id: 'comp-1',
          type: 'composition',
          compositionId: 'sub-comp-1',
          compositionWidth: 640,
          compositionHeight: 360,
        }),
      ],
      transitions: [],
      isCornerPinEditing: false,
      previewCornerPin: null,
      hasMaskPreview: false,
      compositionById: {
        'sub-comp-1': {
          items: [
            createItem({ id: 'sub-left', type: 'image', src: 'blob:left' }),
            createItem({ id: 'sub-right', type: 'image', src: 'blob:right' }),
          ],
          transitions: [
            {
              id: 'transition-1',
              type: 'fade',
              timing: 'linear',
              durationInFrames: 12,
              leftClipId: 'sub-left',
              rightClipId: 'sub-right',
            } as never,
          ],
        },
      },
    })).toBe(true);
  });

  it('returns true when a composition item contains nested overlay-only features', () => {
    expect(shouldForceCompositionRendererOverlay({
      items: [
        createItem({
          id: 'comp-parent',
          type: 'composition',
          compositionId: 'sub-parent',
          compositionWidth: 640,
          compositionHeight: 360,
        }),
      ],
      transitions: [],
      isCornerPinEditing: false,
      previewCornerPin: null,
      hasMaskPreview: false,
      compositionById: {
        'sub-parent': {
          items: [
            createItem({
              id: 'comp-child',
              type: 'composition',
              compositionId: 'sub-child',
              compositionWidth: 320,
              compositionHeight: 180,
            }),
          ],
          transitions: [],
        },
        'sub-child': {
          items: [
            createItem({
              id: 'child-mask',
              type: 'shape',
              shapeType: 'rectangle',
              fillColor: '#ffffff',
              isMask: true,
            }),
          ],
          transitions: [],
        },
      },
    })).toBe(true);
  });
});
