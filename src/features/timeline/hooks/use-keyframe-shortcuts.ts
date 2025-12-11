import { useEffect } from 'react';
import { useKeyframeSelectionStore } from '../stores/keyframe-selection-store';
import { useKeyframesStore } from '../stores/keyframes-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useTimelineStore } from '../stores/timeline-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import type { KeyframeRef } from '@/types/keyframe';

/**
 * Hook to handle keyboard shortcuts for keyframe operations.
 * Should be used in the timeline or keyframe lane container.
 *
 * Shortcuts:
 * - Ctrl+C: Copy selected keyframes
 * - Ctrl+X: Cut selected keyframes
 * - Ctrl+V: Paste keyframes at playhead
 * - Ctrl+D: Duplicate selected keyframes
 * - Delete/Backspace: Delete selected keyframes
 * - Ctrl+A: Select all keyframes for focused property (if any)
 */
export function useKeyframeShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input, textarea, or contenteditable
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const selectionStore = useKeyframeSelectionStore.getState();
      const keyframesStore = useKeyframesStore.getState();
      const { selectedKeyframes, clipboard } = selectionStore;

      // Only handle shortcuts if keyframes are selected or we have clipboard content
      const hasSelection = selectedKeyframes.length > 0;
      const hasClipboard = clipboard !== null && clipboard.keyframes.length > 0;

      const key = e.key.toLowerCase();
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // Ctrl+C: Copy
      if (key === 'c' && isCtrlOrCmd && hasSelection) {
        e.preventDefault();
        selectionStore.copySelectedKeyframes();
        return;
      }

      // Ctrl+X: Cut
      if (key === 'x' && isCtrlOrCmd && hasSelection) {
        e.preventDefault();
        selectionStore.cutSelectedKeyframes();
        return;
      }

      // Ctrl+V: Paste
      if (key === 'v' && isCtrlOrCmd && hasClipboard) {
        e.preventDefault();
        pasteKeyframes();
        return;
      }

      // Ctrl+D: Duplicate
      if (key === 'd' && isCtrlOrCmd && hasSelection) {
        e.preventDefault();
        // Duplicate 10 frames forward
        keyframesStore._duplicateKeyframes(selectedKeyframes, 10);
        return;
      }

      // Delete/Backspace: Delete selected keyframes
      if ((key === 'delete' || key === 'backspace') && hasSelection) {
        e.preventDefault();
        keyframesStore._removeKeyframes(selectedKeyframes);
        selectionStore.clearSelection();
        return;
      }

      // Ctrl+A: Select all keyframes for focused item/property
      // This needs context about which property is focused, so we select all for the first selected item
      if (key === 'a' && isCtrlOrCmd && hasSelection) {
        const firstRef = selectedKeyframes[0];
        if (firstRef) {
          e.preventDefault();
          selectionStore.selectAllForProperty(firstRef.itemId, firstRef.property);
        }
        return;
      }

      // Escape: Clear selection
      if (key === 'escape' && hasSelection) {
        e.preventDefault();
        selectionStore.clearSelection();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
}

/**
 * Paste keyframes from clipboard at the current playhead position.
 * Handles both regular paste and cut-paste (removes originals).
 */
function pasteKeyframes() {
  const selectionStore = useKeyframeSelectionStore.getState();
  const keyframesStore = useKeyframesStore.getState();
  const timelineStore = useTimelineStore.getState();
  const editorSelectionStore = useSelectionStore.getState();

  const { clipboard, isCut, selectedKeyframes: cutRefs } = selectionStore;
  if (!clipboard || clipboard.keyframes.length === 0) return;

  // Get current playhead position
  const currentFrame = usePlaybackStore.getState().currentFrame;

  // Determine target item - use first selected item or clipboard source
  const selectedItemIds = editorSelectionStore.selectedItemIds;
  const targetItemId =
    selectedItemIds.length > 0 ? selectedItemIds[0] : clipboard.sourceItemId;

  if (!targetItemId) return;

  // Find the target item to get its start frame
  const targetItem = timelineStore.items.find((i) => i.id === targetItemId);
  if (!targetItem) return;

  // Calculate relative frame within item
  const relativeFrame = currentFrame - targetItem.from;
  if (relativeFrame < 0 || relativeFrame >= targetItem.durationInFrames) {
    // Playhead is outside target item, paste at frame 0
    pasteAtFrame(targetItemId, 0);
  } else {
    pasteAtFrame(targetItemId, relativeFrame);
  }

  // If this was a cut, remove the originals
  if (isCut && cutRefs.length > 0) {
    keyframesStore._removeKeyframes(cutRefs);
    selectionStore.clearClipboard();
  }
}

/**
 * Paste clipboard keyframes at a specific frame within an item.
 */
function pasteAtFrame(targetItemId: string, startFrame: number) {
  const selectionStore = useKeyframeSelectionStore.getState();
  const keyframesStore = useKeyframesStore.getState();

  const { clipboard } = selectionStore;
  if (!clipboard) return;

  const newRefs: KeyframeRef[] = [];

  // Add each keyframe from clipboard
  for (const kf of clipboard.keyframes) {
    const newId = keyframesStore._addKeyframe(
      targetItemId,
      kf.property,
      startFrame + kf.frame,
      kf.value,
      kf.easing,
      kf.easingConfig
    );

    newRefs.push({
      itemId: targetItemId,
      property: kf.property,
      keyframeId: newId,
    });
  }

  // Select the newly pasted keyframes
  if (newRefs.length > 0) {
    selectionStore.selectKeyframes(newRefs);
  }
}
