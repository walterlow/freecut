/**
 * Clipboard shortcuts: Ctrl+C (copy), Ctrl+X (cut), Ctrl+V (paste).
 */

import { useHotkeys } from 'react-hotkeys-hook';
import { toast } from 'sonner';
import { usePlaybackStore } from '@/shared/state/playback';
import { useTimelineStore } from '../../stores/timeline-store';
import { useZoomStore } from '../../stores/zoom-store';
import { useSelectionStore } from '@/shared/state/selection';
import { useClipboardStore } from '@/shared/state/clipboard';
import { useCompositionNavigationStore } from '../../stores/composition-navigation-store';
import { useCompositionsStore } from '../../stores/compositions-store';
import { useKeyframeSelectionStore } from '../../stores/keyframe-selection-store';
import { HOTKEY_OPTIONS } from '@/config/hotkeys';
import type { Transition } from '@/types/transition';
import { useResolvedHotkeys } from '@/features/timeline/deps/settings';
import { isCompositionWrapperItem, wouldCreateCompositionCycle } from '../../utils/composition-graph';

function revealPastedItems(itemIds: readonly string[]): void {
  if (itemIds.length === 0) {
    return;
  }

  window.requestAnimationFrame(() => {
    const container = document.querySelector<HTMLElement>('.timeline-container');
    if (!container) {
      return;
    }

    const { items, fps } = useTimelineStore.getState();
    const { pixelsPerSecond } = useZoomStore.getState();
    const pastedItems = items.filter((item) => itemIds.includes(item.id));
    if (pastedItems.length === 0 || fps <= 0) {
      return;
    }

    const startPx = Math.min(...pastedItems.map((item) => (item.from / fps) * pixelsPerSecond));
    const endPx = Math.max(...pastedItems.map((item) => ((item.from + item.durationInFrames) / fps) * pixelsPerSecond));
    const padding = 48;
    const viewLeft = container.scrollLeft;
    const viewRight = container.scrollLeft + container.clientWidth;

    if (startPx >= viewLeft + padding && endPx <= viewRight - padding) {
      return;
    }

    let nextScrollLeft = container.scrollLeft;
    if (startPx < viewLeft + padding) {
      nextScrollLeft = Math.max(0, startPx - padding);
    } else if (endPx > viewRight - padding) {
      nextScrollLeft = Math.max(0, endPx - container.clientWidth + padding);
    }

    container.scrollLeft = nextScrollLeft;
  });
}

