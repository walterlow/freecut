import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSelectionStore } from '@/shared/state/selection';

import {
  _resetPreviewWorkBudgetForTest,
  isPreviewWorkDeferred,
  registerPreviewAudioStartupHold,
  schedulePreviewWork,
  subscribePreviewWorkBudget,
} from './preview-work-budget';
import { useRippleEditPreviewStore } from '../stores/ripple-edit-preview-store';
import { useRollingEditPreviewStore } from '../stores/rolling-edit-preview-store';
import { useSlideEditPreviewStore } from '../stores/slide-edit-preview-store';
import { useSlipEditPreviewStore } from '../stores/slip-edit-preview-store';
import { useTrackPushPreviewStore } from '../stores/track-push-preview-store';
import { _resetZoomStoreForTest } from '../stores/zoom-store';

describe('preview work budget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetZoomStoreForTest();
    _resetPreviewWorkBudgetForTest();
    useSelectionStore.getState().setDragState(null);
    useRollingEditPreviewStore.getState().clearPreview();
    useRippleEditPreviewStore.getState().clearPreview();
    useSlipEditPreviewStore.getState().clearPreview();
    useSlideEditPreviewStore.getState().clearPreview();
    useTrackPushPreviewStore.getState().clearPreview();
  });

  afterEach(() => {
    _resetZoomStoreForTest();
    _resetPreviewWorkBudgetForTest();
    useSelectionStore.getState().setDragState(null);
    useRollingEditPreviewStore.getState().clearPreview();
    useRippleEditPreviewStore.getState().clearPreview();
    useSlipEditPreviewStore.getState().clearPreview();
    useSlideEditPreviewStore.getState().clearPreview();
    useTrackPushPreviewStore.getState().clearPreview();
    vi.useRealTimers();
  });

  it('keeps preview work deferred until a released startup hold reaches its minimum duration', () => {
    const releaseHold = registerPreviewAudioStartupHold({
      minDurationMs: 100,
      maxDurationMs: 500,
    });

    expect(isPreviewWorkDeferred()).toBe(true);

    releaseHold();
    expect(isPreviewWorkDeferred()).toBe(true);

    vi.advanceTimersByTime(99);
    expect(isPreviewWorkDeferred()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(isPreviewWorkDeferred()).toBe(false);
  });

  it('notifies subscribers when a startup hold expires', () => {
    const onBudgetChange = vi.fn();
    const unsubscribe = subscribePreviewWorkBudget(onBudgetChange);

    registerPreviewAudioStartupHold({
      minDurationMs: 100,
      maxDurationMs: 100,
    });

    expect(onBudgetChange).not.toHaveBeenCalled();
    expect(isPreviewWorkDeferred()).toBe(true);

    vi.advanceTimersByTime(100);

    expect(onBudgetChange).toHaveBeenCalledTimes(1);
    expect(isPreviewWorkDeferred()).toBe(false);

    unsubscribe();
  });

  it('can schedule visual work without waiting on the audio startup hold', () => {
    const task = vi.fn();
    registerPreviewAudioStartupHold({
      minDurationMs: 100,
      maxDurationMs: 500,
    });

    expect(isPreviewWorkDeferred()).toBe(true);
    expect(isPreviewWorkDeferred({ ignoreAudioStartupHold: true })).toBe(false);

    schedulePreviewWork(task, {
      ignoreAudioStartupHold: true,
    });

    vi.runAllTimers();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('defers preview work during slip, slide, and track-push previews', () => {
    useSlipEditPreviewStore.getState().setPreview({
      itemId: 'item-1',
      trackId: 'track-1',
      slipDelta: 0,
    });
    expect(isPreviewWorkDeferred()).toBe(true);
    useSlipEditPreviewStore.getState().clearPreview();
    expect(isPreviewWorkDeferred()).toBe(false);

    useSlideEditPreviewStore.getState().setPreview({
      itemId: 'item-1',
      trackId: 'track-1',
      leftNeighborId: null,
      rightNeighborId: null,
      slideDelta: 0,
    });
    expect(isPreviewWorkDeferred()).toBe(true);
    useSlideEditPreviewStore.getState().clearPreview();
    expect(isPreviewWorkDeferred()).toBe(false);

    useTrackPushPreviewStore.getState().setPreview({
      anchorItemId: 'item-1',
      trackId: 'track-1',
      shiftedItemIds: new Set(['item-1']),
      delta: 0,
    });
    expect(isPreviewWorkDeferred()).toBe(true);
    useTrackPushPreviewStore.getState().clearPreview();
    expect(isPreviewWorkDeferred()).toBe(false);
  });
});
