/**
 * Timeline Actions - Cross-domain operations with undo/redo support.
 *
 * These functions wrap operations that span multiple domain stores,
 * ensuring atomicity through the command system.
 *
 * Single-domain operations can be called directly on the domain stores,
 * but cross-domain operations (like removeItems which cascades to
 * transitions and keyframes) must go through these wrappers.
 */

import type { TimelineItem, TimelineTrack, ProjectMarker } from '@/types/timeline';
import type { TransformProperties } from '@/types/transform';
import type { VisualEffect } from '@/types/effects';
import type {
  Transition,
  TransitionType,
  TransitionPresentation,
  WipeDirection,
  SlideDirection,
  FlipDirection,
} from '@/types/transition';
import type { AnimatableProperty, EasingType } from '@/types/keyframe';

import { useTimelineCommandStore } from './timeline-command-store';
import { useItemsStore } from './items-store';
import { useTransitionsStore } from './transitions-store';
import { useKeyframesStore } from './keyframes-store';
import { useMarkersStore } from './markers-store';
import { useTimelineSettingsStore } from './timeline-settings-store';
import { validateTransitions } from '../utils/transition-validation';
import { canAddTransition } from '../utils/transition-utils';

// Helper to get execute function
const execute = <T>(type: string, action: () => T, payload?: Record<string, unknown>): T => {
  return useTimelineCommandStore.getState().execute({ type, payload }, action);
};

// =============================================================================
// TRACK ACTIONS
// =============================================================================

export function setTracks(tracks: TimelineTrack[]): void {
  execute('SET_TRACKS', () => {
    useItemsStore.getState().setTracks(tracks);
    useTimelineSettingsStore.getState().markDirty();
  }, { count: tracks.length });
}

// =============================================================================
// ITEM ACTIONS (Cross-domain - affect transitions/keyframes)
// =============================================================================

export function addItem(item: TimelineItem): void {
  execute('ADD_ITEM', () => {
    useItemsStore.getState()._addItem(item);
    useTimelineSettingsStore.getState().markDirty();
  }, { itemId: item.id, type: item.type });
}

export function updateItem(id: string, updates: Partial<TimelineItem>): void {
  execute('UPDATE_ITEM', () => {
    useItemsStore.getState()._updateItem(id, updates);

    // Validate transitions if position changed
    const positionChanged = 'from' in updates || 'durationInFrames' in updates || 'trackId' in updates;
    if (positionChanged) {
      const items = useItemsStore.getState().items;
      const transitions = useTransitionsStore.getState().transitions;
      const { valid, broken } = validateTransitions([id], items, transitions);

      useTransitionsStore.getState().setTransitions(valid);
      if (broken.length > 0) {
        useTransitionsStore.getState().setPendingBreakages([
          ...useTransitionsStore.getState().pendingBreakages,
          ...broken,
        ]);
      }
    }

    useTimelineSettingsStore.getState().markDirty();
  }, { id, updates });
}

export function removeItems(ids: string[]): void {
  execute('REMOVE_ITEMS', () => {
    // Remove items
    useItemsStore.getState()._removeItems(ids);

    // Cascade: Remove transitions referencing deleted items
    useTransitionsStore.getState()._removeTransitionsForItems(ids);

    // Cascade: Remove keyframes for deleted items
    useKeyframesStore.getState()._removeKeyframesForItems(ids);

    useTimelineSettingsStore.getState().markDirty();
  }, { ids });
}

export function rippleDeleteItems(ids: string[]): void {
  execute('RIPPLE_DELETE_ITEMS', () => {
    useItemsStore.getState()._rippleDeleteItems(ids);

    // Cascade: Remove transitions and keyframes
    useTransitionsStore.getState()._removeTransitionsForItems(ids);
    useKeyframesStore.getState()._removeKeyframesForItems(ids);

    useTimelineSettingsStore.getState().markDirty();
  }, { ids });
}

export function closeGapAtPosition(trackId: string, frame: number): void {
  execute('CLOSE_GAP', () => {
    useItemsStore.getState()._closeGapAtPosition(trackId, frame);

    // Validate all transitions on this track
    const items = useItemsStore.getState().items;
    const trackItems = items.filter((i) => i.trackId === trackId);
    const transitions = useTransitionsStore.getState().transitions;
    const { valid, broken } = validateTransitions(
      trackItems.map((i) => i.id),
      items,
      transitions
    );

    useTransitionsStore.getState().setTransitions(valid);
    if (broken.length > 0) {
      useTransitionsStore.getState().setPendingBreakages([
        ...useTransitionsStore.getState().pendingBreakages,
        ...broken,
      ]);
    }

    useTimelineSettingsStore.getState().markDirty();
  }, { trackId, frame });
}

