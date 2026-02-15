/**
 * Clipboard shortcuts: Ctrl+C (copy), Ctrl+X (cut), Ctrl+V (paste).
 */

import { useHotkeys } from 'react-hotkeys-hook';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { useClipboardStore } from '@/features/editor/stores/clipboard-store';
import { useCompositionNavigationStore } from '../../stores/composition-navigation-store';
import { HOTKEYS, HOTKEY_OPTIONS } from '@/config/hotkeys';
import type { Transition } from '@/types/transition';

export function useClipboardShortcuts() {
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);
  const selectedTransitionId = useSelectionStore((s) => s.selectedTransitionId);
  const selectItems = useSelectionStore((s) => s.selectItems);
  const activeTrackId = useSelectionStore((s) => s.activeTrackId);
  const items = useTimelineStore((s) => s.items);
  const transitions = useTimelineStore((s) => s.transitions);
  const tracks = useTimelineStore((s) => s.tracks);
  const addItem = useTimelineStore((s) => s.addItem);
  const removeItems = useTimelineStore((s) => s.removeItems);
  const updateTransition = useTimelineStore((s) => s.updateTransition);
  const copyTransition = useClipboardStore((s) => s.copyTransition);
  const transitionClipboard = useClipboardStore((s) => s.transitionClipboard);
  const copyItems = useClipboardStore((s) => s.copyItems);
  const itemsClipboard = useClipboardStore((s) => s.itemsClipboard);

  // Clipboard: Ctrl+C - Copy selected transition properties or timeline items
  useHotkeys(
    HOTKEYS.COPY,
    (event) => {
      if (selectedTransitionId) {
        event.preventDefault();
        const transition = transitions.find(
          (t: Transition) => t.id === selectedTransitionId
        );
        if (transition) {
          copyTransition({
            presentation: transition.presentation,
            direction: transition.direction,
            timing: transition.timing,
            durationInFrames: transition.durationInFrames,
          });
        }
        return;
      }
      if (selectedItemIds.length > 0) {
        event.preventDefault();
        const currentFrame = usePlaybackStore.getState().currentFrame;
        const selectedItems = items.filter((item) => selectedItemIds.includes(item.id));
        if (selectedItems.length > 0) {
          copyItems(selectedItems, currentFrame, 'copy');
        }
      }
    },
    HOTKEY_OPTIONS,
    [selectedTransitionId, transitions, copyTransition, selectedItemIds, items, copyItems]
  );

  // Clipboard: Ctrl+X - Cut selected items
  useHotkeys(
    HOTKEYS.CUT,
    (event) => {
      if (selectedItemIds.length > 0) {
        event.preventDefault();
        const currentFrame = usePlaybackStore.getState().currentFrame;
        const selectedItems = items.filter((item) => selectedItemIds.includes(item.id));
        if (selectedItems.length > 0) {
          copyItems(selectedItems, currentFrame, 'cut');
        }
      }
    },
    HOTKEY_OPTIONS,
    [selectedItemIds, items, copyItems]
  );

  // Clipboard: Ctrl+V - Paste transition properties or timeline items
  useHotkeys(
    HOTKEYS.PASTE,
    (event) => {
      if (selectedTransitionId && transitionClipboard) {
        event.preventDefault();
        updateTransition(selectedTransitionId, {
          presentation: transitionClipboard.presentation,
          direction: transitionClipboard.direction,
          timing: transitionClipboard.timing,
          durationInFrames: transitionClipboard.durationInFrames,
        });
        return;
      }
      if (itemsClipboard && itemsClipboard.items.length > 0) {
        event.preventDefault();
        const currentFrame = usePlaybackStore.getState().currentFrame;
        const storeItems = useTimelineStore.getState().items;
        const newItemIds: string[] = [];

        // Filter out composition items when pasting inside a sub-composition (1-level nesting limit)
        const isInsideSubComp = useCompositionNavigationStore.getState().activeCompositionId !== null;
        const pasteItems = isInsideSubComp
          ? itemsClipboard.items.filter((item) => item.type !== 'composition')
          : itemsClipboard.items;
        if (pasteItems.length === 0) return;

        const findNextAvailableSpace = (
          trackId: string,
          startFrame: number,
          duration: number
        ): number => {
          const trackItems = storeItems
            .filter((item) => item.trackId === trackId)
            .sort((a, b) => a.from - b.from);

          let candidateFrame = startFrame;

          for (const item of trackItems) {
            const itemEnd = item.from + item.durationInFrames;
            if (candidateFrame < itemEnd && candidateFrame + duration > item.from) {
              candidateFrame = itemEnd;
            }
          }

          return candidateFrame;
        };

        const hasSpaceAt = (
          trackId: string,
          startFrame: number,
          duration: number
        ): boolean => {
          const trackItems = storeItems.filter((item) => item.trackId === trackId);
          for (const item of trackItems) {
            const itemEnd = item.from + item.durationInFrames;
            if (startFrame < itemEnd && startFrame + duration > item.from) {
              return false;
            }
          }
          return true;
        };

        for (const itemData of pasteItems) {
          const newId = crypto.randomUUID();
          newItemIds.push(newId);

          let targetTrackId = activeTrackId;
          if (!targetTrackId || !tracks.some((t) => t.id === targetTrackId)) {
            targetTrackId = itemData.trackId;
          }
          const trackExists = tracks.some((t) => t.id === targetTrackId);
          if (!trackExists && tracks.length > 0) {
            targetTrackId = tracks[0]!.id;
          }

          const desiredFrom = currentFrame;
          const duration = itemData.durationInFrames;

          let newFrom: number;
          if (hasSpaceAt(targetTrackId, desiredFrom, duration)) {
            newFrom = desiredFrom;
          } else {
            newFrom = findNextAvailableSpace(targetTrackId, desiredFrom, duration);
          }

          const newItem = {
            ...itemData,
            id: newId,
            from: newFrom,
            trackId: targetTrackId,
            originId: newId,
          };

          addItem(newItem as Parameters<typeof addItem>[0]);
        }

        if (newItemIds.length > 0) {
          selectItems(newItemIds);
        }

        if (itemsClipboard.copyType === 'cut') {
          // Only remove items that were actually pasted (composition items may have been filtered out)
          const pastedOriginalIds = pasteItems.map((pi) => {
            const idx = itemsClipboard.items.indexOf(pi);
            return itemsClipboard.originalIds[idx]!;
          }).filter(Boolean);
          removeItems(pastedOriginalIds);
          useClipboardStore.getState().clearItemsClipboard();
        }
      }
    },
    HOTKEY_OPTIONS,
    [selectedTransitionId, transitionClipboard, updateTransition, itemsClipboard, tracks, addItem, selectItems, removeItems, activeTrackId]
  );
}
