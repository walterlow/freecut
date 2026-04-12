import { useRippleEditPreviewStore } from '../stores/ripple-edit-preview-store';
import { useRollingEditPreviewStore } from '../stores/rolling-edit-preview-store';
import { useSlideEditPreviewStore } from '../stores/slide-edit-preview-store';
import { useSlipEditPreviewStore } from '../stores/slip-edit-preview-store';
import { useTrackPushPreviewStore } from '../stores/track-push-preview-store';
import { useZoomStore } from '../stores/zoom-store';
import { useSelectionStore } from '@/shared/state/selection';

const SHORT_PREVIEW_DELAY_MS = 120;
const LONG_PREVIEW_DELAY_MS = 220;
const VERY_LONG_PREVIEW_DELAY_MS = 360;
const PREVIEW_IDLE_TIMEOUT_MS = 1200;
const DEFAULT_AUDIO_STARTUP_HOLD_MIN_MS = 1200;

interface PreviewAudioStartupHold {
  releaseAtMs: number;
  expiresAtMs: number | null;
  releaseRequested: boolean;
}

interface SchedulePreviewWorkOptions {
  delayMs?: number;
  idleTimeoutMs?: number;
  ignoreAudioStartupHold?: boolean;
}

interface RegisterPreviewAudioStartupHoldOptions {
  minDurationMs?: number;
  maxDurationMs?: number;
}

const previewAudioStartupHolds = new Map<number, PreviewAudioStartupHold>();
const previewAudioStartupListeners = new Set<() => void>();
let nextPreviewAudioStartupHoldId = 1;
let previewAudioStartupTimer: ReturnType<typeof setTimeout> | null = null;

function hasActiveTimelineGesture(): boolean {
  return !!useSelectionStore.getState().dragState?.isDragging;
}

function hasActiveEditPreview(): boolean {
  const rolling = useRollingEditPreviewStore.getState();
  if (rolling.trimmedItemId !== null || rolling.neighborItemId !== null || rolling.handle !== null) {
    return true;
  }

  const ripple = useRippleEditPreviewStore.getState();
  if (ripple.trimmedItemId !== null || ripple.handle !== null) {
    return true;
  }

  const slip = useSlipEditPreviewStore.getState();
  if (slip.itemId !== null) {
    return true;
  }

  const slide = useSlideEditPreviewStore.getState();
  if (slide.itemId !== null) {
    return true;
  }

  const trackPush = useTrackPushPreviewStore.getState();
  return trackPush.anchorItemId !== null;
}

function clearPreviewAudioStartupTimer(): void {
  if (previewAudioStartupTimer !== null) {
    clearTimeout(previewAudioStartupTimer);
    previewAudioStartupTimer = null;
  }
}

function isPreviewAudioStartupHoldActive(
  hold: PreviewAudioStartupHold,
  nowMs: number,
): boolean {
  if (nowMs < hold.releaseAtMs) {
    return true;
  }
  if (!hold.releaseRequested) {
    return hold.expiresAtMs === null || nowMs < hold.expiresAtMs;
  }
  return false;
}

function pruneInactivePreviewAudioStartupHolds(nowMs: number = Date.now()): boolean {
  let changed = false;
  for (const [id, hold] of previewAudioStartupHolds) {
    if (isPreviewAudioStartupHoldActive(hold, nowMs)) {
      continue;
    }
    previewAudioStartupHolds.delete(id);
    changed = true;
  }
  return changed;
}

function schedulePreviewAudioStartupTimer(): void {
  clearPreviewAudioStartupTimer();
  const nowMs = Date.now();
  let nextWakeAtMs = Number.POSITIVE_INFINITY;

  for (const hold of previewAudioStartupHolds.values()) {
    if (!isPreviewAudioStartupHoldActive(hold, nowMs)) {
      continue;
    }

    if (nowMs < hold.releaseAtMs) {
      nextWakeAtMs = Math.min(nextWakeAtMs, hold.releaseAtMs);
      continue;
    }

    if (hold.expiresAtMs !== null) {
      nextWakeAtMs = Math.min(nextWakeAtMs, hold.expiresAtMs);
    }
  }

  if (!Number.isFinite(nextWakeAtMs)) {
    return;
  }

  previewAudioStartupTimer = setTimeout(() => {
    previewAudioStartupTimer = null;
    const changed = pruneInactivePreviewAudioStartupHolds();
    schedulePreviewAudioStartupTimer();
    if (changed) {
      for (const listener of previewAudioStartupListeners) {
        listener();
      }
    }
  }, Math.max(0, nextWakeAtMs - nowMs));
}

function hasActivePreviewAudioStartupHold(): boolean {
  pruneInactivePreviewAudioStartupHolds();
  const nowMs = Date.now();
  for (const hold of previewAudioStartupHolds.values()) {
    if (isPreviewAudioStartupHoldActive(hold, nowMs)) {
      return true;
    }
  }
  return false;
}

