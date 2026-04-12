import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSelectionStore } from '@/shared/state/selection';

import {
  _resetPreviewWorkBudgetForTest,
  isPreviewWorkDeferred,
  registerPreviewAudioStartupHold,
  subscribePreviewWorkBudget,
} from './preview-work-budget';
import { useRippleEditPreviewStore } from '../stores/ripple-edit-preview-store';
import { useRollingEditPreviewStore } from '../stores/rolling-edit-preview-store';
import { _resetZoomStoreForTest } from '../stores/zoom-store';

describe('preview work budget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetZoomStoreForTest();
    _resetPreviewWorkBudgetForTest();
    useSelectionStore.getState().setDragState(null);
    useRollingEditPreviewStore.getState().clearPreview();
    useRippleEditPreviewStore.getState().clearPreview();
  });

  afterEach(() => {
    _resetZoomStoreForTest();
    _resetPreviewWorkBudgetForTest();
    useSelectionStore.getState().setDragState(null);
    useRollingEditPreviewStore.getState().clearPreview();
    useRippleEditPreviewStore.getState().clearPreview();
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
});
