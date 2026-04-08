import { describe, expect, it } from 'vitest';
import type { Transition } from '@/types/transition';
import {
  getCommittedHeaderFrameValues,
  planGlobalHeaderFrameCommit,
  planLocalHeaderFrameCommit,
} from './header-frame-input-actions';

describe('header frame input actions', () => {
  const blockedTransition = {} as Transition;

  it('plans a local frame commit using blocked-range clamping and frame offsets', () => {
    expect(
      planLocalHeaderFrameCommit({
        inputValue: '40',
        selectedFrameSummary: {
          hasMixedFrames: false,
          localFrame: 20,
          globalFrame: 50,
        },
        totalFrames: 120,
        transitionBlockedRanges: [
          { start: 28, end: 32, transition: blockedTransition, role: 'outgoing' },
        ],
      })
    ).toEqual({
      initialLocalFrame: 20,
      targetLocalFrame: 40,
      globalFrameOffset: 30,
    });
  });

  it('plans a global frame commit by converting global input back to local clip space', () => {
    expect(
      planGlobalHeaderFrameCommit({
        inputValue: '55',
        selectedFrameSummary: {
          hasMixedFrames: false,
          localFrame: 20,
          globalFrame: 50,
        },
        currentFrame: 12,
        globalFrame: 42,
        totalFrames: 120,
        transitionBlockedRanges: [],
      })
    ).toEqual({
      initialLocalFrame: 20,
      targetLocalFrame: 25,
      globalFrameOffset: 30,
    });
  });

  it('returns normalized local and global input values after a move result', () => {
    expect(
      getCommittedHeaderFrameValues(
        {
          initialLocalFrame: 20,
          targetLocalFrame: 24,
          globalFrameOffset: 30,
        },
        { didMove: true, appliedDeltaFrames: 4 }
      )
    ).toEqual({
      finalLocalFrame: 24,
      localInputValue: '24',
      globalInputValue: '54',
    });
  });

  it('returns null plans when the selection is mixed or the input is invalid', () => {
    expect(
      planLocalHeaderFrameCommit({
        inputValue: 'abc',
        selectedFrameSummary: {
          hasMixedFrames: false,
          localFrame: 20,
          globalFrame: 50,
        },
        totalFrames: 120,
        transitionBlockedRanges: [],
      })
    ).toBeNull();

    expect(
      planGlobalHeaderFrameCommit({
        inputValue: '55',
        selectedFrameSummary: {
          hasMixedFrames: true,
          localFrame: 20,
          globalFrame: 50,
        },
        currentFrame: 12,
        globalFrame: 42,
        totalFrames: 120,
        transitionBlockedRanges: [],
      })
    ).toBeNull();
  });
});