export function moveItem(id: string, newFrom: number, newTrackId?: string): void {
  execute('MOVE_ITEM', () => {
    useItemsStore.getState()._moveItem(id, newFrom, newTrackId);

    // Validate transitions
    const items = useItemsStore.getState().items;
    const transitions = useTransitionsStore.getState().transitions;
    const { valid, broken } = validateTransitions([id], items, transitions);

    useTransitionsStore.getState().setTransitions(valid);
    if (broken.length > 0) {
      useTransitionsStore.getState().setPendingBreakages([
        ...useTransitionsStore.getState().pendingBreakages,
        ...broken,
      ]);
    }

    useTimelineSettingsStore.getState().markDirty();
  }, { id, newFrom, newTrackId });
}

export function moveItems(updates: Array<{ id: string; from: number; trackId?: string }>): void {
  execute('MOVE_ITEMS', () => {
    useItemsStore.getState()._moveItems(updates);

    const movedItemIds = new Set(updates.map((u) => u.id));
    const items = useItemsStore.getState().items;
    const transitions = useTransitionsStore.getState().transitions;

    // Update transition trackIds when both clips of a pair move together
    const updatedTransitions = transitions.map((t) => {
      const leftMoved = movedItemIds.has(t.leftClipId);
      const rightMoved = movedItemIds.has(t.rightClipId);

      if (leftMoved && rightMoved) {
        const leftClip = items.find((i) => i.id === t.leftClipId);
        const rightClip = items.find((i) => i.id === t.rightClipId);

        // If they're now on the same track, update transition trackId
        if (leftClip && rightClip && leftClip.trackId === rightClip.trackId) {
          return { ...t, trackId: leftClip.trackId };
        }
      }
      return t;
    });

    // Validate transitions for all moved items
    const { valid, broken } = validateTransitions(
      updates.map((u) => u.id),
      items,
      updatedTransitions
    );

    useTransitionsStore.getState().setTransitions(valid);
    if (broken.length > 0) {
      useTransitionsStore.getState().setPendingBreakages([
        ...useTransitionsStore.getState().pendingBreakages,
        ...broken,
      ]);
    }

    useTimelineSettingsStore.getState().markDirty();
  }, { count: updates.length });
}

export function duplicateItems(
  itemIds: string[],
  positions: Array<{ from: number; trackId: string }>
): TimelineItem[] {
  return execute('DUPLICATE_ITEMS', () => {
    const newItems = useItemsStore.getState()._duplicateItems(itemIds, positions);
    useTimelineSettingsStore.getState().markDirty();
    return newItems;
  }, { itemIds, count: positions.length });
}

export function trimItemStart(id: string, trimAmount: number): void {
  execute('TRIM_ITEM_START', () => {
    useItemsStore.getState()._trimItemStart(id, trimAmount);

    // Validate transitions
    const items = useItemsStore.getState().items;
    const transitions = useTransitionsStore.getState().transitions;
    const { valid, broken } = validateTransitions([id], items, transitions);

    useTransitionsStore.getState().setTransitions(valid);
    if (broken.length > 0) {
      useTransitionsStore.getState().setPendingBreakages([
        ...useTransitionsStore.getState().pendingBreakages,
        ...broken,
      ]);
    }

    useTimelineSettingsStore.getState().markDirty();
  }, { id, trimAmount });
}

export function trimItemEnd(id: string, trimAmount: number): void {
  execute('TRIM_ITEM_END', () => {
    useItemsStore.getState()._trimItemEnd(id, trimAmount);

    // Validate transitions
    const items = useItemsStore.getState().items;
    const transitions = useTransitionsStore.getState().transitions;
    const { valid, broken } = validateTransitions([id], items, transitions);

    useTransitionsStore.getState().setTransitions(valid);
    if (broken.length > 0) {
      useTransitionsStore.getState().setPendingBreakages([
        ...useTransitionsStore.getState().pendingBreakages,
        ...broken,
      ]);
    }

    useTimelineSettingsStore.getState().markDirty();
  }, { id, trimAmount });
}