export function useClipboardShortcuts() {
  const hotkeys = useResolvedHotkeys();
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);
  const selectedTransitionId = useSelectionStore((s) => s.selectedTransitionId);
  const selectedKeyframes = useKeyframeSelectionStore((s) => s.selectedKeyframes);
  const selectItems = useSelectionStore((s) => s.selectItems);
  const clearItemSelection = useSelectionStore((s) => s.clearItemSelection);
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
  const clipboardHotkeyOptions = {
    ...HOTKEY_OPTIONS,
    eventListenerOptions: { capture: true } as const,
  };

  // Clipboard: Ctrl+C - Copy selected transition properties or timeline items
  useHotkeys(
    hotkeys.COPY,
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
          toast.success('Copied transition settings');
        }
        return;
      }
      if (selectedItemIds.length > 0) {
        event.preventDefault();
        const currentFrame = usePlaybackStore.getState().currentFrame;
        const selectedItems = items.filter((item) => selectedItemIds.includes(item.id));
        if (selectedItems.length > 0) {
          copyItems(selectedItems, currentFrame, 'copy');
          toast.success(selectedItems.length === 1 ? 'Copied 1 item' : `Copied ${selectedItems.length} items`);
        }
      }
    },
    { ...clipboardHotkeyOptions, enabled: selectedKeyframes.length === 0 },
    [selectedTransitionId, transitions, copyTransition, selectedItemIds, items, copyItems, selectedKeyframes.length]
  );

  // Clipboard: Ctrl+X - Cut selected items immediately
  useHotkeys(
    hotkeys.CUT,
    (event) => {
      if (selectedItemIds.length > 0) {
        event.preventDefault();
        const currentFrame = usePlaybackStore.getState().currentFrame;
        const selectedItems = items.filter((item) => selectedItemIds.includes(item.id));
        if (selectedItems.length > 0) {
          copyItems(selectedItems, currentFrame, 'cut');
          removeItems(selectedItemIds);
          clearItemSelection();
          toast.success(selectedItems.length === 1 ? 'Cut 1 item' : `Cut ${selectedItems.length} items`);
        }
      }
    },
    { ...clipboardHotkeyOptions, enabled: selectedKeyframes.length === 0 },
    [selectedItemIds, items, copyItems, removeItems, clearItemSelection, selectedKeyframes.length]
  );

  // Clipboard: Ctrl+V - Paste transition properties or timeline items
  useHotkeys(
    hotkeys.PASTE,
    (event) => {
      if (selectedTransitionId && transitionClipboard) {
        event.preventDefault();
        updateTransition(selectedTransitionId, {
          presentation: transitionClipboard.presentation,
          direction: transitionClipboard.direction,
          timing: transitionClipboard.timing,
          durationInFrames: transitionClipboard.durationInFrames,
        });
        toast.success('Pasted transition settings');
        return;
      }
      if (itemsClipboard && itemsClipboard.items.length > 0) {
        event.preventDefault();
        const currentFrame = usePlaybackStore.getState().currentFrame;
        const storeItems = useTimelineStore.getState().items;
        const newItemIds: string[] = [];
        const usedTrackIds = new Set<string>();
        const linkedGroupMap = new Map<string, string>();

        const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId;
        const compositionById = useCompositionsStore.getState().compositionById;
        const pasteItems = activeCompositionId === null
          ? itemsClipboard.items
          : itemsClipboard.items.filter((item) => (
            !isCompositionWrapperItem(item)
            || !wouldCreateCompositionCycle({
              parentCompositionId: activeCompositionId,
              insertedCompositionId: item.compositionId,
              compositionById,
            })
          ));
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
            linkedGroupId: itemData.linkedGroupId
              ? (linkedGroupMap.get(itemData.linkedGroupId)
                ?? linkedGroupMap.set(itemData.linkedGroupId, crypto.randomUUID()).get(itemData.linkedGroupId))
              : undefined,
          };

          addItem(newItem as Parameters<typeof addItem>[0]);
          usedTrackIds.add(targetTrackId);
        }

        if (newItemIds.length > 0) {
          selectItems(newItemIds);
          revealPastedItems(newItemIds);
          const activeTrack = activeTrackId
            ? tracks.find((track) => track.id === activeTrackId)
            : null;
          const usedTracks = tracks.filter((track) => usedTrackIds.has(track.id));
          const pasteTitle = newItemIds.length === 1 ? 'Pasted 1 item' : `Pasted ${newItemIds.length} items`;

          if (activeTrack) {
            toast.success(pasteTitle, {
              description: `Active Track: ${activeTrack.name.replace(/^Track\s+/i, '')}`,
            });
          } else if (usedTracks.length === 1) {
            toast.success(pasteTitle, {
              description: `Track: ${usedTracks[0]!.name.replace(/^Track\s+/i, '')}`,
            });
          } else {
            toast.success(pasteTitle);
          }

          if (itemsClipboard.copyType === 'cut') {
            useClipboardStore.getState().clearItemsClipboard();
          }
        }

      }
    },
    { ...clipboardHotkeyOptions, enabled: selectedKeyframes.length === 0 },
    [selectedTransitionId, transitionClipboard, updateTransition, itemsClipboard, tracks, addItem, selectItems, activeTrackId, selectedKeyframes.length]
  );
}
