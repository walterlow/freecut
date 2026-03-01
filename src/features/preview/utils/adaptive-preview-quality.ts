import type { PreviewQuality } from '@/shared/state/playback';

export interface AdaptivePreviewQualityState {
  qualityCap: PreviewQuality;
  frameTimeEmaMs: number;
  overBudgetSamples: number;
  underBudgetSamples: number;
  lastQualityChangeAtMs: number;
}

export interface AdaptivePreviewQualityOptions {
  emaAlpha: number;
  degradeThresholdRatio: number;
  recoverThresholdRatio: number;
  degradeSamples: number;
  recoverSamples: number;
  changeCooldownMs: number;
}

export interface AdaptivePreviewQualityInput {
  state: AdaptivePreviewQualityState;
  sampleMsPerFrame: number;
  frameBudgetMs: number;
  userQuality: PreviewQuality;
  nowMs: number;
  allowRecovery?: boolean;
  options?: Partial<AdaptivePreviewQualityOptions>;
}

export interface AdaptivePreviewQualityResult {
  state: AdaptivePreviewQualityState;
  qualityChanged: boolean;
  qualityChangeDirection: 'degrade' | 'recover' | null;
}

const DEFAULT_OPTIONS: AdaptivePreviewQualityOptions = {
  emaAlpha: 0.2,
  degradeThresholdRatio: 1.2,
  recoverThresholdRatio: 0.85,
  degradeSamples: 10,
  recoverSamples: 36,
  changeCooldownMs: 1200,
};

function getLowerQuality(quality: PreviewQuality): PreviewQuality {
  if (quality === 1) return 0.5;
  if (quality === 0.5) return 0.25;
  return 0.25;
}

function getHigherQuality(quality: PreviewQuality): PreviewQuality {
  if (quality === 0.25) return 0.5;
  if (quality === 0.5) return 1;
  return 1;
}

export function createAdaptivePreviewQualityState(
  qualityCap: PreviewQuality = 1
): AdaptivePreviewQualityState {
  return {
    qualityCap,
    frameTimeEmaMs: 0,
    overBudgetSamples: 0,
    underBudgetSamples: 0,
    lastQualityChangeAtMs: 0,
  };
}

export function getEffectivePreviewQuality(
  userQuality: PreviewQuality,
  qualityCap: PreviewQuality
): PreviewQuality {
  return userQuality <= qualityCap ? userQuality : qualityCap;
}

export function getFrameBudgetMs(fps: number, playbackRate: number): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const safeRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  const effectiveFps = Math.max(1, safeFps * safeRate);
  return 1000 / effectiveFps;
}

export function updateAdaptivePreviewQuality({
  state,
  sampleMsPerFrame,
  frameBudgetMs,
  userQuality,
  nowMs,
  allowRecovery = true,
  options,
}: AdaptivePreviewQualityInput): AdaptivePreviewQualityResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sample = Math.max(0, sampleMsPerFrame);
  const ema = state.frameTimeEmaMs === 0
    ? sample
    : (state.frameTimeEmaMs + ((sample - state.frameTimeEmaMs) * opts.emaAlpha));

  const overThresholdMs = frameBudgetMs * opts.degradeThresholdRatio;
  const underThresholdMs = frameBudgetMs * opts.recoverThresholdRatio;

  let overBudgetSamples = state.overBudgetSamples;
  let underBudgetSamples = state.underBudgetSamples;

  if (ema > overThresholdMs) {
    overBudgetSamples += 1;
    underBudgetSamples = 0;
  } else if (ema < underThresholdMs) {
    underBudgetSamples += 1;
    overBudgetSamples = 0;
  } else {
    overBudgetSamples = 0;
    underBudgetSamples = 0;
  }

  let qualityCap = state.qualityCap;
  let qualityChangeDirection: AdaptivePreviewQualityResult['qualityChangeDirection'] = null;
  let lastQualityChangeAtMs = state.lastQualityChangeAtMs;
  const canChange = (nowMs - state.lastQualityChangeAtMs) >= opts.changeCooldownMs;
  const effectiveQuality = getEffectivePreviewQuality(userQuality, qualityCap);

  if (
    canChange
    && overBudgetSamples >= opts.degradeSamples
    && effectiveQuality > 0.25
  ) {
    qualityCap = getLowerQuality(effectiveQuality);
    qualityChangeDirection = 'degrade';
    lastQualityChangeAtMs = nowMs;
    overBudgetSamples = 0;
    underBudgetSamples = 0;
  } else if (
    allowRecovery
    && canChange
    && underBudgetSamples >= opts.recoverSamples
    && qualityCap < userQuality
  ) {
    const nextCap = getHigherQuality(qualityCap);
    qualityCap = nextCap > userQuality ? userQuality : nextCap;
    qualityChangeDirection = 'recover';
    lastQualityChangeAtMs = nowMs;
    overBudgetSamples = 0;
    underBudgetSamples = 0;
  }

  return {
    state: {
      qualityCap,
      frameTimeEmaMs: ema,
      overBudgetSamples,
      underBudgetSamples,
      lastQualityChangeAtMs,
    },
    qualityChanged: qualityChangeDirection !== null,
    qualityChangeDirection,
  };
}
