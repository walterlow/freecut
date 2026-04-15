import { describe, expect, it } from 'vitest';

import {
  resolvePreviewMediabunnyInitAction,
  shouldAllowVideoElementFallback,
  shouldTryPreviewWorkerBitmap,
  shouldUsePreviewStrictWaitingFallback,
} from './frame-source-policy';

describe('frame-source-policy', () => {
  it('warms mediabunny in the background for variable-speed preview playback', () => {
    expect(resolvePreviewMediabunnyInitAction({
      renderMode: 'preview',
      hasMediabunny: false,
      isMediabunnyDisabled: false,
      hasEnsureVideoItemReady: true,
      speed: 1.25,
    })).toBe('warm-background-and-skip');
  });

  it('awaits mediabunny readiness for 1x preview playback', () => {
    expect(resolvePreviewMediabunnyInitAction({
      renderMode: 'preview',
      hasMediabunny: false,
      isMediabunnyDisabled: false,
      hasEnsureVideoItemReady: true,
      speed: 1,
    })).toBe('await-ready');
  });

  it('uses strict waiting fallback only when preview has no decoder', () => {
    expect(shouldUsePreviewStrictWaitingFallback({
      renderMode: 'preview',
      hasMediabunny: false,
    })).toBe(true);
    expect(shouldUsePreviewStrictWaitingFallback({
      renderMode: 'preview',
      hasMediabunny: true,
    })).toBe(false);
    expect(shouldUsePreviewStrictWaitingFallback({
      renderMode: 'export',
      hasMediabunny: false,
    })).toBe(false);
  });

  it('tries worker bitmaps only in preview mode', () => {
    expect(shouldTryPreviewWorkerBitmap({
      renderMode: 'preview',
    })).toBe(true);
    expect(shouldTryPreviewWorkerBitmap({
      renderMode: 'export',
    })).toBe(false);
  });

  it('allows video element fallback when mediabunny is unavailable', () => {
    expect(shouldAllowVideoElementFallback({
      hasFallbackVideoElement: true,
      hasMediabunny: false,
      isMediabunnyDisabled: false,
      mediabunnyFailedThisFrame: false,
    })).toBe(true);
    expect(shouldAllowVideoElementFallback({
      hasFallbackVideoElement: true,
      hasMediabunny: true,
      isMediabunnyDisabled: false,
      mediabunnyFailedThisFrame: false,
    })).toBe(false);
  });
});
