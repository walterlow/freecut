import React, { useEffect } from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioPlaybackProps } from '../audio-playback-props';
import { useAudioPlaybackState } from './use-audio-playback-state';

const playerMocks = vi.hoisted(() => ({
  sequenceContext: { localFrame: 12 } as { localFrame: number } | null,
}));

const compatMocks = vi.hoisted(() => ({
  videoConfig: { fps: 30 },
  isPlaying: false,
}));

const previewBridgeMocks = vi.hoisted(() => ({
  state: {
    visualPlaybackMode: 'player' as 'player' | 'rendered_preview' | 'streaming',
  },
}));

const storeMocks = vi.hoisted(() => ({
  playbackState: {
    currentFrame: 48,
    isPlaying: true,
    volume: 1,
    muted: false,
  },
  gizmoState: {
    preview: undefined as Record<string, { properties?: Record<string, unknown> }> | undefined,
  },
  timelineState: {
    keyframes: [] as unknown[],
  },
}));

const latestState: {
  current: ReturnType<typeof useAudioPlaybackState> | null;
} = { current: null };

vi.mock('@/features/composition-runtime/deps/player', () => ({
  useSequenceContext: () => playerMocks.sequenceContext,
}));

vi.mock('../../hooks/use-player-compat', () => ({
  useVideoConfig: () => compatMocks.videoConfig,
  useIsPlaying: () => compatMocks.isPlaying,
}));

vi.mock('@/shared/state/preview-bridge', () => ({
  usePreviewBridgeStore: (selector?: (value: typeof previewBridgeMocks.state) => unknown) => (
    selector ? selector(previewBridgeMocks.state) : previewBridgeMocks.state
  ),
}));

vi.mock('@/features/composition-runtime/deps/stores', () => ({
  useGizmoStore: (selector?: (value: typeof storeMocks.gizmoState) => unknown) => (
    selector ? selector(storeMocks.gizmoState) : storeMocks.gizmoState
  ),
  usePlaybackStore: (selector?: (value: typeof storeMocks.playbackState) => unknown) => (
    selector ? selector(storeMocks.playbackState) : storeMocks.playbackState
  ),
  useTimelineStore: (selector?: (value: typeof storeMocks.timelineState) => unknown) => (
    selector ? selector(storeMocks.timelineState) : storeMocks.timelineState
  ),
}));

vi.mock('../../contexts/keyframes-context', () => ({
  useItemKeyframesFromContext: () => null,
}));

vi.mock('@/features/composition-runtime/deps/keyframes', () => ({
  getPropertyKeyframes: () => [],
  interpolatePropertyValue: (_keyframes: unknown, _frame: number, fallback: number) => fallback,
}));

vi.mock('@/shared/utils/audio-eq', () => ({
  resolvePreviewAudioEqStages: () => [],
}));

vi.mock('@/shared/utils/audio-pitch', () => ({
  resolvePreviewAudioPitchShiftSemitones: () => 0,
}));

vi.mock('@/shared/state/mixer-live-gain', () => ({
  useMixerLiveGainProduct: () => 1,
  clearMixerLiveGain: () => {},
}));

function Harness(props: AudioPlaybackProps) {
  const state = useAudioPlaybackState(props);
  useEffect(() => {
    latestState.current = state;
  }, [state]);
  return null;
}

describe('useAudioPlaybackState', () => {
  beforeEach(() => {
    latestState.current = null;
    playerMocks.sequenceContext = { localFrame: 12 };
    compatMocks.videoConfig = { fps: 30 };
    compatMocks.isPlaying = false;
    previewBridgeMocks.state.visualPlaybackMode = 'player';
    storeMocks.playbackState.currentFrame = 48;
    storeMocks.playbackState.isPlaying = true;
    storeMocks.playbackState.volume = 1;
    storeMocks.playbackState.muted = false;
    storeMocks.gizmoState.preview = undefined;
    storeMocks.timelineState.keyframes = [];
  });

  it('uses Player timing while visual playback mode is player-owned', async () => {
    render(
      <Harness
        itemId="item-1"
        durationInFrames={120}
        volume={0}
      />,
    );

    await waitFor(() => {
      expect(latestState.current).not.toBeNull();
    });

    expect(latestState.current?.frame).toBe(12);
    expect(latestState.current?.playing).toBe(false);
    expect(latestState.current?.fps).toBe(30);
  });

  it('uses preview transport state but keeps clip-local frame timing while visual playback mode is streaming', async () => {
    previewBridgeMocks.state.visualPlaybackMode = 'streaming';
    compatMocks.isPlaying = false;
    storeMocks.playbackState.currentFrame = 96;
    storeMocks.playbackState.isPlaying = true;

    render(
      <Harness
        itemId="item-1"
        durationInFrames={120}
        volume={0}
      />,
    );

    await waitFor(() => {
      expect(latestState.current).not.toBeNull();
    });

    expect(latestState.current?.frame).toBe(12);
    expect(latestState.current?.playing).toBe(true);
    expect(latestState.current?.fps).toBe(30);
  });
});
