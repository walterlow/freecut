import { create } from 'zustand';
import { temporal } from 'zundo';
import type { TimelineState, TimelineActions } from '../types';
import { getProject, updateProject } from '@/lib/storage/indexeddb';
import type { ProjectTimeline } from '@/types/project';
import type { TimelineItem } from '@/types/timeline';
import type { ItemEffect } from '@/types/effects';
import type { Transition, TransitionBreakage } from '@/types/transition';
import { TRANSITION_CONFIGS } from '@/types/transition';
import type { ItemKeyframes } from '@/types/keyframe';
import { canAddTransition } from '../utils/transition-utils';
import { validateTransitions } from '../utils/transition-validation';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useZoomStore } from './zoom-store';
import { generatePlayheadThumbnail } from '@/features/projects/utils/thumbnail-generator';

// IMPORTANT: Always use granular selectors to prevent unnecessary re-renders!
//
// ✅ CORRECT: Use granular selectors
// const currentFrame = useTimelineStore(s => s.currentFrame);
// const setCurrentFrame = useTimelineStore(s => s.setCurrentFrame);
//
// ❌ WRONG: Don't destructure the entire store
// const { currentFrame, setCurrentFrame } = useTimelineStore();
//
// UNDO/REDO: This store is wrapped with Zundo's temporal middleware
// Access undo/redo functionality:
// const undo = useTimelineStore.temporal.getState().undo;
// const redo = useTimelineStore.temporal.getState().redo;
// const canUndo = useTimelineStore((state) => state.pastStates.length > 0);


