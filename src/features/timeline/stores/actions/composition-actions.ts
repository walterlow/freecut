/**
 * Composition Actions — create, dissolve, and manage pre-compositions.
 */

import type { TimelineItem, TimelineTrack, CompositionItem } from '@/types/timeline';
import { useItemsStore } from '../items-store';
import { useTransitionsStore } from '../transitions-store';
import { useKeyframesStore } from '../keyframes-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { useCompositionsStore, type SubComposition } from '../compositions-store';
import { useSelectionStore } from '@/shared/state/selection';
import { DEFAULT_TRACK_HEIGHT } from '../../constants';
import { useCompositionNavigationStore } from '../composition-navigation-store';
import { execute } from './shared';

/**
 * Create a pre-composition from the currently selected items.
 *
 * 1. Calculates bounding box of selected items (earliest from, latest end).
 * 2. Creates a SubComposition with repositioned items (starting at frame 0).
 * 3. Creates tracks within the sub-composition.
 * 4. Removes original items from the main timeline.
 * 5. Inserts a CompositionItem at the bounding box position on the first
 *    available track (or the first selected item's track).
 *
 * Only allowed on the root timeline (1-level nesting limit).
 */
export function createPreComp(name?: string, itemIds?: string[]): CompositionItem | null {
  return execute('CREATE_PRE_COMP', () => {
    // Block pre-comp creation inside a sub-composition (1-level nesting limit)
    if (useCompositionNavigationStore.getState().activeCompositionId !== null) return null;
    const { items, tracks } = useItemsStore.getState();
    const { transitions } = useTransitionsStore.getState();
    const { keyframes } = useKeyframesStore.getState();
    const { fps } = useTimelineSettingsStore.getState();
    const selectedIds = itemIds ?? useSelectionStore.getState().selectedItemIds;

    if (selectedIds.length === 0) return null;

    const selectedItems = items.filter((i) => selectedIds.includes(i.id));
    if (selectedItems.length === 0) return null;

    // --- 1. Calculate bounding box ---
    const minFrom = Math.min(...selectedItems.map((i) => i.from));
    const maxEnd = Math.max(...selectedItems.map((i) => i.from + i.durationInFrames));
    const durationInFrames = maxEnd - minFrom;

    // --- 2. Determine canvas dimensions from project settings ---
    // Use the same canvas size as the project for the sub-composition
    // (Could be refined later to compute tight bounding box from transforms)
    // Get the project canvas dimensions from video config or default
    const width = 1920;
    const height = 1080;

    // --- 3. Collect distinct source tracks and build sub-comp tracks ---
    const selectedItemIds = new Set(selectedIds);
    const sourceTrackMap = new Map(tracks.map((t) => [t.id, t]));
    const sourceTrackIds = [...new Set(selectedItems.map((i) => i.trackId))]
      .sort((a, b) => (sourceTrackMap.get(a)?.order ?? 0) - (sourceTrackMap.get(b)?.order ?? 0));

    const subCompTracks: TimelineTrack[] = sourceTrackIds.map((trackId, index) => {
      const sourceTrack = sourceTrackMap.get(trackId);
      return {
        id: crypto.randomUUID(),
        name: sourceTrack?.name ?? `Track ${index + 1}`,
        height: sourceTrack?.height ?? DEFAULT_TRACK_HEIGHT,
        locked: false,
        visible: true,
        muted: sourceTrack?.muted ?? false,
        solo: false,
        order: index,
        items: [],
      };
    });

    // Map old trackId → new trackId
    const trackIdMapping = new Map<string, string>();
    sourceTrackIds.forEach((oldId, index) => {
      trackIdMapping.set(oldId, subCompTracks[index]!.id);
    });

    // --- 4. Reposition items to start at frame 0, assign to new tracks ---
    const subCompItems: TimelineItem[] = selectedItems.map((item) => ({
      ...item,
      id: crypto.randomUUID(),
      from: item.from - minFrom,
      trackId: trackIdMapping.get(item.trackId) ?? subCompTracks[0]!.id,
    }));

    // Map old item IDs to new item IDs for transition/keyframe migration
    const itemIdMapping = new Map<string, string>();
    selectedItems.forEach((original, index) => {
      itemIdMapping.set(original.id, subCompItems[index]!.id);
    });

    // --- 5. Migrate transitions that involve only selected items ---
    const subCompTransitions = transitions
      .filter(
        (t) =>
          selectedItemIds.has(t.leftClipId) && selectedItemIds.has(t.rightClipId)
      )
      .map((t) => ({
        ...t,
        id: crypto.randomUUID(),
        leftClipId: itemIdMapping.get(t.leftClipId) ?? t.leftClipId,
        rightClipId: itemIdMapping.get(t.rightClipId) ?? t.rightClipId,
        trackId: trackIdMapping.get(t.trackId) ?? t.trackId,
      }));

    // --- 6. Migrate keyframes for selected items ---
    const subCompKeyframes = keyframes
      .filter((kf) => selectedItemIds.has(kf.itemId))
      .map((kf) => ({
        ...kf,
        itemId: itemIdMapping.get(kf.itemId) ?? kf.itemId,
      }));

    // --- 7. Create SubComposition ---
    const compositionId = crypto.randomUUID();
    const compName = name ?? `Pre-Comp ${useCompositionsStore.getState().compositions.length + 1}`;
    const subComp: SubComposition = {
      id: compositionId,
      name: compName,
      items: subCompItems,
      tracks: subCompTracks,
      transitions: subCompTransitions,
      keyframes: subCompKeyframes,
      fps,
      width,
      height,
      durationInFrames,
    };

    useCompositionsStore.getState().addComposition(subComp);

    // --- 8. Remove original items and their transitions/keyframes ---
    useItemsStore.getState()._removeItems(selectedIds);

    // Remove transitions that reference any selected items
    const transitionsToKeep = transitions.filter(
      (t) =>
        !selectedItemIds.has(t.leftClipId) && !selectedItemIds.has(t.rightClipId)
    );
    useTransitionsStore.getState().setTransitions(transitionsToKeep);

    // Remove keyframes for selected items
    useKeyframesStore.getState()._removeKeyframesForItems(selectedIds);

    // --- 9. Insert CompositionItem on the highest-order (bottom-most) selected track ---
    // Dissolve will map the last sub-comp track back here and expand upward
    const targetTrackId = sourceTrackIds[sourceTrackIds.length - 1]!;
    const compositionItem: CompositionItem = {
      id: crypto.randomUUID(),
      type: 'composition',
      trackId: targetTrackId,
      from: minFrom,
      durationInFrames,
      label: compName,
      compositionId,
      compositionWidth: width,
      compositionHeight: height,
      transform: {
        x: 0,
        y: 0,
        rotation: 0,
        opacity: 1,
      },
    };

    useItemsStore.getState()._addItem(compositionItem);

    // Select the new composition item
    useSelectionStore.getState().selectItems([compositionItem.id]);

    useTimelineSettingsStore.getState().markDirty();

    return compositionItem;
  }, { name });
}

