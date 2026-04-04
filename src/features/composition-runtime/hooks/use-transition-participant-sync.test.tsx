import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTransitionParticipantSync } from './use-transition-participant-sync';

const testState = vi.hoisted(() => ({
  currentFrame: 40,
  isPlaying: true,
  onFrameChangeMock: vi.fn(() => () => {}),
  getClipElementMock: vi.fn(),
}));

vi.mock('@/features/composition-runtime/deps/player', () => ({
  useClock: () => ({
    currentFrame: testState.currentFrame,
    onFrameChange: testState.onFrameChangeMock,
  }),
  useVideoSourcePool: () => ({
    getClipElement: testState.getClipElementMock,
  }),
}));

vi.mock('./use-player-compat', () => ({
  useIsPlaying: () => testState.isPlaying,
}));

function createMockVideoElement(): HTMLVideoElement {
  const element = document.createElement('video');
  let currentTimeValue = 4;
  let pausedValue = true;

  Object.defineProperty(element, 'readyState', {
    configurable: true,
    get: () => 4,
  });
  Object.defineProperty(element, 'duration', {
    configurable: true,
    get: () => 120,
  });
  Object.defineProperty(element, 'currentTime', {
    configurable: true,
    get: () => currentTimeValue,
    set: (value: number) => {
      currentTimeValue = value;
    },
  });
  Object.defineProperty(element, 'paused', {
    configurable: true,
    get: () => pausedValue,
  });

  element.play = vi.fn(async () => {
    pausedValue = false;
  });
  element.pause = vi.fn(() => {
    pausedValue = true;
  });

  return element;
}

describe('useTransitionParticipantSync', () => {
  beforeEach(() => {
    testState.currentFrame = 40;
    testState.isPlaying = true;
    testState.onFrameChangeMock.mockClear();
    testState.onFrameChangeMock.mockImplementation(() => () => {});
    testState.getClipElementMock.mockReset();
  });

  it('keeps transition-held incoming preroll clips synced before their nominal from frame', () => {
    const leader = createMockVideoElement();
    const video = createMockVideoElement();
    video.dataset.transitionHold = '1';
    testState.getClipElementMock.mockImplementation((poolClipId: string) => {
      if (poolClipId === 'clip-a') return leader;
      if (poolClipId === 'clip-b') return video;
      return null;
    });

    renderHook(() => useTransitionParticipantSync([
      {
        poolClipId: 'clip-a',
        safeTrimBefore: 0,
        sourceFps: 30,
        playbackRate: 1,
        sequenceFrameOffset: 0,
        role: 'leader',
      },
      {
        poolClipId: 'clip-b',
        safeTrimBefore: 120,
        sourceFps: 30,
        playbackRate: 1,
        sequenceFrameOffset: 100,
        role: 'follower',
      },
    ], 0, 30));

    expect(video.pause).not.toHaveBeenCalled();
    expect(video.currentTime).toBeCloseTo(2, 3);
    expect(video.playbackRate).toBe(1);
    expect(video.play).toHaveBeenCalled();
  });
});