export function splitItem(
  id: string,
  splitFrame: number
): { leftItem: TimelineItem; rightItem: TimelineItem } | null {
  return execute('SPLIT_ITEM', () => {
    const result = useItemsStore.getState()._splitItem(id, splitFrame);
    if (!result) return null;

    const { rightItem } = result;

    // Update transitions pointing to split item
    const transitions = useTransitionsStore.getState().transitions;
    const updatedTransitions = transitions.map((t) => {
      if (t.leftClipId === id) {
        // Transition was from this clip - now from right half
        return { ...t, leftClipId: rightItem.id };
      }
      if (t.rightClipId === id) {
        // Transition was to this clip - stays pointing to left half (original ID)
        return t;
      }
      return t;
    });
    useTransitionsStore.getState().setTransitions(updatedTransitions);

    useTimelineSettingsStore.getState().markDirty();
    return result;
  }, { id, splitFrame });
}

export function joinItems(itemIds: string[]): void {
  execute('JOIN_ITEMS', () => {
    useItemsStore.getState()._joinItems(itemIds);

    // Remove keyframes for joined items (except first)
    if (itemIds.length > 1) {
      useKeyframesStore.getState()._removeKeyframesForItems(itemIds.slice(1));
    }

    useTimelineSettingsStore.getState().markDirty();
  }, { itemIds });
}

export function rateStretchItem(
  id: string,
  newFrom: number,
  newDuration: number,
  newSpeed: number
): void {
  execute('RATE_STRETCH_ITEM', () => {
    // Get old duration BEFORE applying rate stretch (needed for keyframe scaling)
    const oldItem = useItemsStore.getState().items.find((i) => i.id === id);
    const oldDuration = oldItem?.durationInFrames ?? newDuration;

    useItemsStore.getState()._rateStretchItem(id, newFrom, newDuration, newSpeed);

    // Scale keyframes proportionally to match new duration
    // This ensures animations maintain their relative timing within the clip
    if (oldDuration !== newDuration) {
      useKeyframesStore.getState()._scaleKeyframesForItem(id, oldDuration, newDuration);
    }

    // Validate transitions
    const items = useItemsStore.getState().items;
    const transitions = useTransitionsStore.getState().transitions;
    const { valid, broken } = validateTransitions([id], items, transitions);

    useTransitionsStore.getState().setTransitions(valid);
    if (broken.length > 0) {
      useTransitionsStore.getState().setPendingBreakages([
        ...useTransitionsStore.getState().pendingBreakages,
        ...broken,
      ]);
    }

    useTimelineSettingsStore.getState().markDirty();
  }, { id, newFrom, newDuration, newSpeed });
}

// =============================================================================
// TRANSFORM ACTIONS
// =============================================================================

export function updateItemTransform(id: string, transform: Partial<TransformProperties>): void {
  execute('UPDATE_TRANSFORM', () => {
    useItemsStore.getState()._updateItemTransform(id, transform);
    useTimelineSettingsStore.getState().markDirty();
  }, { id });
}

export function resetItemTransform(id: string): void {
  execute('RESET_TRANSFORM', () => {
    useItemsStore.getState()._resetItemTransform(id);
    useTimelineSettingsStore.getState().markDirty();
  }, { id });
}

export function updateItemsTransform(ids: string[], transform: Partial<TransformProperties>): void {
  execute('UPDATE_TRANSFORMS', () => {
    useItemsStore.getState()._updateItemsTransform(ids, transform);
    useTimelineSettingsStore.getState().markDirty();
  }, { ids });
}

export function updateItemsTransformMap(
  transformsMap: Map<string, Partial<TransformProperties>>
): void {
  execute('UPDATE_TRANSFORMS', () => {
    useItemsStore.getState()._updateItemsTransformMap(transformsMap);
    useTimelineSettingsStore.getState().markDirty();
  }, { count: transformsMap.size });
}

// =============================================================================
// EFFECT ACTIONS
// =============================================================================

export function addEffect(itemId: string, effect: VisualEffect): void {
  execute('ADD_EFFECT', () => {
    useItemsStore.getState()._addEffect(itemId, effect);
    useTimelineSettingsStore.getState().markDirty();
  }, { itemId, effectType: effect.type });
}

export function addEffects(updates: Array<{ itemId: string; effects: VisualEffect[] }>): void {
  execute('ADD_EFFECTS', () => {
    useItemsStore.getState()._addEffects(updates);
    useTimelineSettingsStore.getState().markDirty();
  }, { count: updates.length });
}