/**
 * Dissolve a CompositionItem back into individual items on the main timeline.
 * This is the inverse of createPreComp.
 */
export function dissolvePreComp(compositionItemId: string): boolean {
  return execute('DISSOLVE_PRE_COMP', () => {
    const { items } = useItemsStore.getState();
    const compositionItem = items.find(
      (i) => i.id === compositionItemId && i.type === 'composition'
    );
    if (!compositionItem || compositionItem.type !== 'composition') return false;

    const subComp = useCompositionsStore.getState().getComposition(
      compositionItem.compositionId
    );
    if (!subComp) return false;

    const compFrom = compositionItem.from;
    const targetTrackId = compositionItem.trackId;
    const { tracks } = useItemsStore.getState();

    // Find the composition item's track to get its order for inserting new tracks nearby
    const compTrack = tracks.find((t) => t.id === targetTrackId);
    const compTrackOrder = compTrack?.order ?? 0;

    // Map sub-comp tracks to main timeline tracks.
    // Bottom-most sub-comp track reuses the comp's track.
    // Upper sub-comp tracks try to reuse existing tracks above the comp
    // (checking for item overlap), only creating new tracks as a last resort.
    const sortedSubTracks = [...subComp.tracks].sort((a, b) => a.order - b.order);
    const trackIdMapping = new Map<string, string>();
    const newTracks: typeof tracks = [];
    const lastIdx = sortedSubTracks.length - 1;

    // Bottom-most sub-comp track → comp's track
    trackIdMapping.set(sortedSubTracks[lastIdx]!.id, targetTrackId);

    // Candidate tracks above the comp, sorted descending (closest to comp first)
    // Exclude group tracks — they are headers, not item containers
    const candidatesAbove = [...tracks]
      .filter((t) => t.id !== targetTrackId && !t.isGroup && (t.order ?? 0) < compTrackOrder)
      .sort((a, b) => (b.order ?? 0) - (a.order ?? 0));

    const usedTrackIds = new Set<string>([targetTrackId]);
    // Current items excluding the comp item itself (for overlap checks)
    const currentItems = items.filter((i) => i.id !== compositionItemId);

    // Process from second-to-bottom upward so closest-to-comp gets matched first
    for (let i = lastIdx - 1; i >= 0; i--) {
      const subTrack = sortedSubTracks[i]!;

      // Items that will be restored onto this track (with absolute positions)
      const restoredRanges = subComp.items
        .filter((it) => it.trackId === subTrack.id)
        .map((it) => ({ from: it.from + compFrom, end: it.from + compFrom + it.durationInFrames }));

      // Try to find an existing track above the comp with no overlap
      let foundTrackId: string | null = null;
      for (const candidate of candidatesAbove) {
        if (usedTrackIds.has(candidate.id)) continue;

        const existingOnTrack = currentItems.filter((it) => it.trackId === candidate.id);
        const overlaps = existingOnTrack.some((existing) => {
          const existEnd = existing.from + existing.durationInFrames;
          return restoredRanges.some((r) => r.from < existEnd && existing.from < r.end);
        });

        if (!overlaps) {
          foundTrackId = candidate.id;
          usedTrackIds.add(candidate.id);
          break;
        }
      }

      if (foundTrackId) {
        trackIdMapping.set(subTrack.id, foundTrackId);
      } else {
        // No suitable existing track — create a new one above the comp
        const distFromBottom = lastIdx - i;
        const newTrackId = crypto.randomUUID();
        trackIdMapping.set(subTrack.id, newTrackId);
        newTracks.push({
          ...subTrack,
          id: newTrackId,
          order: compTrackOrder - distFromBottom * 0.01,
          parentTrackId: compTrack?.parentTrackId,
        });
      }
    }

    // Add new tracks to the store (only if we couldn't reuse existing ones)
    if (newTracks.length > 0) {
      useItemsStore.getState().setTracks([...tracks, ...newTracks]);
    }

    // Reposition items back to absolute timeline positions with correct track mapping
    const itemIdMapping = new Map<string, string>();
    const restoredItems: TimelineItem[] = subComp.items.map((item) => {
      const newId = crypto.randomUUID();
      itemIdMapping.set(item.id, newId);
      return {
        ...item,
        id: newId,
        from: item.from + compFrom,
        trackId: trackIdMapping.get(item.trackId) ?? targetTrackId,
      };
    });

    // Restore transitions with remapped IDs
    const subTransitions = subComp.transitions ?? [];
    if (subTransitions.length > 0) {
      const currentTransitions = useTransitionsStore.getState().transitions;
      const restoredTransitions = subTransitions.map((t) => ({
        ...t,
        id: crypto.randomUUID(),
        leftClipId: itemIdMapping.get(t.leftClipId) ?? t.leftClipId,
        rightClipId: itemIdMapping.get(t.rightClipId) ?? t.rightClipId,
        trackId: trackIdMapping.get(t.trackId) ?? t.trackId,
      }));
      useTransitionsStore.getState().setTransitions([...currentTransitions, ...restoredTransitions]);
    }

    // Restore keyframes with remapped item IDs
    const subKeyframes = subComp.keyframes ?? [];
    if (subKeyframes.length > 0) {
      const currentKeyframes = useKeyframesStore.getState().keyframes;
      const restoredKeyframes = subKeyframes.map((kf) => ({
        ...kf,
        itemId: itemIdMapping.get(kf.itemId) ?? kf.itemId,
      }));
      useKeyframesStore.getState().setKeyframes([...currentKeyframes, ...restoredKeyframes]);
    }

    // Remove the composition item
    useItemsStore.getState()._removeItems([compositionItemId]);

    // Add restored items
    for (const item of restoredItems) {
      useItemsStore.getState()._addItem(item);
    }

    // Check if composition is still referenced by other items
    const remainingRefs = useItemsStore.getState().items.filter(
      (i) => i.type === 'composition' && i.compositionId === compositionItem.compositionId
    );

    // Only remove the sub-composition if no other items reference it
    if (remainingRefs.length === 0) {
      useCompositionsStore.getState().removeComposition(compositionItem.compositionId);
    }

    // Select the restored items
    useSelectionStore.getState().selectItems(restoredItems.map((i) => i.id));

    useTimelineSettingsStore.getState().markDirty();
    return true;
  }, { compositionItemId });
}
