/**
 * Keyframe Actions - Animation keyframe operations with undo/redo support.
 */

import type { AnimatableProperty, EasingType, KeyframeRef } from '@/types/keyframe';
import type { KeyframeAddPayload } from '../keyframes-store';
import { useKeyframesStore } from '../keyframes-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { execute, logger, canAddKeyframeAtFrame } from './shared';

export function addKeyframe(
  itemId: string,
  property: AnimatableProperty,
  frame: number,
  value: number,
  easing?: EasingType
): string {
  // Validate: keyframes cannot be added in transition regions
  if (!canAddKeyframeAtFrame(itemId, frame)) {
    logger.warn('Cannot add keyframe in transition region', { itemId, property, frame });
    return '';
  }

  return execute('ADD_KEYFRAME', () => {
    const id = useKeyframesStore.getState()._addKeyframe(itemId, property, frame, value, easing);
    useTimelineSettingsStore.getState().markDirty();
    return id;
  }, { itemId, property, frame });
}

/**
 * Add multiple keyframes at once (batched as single undo operation).
 * Used by K hotkey to add keyframes for all properties at once.
 * Keyframes in transition regions are filtered out.
 */
export function addKeyframes(payloads: KeyframeAddPayload[]): string[] {
  if (payloads.length === 0) return [];

  // Filter out keyframes that would be placed in transition regions
  const validPayloads = payloads.filter((p) => canAddKeyframeAtFrame(p.itemId, p.frame));

  if (validPayloads.length === 0) {
    logger.warn('All keyframes blocked by transition regions', { originalCount: payloads.length });
    return [];
  }

  if (validPayloads.length < payloads.length) {
    logger.warn('Some keyframes blocked by transition regions', {
      originalCount: payloads.length,
      validCount: validPayloads.length,
    });
  }

  return execute('ADD_KEYFRAMES', () => {
    const ids = useKeyframesStore.getState()._addKeyframes(validPayloads);
    useTimelineSettingsStore.getState().markDirty();
    return ids;
  }, { count: validPayloads.length });
}

export function updateKeyframe(
  itemId: string,
  property: AnimatableProperty,
  keyframeId: string,
  updates: Partial<{ frame: number; value: number; easing: EasingType }>
): void {
  execute('UPDATE_KEYFRAME', () => {
    useKeyframesStore.getState()._updateKeyframe(itemId, property, keyframeId, updates);
    useTimelineSettingsStore.getState().markDirty();
  }, { itemId, property, keyframeId });
}

export function removeKeyframe(
  itemId: string,
  property: AnimatableProperty,
  keyframeId: string
): void {
  execute('REMOVE_KEYFRAME', () => {
    useKeyframesStore.getState()._removeKeyframe(itemId, property, keyframeId);
    useTimelineSettingsStore.getState().markDirty();
  }, { itemId, property, keyframeId });
}

export function removeKeyframesForItem(itemId: string): void {
  execute('REMOVE_KEYFRAMES_FOR_ITEM', () => {
    useKeyframesStore.getState()._removeKeyframesForItem(itemId);
    useTimelineSettingsStore.getState().markDirty();
  }, { itemId });
}

export function removeKeyframesForProperty(itemId: string, property: AnimatableProperty): void {
  execute('REMOVE_KEYFRAMES_FOR_PROPERTY', () => {
    useKeyframesStore.getState()._removeKeyframesForProperty(itemId, property);
    useTimelineSettingsStore.getState().markDirty();
  }, { itemId, property });
}

// Read-only keyframe helpers (no undo needed)
export function getKeyframesForItem(itemId: string) {
  return useKeyframesStore.getState().getKeyframesForItem(itemId);
}

export function hasKeyframesAtFrame(
  itemId: string,
  property: AnimatableProperty,
  frame: number
): boolean {
  return useKeyframesStore.getState().hasKeyframesAtFrame(itemId, property, frame);
}

/**
 * Remove multiple keyframes at once.
 */
export function removeKeyframes(refs: KeyframeRef[]): void {
  if (refs.length === 0) return;

  execute('REMOVE_KEYFRAMES', () => {
    useKeyframesStore.getState()._removeKeyframes(refs);
    useTimelineSettingsStore.getState().markDirty();
  }, { count: refs.length });
}
