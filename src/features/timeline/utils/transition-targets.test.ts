import { describe, expect, it } from 'vitest';
import type { Transition } from '@/types/transition';
import type { VideoItem } from '@/types/timeline';
import {
  resolveTransitionTargetForEdge,
  resolveTransitionTargetFromSelection,
} from './transition-targets';

function createVideoClip(
  id: string,
  from: number,
  durationInFrames: number,
  sourceStart = 0,
  sourceEnd = sourceStart + durationInFrames,
  sourceDuration = Math.max(120, sourceEnd + 60),
): VideoItem {
  return {
    id,
    type: 'video',
    trackId: 'track-1',
    from,
    durationInFrames,
    label: id,
    src: `${id}.mp4`,
    sourceStart,
    sourceEnd,
    sourceDuration,
  };
}

function createTransition(leftClipId: string, rightClipId: string): Transition {
  return {
    id: 'transition-1',
    type: 'crossfade',
    leftClipId,
    rightClipId,
    trackId: 'track-1',
    durationInFrames: 18,
    presentation: 'fade',
    timing: 'linear',
    alignment: 0.5,
  };
}

describe('transition-targets', () => {
  it('returns a valid edge target with duration clamped to available handle', () => {
    const items = [
      createVideoClip('left', 0, 60, 0, 72, 120),
      createVideoClip('right', 60, 60, 8, 68, 120),
    ];

    const target = resolveTransitionTargetForEdge({
      itemId: 'left',
      edge: 'right',
      items,
      transitions: [],
      preferredDurationInFrames: 30,
    });

    expect(target).toMatchObject({
      leftClipId: 'left',
      rightClipId: 'right',
      canApply: true,
      hasExisting: false,
      maxDurationInFrames: 16,
      suggestedDurationInFrames: 16,
    });
  });

  it('returns an invalid target when there is not enough handle at the cut', () => {
    const items = [
      createVideoClip('left', 0, 60, 0, 60, 60),
      createVideoClip('right', 60, 60, 0, 60, 60),
    ];

    const target = resolveTransitionTargetForEdge({
      itemId: 'left',
      edge: 'right',
      items,
      transitions: [],
    });

    expect(target).toMatchObject({
      leftClipId: 'left',
      rightClipId: 'right',
      canApply: false,
      hasExisting: false,
    });
    expect(target?.reason).toContain('Not enough source handle');
  });

  it('resolves an existing transition from single-clip selection', () => {
    const items = [
      createVideoClip('left', 0, 60, 0, 90, 120),
      createVideoClip('right', 60, 60, 15, 75, 120),
    ];

    const target = resolveTransitionTargetFromSelection({
      selectedItemIds: ['left'],
      items,
      transitions: [createTransition('left', 'right')],
    });

    expect(target).toMatchObject({
      leftClipId: 'left',
      rightClipId: 'right',
      hasExisting: true,
      existingTransitionId: 'transition-1',
      canApply: true,
      suggestedDurationInFrames: 18,
    });
  });
});