export function isPreviewWorkDeferred(
  options: { ignoreAudioStartupHold?: boolean } = {},
): boolean {
  return useZoomStore.getState().isZoomInteracting
    || hasActiveTimelineGesture()
    || hasActiveEditPreview()
    || (!options.ignoreAudioStartupHold && hasActivePreviewAudioStartupHold());
}

export function subscribePreviewWorkBudget(callback: () => void): () => void {
  previewAudioStartupListeners.add(callback);
  const unsubscribers = [
    useZoomStore.subscribe(callback),
    useSelectionStore.subscribe(callback),
    useRollingEditPreviewStore.subscribe(callback),
    useRippleEditPreviewStore.subscribe(callback),
    useSlipEditPreviewStore.subscribe(callback),
    useSlideEditPreviewStore.subscribe(callback),
    useTrackPushPreviewStore.subscribe(callback),
  ];

  return () => {
    previewAudioStartupListeners.delete(callback);
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}

export function registerPreviewAudioStartupHold(
  options: RegisterPreviewAudioStartupHoldOptions = {},
): () => void {
  const nowMs = Date.now();
  const minDurationMs = Math.max(0, options.minDurationMs ?? DEFAULT_AUDIO_STARTUP_HOLD_MIN_MS);
  const requestedMaxDurationMs = options.maxDurationMs;
  const maxDurationMs = requestedMaxDurationMs == null
    ? null
    : Math.max(minDurationMs, requestedMaxDurationMs);
  const holdId = nextPreviewAudioStartupHoldId++;

  previewAudioStartupHolds.set(holdId, {
    releaseAtMs: nowMs + minDurationMs,
    expiresAtMs: maxDurationMs === null ? null : nowMs + maxDurationMs,
    releaseRequested: false,
  });
  schedulePreviewAudioStartupTimer();

  return () => {
    const hold = previewAudioStartupHolds.get(holdId);
    if (!hold) {
      return;
    }

    hold.releaseRequested = true;
    const changed = pruneInactivePreviewAudioStartupHolds();
    schedulePreviewAudioStartupTimer();
    if (changed) {
      for (const listener of previewAudioStartupListeners) {
        listener();
      }
    }
  };
}

export function _resetPreviewWorkBudgetForTest(): void {
  previewAudioStartupHolds.clear();
  previewAudioStartupListeners.clear();
  nextPreviewAudioStartupHoldId = 1;
  clearPreviewAudioStartupTimer();
}

export function getPreviewStartupDelayMs(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return SHORT_PREVIEW_DELAY_MS;
  }
  if (durationSec >= 3600) {
    return VERY_LONG_PREVIEW_DELAY_MS;
  }
  if (durationSec >= 900) {
    return LONG_PREVIEW_DELAY_MS;
  }
  return SHORT_PREVIEW_DELAY_MS;
}

function scheduleOnIdle(callback: () => void, delayMs: number, idleTimeoutMs: number): () => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let idleId: number | null = null;
  let cancelled = false;

  const run = () => {
    if (cancelled) return;

    if (typeof requestIdleCallback === 'function') {
      idleId = requestIdleCallback(() => {
        idleId = null;
        if (!cancelled) {
          callback();
        }
      }, { timeout: idleTimeoutMs });
      return;
    }

    timeoutId = setTimeout(() => {
      timeoutId = null;
      if (!cancelled) {
        callback();
      }
    }, 0);
  };

  timeoutId = setTimeout(() => {
    timeoutId = null;
    run();
  }, Math.max(0, delayMs));

  return () => {
    cancelled = true;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    if (idleId !== null && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(idleId);
    }
  };
}

export function schedulePreviewWork(
  task: () => void,
  options: SchedulePreviewWorkOptions = {},
): () => void {
  const delayMs = options.delayMs ?? 0;
  const idleTimeoutMs = options.idleTimeoutMs ?? PREVIEW_IDLE_TIMEOUT_MS;
  const deferOptions = {
    ignoreAudioStartupHold: options.ignoreAudioStartupHold ?? false,
  };

  let cancelled = false;
  let cancelScheduled = () => {};
  let unsubscribeBudget = () => {};

  const cleanup = () => {
    cancelScheduled();
    unsubscribeBudget();
  };

  const scheduleAttempt = () => {
    cancelScheduled();
    cancelScheduled = scheduleOnIdle(() => {
      if (cancelled) return;
      if (isPreviewWorkDeferred(deferOptions)) {
        waitForBudget();
        return;
      }
      task();
    }, delayMs, idleTimeoutMs);
  };

  const onBudgetChange = () => {
    if (cancelled || isPreviewWorkDeferred(deferOptions)) {
      return;
    }
    unsubscribeBudget();
    unsubscribeBudget = () => {};
    scheduleAttempt();
  };

  const waitForBudget = () => {
    unsubscribeBudget();
    unsubscribeBudget = subscribePreviewWorkBudget(onBudgetChange);
  };

  if (isPreviewWorkDeferred(deferOptions)) {
    waitForBudget();
  } else {
    scheduleAttempt();
  }

  return () => {
    cancelled = true;
    cleanup();
  };
}
