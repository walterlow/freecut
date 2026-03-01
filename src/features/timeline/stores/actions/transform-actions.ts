/**
 * Transform Actions - Item transform operations with undo/redo support.
 */

import type { TransformProperties } from '@/types/transform';
import type { AnimatableProperty } from '@/types/keyframe';
import type { LayoutConfig } from '../../utils/bento-layout';
import type { TransformCommandOptions, TransformHistoryOperation } from '../../types';
import { computeLayout, buildTransitionChains } from '../../utils/bento-layout';
import { useItemsStore } from '../items-store';
import { useKeyframesStore } from '../keyframes-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { useTransitionsStore } from '../transitions-store';
import { buildTransitionIndexes } from '../../utils/transition-indexes';
import { execute } from './shared';

function getTransformKeys(transform: Partial<TransformProperties>): Set<string> {
  const keys = new Set<string>();
  for (const key of Object.keys(transform)) {
    keys.add(key);
  }
  return keys;
}

function inferTransformOperation(keys: Set<string>): TransformHistoryOperation {
  const hasPosition = keys.has('x') || keys.has('y');
  const hasSize = keys.has('width') || keys.has('height');
  const hasRotation = keys.has('rotation');
  const hasOpacity = keys.has('opacity');
  const hasCornerRadius = keys.has('cornerRadius');
  const hasOther = [...keys].some((key) =>
    key !== 'x'
    && key !== 'y'
    && key !== 'width'
    && key !== 'height'
    && key !== 'rotation'
    && key !== 'opacity'
    && key !== 'cornerRadius'
  );

  if (hasPosition && !hasSize && !hasRotation && !hasOpacity && !hasCornerRadius && !hasOther) {
    return 'move';
  }
  if (hasSize && !hasPosition && !hasRotation && !hasOpacity && !hasCornerRadius && !hasOther) {
    return 'resize';
  }
  if (hasRotation && !hasPosition && !hasSize && !hasOpacity && !hasCornerRadius && !hasOther) {
    return 'rotate';
  }
  if (hasOpacity && !hasPosition && !hasSize && !hasRotation && !hasCornerRadius && !hasOther) {
    return 'opacity';
  }
  if (hasCornerRadius && !hasPosition && !hasSize && !hasRotation && !hasOpacity && !hasOther) {
    return 'corner_radius';
  }
  return 'transform';
}

function inferTransformOperationFromMap(
  transformsMap: Map<string, Partial<TransformProperties>>
): TransformHistoryOperation {
  const unionKeys = new Set<string>();
  for (const transform of transformsMap.values()) {
    for (const key of Object.keys(transform)) {
      unionKeys.add(key);
    }
  }
  return inferTransformOperation(unionKeys);
}

export function updateItemTransform(
  id: string,
  transform: Partial<TransformProperties>,
  options?: TransformCommandOptions
): void {
  const operation = options?.operation ?? inferTransformOperation(getTransformKeys(transform));
  execute('UPDATE_TRANSFORM', () => {
    useItemsStore.getState()._updateItemTransform(id, transform);
    useTimelineSettingsStore.getState().markDirty();
  }, { id, operation, properties: [...getTransformKeys(transform)] });
}

export function resetItemTransform(id: string): void {
  execute('RESET_TRANSFORM', () => {
    useItemsStore.getState()._resetItemTransform(id);
    useTimelineSettingsStore.getState().markDirty();
  }, { id });
}

export function updateItemsTransform(
  ids: string[],
  transform: Partial<TransformProperties>,
  options?: TransformCommandOptions
): void {
  const keys = getTransformKeys(transform);
  const operation = options?.operation ?? inferTransformOperation(keys);
  execute('UPDATE_TRANSFORMS', () => {
    useItemsStore.getState()._updateItemsTransform(ids, transform);
    useTimelineSettingsStore.getState().markDirty();
  }, { ids, count: ids.length, operation, properties: [...keys] });
}

export function updateItemsTransformMap(
  transformsMap: Map<string, Partial<TransformProperties>>,
  options?: TransformCommandOptions
): void {
  const operation = options?.operation ?? inferTransformOperationFromMap(transformsMap);
  execute('UPDATE_TRANSFORMS', () => {
    useItemsStore.getState()._updateItemsTransformMap(transformsMap);
    useTimelineSettingsStore.getState().markDirty();
  }, { count: transformsMap.size, operation });
}

/** Transform properties that bento layout controls (cleared from keyframes) */
const BENTO_PROPERTIES: AnimatableProperty[] = ['x', 'y', 'width', 'height', 'rotation'];

export function applyBentoLayout(
  itemIds: string[],
  canvasWidth: number,
  canvasHeight: number,
  config?: LayoutConfig,
  /** Pre-ordered chains from dialog drag-swap; skips buildTransitionChains when provided */
  orderedChains?: string[][],
): void {
  const items = useItemsStore.getState().items;

  // Filter to visual items only (exclude audio)
  const visualItemIds = itemIds.filter((id) => {
    const item = items.find((i) => i.id === id);
    return item != null && item.type !== 'audio';
  });

  if (visualItemIds.length < 2) return;

  // Use caller-provided chains (preserves user's drag-swap order) or rebuild from transitions
  let chains: string[][];
  if (orderedChains && orderedChains.length > 0) {
    // Filter out any audio-only chains and ensure all IDs are in visualItemIds
    const visualSet = new Set(visualItemIds);
    chains = orderedChains
      .map((chain) => chain.filter((id) => visualSet.has(id)))
      .filter((chain) => chain.length > 0);
  } else {
    const transitions = useTransitionsStore.getState().transitions;
    const { transitionsByClipId } = buildTransitionIndexes(transitions);
    chains = buildTransitionChains(visualItemIds, transitionsByClipId);
  }

  // One layout item per chain (use first item's source dimensions as representative)
  const layoutItems = chains.map((chain) => {
    const firstItem = items.find((i) => i.id === chain[0]);
    const sw = (firstItem && 'sourceWidth' in firstItem && firstItem.sourceWidth) || canvasWidth;
    const sh = (firstItem && 'sourceHeight' in firstItem && firstItem.sourceHeight) || canvasHeight;
    return { id: chain[0]!, sourceWidth: sw, sourceHeight: sh };
  });

  const resolvedConfig: LayoutConfig = config ?? { preset: 'auto' };
  const chainTransformsMap = computeLayout(layoutItems, canvasWidth, canvasHeight, resolvedConfig);

  // Expand chain transforms to all items in each chain
  const transformsMap = new Map<string, TransformProperties>();
  for (const chain of chains) {
    const transform = chainTransformsMap.get(chain[0]!);
    if (!transform) continue;
    for (const id of chain) {
      transformsMap.set(id, transform);
    }
  }

  execute('APPLY_BENTO_LAYOUT', () => {
    // Clear transform keyframes that would conflict
    const kfStore = useKeyframesStore.getState();
    for (const id of visualItemIds) {
      for (const prop of BENTO_PROPERTIES) {
        kfStore._removeKeyframesForProperty(id, prop);
      }
    }

    // Apply computed transforms
    useItemsStore.getState()._updateItemsTransformMap(transformsMap);
    useTimelineSettingsStore.getState().markDirty();
  }, { count: visualItemIds.length });
}
