import { describe, expect, it } from 'vitest';
import type { ClipMask } from '@/types/masks';
import type { TimelineItem } from '@/types/timeline';
import {
  shouldForceCompositionRendererOverlay,
  shouldForcePlaybackCompositionRendererOverlay,
} from './use-gpu-effects-overlay';

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

function createMask(overrides: Partial<ClipMask> = {}): ClipMask {
  return {
    id: 'mask-1',
    vertices: [
      { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
      { position: [1, 0], inHandle: [0, 0], outHandle: [0, 0] },
      { position: [1, 1], inHandle: [0, 0], outHandle: [0, 0] },
    ],
    mode: 'add',
    opacity: 1,
    feather: 0,
    inverted: false,
    enabled: true,
    ...overrides,
  };
}

describe('shouldForceCompositionRendererOverlay', () => {
  it('returns false for plain items without skim-only features', () => {
    expect(shouldForceCompositionRendererOverlay({
      items: [createItem({})],
      transitions: [],
      isCornerPinEditing: false,
      previewCornerPin: null,
      compositionById: {},
    })).toBe(false);
  });

  it('returns true when the timeline contains a transition', () => {
    expect(shouldForceCompositionRendererOverlay({
      items: [createItem({})],
      transitions: [
        {
          id: 'transition-1',
          type: 'fade',
          timing: 'linear',
          durationInFrames: 12,
          leftClipId: 'left',
          rightClipId: 'right',
        } as never,
      ],
      isCornerPinEditing: false,
      previewCornerPin: null,
      compositionById: {},
    })).toBe(true);
  });

  it('returns true when an item has an enabled GPU effect', () => {
    expect(shouldForceCompositionRendererOverlay({
      items: [
        createItem({
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
      compositionById: {},
    })).toBe(true);
  });

  it('does not force overlay for hard clip masks', () => {
    expect(shouldForceCompositionRendererOverlay({
      items: [
        createItem({
          masks: [createMask()],
        }),
      ],
      transitions: [],
      isCornerPinEditing: false,
      previewCornerPin: null,
      compositionById: {},
    })).toBe(false);
  });

  it('returns true for soft clip masks and live soft-mask preview edits', () => {
    expect(shouldForceCompositionRendererOverlay({
      items: [
        createItem({
          id: 'masked-item',
          masks: [createMask({ feather: 12 })],
        }),
      ],
      transitions: [],
      isCornerPinEditing: false,
      previewCornerPin: null,
      previewMaskEditingItemId: 'masked-item',
      previewMasks: [createMask({ opacity: 0.6 })],
      compositionById: {},
    })).toBe(true);
  });

  it('only forces shape-mask overlay for soft shape masks', () => {
    expect(shouldForceCompositionRendererOverlay({
      items: [
        createItem({
          type: 'shape',
          shapeType: 'rectangle',
          fillColor: '#ffffff',
          isMask: true,
          maskType: 'clip',
          maskFeather: 0,
        }),
      ],
      transitions: [],
      isCornerPinEditing: false,
      previewCornerPin: null,
      compositionById: {},
    })).toBe(false);

    expect(shouldForceCompositionRendererOverlay({
      items: [
        createItem({
          type: 'shape',
          shapeType: 'rectangle',
          fillColor: '#ffffff',
          isMask: true,
          maskType: 'alpha',
          maskFeather: 12,
        }),
      ],
      transitions: [],
      isCornerPinEditing: false,
      previewCornerPin: null,
      compositionById: {},
    })).toBe(true);
  });

  it('recurses into sub-compositions for transitions and soft masks', () => {
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
              maskType: 'alpha',
              maskFeather: 10,
            }),
          ],
          transitions: [
            {
              id: 'transition-2',
              type: 'slide',
              timing: 'linear',
              durationInFrames: 10,
              leftClipId: 'a',
              rightClipId: 'b',
            } as never,
          ],
        },
      },
    })).toBe(true);
  });
});

describe('shouldForcePlaybackCompositionRendererOverlay', () => {
  it('returns false for soft masks without transitions or GPU effects', () => {
    expect(shouldForcePlaybackCompositionRendererOverlay({
      items: [
        createItem({
          masks: [createMask({ feather: 12 })],
        }),
      ],
      transitions: [],
      compositionById: {},
    })).toBe(false);
  });

  it('returns false for direct GPU effects during playback', () => {
    expect(shouldForcePlaybackCompositionRendererOverlay({
      items: [
        createItem({
          effects: [
            {
              id: 'fx-playback',
              enabled: true,
              effect: {
                type: 'gpu-effect',
                gpuEffectType: 'gpu-brightness',
                params: { amount: 0.35 },
              },
            },
          ],
        }),
      ],
      transitions: [],
      compositionById: {},
    })).toBe(false);
  });

  it('returns true when the timeline contains a transition', () => {
    expect(shouldForcePlaybackCompositionRendererOverlay({
      items: [createItem({})],
      transitions: [
        {
          id: 'transition-3',
          type: 'fade',
          timing: 'linear',
          durationInFrames: 12,
          leftClipId: 'left',
          rightClipId: 'right',
        } as never,
      ],
      compositionById: {},
    })).toBe(true);
  });

  it('returns false when playback-only content is a nested GPU effect without transitions', () => {
    expect(shouldForcePlaybackCompositionRendererOverlay({
      items: [
        createItem({
          id: 'comp-playback',
          type: 'composition',
          compositionId: 'sub-playback',
          compositionWidth: 640,
          compositionHeight: 360,
        }),
      ],
      transitions: [],
      compositionById: {
        'sub-playback': {
          items: [
            createItem({
              id: 'gpu-child',
              effects: [
                {
                  id: 'fx-2',
                  enabled: true,
                  effect: {
                    type: 'gpu-effect',
                    gpuEffectType: 'gpu-contrast',
                    params: { amount: 0.5 },
                  },
                },
              ],
            }),
          ],
          transitions: [],
        },
      },
    })).toBe(false);
  });
});