export const useTimelineStore = create<TimelineState & TimelineActions>()(
  temporal((set) => ({
  // State
  tracks: [],
  items: [],
  markers: [],
  transitions: [],
  keyframes: [],
  fps: 30,
  scrollPosition: 0,
  snapEnabled: true,
  inPoint: null,
  outPoint: null,
  isDirty: false,
  pendingBreakages: [],

  // Actions
  // Always keep tracks sorted by order property - single source of truth
  setTracks: (tracks) => set({
    tracks: [...tracks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    isDirty: true,
  }),
  addItem: (item) => set((state) => ({ items: [...state.items, item as any], isDirty: true })),
  updateItem: (id, updates) => set((state) => {
    const originalItem = state.items.find((i) => i.id === id);
    if (!originalItem) return state;

    // Apply the update
    const newItems = state.items.map((i) =>
      i.id === id ? { ...i, ...updates } as typeof i : i
    );

    // Check if position-related properties changed (affects transitions)
    const positionChanged = 'from' in updates || 'durationInFrames' in updates || 'trackId' in updates;

    if (!positionChanged) {
      return { items: newItems, isDirty: true };
    }

    // Use centralized validation to find broken transitions
    const { valid, broken } = validateTransitions([id], newItems, state.transitions);

    return {
      items: newItems,
      transitions: valid,
      pendingBreakages: broken.length > 0
        ? [...state.pendingBreakages, ...broken]
        : state.pendingBreakages,
      isDirty: true,
    };
  }),
  removeItems: (ids) => set((state) => {
    const idsSet = new Set(ids);
    return {
      items: state.items.filter((i) => !idsSet.has(i.id)),
      // Remove transitions that involve any of the deleted clips
      transitions: state.transitions.filter(
        (t) => !idsSet.has(t.leftClipId) && !idsSet.has(t.rightClipId)
      ),
      // Remove keyframes for deleted items
      keyframes: state.keyframes.filter((k) => !idsSet.has(k.itemId)),
      isDirty: true,
    };
  }),
  // Ripple delete: remove items AND shift subsequent items on same track to close gaps
  rippleDeleteItems: (ids) => set((state) => {
    const idsToDelete = new Set(ids);
    const itemsToDelete = state.items.filter((i) => idsToDelete.has(i.id));

    if (itemsToDelete.length === 0) return state;

    // Shift each remaining item by the sum of deleted durations before it on same track
    const newItems = state.items
      .filter((i) => !idsToDelete.has(i.id))
      .map((item) => {
        const shiftAmount = itemsToDelete
          .filter((d) => d.trackId === item.trackId && d.from + d.durationInFrames <= item.from)
          .reduce((sum, d) => sum + d.durationInFrames, 0);

        return shiftAmount > 0 ? { ...item, from: item.from - shiftAmount } : item;
      });

    return { items: newItems, isDirty: true };
  }),
  // Close gap at a specific position on a track (shift items left)
  closeGapAtPosition: (trackId, frame) => set((state) => {
    // Find all items on this track, sorted by position
    const trackItems = state.items
      .filter((i) => i.trackId === trackId)
      .sort((a, b) => a.from - b.from);

    if (trackItems.length === 0) return state;

    // Find the gap that contains this frame
    // A gap exists between items or before the first item
    let gapStart = 0;
    let gapEnd = 0;

    for (const item of trackItems) {
      if (frame >= gapStart && frame < item.from) {
        // Found the gap - it's between gapStart and item.from
        gapEnd = item.from;
        break;
      }
      // Move gapStart to the end of this item
      gapStart = item.from + item.durationInFrames;
    }

    // If we didn't find a gap containing the frame, nothing to close
    const gapDuration = gapEnd - gapStart;
    if (gapDuration <= 0) return state;

    // Shift all items on this track that start at or after gapEnd
    const newItems = state.items.map((item) => {
      if (item.trackId === trackId && item.from >= gapEnd) {
        return { ...item, from: item.from - gapDuration };
      }
      return item;
    });

    return { items: newItems, isDirty: true };
  }),
  toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
  setScrollPosition: (position) => set({ scrollPosition: position }),
  moveItem: (id, newFrom, newTrackId) => set((state) => {
    const movedItem = state.items.find((i) => i.id === id);
    if (!movedItem) return state;

    // Apply the move
    const newItems = state.items.map((i) =>
      i.id === id
        ? { ...i, from: newFrom, ...(newTrackId && { trackId: newTrackId }) }
        : i
    );

    // Use centralized validation to find broken transitions
    const { valid, broken } = validateTransitions([id], newItems, state.transitions);

    return {
      items: newItems,
      transitions: valid,
      pendingBreakages: broken.length > 0
        ? [...state.pendingBreakages, ...broken]
        : state.pendingBreakages,
      isDirty: true,
    };
  }),
  moveItems: (updates) => set((state) => {
    const updateMap = new Map(updates.map((u) => [u.id, u]));

    // Apply the moves
    const newItems = state.items.map((i) => {
      const update = updateMap.get(i.id);
      return update
        ? { ...i, from: update.from, ...(update.trackId && { trackId: update.trackId }) }
        : i;
    });

    // Use centralized validation to find broken transitions
    const movedIds = updates.map((u) => u.id);
    const { valid, broken } = validateTransitions(movedIds, newItems, state.transitions);

    return {
      items: newItems,
      transitions: valid,
      pendingBreakages: broken.length > 0
        ? [...state.pendingBreakages, ...broken]
        : state.pendingBreakages,
      isDirty: true,
    };
  }),

  // Duplicate items at new positions (for Alt+drag)
  duplicateItems: (itemIds, positions) => set((state) => {
    const newItems: TimelineItem[] = [];

    itemIds.forEach((id, index) => {
      const sourceItem = state.items.find((i) => i.id === id);
      if (!sourceItem) return;

      const position = positions[index];
      if (!position) return;

      // Generate new ID for the duplicate
      const newId = crypto.randomUUID();

      // Deep copy with new ID and NEW originId
      // Unlike split (which preserves originId for stable keys during trim),
      // duplication creates a fully independent clip with its own lineage.
      // This ensures the stable key is unique and prevents React key collisions.
      const duplicate: TimelineItem = {
        ...sourceItem,
        id: newId,
        originId: newId, // New origin = independent clip
        from: position.from,
        trackId: position.trackId,
      };

      newItems.push(duplicate);
    });

    return {
      items: [...state.items, ...newItems],
      isDirty: true,
    };
  }),

  // Trim item from start: increases trimStart and sourceStart, adjusts from position
  trimItemStart: (id, trimAmount) => set((state) => {
    const newItems = state.items.map((item) => {
      if (item.id !== id) return item;

      // Non-media items (text, shape, adjustment) use simple trimming - just adjust position and duration
      const isNonMediaItem = item.type === 'text' || item.type === 'shape' || item.type === 'adjustment';
      if (isNonMediaItem) {
        let actualTrimAmount = trimAmount;

        // Prevent extending before timeline frame 0
        if (trimAmount < 0 && item.from + trimAmount < 0) {
          actualTrimAmount = -item.from;
        }

        // Prevent trimming more than available duration (keep at least 1 frame)
        if (trimAmount > 0 && item.durationInFrames - trimAmount < 1) {
          actualTrimAmount = item.durationInFrames - 1;
        }

        return {
          ...item,
          from: Math.round(item.from + actualTrimAmount),
          durationInFrames: Math.max(1, Math.round(item.durationInFrames - actualTrimAmount)),
        } as typeof item;
      }

      // Media items use source-based trimming
      const currentTrimStart = item.trimStart || 0;
      const currentSourceStart = item.sourceStart || 0;

      // Account for speed: timeline frames * speed = source frames
      const speed = item.speed || 1;

      // Images/GIFs can loop infinitely, so don't clamp to source start
      const canLoopInfinitely = item.type === 'image';

      // Calculate new values with boundary checks
      let actualTrimAmount = trimAmount; // Timeline frames

      // Prevent extending before source start (only for non-looping media)
      // sourceStart + (trimAmount * speed) < 0
      if (!canLoopInfinitely && trimAmount < 0 && currentSourceStart + (trimAmount * speed) < 0) {
        actualTrimAmount = Math.round(-currentSourceStart / speed);
      }

      // Prevent extending before timeline frame 0 (applies to all media types)
      // newFrom = item.from + trimAmount, so trimAmount < 0 extends left
      if (trimAmount < 0 && item.from + trimAmount < 0) {
        actualTrimAmount = -item.from; // Clamp to frame 0
      }

      // Prevent trimming more than available duration (keep at least 1 timeline frame)
      if (trimAmount > 0 && item.durationInFrames - trimAmount < 1) {
        actualTrimAmount = item.durationInFrames - 1;
      }

      // Convert to source frames for source properties
      const sourceTrimAmount = Math.round(actualTrimAmount * speed);

      // For looping media, allow negative sourceStart (will be handled with modulo in playback)
      const newTrimStart = canLoopInfinitely
        ? currentTrimStart + sourceTrimAmount
        : Math.max(0, currentTrimStart + sourceTrimAmount);
      const newSourceStart = canLoopInfinitely
        ? currentSourceStart + sourceTrimAmount
        : Math.max(0, currentSourceStart + sourceTrimAmount);
      // Ensure frame values are integers (Remotion requirement)
      const newDuration = Math.max(1, Math.round(item.durationInFrames - actualTrimAmount));
      const newFrom = Math.round(item.from + actualTrimAmount);

      // Update offset for Remotion compatibility (offset = trimStart)
      const updates: Partial<typeof item> = {
        trimStart: newTrimStart,
        sourceStart: newSourceStart,
        durationInFrames: newDuration,
        from: newFrom,
        // Explicitly preserve speed and sourceDuration (important for rate-stretched clips)
        speed: item.speed,
        sourceDuration: item.sourceDuration,
      };

      // Add offset for video/audio items (Remotion compatibility)
      if (item.type === 'video' || item.type === 'audio') {
        (updates as any).offset = newTrimStart;
      }

      return { ...item, ...updates } as typeof item;
    });

    // Use centralized validation to find broken transitions
    const { valid, broken } = validateTransitions([id], newItems, state.transitions);

    return {
      items: newItems,
      transitions: valid,
      pendingBreakages: broken.length > 0
        ? [...state.pendingBreakages, ...broken]
        : state.pendingBreakages,
      isDirty: true,
    };
  }),

  // Trim item from end: increases trimEnd and adjusts duration
  trimItemEnd: (id, trimAmount) => set((state) => {
    const newItems = state.items.map((item) => {
      if (item.id !== id) return item;

      // Non-media items (text, shape, adjustment) use simple trimming - just adjust duration
      const isNonMediaItem = item.type === 'text' || item.type === 'shape' || item.type === 'adjustment';
      if (isNonMediaItem) {
        let actualTrimAmount = trimAmount;

        // Prevent trimming more than available duration (keep at least 1 frame)
        if (trimAmount > 0 && item.durationInFrames - trimAmount < 1) {
          actualTrimAmount = item.durationInFrames - 1;
        }

        // No limit on extending for non-media items (they can be any duration)
        return {
          ...item,
          durationInFrames: Math.max(1, Math.round(item.durationInFrames - actualTrimAmount)),
        } as typeof item;
      }

      // Media items use source-based trimming
      const currentTrimEnd = item.trimEnd || 0;
      // Account for speed: timeline frames * speed = source frames
      const speed = item.speed || 1;
      const sourceDuration = item.sourceDuration || (item.durationInFrames * speed);
      const currentSourceEnd = item.sourceEnd || sourceDuration;

      // Images/GIFs can loop infinitely, so don't clamp their duration
      const canLoopInfinitely = item.type === 'image';

      // Calculate new values with boundary checks
      let actualTrimAmount = trimAmount; // Timeline frames

      // Prevent extending beyond source duration (only for non-looping media)
      // sourceEnd - (trimAmount * speed) > sourceDuration (extending = negative trim)
      if (!canLoopInfinitely && trimAmount < 0 && currentSourceEnd - (trimAmount * speed) > sourceDuration) {
        actualTrimAmount = Math.round(-(sourceDuration - currentSourceEnd) / speed);
      }

      // Prevent trimming more than available duration (keep at least 1 timeline frame)
      if (trimAmount > 0 && item.durationInFrames - trimAmount < 1) {
        actualTrimAmount = item.durationInFrames - 1;
      }

      // Convert to source frames for source properties
      const sourceTrimAmount = Math.round(actualTrimAmount * speed);

      const newTrimEnd = Math.max(0, currentTrimEnd + sourceTrimAmount);
      // Clamp sourceEnd to not exceed sourceDuration (prevents playback rewind issues)
      // For looping media (images/GIFs), don't clamp - they can extend infinitely
      const newSourceEnd = canLoopInfinitely
        ? currentSourceEnd - sourceTrimAmount
        : Math.min(sourceDuration, currentSourceEnd - sourceTrimAmount);

      // Calculate duration
      // For looping media, just use the trimmed duration directly
      // For non-looping media, ensure we don't exceed available source frames
      let newDuration: number;
      if (canLoopInfinitely) {
        newDuration = Math.max(1, Math.round(item.durationInFrames - actualTrimAmount));
      } else {
        const currentSourceStart = item.sourceStart || 0;
        const availableSourceFrames = newSourceEnd - currentSourceStart;
        const maxTimelineDuration = Math.floor(availableSourceFrames / speed);
        newDuration = Math.max(1, Math.min(maxTimelineDuration, Math.round(item.durationInFrames - actualTrimAmount)));
      }

      return {
        ...item,
        trimEnd: newTrimEnd,
        sourceEnd: newSourceEnd,
        durationInFrames: newDuration,
        // Explicitly preserve speed and sourceDuration (important for rate-stretched clips)
        speed: item.speed,
        sourceDuration: item.sourceDuration,
      } as typeof item;
    });

    // Use centralized validation to find broken transitions
    const { valid, broken } = validateTransitions([id], newItems, state.transitions);

    return {
      items: newItems,
      transitions: valid,
      pendingBreakages: broken.length > 0
        ? [...state.pendingBreakages, ...broken]
        : state.pendingBreakages,
      isDirty: true,
    };
  }),

  // Join multiple adjacent items that were previously split (inverse of splitItem)
  // Items must form a contiguous chain with same originId, mediaId, track, speed, and source continuity
  joinItems: (itemIds) => set((state) => {
    if (itemIds.length < 2) return state;

    // Get all items and sort by position
    const itemsToJoin = itemIds
      .map((id) => state.items.find((i) => i.id === id))
      .filter((item): item is NonNullable<typeof item> => item !== undefined)
      .sort((a, b) => a.from - b.from);

    if (itemsToJoin.length < 2) return state;

    // Validate all items can be joined (check each adjacent pair)
    for (let i = 0; i < itemsToJoin.length - 1; i++) {
      const left = itemsToJoin[i]!;
      const right = itemsToJoin[i + 1]!;

      // Must share same origin (from a split operation)
      if (left.originId !== right.originId) return state;
      // Must be on same track
      if (left.trackId !== right.trackId) return state;
      // Must be from same source media
      if (left.mediaId !== right.mediaId) return state;
      // Must be adjacent (left ends where right begins)
      if (left.from + left.durationInFrames !== right.from) return state;
      // Must have same speed
      if ((left.speed || 1) !== (right.speed || 1)) return state;

      // Verify source continuity (no trim gap between clips)
      const leftSourceEnd = left.sourceEnd ?? ((left.sourceStart ?? 0) + left.durationInFrames * (left.speed || 1));
      const rightSourceStart = right.sourceStart ?? 0;
      if (Math.abs(leftSourceEnd - rightSourceStart) > 0.5) return state;
    }

    // All validations passed - create merged item from first and last
    const firstItem = itemsToJoin[0]!;
    const lastItem = itemsToJoin[itemsToJoin.length - 1]!
    const totalDuration = itemsToJoin.reduce((sum, item) => sum + item.durationInFrames, 0);

    const mergedItem: typeof firstItem = {
      ...firstItem,
      durationInFrames: totalDuration,
      sourceEnd: lastItem.sourceEnd,
      trimEnd: lastItem.trimEnd,
    };

    // Recalculate offset for video/audio items (Remotion compatibility)
    // Must match the calculation in splitItem for consistency
    if (firstItem.type === 'video' || firstItem.type === 'audio') {
      (mergedItem as any).offset = (mergedItem.sourceStart || 0) + (mergedItem.trimStart || 0);
    }

    const idsToRemove = new Set(itemIds);
    return {
      items: state.items
        .filter((i) => !idsToRemove.has(i.id))
        .concat([mergedItem]),
      isDirty: true,
    };
  }),

  // Split item at the specified frame
  // Handles clips in transition chains - updates transitions to point to new clips
  splitItem: (id, splitFrame) => set((state) => {
    const item = state.items.find((i) => i.id === id);
    if (!item) return state;

    // Validate split position is within item bounds
    if (splitFrame <= item.from || splitFrame >= item.from + item.durationInFrames) {
      console.warn('Split frame must be within item bounds');
      return state;
    }

    // Calculate durations for left and right items
    const leftDuration = splitFrame - item.from;
    const rightDuration = item.from + item.durationInFrames - splitFrame;

    // Ensure minimum duration of 1 frame
    if (leftDuration < 1 || rightDuration < 1) {
      console.warn('Split would create item with less than 1 frame duration');
      return state;
    }

    // Check for transitions involving this clip
    const transitionAsLeft = state.transitions.find((t) => t.leftClipId === id);
    const transitionAsRight = state.transitions.find((t) => t.rightClipId === id);

    // Validate split is not in the transition region
    // Left clip in transition: transition region is the last N frames
    if (transitionAsLeft) {
      const transitionStart = item.from + item.durationInFrames - transitionAsLeft.durationInFrames;
      if (splitFrame >= transitionStart) {
        console.warn('Cannot split within the transition region. Split must be before the transition.');
        return state;
      }
    }

    // Right clip in transition: transition region is the first N frames
    if (transitionAsRight) {
      const transitionEnd = item.from + transitionAsRight.durationInFrames;
      if (splitFrame <= transitionEnd) {
        console.warn('Cannot split within the transition region. Split must be after the transition.');
        return state;
      }
    }

    // Create base properties for both items
    const currentSourceStart = item.sourceStart || 0;
    const currentTrimEnd = item.trimEnd || 0;

    // Account for speed when calculating source frames
    // Timeline frames * speed = source frames
    // e.g., 50 timeline frames at 2x speed = 100 source frames
    // IMPORTANT: Calculate right source frames as remainder to avoid rounding gaps
    // If both are rounded independently, their sum may not equal the original total
    const speed = item.speed || 1;
    const totalSourceFrames = Math.round(item.durationInFrames * speed);
    const leftSourceFrames = Math.round(leftDuration * speed);
    const rightSourceFrames = totalSourceFrames - leftSourceFrames;

    // Ensure originId is set for both items (needed for stable video grouping)
    // If original item has originId, use it; otherwise use original item's id
    const sharedOriginId = item.originId || item.id;

    // Handle fade properties for split clips
    // Left clip keeps fade in (starts at original beginning), loses fade out
    // Right clip loses fade in, keeps fade out (ends at original end)
    // Clamp fade durations to not exceed new clip durations
    const fps = state.fps || 30;
    const leftDurationSec = leftDuration / fps;
    const rightDurationSec = rightDuration / fps;

    // Generate new IDs for split items
    const leftItemId = crypto.randomUUID();
    const rightItemId = crypto.randomUUID();

    // Left item: keeps original from, new duration, updated end trim
    const leftItem: typeof item = {
      ...item,
      id: leftItemId,
      originId: sharedOriginId,
      durationInFrames: leftDuration,
      // Update sourceEnd and trimEnd for left item (in source frames)
      sourceEnd: currentSourceStart + leftSourceFrames,
      trimEnd: currentTrimEnd + rightSourceFrames,
      // Left clip keeps fade in (clamped to duration), loses fade out
      audioFadeIn: item.audioFadeIn ? Math.min(item.audioFadeIn, leftDurationSec) : undefined,
      audioFadeOut: 0,
      fadeIn: item.fadeIn ? Math.min(item.fadeIn, leftDurationSec) : undefined,
      fadeOut: 0,
    };

    // Right item: new from, new duration, adjusted source start
    // NOTE: Only update sourceStart, NOT trimStart - they're added in visualization
    // trimStart represents user trimming, sourceStart represents where in source we begin
    const rightItem: typeof item = {
      ...item,
      id: rightItemId,
      originId: sharedOriginId,
      from: splitFrame,
      durationInFrames: rightDuration,
      // Move source start forward by left clip's source frames
      sourceStart: currentSourceStart + leftSourceFrames,
      // trimStart stays the same - we're not "trimming", we're moving the source window
      // Right clip loses fade in, keeps fade out (clamped to duration)
      audioFadeIn: 0,
      audioFadeOut: item.audioFadeOut ? Math.min(item.audioFadeOut, rightDurationSec) : undefined,
      fadeIn: 0,
      fadeOut: item.fadeOut ? Math.min(item.fadeOut, rightDurationSec) : undefined,
    };

    // Update offset for video/audio items (Remotion compatibility)
    // Offset should be the effective start in source: sourceStart + trimStart
    if (item.type === 'video' || item.type === 'audio') {
      (leftItem as any).offset = (leftItem.sourceStart || 0) + (leftItem.trimStart || 0);
      (rightItem as any).offset = (rightItem.sourceStart || 0) + (rightItem.trimStart || 0);
    }

    // Update transitions to point to the new clips
    let updatedTransitions = state.transitions;

    // If this clip was the LEFT clip in a transition, update to point to the new RIGHT item
    // (the part that's adjacent to the next clip)
    if (transitionAsLeft) {
      updatedTransitions = updatedTransitions.map((t) =>
        t.id === transitionAsLeft.id ? { ...t, leftClipId: rightItemId } : t
      );
    }

    // If this clip was the RIGHT clip in a transition, update to point to the new LEFT item
    // (the part that's adjacent to the previous clip)
    if (transitionAsRight) {
      updatedTransitions = updatedTransitions.map((t) =>
        t.id === transitionAsRight.id ? { ...t, rightClipId: leftItemId } : t
      );
    }

    // Replace original item with the two new items
    return {
      items: state.items
        .filter((i) => i.id !== id)
        .concat([leftItem, rightItem]),
      transitions: updatedTransitions,
      isDirty: true,
    };
  }),

  // Rate stretch item: change duration and speed while preserving the CURRENT trimmed region
  // If clip shows [B-C] of source [A-D], rate stretch only affects [B-C], not the full source
  // For images/GIFs: changes animation speed (they loop infinitely, so no source constraints)
  rateStretchItem: (id, newFrom, newDuration, newSpeed) => set((state) => ({
    items: state.items.map((item) => {
      if (item.id !== id) return item;

      // Clamp speed to valid range (0.1x to 10x) and round to 2 decimals to avoid floating point drift
      const clampedSpeed = Math.round(Math.max(0.1, Math.min(10, newSpeed)) * 100) / 100;

      // For images/GIFs: simpler handling - just update speed and duration
      // GIFs loop infinitely, so no source position tracking needed
      if (item.type === 'image') {
        return {
          ...item,
          from: Math.round(newFrom),
          durationInFrames: Math.round(newDuration),
          speed: clampedSpeed,
        };
      }

      // Only apply source tracking to video/audio items
      if (item.type !== 'video' && item.type !== 'audio') return item;

      // Get current source region being displayed
      const currentSpeed = item.speed || 1;
      const currentSourceStart = item.sourceStart || 0;

      // Calculate the source frames currently being shown (the [B-C] region)
      // This is the content that will be stretched, not the full source
      const currentSourceFramesShown = Math.round(item.durationInFrames * currentSpeed);

      // Preserve the full source duration (the entire video file [A-D])
      // This is needed for validation in Remotion to prevent seeking past the source
      const fullSourceDuration = item.sourceDuration || currentSourceFramesShown;

      // Calculate what Remotion will need: sourceFramesNeeded = durationInFrames * speed
      // This must not exceed fullSourceDuration (accounting for sourceStart offset)
      const availableSourceFrames = fullSourceDuration - currentSourceStart;
      let finalDuration = Math.round(newDuration);

      // Ensure duration * speed doesn't exceed available source frames
      // This prevents "Clip duration exceeds source duration" errors from rounding drift
      const sourceFramesNeeded = Math.round(finalDuration * clampedSpeed);
      if (sourceFramesNeeded > availableSourceFrames) {
        // Reduce duration to fit within source bounds
        finalDuration = Math.floor(availableSourceFrames / clampedSpeed);
        console.log('[rateStretchItem] Clamped duration to prevent source overflow:', {
          requested: Math.round(newDuration),
          clamped: finalDuration,
          availableSourceFrames,
          clampedSpeed,
        });
      }

      // sourceStart stays the same - we're still starting from point B
      // sourceEnd is recalculated based on the visible region
      const sourceEnd = currentSourceStart + currentSourceFramesShown;

      // Ensure frame values are integers (Remotion requirement)
      return {
        ...item,
        from: Math.round(newFrom),
        durationInFrames: finalDuration,
        speed: clampedSpeed,
        // Preserve source position - still starts at B
        sourceStart: currentSourceStart,
        sourceEnd,
        // IMPORTANT: Keep sourceDuration as the FULL source, not the visible region
        // This is used by Remotion's clamping logic to validate seek positions
        sourceDuration: fullSourceDuration,
        // Preserve trim values - they define where in the original we are
        trimStart: item.trimStart || 0,
        trimEnd: item.trimEnd || 0,
      };
    }),
    isDirty: true,
  })),

  // In/Out point actions with validation
  setInPoint: (frame) => set((state) => {
    // Calculate last frame from rightmost item
    const maxEndFrame = state.items.length > 0
      ? Math.max(...state.items.map(item => item.from + item.durationInFrames))
      : state.fps * 10; // Default to 10 seconds if no items

    // If out-point doesn't exist, set it to the last frame
    if (state.outPoint === null) {
      return { inPoint: frame, outPoint: Math.max(maxEndFrame, frame + 1), isDirty: true };
    }

    // If out-point exists and in-point would exceed it, move out-point to last frame
    if (frame >= state.outPoint) {
      return { inPoint: frame, outPoint: Math.max(maxEndFrame, frame + 1), isDirty: true };
    }
    return { inPoint: frame, isDirty: true };
  }),
  setOutPoint: (frame) => set((state) => {
    // If in-point doesn't exist, set it to frame 0
    if (state.inPoint === null) {
      return { inPoint: 0, outPoint: frame, isDirty: true };
    }

    // If in-point exists and out-point would go before it, move in-point to frame 0
    if (frame <= state.inPoint) {
      return { inPoint: 0, outPoint: frame, isDirty: true };
    }
    return { outPoint: frame, isDirty: true };
  }),
  clearInOutPoints: () => set({ inPoint: null, outPoint: null, isDirty: true }),

  // Marker actions
  addMarker: (frame, color = 'var(--color-timeline-marker)', label) => set((state) => ({
    markers: [...state.markers, {
      id: crypto.randomUUID(),
      frame,
      color,
      ...(label && { label }),
    }].sort((a, b) => a.frame - b.frame), // Keep markers sorted by frame
    isDirty: true,
  })),

  updateMarker: (id, updates) => set((state) => ({
    markers: state.markers
      .map((m) => (m.id === id ? { ...m, ...updates } : m))
      .sort((a, b) => a.frame - b.frame), // Re-sort if frame changed
    isDirty: true,
  })),

  removeMarker: (id) => set((state) => ({
    markers: state.markers.filter((m) => m.id !== id),
    isDirty: true,
  })),

  clearAllMarkers: () => set({ markers: [], isDirty: true }),

  // Transform actions
  updateItemTransform: (id, transformUpdates) => set((state) => ({
    items: state.items.map((item) => {
      if (item.id !== id) return item;
      // Merge transform updates (preserving other transform properties)
      const existingTransform = item.transform || {};
      return {
        ...item,
        transform: {
          ...existingTransform,
          ...transformUpdates,
        },
      };
    }),
    isDirty: true,
  })),

  // Reset transform to defaults (remove explicit values)
  resetItemTransform: (id) => set((state) => ({
    items: state.items.map((item) =>
      item.id === id ? { ...item, transform: undefined } : item
    ),
    isDirty: true,
  })),

  // Batch update for multi-select (apply same transform updates to all)
  updateItemsTransform: (ids, transformUpdates) => set((state) => ({
    items: state.items.map((item) => {
      if (!ids.includes(item.id)) return item;
      const existingTransform = item.transform || {};
      return {
        ...item,
        transform: {
          ...existingTransform,
          ...transformUpdates,
        },
      };
    }),
    isDirty: true,
  })),

  // Batch update for group transforms (each item gets its own transform)
  // This is a single undo operation for all items
  updateItemsTransformMap: (transformsMap) => set((state) => ({
    items: state.items.map((item) => {
      const transformUpdates = transformsMap.get(item.id);
      if (!transformUpdates) return item;
      const existingTransform = item.transform || {};
      return {
        ...item,
        transform: {
          ...existingTransform,
          ...transformUpdates,
        },
      };
    }),
    isDirty: true,
  })),

  // Effect actions
  addEffect: (itemId, effect) => set((state) => ({
    items: state.items.map((item) => {
      if (item.id !== itemId) return item;
      const newEffect: ItemEffect = {
        id: crypto.randomUUID(),
        effect,
        enabled: true,
      };
      return {
        ...item,
        effects: [...(item.effects ?? []), newEffect],
      };
    }),
    isDirty: true,
  })),

  // Batch add effects - single undo/redo action for presets or multi-item operations
  addEffects: (updates) => set((state) => {
    const updateMap = new Map(updates.map((u) => [u.itemId, u.effects]));
    return {
      items: state.items.map((item) => {
        const effectsToAdd = updateMap.get(item.id);
        if (!effectsToAdd) return item;
        const newEffects: ItemEffect[] = effectsToAdd.map((effect) => ({
          id: crypto.randomUUID(),
          effect,
          enabled: true,
        }));
        return {
          ...item,
          effects: [...(item.effects ?? []), ...newEffects],
        };
      }),
      isDirty: true,
    };
  }),

  updateEffect: (itemId, effectId, updates) => set((state) => ({
    items: state.items.map((item) => {
      if (item.id !== itemId) return item;
      return {
        ...item,
        effects: (item.effects ?? []).map((e) =>
          e.id === effectId ? { ...e, ...updates } : e
        ),
      };
    }),
    isDirty: true,
  })),

  removeEffect: (itemId, effectId) => set((state) => ({
    items: state.items.map((item) => {
      if (item.id !== itemId) return item;
      return {
        ...item,
        effects: (item.effects ?? []).filter((e) => e.id !== effectId),
      };
    }),
    isDirty: true,
  })),

  toggleEffect: (itemId, effectId) => set((state) => ({
    items: state.items.map((item) => {
      if (item.id !== itemId) return item;
      return {
        ...item,
        effects: (item.effects ?? []).map((e) =>
          e.id === effectId ? { ...e, enabled: !e.enabled } : e
        ),
      };
    }),
    isDirty: true,
  })),

  // Transition actions
  // Add a transition between two adjacent clips
  // Clips stay at their original positions - TransitionSeries handles overlap at render time
  // Returns true if transition was added successfully
  addTransition: (leftClipId, rightClipId, type = 'crossfade', durationInFrames, presentation = 'fade', direction) => {
    const state = useTimelineStore.getState();
    const leftClip = state.items.find((i) => i.id === leftClipId);
    const rightClip = state.items.find((i) => i.id === rightClipId);

    if (!leftClip || !rightClip) {
      console.warn('[addTransition] Clips not found');
      return false;
    }

    // Use default duration if not provided
    const duration = durationInFrames ?? TRANSITION_CONFIGS[type].defaultDuration;

    // Validate transition can be added
    const validation = canAddTransition(leftClip, rightClip, duration);
    if (!validation.canAdd) {
      console.warn('[addTransition] Cannot add transition:', validation.reason);
      return false;
    }

    // Check if transition already exists between these clips
    const existingTransition = state.transitions.find(
      (t) => t.leftClipId === leftClipId && t.rightClipId === rightClipId
    );
    if (existingTransition) {
      console.warn('[addTransition] Transition already exists between these clips');
      return false;
    }

    // Create the transition with all properties in a single operation
    // Clips stay at their original positions - TransitionSeries handles overlap at render time
    const transition: Transition = {
      id: crypto.randomUUID(),
      type,
      presentation, // Use provided presentation
      timing: 'linear', // Default to linear timing
      leftClipId,
      rightClipId,
      trackId: leftClip.trackId,
      durationInFrames: duration,
      direction, // Include direction if provided
    };

    useTimelineStore.setState((state) => ({
      transitions: [...state.transitions, transition],
      isDirty: true,
    }));

    return true;
  },

  // Update a transition's properties
  updateTransition: (id, updates) => set((state) => {
    const transition = state.transitions.find((t) => t.id === id);
    if (!transition) return state;

    let validatedUpdates = { ...updates };

    // If duration is being updated, validate against Remotion constraints
    if (validatedUpdates.durationInFrames !== undefined) {
      const leftClip = state.items.find((i) => i.id === transition.leftClipId);
      const rightClip = state.items.find((i) => i.id === transition.rightClipId);

      if (leftClip && rightClip) {
        // Remotion rule: transition duration must be < min(leftDuration, rightDuration)
        const maxDuration = Math.min(leftClip.durationInFrames, rightClip.durationInFrames) - 1;
        let duration = validatedUpdates.durationInFrames;

        if (duration > maxDuration) {
          console.warn(`[updateTransition] Duration ${duration} exceeds max ${maxDuration}`);
          duration = maxDuration;
        }
        // Ensure minimum of 1 frame
        if (duration < 1) {
          duration = 1;
        }

        validatedUpdates.durationInFrames = duration;
      }
    }

    return {
      transitions: state.transitions.map((t) =>
        t.id === id ? { ...t, ...validatedUpdates } : t
      ),
      isDirty: true,
    };
  }),

  // Remove a transition
  removeTransition: (id) => set((state) => ({
    transitions: state.transitions.filter((t) => t.id !== id),
    isDirty: true,
  })),

  // Clear pending breakages (after user has been notified)
  clearPendingBreakages: () => set({ pendingBreakages: [] }),

  // Keyframe actions
  // Add a keyframe at a specific frame for a property
  addKeyframe: (itemId, property, frame, value, easing = 'linear') => {
    const keyframeId = crypto.randomUUID();
    useTimelineStore.setState((state) => {
      const existingItemKeyframes = state.keyframes.find((k) => k.itemId === itemId);

      if (existingItemKeyframes) {
        // Item already has keyframes - update or add
        const existingPropKeyframes = existingItemKeyframes.properties.find(
          (p) => p.property === property
        );

        if (existingPropKeyframes) {
          // Property already has keyframes - check for existing keyframe at this frame
          const existingAtFrame = existingPropKeyframes.keyframes.find((k) => k.frame === frame);
          if (existingAtFrame) {
            // Update existing keyframe value
            return {
              keyframes: state.keyframes.map((ik) =>
                ik.itemId === itemId
                  ? {
                      ...ik,
                      properties: ik.properties.map((pk) =>
                        pk.property === property
                          ? {
                              ...pk,
                              keyframes: pk.keyframes.map((k) =>
                                k.frame === frame ? { ...k, value, easing } : k
                              ),
                            }
                          : pk
                      ),
                    }
                  : ik
              ),
              isDirty: true,
            };
          }
          // Add new keyframe and keep sorted
          return {
            keyframes: state.keyframes.map((ik) =>
              ik.itemId === itemId
                ? {
                    ...ik,
                    properties: ik.properties.map((pk) =>
                      pk.property === property
                        ? {
                            ...pk,
                            keyframes: [...pk.keyframes, { id: keyframeId, frame, value, easing }]
                              .sort((a, b) => a.frame - b.frame),
                          }
                        : pk
                    ),
                  }
                : ik
            ),
            isDirty: true,
          };
        }
        // Add new property with keyframe
        return {
          keyframes: state.keyframes.map((ik) =>
            ik.itemId === itemId
              ? {
                  ...ik,
                  properties: [
                    ...ik.properties,
                    { property, keyframes: [{ id: keyframeId, frame, value, easing }] },
                  ],
                }
              : ik
          ),
          isDirty: true,
        };
      }
      // Create new item keyframes entry
      return {
        keyframes: [
          ...state.keyframes,
          {
            itemId,
            properties: [{ property, keyframes: [{ id: keyframeId, frame, value, easing }] }],
          },
        ],
        isDirty: true,
      };
    });
    return keyframeId;
  },

  // Update a keyframe's properties
  updateKeyframe: (itemId, property, keyframeId, updates) => set((state) => ({
    keyframes: state.keyframes.map((ik) =>
      ik.itemId === itemId
        ? {
            ...ik,
            properties: ik.properties.map((pk) =>
              pk.property === property
                ? {
                    ...pk,
                    keyframes: pk.keyframes
                      .map((k) => (k.id === keyframeId ? { ...k, ...updates } : k))
                      .sort((a, b) => a.frame - b.frame),
                  }
                : pk
            ),
          }
        : ik
    ),
    isDirty: true,
  })),

  // Remove a keyframe
  removeKeyframe: (itemId, property, keyframeId) => set((state) => {
    const newKeyframes = state.keyframes.map((ik) => {
      if (ik.itemId !== itemId) return ik;

      const newProperties = ik.properties
        .map((pk) => {
          if (pk.property !== property) return pk;
          return {
            ...pk,
            keyframes: pk.keyframes.filter((k) => k.id !== keyframeId),
          };
        })
        .filter((pk) => pk.keyframes.length > 0); // Remove empty property entries

      return { ...ik, properties: newProperties };
    }).filter((ik) => ik.properties.length > 0); // Remove empty item entries

    return { keyframes: newKeyframes, isDirty: true };
  }),

  // Remove all keyframes for an item
  removeKeyframesForItem: (itemId) => set((state) => ({
    keyframes: state.keyframes.filter((k) => k.itemId !== itemId),
    isDirty: true,
  })),

  // Remove all keyframes for a specific property on an item
  removeKeyframesForProperty: (itemId, property) => set((state) => ({
    keyframes: state.keyframes
      .map((ik) =>
        ik.itemId === itemId
          ? { ...ik, properties: ik.properties.filter((p) => p.property !== property) }
          : ik
      )
      .filter((ik) => ik.properties.length > 0),
    isDirty: true,
  })),

  // Get keyframes for an item (used for rendering)
  // Note: Use granular selector in components instead of this method for reactivity
  getKeyframesForItem: (itemId) => {
    const { keyframes } = useTimelineStore.getState();
    return keyframes.find((k) => k.itemId === itemId);
  },

  // Check if a keyframe exists at a specific frame for a property
  hasKeyframesAtFrame: (itemId, property, frame) => {
    const { keyframes } = useTimelineStore.getState();
    const itemKeyframes = keyframes.find((k) => k.itemId === itemId);
    if (!itemKeyframes) return false;
    const propKeyframes = itemKeyframes.properties.find((p) => p.property === property);
    if (!propKeyframes) return false;
    return propKeyframes.keyframes.some((k) => k.frame === frame);
  },

  // Save timeline to project in IndexedDB
  saveTimeline: async (projectId) => {
    const state = useTimelineStore.getState();
    const currentFrame = usePlaybackStore.getState().currentFrame;
    const zoomLevel = useZoomStore.getState().level;

    try {
      // Get the current project
      const project = await getProject(projectId);
      if (!project) {
        throw new Error(`Project not found: ${projectId}`);
      }

      // Prepare timeline data (serialize tracks without items since items are separate)
      const timelineData: ProjectTimeline = {
        tracks: state.tracks.map(track => ({
          id: track.id,
          name: track.name,
          height: track.height,
          locked: track.locked,
          visible: track.visible,
          muted: track.muted,
          solo: track.solo,
          color: track.color,
          order: track.order,
        })),
        items: state.items.map(item => {
          // Base properties common to all items
          const baseItem = {
            id: item.id,
            trackId: item.trackId,
            from: item.from,
            durationInFrames: item.durationInFrames,
            label: item.label,
            mediaId: item.mediaId,
            originId: item.originId, // Stable key lineage tracking
            type: item.type,
            // Save trim properties for all items
            ...(item.trimStart !== undefined && { trimStart: item.trimStart }),
            ...(item.trimEnd !== undefined && { trimEnd: item.trimEnd }),
            ...(item.sourceStart !== undefined && { sourceStart: item.sourceStart }),
            ...(item.sourceEnd !== undefined && { sourceEnd: item.sourceEnd }),
            ...(item.sourceDuration !== undefined && { sourceDuration: item.sourceDuration }),
            // Save transform if present
            ...(item.transform && { transform: item.transform }),
            // Save audio properties for all items (video/audio may have these)
            ...(item.volume !== undefined && { volume: item.volume }),
            ...(item.audioFadeIn !== undefined && { audioFadeIn: item.audioFadeIn }),
            ...(item.audioFadeOut !== undefined && { audioFadeOut: item.audioFadeOut }),
            // Save video fade properties
            ...(item.fadeIn !== undefined && { fadeIn: item.fadeIn }),
            ...(item.fadeOut !== undefined && { fadeOut: item.fadeOut }),
            // Save visual effects
            ...(item.effects && item.effects.length > 0 && { effects: item.effects }),
          };

          // Add type-specific properties
          if (item.type === 'video') {
            return {
              ...baseItem,
              src: item.src,
              thumbnailUrl: item.thumbnailUrl,
              offset: item.offset,
              ...(item.speed !== undefined && item.speed !== 1 && { speed: item.speed }),
              ...(item.sourceWidth !== undefined && { sourceWidth: item.sourceWidth }),
              ...(item.sourceHeight !== undefined && { sourceHeight: item.sourceHeight }),
            };
          } else if (item.type === 'audio') {
            return { ...baseItem, src: item.src, waveformData: item.waveformData, offset: item.offset, ...(item.speed !== undefined && item.speed !== 1 && { speed: item.speed }) };
          } else if (item.type === 'text') {
            return {
              ...baseItem,
              text: item.text,
              color: item.color,
              // Typography
              ...(item.fontSize !== undefined && { fontSize: item.fontSize }),
              ...(item.fontFamily && { fontFamily: item.fontFamily }),
              ...(item.fontWeight && { fontWeight: item.fontWeight }),
              ...(item.fontStyle && { fontStyle: item.fontStyle }),
              // Colors
              ...(item.backgroundColor && { backgroundColor: item.backgroundColor }),
              // Text layout
              ...(item.textAlign && { textAlign: item.textAlign }),
              ...(item.verticalAlign && { verticalAlign: item.verticalAlign }),
              ...(item.lineHeight !== undefined && { lineHeight: item.lineHeight }),
              ...(item.letterSpacing !== undefined && { letterSpacing: item.letterSpacing }),
              // Text effects
              ...(item.textShadow && { textShadow: item.textShadow }),
              ...(item.stroke && { stroke: item.stroke }),
            };
          } else if (item.type === 'image') {
            return {
              ...baseItem,
              src: item.src,
              thumbnailUrl: item.thumbnailUrl,
              ...(item.sourceWidth !== undefined && { sourceWidth: item.sourceWidth }),
              ...(item.sourceHeight !== undefined && { sourceHeight: item.sourceHeight }),
            };
          } else if (item.type === 'shape') {
            return {
              ...baseItem,
              shapeType: item.shapeType,
              fillColor: item.fillColor,
              // Stroke properties
              ...(item.strokeColor && { strokeColor: item.strokeColor }),
              ...(item.strokeWidth !== undefined && { strokeWidth: item.strokeWidth }),
              // Shape-specific properties
              ...(item.cornerRadius !== undefined && { cornerRadius: item.cornerRadius }),
              ...(item.direction && { direction: item.direction }),
              ...(item.points !== undefined && { points: item.points }),
              ...(item.innerRadius !== undefined && { innerRadius: item.innerRadius }),
              // Mask properties
              ...(item.isMask !== undefined && { isMask: item.isMask }),
              ...(item.maskType && { maskType: item.maskType }),
              ...(item.maskFeather !== undefined && { maskFeather: item.maskFeather }),
              ...(item.maskInvert !== undefined && { maskInvert: item.maskInvert }),
            };
          } else if (item.type === 'adjustment') {
            return {
              ...baseItem,
              ...(item.effectOpacity !== undefined && { effectOpacity: item.effectOpacity }),
            };
          }
          return baseItem as any;
        }),
        // Save playback and view state
        currentFrame,
        zoomLevel,
        scrollPosition: state.scrollPosition,
        // Save in/out points
        ...(state.inPoint !== null && { inPoint: state.inPoint }),
        ...(state.outPoint !== null && { outPoint: state.outPoint }),
        // Save project markers
        ...(state.markers.length > 0 && {
          markers: state.markers.map(m => ({
            id: m.id,
            frame: m.frame,
            color: m.color,
            ...(m.label && { label: m.label }),
          })),
        }),
        // Save transitions
        ...(state.transitions.length > 0 && {
          transitions: state.transitions.map(t => ({
            id: t.id,
            type: t.type,
            leftClipId: t.leftClipId,
            rightClipId: t.rightClipId,
            trackId: t.trackId,
            durationInFrames: t.durationInFrames,
            presentation: t.presentation,
            ...(t.timing && { timing: t.timing }),
            ...(t.direction && { direction: t.direction }),
          })),
        }),
        // Save keyframes
        ...(state.keyframes.length > 0 && {
          keyframes: state.keyframes.map(ik => ({
            itemId: ik.itemId,
            properties: ik.properties.map(pk => ({
              property: pk.property,
              keyframes: pk.keyframes.map(k => ({
                id: k.id,
                frame: k.frame,
                value: k.value,
                easing: k.easing,
              })),
            })),
          })),
        }),
      };

      // Generate thumbnail from current Player frame (captures the actual rendered output)
      // Skip if timeline has no clips - nothing to capture
      let thumbnail: string | undefined;
      if (state.items.length > 0) {
        try {
          const captureFrame = usePlaybackStore.getState().captureFrame;
          if (captureFrame) {
            const capturedThumbnail = await captureFrame();
            if (capturedThumbnail) {
              thumbnail = capturedThumbnail;
            }
          } else {
            // Fallback to source-based thumbnail if Player isn't available
            const fps = project.metadata?.fps || 30;
            const playheadThumbnail = await generatePlayheadThumbnail(
              state.items,
              state.tracks,
              currentFrame,
              fps
            );
            if (playheadThumbnail) {
              thumbnail = playheadThumbnail;
            }
          }
        } catch (thumbError) {
          // Thumbnail generation failure shouldn't block save
          console.warn('Failed to generate thumbnail:', thumbError);
        }
      }

      // Update project with timeline data and thumbnail (if generated)
      await updateProject(projectId, {
        timeline: timelineData,
        ...(thumbnail && { thumbnail }),
      });

      // Mark as clean after successful save
      set({ isDirty: false });
    } catch (error) {
      console.error('Failed to save timeline:', error);
      throw error;
    }
  },

  // Load timeline from project in IndexedDB
  loadTimeline: async (projectId) => {
    try {
      const project = await getProject(projectId);
      if (!project) {
        throw new Error(`Project not found: ${projectId}`);
      }

      if (project.timeline) {
        // Restore tracks and items from project
        // Sort tracks by order property to preserve user's track arrangement
        // Use original array index as fallback for tracks without order property
        const sortedTracks = project.timeline.tracks
          .map((track, index) => ({ track, originalIndex: index }))
          .sort((a, b) => (a.track.order ?? a.originalIndex) - (b.track.order ?? b.originalIndex))
          .map(({ track }) => ({
            ...track,
            items: [], // Items are stored separately
          }));

        set({
          tracks: sortedTracks,
          items: project.timeline.items as any, // Type assertion needed due to serialization
          // Restore in/out points
          inPoint: project.timeline.inPoint ?? null,
          outPoint: project.timeline.outPoint ?? null,
          // Restore project markers
          markers: project.timeline.markers ?? [],
          // Restore transitions
          transitions: (project.timeline.transitions as Transition[]) ?? [],
          // Restore keyframes
          keyframes: (project.timeline.keyframes as ItemKeyframes[]) ?? [],
          isDirty: false, // Fresh load is clean
        });

        // Restore playback and view state
        if (project.timeline.currentFrame !== undefined) {
          usePlaybackStore.getState().setCurrentFrame(project.timeline.currentFrame);
        }
        if (project.timeline.zoomLevel !== undefined) {
          useZoomStore.getState().setZoomLevel(project.timeline.zoomLevel);
        }
      } else {
        // Initialize with empty state for new projects
        set({
          tracks: [],
          items: [],
          markers: [],
          transitions: [],
          keyframes: [],
          inPoint: null,
          outPoint: null,
          isDirty: false, // New project starts clean
        });

        // Reset playback and view state for new projects
        usePlaybackStore.getState().setCurrentFrame(0);
        useZoomStore.getState().setZoomLevel(1);
      }
    } catch (error) {
      console.error('Failed to load timeline:', error);
      throw error;
    }
  },

  // Clear timeline (reset to empty state)
  clearTimeline: () => set({
    tracks: [],
    items: [],
    markers: [],
    transitions: [],
    keyframes: [],
    scrollPosition: 0,
    isDirty: false,
  }),

  // Dirty state management
  markDirty: () => set({ isDirty: true }),
  markClean: () => set({ isDirty: false }),
  }))
);

// === Memoized Selectors ===

/**
 * Memoized selector that returns keyframes as a Map for O(1) lookups by itemId.
 * This avoids O(n) find() calls in hot paths like animation resolution.
 *
 * @example
 * const keyframeMap = useKeyframeMap();
 * const itemKeyframes = keyframeMap.get(itemId);
 */
export function useKeyframeMap(): Map<string, ItemKeyframes> {
  return useTimelineStore((state: TimelineState) => {
    // Create Map from array - this is memoized by Zustand's selector equality check
    const map = new Map<string, ItemKeyframes>();
    for (const kf of state.keyframes) {
      map.set(kf.itemId, kf);
    }
    return map;
  });
}

/**
 * Get keyframes for a specific item using the memoized map.
 * More efficient than using the array when you only need one item's keyframes.
 */
export function useItemKeyframes(itemId: string): ItemKeyframes | undefined {
  return useTimelineStore((state: TimelineState) => {
    return state.keyframes.find((k: ItemKeyframes) => k.itemId === itemId);
  });
}
