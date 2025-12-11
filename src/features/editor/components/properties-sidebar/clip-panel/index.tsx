import { useMemo, useCallback, memo } from 'react';
import { Separator } from '@/components/ui/separator';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { useProjectStore } from '@/features/projects/stores/project-store';
import type { SelectionState, SelectionActions } from '@/features/editor/types';
import type { TimelineState, TimelineActions } from '@/features/timeline/types';
import type { TransformProperties } from '@/types/transform';
import type { TimelineItem } from '@/types/timeline';

import { SourceSection } from './source-section';
import { LayoutSection } from './layout-section';
import { FillSection } from './fill-section';
import { VideoSection } from './video-section';
import { AudioSection } from './audio-section';
import { TextSection } from './text-section';
import { ShapeSection } from './shape-section';
import { KeyframeGraphSection } from './keyframe-graph-section';
import { EffectsSection } from '@/features/effects/components/effects-section';

/**
 * Compute item type information in a single pass for efficiency.
 * Uses Set for O(1) type lookups instead of repeated array iterations.
 */
function computeItemTypeInfo(items: TimelineItem[]) {
  const types = new Set(items.map(item => item.type));

  return {
    hasVisualItems: types.has('video') || types.has('image') || types.has('text') || types.has('shape') || types.has('adjustment'),
    hasVideoItems: types.has('video'),
    hasAudioItems: types.has('video') || types.has('audio'),
    hasTextItems: types.has('text'),
    hasShapeItems: types.has('shape'),
    hasAdjustmentItems: types.has('adjustment'),
    isOnlyAdjustmentItems: types.size === 1 && types.has('adjustment'),
    isOnlyTextOrShape: items.length > 0 && items.every(
      item => item.type === 'text' || item.type === 'shape'
    ),
  };
}

/**
 * Clip properties panel - shown when one or more clips are selected.
 * Displays and allows editing of clip transforms and media properties.
 * Memoized to prevent re-renders when props haven't changed.
 */
export const ClipPanel = memo(function ClipPanel() {
  // Granular selectors with explicit types
  const selectedItemIds = useSelectionStore((s: SelectionState & SelectionActions) => s.selectedItemIds);
  const items = useTimelineStore((s: TimelineState & TimelineActions) => s.items);
  const fps = useTimelineStore((s: TimelineState & TimelineActions) => s.fps);
  const updateItemsTransform = useTimelineStore((s: TimelineState & TimelineActions) => s.updateItemsTransform);
  const currentProject = useProjectStore((s) => s.currentProject);

  // Get selected items
  const selectedItems = useMemo(
    () => items.filter((item: TimelineItem) => selectedItemIds.includes(item.id)),
    [items, selectedItemIds]
  );

  // Canvas settings
  const canvas = useMemo(
    () => ({
      width: currentProject?.metadata.width ?? 1920,
      height: currentProject?.metadata.height ?? 1080,
      fps: currentProject?.metadata.fps ?? 30,
    }),
    [currentProject]
  );

  // CONSOLIDATED: Single pass for all item type checks
  const itemTypeInfo = useMemo(
    () => computeItemTypeInfo(selectedItems),
    [selectedItems]
  );

  // Destructure for cleaner usage
  const {
    hasVisualItems,
    hasVideoItems,
    hasAudioItems,
    hasTextItems,
    hasShapeItems,
    hasAdjustmentItems,
    isOnlyAdjustmentItems,
    isOnlyTextOrShape,
  } = itemTypeInfo;

  // Memoized filtered arrays for child components - prevents new array creation each render
  const layoutFillItems = useMemo(
    () => selectedItems.filter((item: TimelineItem) => item.type !== 'audio' && item.type !== 'adjustment'),
    [selectedItems]
  );

  const visualItems = useMemo(
    () => selectedItems.filter((item: TimelineItem) => item.type !== 'audio'),
    [selectedItems]
  );

  // Compute aspectLocked from items' transforms
  // If any item has explicit aspectRatioLocked, use that; otherwise use default based on type
  const aspectLocked = useMemo(() => {
    if (selectedItems.length === 0) return true;

    // Check if any item has explicit aspectRatioLocked set
    const firstWithExplicit = selectedItems.find(
      (item: TimelineItem) => item.transform?.aspectRatioLocked !== undefined
    );
    if (firstWithExplicit) {
      return firstWithExplicit.transform!.aspectRatioLocked!;
    }

    // Default based on item types: text/shape = unlocked, others = locked
    return !isOnlyTextOrShape;
  }, [selectedItems, isOnlyTextOrShape]);

  // Toggle aspect lock - updates all selected items' transforms
  const handleAspectLockToggle = useCallback(() => {
    const newValue = !aspectLocked;
    const itemIds = selectedItems.map((item: TimelineItem) => item.id);
    updateItemsTransform(itemIds, { aspectRatioLocked: newValue });
  }, [aspectLocked, selectedItems, updateItemsTransform]);

  // Handle transform changes
  const handleTransformChange = useCallback(
    (ids: string[], updates: Partial<TransformProperties>) => {
      updateItemsTransform(ids, updates);
    },
    [updateItemsTransform]
  );

  if (selectedItems.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Source info - always shown */}
      <SourceSection items={selectedItems} fps={fps} />

      <Separator />

      {/* Layout - only for visual items that have canvas position (not adjustment layers) */}
      {hasVisualItems && !isOnlyAdjustmentItems && (
        <>
          <LayoutSection
            items={layoutFillItems}
            canvas={canvas}
            onTransformChange={handleTransformChange}
            aspectLocked={aspectLocked}
            onAspectLockToggle={handleAspectLockToggle}
          />
          <Separator />
        </>
      )}

      {/* Fill - only for visual items that have canvas position (not adjustment layers) */}
      {hasVisualItems && !isOnlyAdjustmentItems && (
        <>
          <FillSection
            items={layoutFillItems}
            canvas={canvas}
            onTransformChange={handleTransformChange}
          />
          <Separator />
        </>
      )}

      {/* Effects - for visual items and adjustment layers */}
      {hasVisualItems && (
        <>
          {/* Explanatory text for adjustment layers */}
          {hasAdjustmentItems && (
            <div className="px-1 py-2 text-xs text-muted-foreground bg-purple-500/10 rounded border border-purple-500/20 mb-2">
              Effects on adjustment layers apply to all items on tracks above.
            </div>
          )}
          <EffectsSection
            items={visualItems}
          />
          <Separator />
        </>
      )}

      {/* Keyframe Graph - for single item with keyframes */}
      {selectedItems.length === 1 && (
        <>
          <KeyframeGraphSection items={selectedItems} />
          <Separator />
        </>
      )}

      {/* Text - only for text items */}
      {hasTextItems && (
        <>
          <TextSection items={selectedItems} />
          <Separator />
        </>
      )}

      {/* Shape - only for shape items */}
      {hasShapeItems && (
        <>
          <ShapeSection items={selectedItems} />
          <Separator />
        </>
      )}

      {/* Video - only for video items */}
      {hasVideoItems && (
        <>
          <VideoSection items={selectedItems} />
          <Separator />
        </>
      )}

      {/* Audio - for video and audio items */}
      {hasAudioItems && <AudioSection items={selectedItems} />}
    </div>
  );
});
