import React, { useEffect, useMemo, useRef } from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybackStore } from '@/shared/state/playback';
import type { PreviewVisualPlaybackMode } from '@/shared/state/preview-bridge';
import { createAdaptivePreviewQualityState } from '../utils/adaptive-preview-quality';
import type { PreviewPerfStats } from './use-preview-diagnostics';
import { usePreviewPlaybackController } from './use-preview-playback-controller';

type AudioContextLike = {
  currentTime: number;
  state: 'running' | 'suspended';
};

const previewAudioClockState = vi.hoisted(() => ({
  context: { currentTime: 0, state: 'running' } as AudioContextLike | null,
}));

vi.mock('@/features/preview/deps/composition-runtime', async () => {
  const actual = await vi.importActual<typeof import('@/features/preview/deps/composition-runtime')>(
    '@/features/preview/deps/composition-runtime'
  );
  return {
    ...actual,
    getSharedPreviewAudioContext: () => previewAudioClockState.context,
  };
});

let latestApi: ReturnType<typeof usePreviewPlaybackController> | null = null;
let rafCallbacks = new Map<number, FrameRequestCallback>();
let nextRafId = 1;

function createPreviewPerfStats(): PreviewPerfStats {
  return {
    resolveSamples: 0,
    resolveTotalMs: 0,
    resolveTotalIds: 0,
    resolveLastMs: 0,
    resolveLastIds: 0,
    preloadScanSamples: 0,
    preloadScanTotalMs: 0,
    preloadScanLastMs: 0,
    preloadBatchSamples: 0,
    preloadBatchTotalMs: 0,
    preloadBatchLastMs: 0,
    preloadBatchLastIds: 0,
    preloadCandidateIds: 0,
    preloadBudgetBase: 0,
    preloadBudgetAdjusted: 0,
    preloadWindowMaxCost: 0,
    preloadScanBudgetYields: 0,
    preloadContinuations: 0,
    preloadScrubDirection: 0,
    preloadDirectionPenaltyCount: 0,
    sourceWarmTarget: 0,
    sourceWarmKeep: 0,
    sourceWarmEvictions: 0,
    sourcePoolSources: 0,
    sourcePoolElements: 0,
    sourcePoolActiveClips: 0,
    fastScrubPrewarmedSources: 0,
    fastScrubPrewarmSourceEvictions: 0,
    staleScrubOverlayDrops: 0,
    scrubDroppedFrames: 0,
    scrubUpdates: 0,
    adaptiveQualityDowngrades: 0,
    adaptiveQualityRecovers: 0,
  };
}

function flushAnimationFrames(timestamp = 0) {
  const callbacks = [...rafCallbacks.values()];
  rafCallbacks = new Map();
  for (const callback of callbacks) {
    callback(timestamp);
  }
}

function HookHarness({
  visualPlaybackMode = 'streaming',
  fps = 30,
  totalFrames = 300,
}: {
  visualPlaybackMode?: PreviewVisualPlaybackMode;
  fps?: number;
  totalFrames?: number;
}) {
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const previewPerfRef = useRef(createPreviewPerfStats());
  const isGizmoInteractingRef = useRef(false);
  const preferPlayerForTextGizmoRef = useRef(false);
  const preferPlayerForStyledTextScrubRef = useRef(false);
  const adaptiveQualityStateRef = useRef(createAdaptivePreviewQualityState(1));
  const adaptiveFrameSampleRef = useRef<{ frame: number; tsMs: number } | null>(null);
  const ignorePlayerUpdatesRef = useRef(false);
  const playerSeekTargetRef = useRef<number | null>(null);
  const visualPlaybackModeRef = useRef<PreviewVisualPlaybackMode>(visualPlaybackMode);
  visualPlaybackModeRef.current = visualPlaybackMode;

  const controller = usePreviewPlaybackController({
    fps,
    combinedTracks: useMemo(() => [], []),
    keyframes: useMemo(() => [], []),
    activeGizmoItemType: null,
    isGizmoInteracting: false,
    isPlaying,
    totalFrames,
    visualPlaybackMode,
    forceFastScrubOverlay: true,
    previewPerfRef,
    isGizmoInteractingRef,
    preferPlayerForTextGizmoRef,
    preferPlayerForStyledTextScrubRef,
    adaptiveQualityStateRef,
    adaptiveFrameSampleRef,
    ignorePlayerUpdatesRef,
    playerSeekTargetRef,
    resolvePendingSeekLatency: () => {},
    visualPlaybackModeRef,
  });

  useEffect(() => {
    latestApi = controller;
    return () => {
      latestApi = null;
    };
  }, [controller]);

  return null;
}

describe('usePreviewPlaybackController', () => {
  beforeEach(() => {
    latestApi = null;
    previewAudioClockState.context = { currentTime: 0, state: 'running' };
    rafCallbacks = new Map();
    nextRafId = 1;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      const id = nextRafId++;
      rafCallbacks.set(id, callback);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
      rafCallbacks.delete(id);
    });
    usePlaybackStore.setState({
      currentFrame: 24,
      currentFrameEpoch: 0,
      isPlaying: false,
      playbackRate: 1,
      loop: false,
      volume: 1,
      muted: false,
      zoom: -1,
      previewFrame: null,
      previewFrameEpoch: 0,
      frameUpdateEpoch: 0,
      previewItemId: null,
      useProxy: true,
      previewQuality: 1,
    });
  });

  it('drives currentFrame from the shared audio clock during streaming playback', () => {
    render(<HookHarness visualPlaybackMode="streaming" fps={30} totalFrames={300} />);

    act(() => {
      usePlaybackStore.getState().play();
    });

    act(() => {
      previewAudioClockState.context!.currentTime = 1;
      flushAnimationFrames();
    });

    expect(usePlaybackStore.getState().currentFrame).toBe(54);
  });

  it('ignores Player frame callbacks while the streaming clock owns playback', () => {
    render(<HookHarness visualPlaybackMode="streaming" fps={30} totalFrames={300} />);

    act(() => {
      usePlaybackStore.getState().play();
    });

    expect(latestApi).not.toBeNull();

    act(() => {
      latestApi!.handleFrameChange(5);
    });

    expect(usePlaybackStore.getState().currentFrame).toBe(24);
  });

  it('falls back to Player frame callbacks when the audio clock is unavailable', () => {
    previewAudioClockState.context = null;

    render(<HookHarness visualPlaybackMode="streaming" fps={30} totalFrames={300} />);

    act(() => {
      usePlaybackStore.getState().play();
    });

    expect(latestApi).not.toBeNull();

    act(() => {
      latestApi!.handleFrameChange(40);
    });

    expect(usePlaybackStore.getState().currentFrame).toBe(40);
  });
});
