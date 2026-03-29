/**
 * Lightweight per-item gain overrides for real-time mixer fader adjustments.
 *
 * During fader drag, the mixer sets linear gain multipliers keyed by itemId.
 * Audio components subscribe via useMixerLiveGain(itemId) — only those
 * components re-render (cheap gain ramp), NOT the composition renderer.
 * On fader release, overrides are cleared and the track volume commits to the store.
 */

import { useSyncExternalStore } from 'react';

const overrides = new Map<string, number>();
const listeners = new Set<() => void>();
let epoch = 0;

function notify(): void {
  epoch++;
  for (const fn of listeners) fn();
}

export function setMixerLiveGains(entries: Array<{ itemId: string; gain: number }>): void {
  for (const { itemId, gain } of entries) {
    overrides.set(itemId, gain);
  }
  notify();
}

export function clearMixerLiveGains(): void {
  if (overrides.size === 0) return;
  overrides.clear();
  notify();
}

export function getMixerLiveGain(itemId: string): number {
  return overrides.get(itemId) ?? 1;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}

function getEpoch(): number {
  return epoch;
}

/**
 * Subscribe to mixer live gain changes. Returns the current epoch.
 * Audio components call this + getMixerLiveGain(itemId) to get their multiplier.
 * Only triggers re-render when any gain override changes.
 */
export function useMixerLiveGainEpoch(): number {
  return useSyncExternalStore(subscribe, getEpoch);
}
