import { describe, expect, it } from 'vitest';
import type { Transition } from '@/types/transition';
import {
  getTransitionBridgeAtHandle,
  hasAnyTransitionBridge,
  hasTransitionBridgeAtHandle,
} from './transition-edit-guards';

function makeTransition(leftClipId: string, rightClipId: string): Transition {
  return {
    id: `${leftClipId}-${rightClipId}`,
    type: 'crossfade',
    presentation: 'fade',
    timing: 'linear',
    leftClipId,
    rightClipId,
    trackId: 'track-1',
    durationInFrames: 30,
  };
}

describe('transition-edit-guards', () => {
  const transitions = [
    makeTransition('a', 'b'),
    makeTransition('c', 'd'),
  ];

  it('detects transition bridge on start handle', () => {
    expect(hasTransitionBridgeAtHandle(transitions, 'b', 'start')).toBe(true);
    expect(hasTransitionBridgeAtHandle(transitions, 'a', 'start')).toBe(false);
  });

  it('detects transition bridge on end handle', () => {
    expect(hasTransitionBridgeAtHandle(transitions, 'a', 'end')).toBe(true);
    expect(hasTransitionBridgeAtHandle(transitions, 'b', 'end')).toBe(false);
  });

  it('returns the transition bridge for a clip handle', () => {
    expect(getTransitionBridgeAtHandle(transitions, 'b', 'start')?.id).toBe('a-b');
    expect(getTransitionBridgeAtHandle(transitions, 'a', 'end')?.id).toBe('a-b');
    expect(getTransitionBridgeAtHandle(transitions, 'x', 'start')).toBeNull();
  });

  it('detects any transition participation for a selection', () => {
    expect(hasAnyTransitionBridge(transitions, ['x', 'a'])).toBe(true);
    expect(hasAnyTransitionBridge(transitions, ['x', 'y'])).toBe(false);
  });
});
