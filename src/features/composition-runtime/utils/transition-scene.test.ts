import { describe, expect, it } from 'vitest';
import {
  collectTransitionParticipantClipIds,
  resolveTransitionFrameState,
} from './transition-scene';

describe('transition scene', () => {
  it('resolves active transitions and participating clip ids for a frame', () => {
    const state = resolveTransitionFrameState({
      transitionWindows: [
        {
          transition: {
            id: 'transition-1',
            type: 'crossfade' as const,
            trackId: 'track-1',
            leftClipId: 'left',
            rightClipId: 'right',
            durationInFrames: 10,
            timing: 'linear' as const,
            presentation: 'fade' as const,
          },
          leftClip: {
            id: 'left',
            type: 'video' as const,
            trackId: 'track-1',
            from: 0,
            durationInFrames: 30,
            src: 'left.mp4',
            label: 'Left',
          },
          rightClip: {
            id: 'right',
            type: 'video' as const,
            trackId: 'track-1',
            from: 20,
            durationInFrames: 30,
            src: 'right.mp4',
            label: 'Right',
          },
          cutPoint: 30,
          startFrame: 20,
          endFrame: 30,
          durationInFrames: 10,
          leftPortion: 10,
          rightPortion: 10,
        },
      ],
      frame: 25,
    });

    expect(state.activeTransitions).toEqual([
      expect.objectContaining({
        transition: expect.objectContaining({ id: 'transition-1' }),
        leftClip: expect.objectContaining({ id: 'left' }),
        rightClip: expect.objectContaining({ id: 'right' }),
        progress: expect.any(Number),
        transitionStart: 20,
        transitionEnd: 30,
      }),
    ]);
    expect(state.transitionClipIds).toEqual(new Set(['left', 'right']));
  });

  it('collects active and imminent transition clip ids within a lookahead window', () => {
    const transitionWindows = [
      {
        transition: {
          id: 'transition-1',
          type: 'crossfade' as const,
          trackId: 'track-1',
          leftClipId: 'left',
          rightClipId: 'right',
          durationInFrames: 10,
          timing: 'linear' as const,
          presentation: 'fade' as const,
        },
        leftClip: {
          id: 'left',
          type: 'video' as const,
          trackId: 'track-1',
          from: 0,
          durationInFrames: 30,
          src: 'left.mp4',
          label: 'Left',
        },
        rightClip: {
          id: 'right',
          type: 'video' as const,
          trackId: 'track-1',
          from: 20,
          durationInFrames: 30,
          src: 'right.mp4',
          label: 'Right',
        },
        cutPoint: 30,
        startFrame: 20,
        endFrame: 30,
        durationInFrames: 10,
        leftPortion: 10,
        rightPortion: 10,
      },
    ];

    expect(collectTransitionParticipantClipIds({
      transitionWindows,
      frame: 5,
      lookaheadFrames: 20,
    })).toEqual(new Set(['left', 'right']));

    expect(collectTransitionParticipantClipIds({
      transitionWindows,
      frame: 31,
      lookaheadFrames: 20,
    })).toEqual(new Set());

    expect(collectTransitionParticipantClipIds({
      transitionWindows,
      frame: 31,
      lookaheadFrames: 0,
      lookbehindFrames: 3,
    })).toEqual(new Set(['left', 'right']));
  });
});
