import { describe, expect, it } from 'vitest';
import type { ResolvedTransitionWindow } from '@/domain/timeline/transitions/transition-planner';
import type { TimelineItem, TimelineTrack } from '@/types/timeline';
import { resolvePlaybackTransitionComplexStartFrames } from './preview-transition-complexity';

function createTrack(overrides: Partial<TimelineTrack> & Pick<TimelineTrack, 'id' | 'name' | 'order'>): TimelineTrack {
  return {
    id: overrides.id,
    name: overrides.name,
    kind: 'video',
    height: 60,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: overrides.order,
    items: overrides.items ?? [],
    ...overrides,
  };
}

function createVideoItem(
  id: string,
  trackId: string,
  from: number,
  durationInFrames: number,
  overrides: Partial<TimelineItem> = {},
): TimelineItem {
  return {
    id,
    label: id,
    type: 'video',
    trackId,
    from,
    durationInFrames,
    src: `blob:${id}`,
    ...overrides,
  } as TimelineItem;
}

function createTransitionWindow(
  leftClip: TimelineItem,
  rightClip: TimelineItem,
  startFrame: number = 40,
  endFrame: number = 60,
): ResolvedTransitionWindow<TimelineItem> {
  return {
    transition: {
      id: 'transition-1',
      type: 'crossfade',
      presentation: 'fade',
      timing: 'linear',
      leftClipId: leftClip.id,
      rightClipId: rightClip.id,
      trackId: leftClip.trackId,
      durationInFrames: endFrame - startFrame,
    },
    leftClip,
    rightClip,
    cutPoint: 60,
    startFrame,
    endFrame,
    durationInFrames: endFrame - startFrame,
    leftPortion: 10,
    rightPortion: 10,
  };
}

describe('resolvePlaybackTransitionComplexStartFrames', () => {
  it('keeps plain 1x video transitions on the DOM-safe path', () => {
    const leftClip = createVideoItem('clip-left', 'track-video', 0, 60);
    const rightClip = createVideoItem('clip-right', 'track-video', 40, 60);
    const tracks = [createTrack({ id: 'track-video', name: 'Video', order: 2, items: [leftClip, rightClip] })];

    expect(resolvePlaybackTransitionComplexStartFrames([createTransitionWindow(leftClip, rightClip)], tracks))
      .toEqual(new Set());
  });

  it('marks transitions complex when a participant is not plain 1x video', () => {
    const leftClip = createVideoItem('clip-left', 'track-video', 0, 60, {
      effects: [
        {
          id: 'effect-sepia',
          enabled: true,
          effect: {
            type: 'gpu-effect',
            gpuEffectType: 'gpu-sepia',
            params: { amount: 0.5 },
          },
        },
      ],
    });
    const rightClip = createVideoItem('clip-right', 'track-video', 40, 60);
    const tracks = [createTrack({ id: 'track-video', name: 'Video', order: 2, items: [leftClip, rightClip] })];

    expect(resolvePlaybackTransitionComplexStartFrames([createTransitionWindow(leftClip, rightClip)], tracks))
      .toEqual(new Set([40]));
  });

  it('marks transitions complex when a participant clip is not 1x speed', () => {
    const leftClip = createVideoItem('clip-left', 'track-video', 0, 60);
    const rightClip = createVideoItem('clip-right', 'track-video', 40, 60, { speed: 1.5 });
    const tracks = [createTrack({ id: 'track-video', name: 'Video', order: 2, items: [leftClip, rightClip] })];

    expect(resolvePlaybackTransitionComplexStartFrames([createTransitionWindow(leftClip, rightClip)], tracks))
      .toEqual(new Set([40]));
  });

  it('marks transitions complex when an overlapping visible mask affects the transition track', () => {
    const leftClip = createVideoItem('clip-left', 'track-video', 0, 60);
    const rightClip = createVideoItem('clip-right', 'track-video', 40, 60);
    const mask = {
      id: 'mask-1',
      label: 'Mask',
      type: 'shape',
      trackId: 'track-mask',
      from: 30,
      durationInFrames: 40,
      shapeType: 'rectangle',
      fillColor: '#ffffff',
      isMask: true,
      maskType: 'clip',
    } as TimelineItem;

    const tracks = [
      createTrack({ id: 'track-mask', name: 'Mask', order: 0, items: [mask] }),
      createTrack({ id: 'track-video', name: 'Video', order: 2, items: [leftClip, rightClip] }),
    ];

    expect(resolvePlaybackTransitionComplexStartFrames([createTransitionWindow(leftClip, rightClip)], tracks))
      .toEqual(new Set([40]));
  });

  it('marks transitions complex when an overlapping adjustment layer adds enabled effects', () => {
    const leftClip = createVideoItem('clip-left', 'track-video', 0, 60);
    const rightClip = createVideoItem('clip-right', 'track-video', 40, 60);
    const adjustment = {
      id: 'adjustment-1',
      label: 'Adjustment',
      type: 'adjustment',
      trackId: 'track-adjustment',
      from: 20,
      durationInFrames: 60,
      effects: [
        {
          id: 'effect-halftone',
          enabled: true,
          effect: {
            type: 'gpu-effect',
            gpuEffectType: 'gpu-halftone',
            params: { dotSize: 3 },
          },
        },
      ],
    } as TimelineItem;

    const tracks = [
      createTrack({ id: 'track-adjustment', name: 'Adjustment', order: 1, items: [adjustment] }),
      createTrack({ id: 'track-video', name: 'Video', order: 2, items: [leftClip, rightClip] }),
    ];

    expect(resolvePlaybackTransitionComplexStartFrames([createTransitionWindow(leftClip, rightClip)], tracks))
      .toEqual(new Set([40]));
  });

  it('ignores masks and adjustment layers that do not affect the transition track', () => {
    const leftClip = createVideoItem('clip-left', 'track-video', 0, 60);
    const rightClip = createVideoItem('clip-right', 'track-video', 40, 60);
    const unrelatedMask = {
      id: 'mask-1',
      label: 'Mask',
      type: 'shape',
      trackId: 'track-mask',
      from: 30,
      durationInFrames: 40,
      shapeType: 'rectangle',
      fillColor: '#ffffff',
      isMask: true,
      maskType: 'clip',
    } as TimelineItem;
    const disabledAdjustment = {
      id: 'adjustment-1',
      label: 'Adjustment',
      type: 'adjustment',
      trackId: 'track-adjustment',
      from: 20,
      durationInFrames: 60,
      effects: [
        {
          id: 'effect-disabled',
          enabled: false,
          effect: {
            type: 'gpu-effect',
            gpuEffectType: 'gpu-sepia',
            params: { amount: 0.5 },
          },
        },
      ],
    } as TimelineItem;

    const tracks = [
      createTrack({ id: 'track-video', name: 'Video', order: 1, items: [leftClip, rightClip] }),
      createTrack({ id: 'track-mask', name: 'Mask', order: 3, items: [unrelatedMask] }),
      createTrack({ id: 'track-adjustment', name: 'Adjustment', order: 3, items: [disabledAdjustment], visible: false }),
    ];

    expect(resolvePlaybackTransitionComplexStartFrames([createTransitionWindow(leftClip, rightClip)], tracks))
      .toEqual(new Set());
  });
});
