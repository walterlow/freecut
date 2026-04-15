import { describe, expect, it } from 'vitest';

import {
  resolvePreviewMediabunnyInitAction,
  shouldAllowPreviewVideoElementFallback,
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

  it('uses strict waiting fallback only when preview has no decoder or fallback element', () => {
    expect(shouldUsePreviewStrictWaitingFallback({
      renderMode: 'preview',
      hasMediabunny: false,
      hasFallbackVideoElement: false,
    })).toBe(true);
    expect(shouldUsePreviewStrictWaitingFallback({
      renderMode: 'preview',
      hasMediabunny: true,
      hasFallbackVideoElement: false,
    })).toBe(false);
    expect(shouldUsePreviewStrictWaitingFallback({
      renderMode: 'export',
      hasMediabunny: false,
      hasFallbackVideoElement: false,
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

  it('allows preview video element fallback when mediabunny is unavailable', () => {
    expect(shouldAllowPreviewVideoElementFallback({
      renderMode: 'preview',
      hasFallbackVideoElement: true,
      hasMediabunny: false,
      isMediabunnyDisabled: false,
      mediabunnyFailedThisFrame: false,
    })).toBe(true);
    expect(shouldAllowPreviewVideoElementFallback({
      renderMode: 'preview',
      hasFallbackVideoElement: true,
      hasMediabunny: true,
      isMediabunnyDisabled: false,
      mediabunnyFailedThisFrame: false,
    })).toBe(false);
  });
});
