import { describe, expect, it } from 'vitest';
import {
  createAdaptivePreviewQualityState,
  getEffectivePreviewQuality,
  getFrameBudgetMs,
  updateAdaptivePreviewQuality,
} from './adaptive-preview-quality';

describe('getEffectivePreviewQuality', () => {
  it('uses user quality when below cap', () => {
    expect(getEffectivePreviewQuality(0.5, 1)).toBe(0.5);
  });

  it('caps user quality under adaptive limit', () => {
    expect(getEffectivePreviewQuality(1, 0.25)).toBe(0.25);
  });
});

describe('getFrameBudgetMs', () => {
  it('accounts for playback rate', () => {
    expect(getFrameBudgetMs(30, 1)).toBeCloseTo(33.333, 2);
    expect(getFrameBudgetMs(30, 2)).toBeCloseTo(16.666, 2);
  });
});

describe('updateAdaptivePreviewQuality', () => {
  it('degrades when over budget enough times', () => {
    let state = createAdaptivePreviewQualityState(1);
    for (let i = 0; i < 10; i += 1) {
      const next = updateAdaptivePreviewQuality({
        state,
        sampleMsPerFrame: 45,
        frameBudgetMs: 33,
        userQuality: 1,
        nowMs: 2_000 + i,
        options: { changeCooldownMs: 0 },
      });
      state = next.state;
    }
    expect(state.qualityCap).toBe(0.5);
  });

  it('does not degrade below quarter quality', () => {
    let state = createAdaptivePreviewQualityState(0.25);
    for (let i = 0; i < 20; i += 1) {
      state = updateAdaptivePreviewQuality({
        state,
        sampleMsPerFrame: 60,
        frameBudgetMs: 16,
        userQuality: 1,
        nowMs: 3_000 + i,
        options: { changeCooldownMs: 0 },
      }).state;
    }
    expect(state.qualityCap).toBe(0.25);
  });

  it('recovers toward user quality when under budget', () => {
    let state = createAdaptivePreviewQualityState(0.25);
    for (let i = 0; i < 36; i += 1) {
      const next = updateAdaptivePreviewQuality({
        state,
        sampleMsPerFrame: 10,
        frameBudgetMs: 33,
        userQuality: 1,
        nowMs: 4_000 + i,
        options: { changeCooldownMs: 0 },
      });
      state = next.state;
    }
    expect(state.qualityCap).toBe(0.5);
  });

  it('respects cooldown between quality changes', () => {
    let state = createAdaptivePreviewQualityState(1);
    for (let i = 0; i < 10; i += 1) {
      state = updateAdaptivePreviewQuality({
        state,
        sampleMsPerFrame: 50,
        frameBudgetMs: 33,
        userQuality: 1,
        nowMs: 5_000 + i,
        options: { changeCooldownMs: 0 },
      }).state;
    }
    expect(state.qualityCap).toBe(0.5);

    for (let i = 0; i < 10; i += 1) {
      state = updateAdaptivePreviewQuality({
        state,
        sampleMsPerFrame: 50,
        frameBudgetMs: 33,
        userQuality: 1,
        nowMs: 5_010 + i,
        options: { changeCooldownMs: 1_000 },
      }).state;
    }
    expect(state.qualityCap).toBe(0.5);
  });

  it('does not recover while recovery is disabled', () => {
    let state = createAdaptivePreviewQualityState(0.25);
    for (let i = 0; i < 72; i += 1) {
      state = updateAdaptivePreviewQuality({
        state,
        sampleMsPerFrame: 8,
        frameBudgetMs: 33,
        userQuality: 1,
        nowMs: 6_000 + i,
        allowRecovery: false,
        options: { changeCooldownMs: 0 },
      }).state;
    }
    expect(state.qualityCap).toBe(0.25);
  });
});