export function updateEffect(
  itemId: string,
  effectId: string,
  updates: Partial<{ effect: VisualEffect; enabled: boolean }>
): void {
  execute('UPDATE_EFFECT', () => {
    useItemsStore.getState()._updateEffect(itemId, effectId, updates);
    useTimelineSettingsStore.getState().markDirty();
  }, { itemId, effectId });
}

export function removeEffect(itemId: string, effectId: string): void {
  execute('REMOVE_EFFECT', () => {
    useItemsStore.getState()._removeEffect(itemId, effectId);
    useTimelineSettingsStore.getState().markDirty();
  }, { itemId, effectId });
}

export function toggleEffect(itemId: string, effectId: string): void {
  execute('TOGGLE_EFFECT', () => {
    useItemsStore.getState()._toggleEffect(itemId, effectId);
    useTimelineSettingsStore.getState().markDirty();
  }, { itemId, effectId });
}

// =============================================================================
// TRANSITION ACTIONS
// =============================================================================

export function addTransition(
  leftClipId: string,
  rightClipId: string,
  type: TransitionType = 'crossfade',
  durationInFrames?: number,
  presentation?: TransitionPresentation,
  direction?: WipeDirection | SlideDirection | FlipDirection
): boolean {
  return execute('ADD_TRANSITION', () => {
    const items = useItemsStore.getState().items;
    const transitions = useTransitionsStore.getState().transitions;
    const fps = useTimelineSettingsStore.getState().fps;

    // Find the clips
    const leftClip = items.find((i) => i.id === leftClipId);
    const rightClip = items.find((i) => i.id === rightClipId);

    if (!leftClip || !rightClip) {
      console.warn('[addTransition] Clips not found');
      return false;
    }

    // Default duration is 1 second (fps frames)
    const duration = durationInFrames ?? fps;

    // Validate that transition can be added
    const validation = canAddTransition(leftClip, rightClip, duration);
    if (!validation.canAdd) {
      console.warn('[addTransition] Cannot add transition:', validation.reason);
      return false;
    }

    // Check if transition already exists
    const existingTransition = transitions.find(
      (t) => t.leftClipId === leftClipId && t.rightClipId === rightClipId
    );
    if (existingTransition) {
      console.warn('[addTransition] Transition already exists between these clips');
      return false;
    }

    useTransitionsStore.getState()._addTransition(
      leftClipId,
      rightClipId,
      leftClip.trackId,
      type,
      duration,
      presentation,
      direction
    );

    useTimelineSettingsStore.getState().markDirty();
    return true;
  }, { leftClipId, rightClipId, type });
}

export function updateTransition(
  id: string,
  updates: Partial<Pick<Transition, 'durationInFrames' | 'type' | 'presentation' | 'direction' | 'timing'>>
): void {
  execute('UPDATE_TRANSITION', () => {
    useTransitionsStore.getState()._updateTransition(id, updates);
    useTimelineSettingsStore.getState().markDirty();
  }, { id, updates });
}

export function updateTransitions(
  updates: Array<{
    id: string;
    updates: Partial<Pick<Transition, 'durationInFrames' | 'type' | 'presentation' | 'direction' | 'timing'>>;
  }>
): void {
  if (updates.length === 0) return;
  execute('UPDATE_TRANSITIONS', () => {
    const store = useTransitionsStore.getState();
    for (const { id, updates: u } of updates) {
      store._updateTransition(id, u);
    }
    useTimelineSettingsStore.getState().markDirty();
  }, { updates });
}

export function removeTransition(id: string): void {
  execute('REMOVE_TRANSITION', () => {
    useTransitionsStore.getState()._removeTransition(id);
    useTimelineSettingsStore.getState().markDirty();
  }, { id });
}

export function clearPendingBreakages(): void {
  // No undo for this - it's ephemeral state
  useTransitionsStore.getState().clearPendingBreakages();
}

// =============================================================================
// KEYFRAME ACTIONS
// =============================================================================

export function addKeyframe(
  itemId: string,
  property: AnimatableProperty,
  frame: number,
  value: number,
  easing?: EasingType
): string {
  return execute('ADD_KEYFRAME', () => {
    const id = useKeyframesStore.getState()._addKeyframe(itemId, property, frame, value, easing);
    useTimelineSettingsStore.getState().markDirty();
    return id;
  }, { itemId, property, frame });
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

// =============================================================================
// MARKER ACTIONS
// =============================================================================

export function addMarker(frame: number, color?: string, label?: string): void {
  execute('ADD_MARKER', () => {
    useMarkersStore.getState().addMarker(frame, color, label);
    useTimelineSettingsStore.getState().markDirty();
  }, { frame, color, label });
}

export function updateMarker(id: string, updates: Partial<Omit<ProjectMarker, 'id'>>): void {
  execute('UPDATE_MARKER', () => {
    useMarkersStore.getState().updateMarker(id, updates);
    useTimelineSettingsStore.getState().markDirty();
  }, { id, updates });
}

export function removeMarker(id: string): void {
  execute('REMOVE_MARKER', () => {
    useMarkersStore.getState().removeMarker(id);
    useTimelineSettingsStore.getState().markDirty();
  }, { id });
}

export function clearAllMarkers(): void {
  execute('CLEAR_MARKERS', () => {
    useMarkersStore.getState().clearAllMarkers();
    useTimelineSettingsStore.getState().markDirty();
  });
}

// =============================================================================
// IN/OUT POINT ACTIONS
// =============================================================================

export function setInPoint(frame: number): void {
  execute('SET_IN_POINT', () => {
    const items = useItemsStore.getState().items;
    const outPoint = useMarkersStore.getState().outPoint;

    // Calculate max frame from items
    const maxFrame = items.reduce(
      (max, item) => Math.max(max, item.from + item.durationInFrames),
      0
    );

    // Validate: inPoint must be >= 0 and < outPoint (if set)
    let validatedFrame = Math.max(0, frame);
    if (outPoint !== null && validatedFrame >= outPoint) {
      validatedFrame = outPoint - 1;
    }
    validatedFrame = Math.min(validatedFrame, maxFrame);

    useMarkersStore.getState().setInPoint(validatedFrame);
    useTimelineSettingsStore.getState().markDirty();
  }, { frame });
}

export function setOutPoint(frame: number): void {
  execute('SET_OUT_POINT', () => {
    const items = useItemsStore.getState().items;
    const inPoint = useMarkersStore.getState().inPoint;

    // Calculate max frame from items
    const maxFrame = items.reduce(
      (max, item) => Math.max(max, item.from + item.durationInFrames),
      0
    );

    // Validate: outPoint must be > inPoint (if set) and <= maxFrame
    let validatedFrame = Math.min(frame, maxFrame);
    if (inPoint !== null && validatedFrame <= inPoint) {
      validatedFrame = inPoint + 1;
    }
    validatedFrame = Math.max(1, validatedFrame);

    useMarkersStore.getState().setOutPoint(validatedFrame);
    useTimelineSettingsStore.getState().markDirty();
  }, { frame });
}

export function clearInOutPoints(): void {
  execute('CLEAR_IN_OUT_POINTS', () => {
    useMarkersStore.getState().clearInOutPoints();
    useTimelineSettingsStore.getState().markDirty();
  });
}

// =============================================================================
// SETTINGS ACTIONS
// =============================================================================

export function toggleSnap(): void {
  execute('TOGGLE_SNAP', () => {
    useTimelineSettingsStore.getState().toggleSnap();
  });
}

export function setScrollPosition(position: number): void {
  // No undo for scroll position - it's UI state
  useTimelineSettingsStore.getState().setScrollPosition(position);
}

// =============================================================================
// PERSISTENCE ACTIONS (no individual undo - these are bulk operations)
// =============================================================================

export function clearTimeline(): void {
  execute('CLEAR_TIMELINE', () => {
    useItemsStore.getState().setItems([]);
    useItemsStore.getState().setTracks([]);
    useTransitionsStore.getState().setTransitions([]);
    useTransitionsStore.getState().setPendingBreakages([]);
    useKeyframesStore.getState().setKeyframes([]);
    useMarkersStore.getState().setMarkers([]);
    useMarkersStore.getState().clearInOutPoints();
    useTimelineSettingsStore.getState().markClean();
  });

  // Clear undo history when clearing timeline
  useTimelineCommandStore.getState().clearHistory();
}

// Mark dirty/clean (no undo)
export function markDirty(): void {
  useTimelineSettingsStore.getState().markDirty();
}

export function markClean(): void {
  useTimelineSettingsStore.getState().markClean();
}
