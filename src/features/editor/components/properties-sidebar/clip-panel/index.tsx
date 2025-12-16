import { useMemo, useCallback, memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Move, Sparkles, Film } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
import { GifSection } from './gif-section';
import { AudioSection } from './audio-section';
import { TextSection } from './text-section';
import { ShapeSection } from './shape-section';
import { KeyframeGraphSection } from './keyframe-graph-section';
import { EffectsSection } from '@/features/effects/components/effects-section';

/**
 * Check if an item is a GIF (image with .gif extension)
 */
function isGifItem(item: TimelineItem): boolean {
  return item.type === 'image' && (item.label?.toLowerCase().endsWith('.gif') ?? false);
}

/**
 * Compute item type information in a single pass for efficiency.
 * Uses Set for O(1) type lookups instead of repeated array iterations.
 */
function computeItemTypeInfo(items: TimelineItem[]) {
  const types = new Set(items.map(item => item.type));
  const hasGifItems = items.some(isGifItem);

  return {
    hasVisualItems: types.has('video') || types.has('image') || types.has('text') || types.has('shape') || types.has('adjustment'),
    hasVideoItems: types.has('video'),
    hasGifItems,
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
  const fps = useTimelineStore((s: TimelineState & TimelineActions) => s.fps);
  const updateItemsTransform = useTimelineStore((s: TimelineState & TimelineActions) => s.updateItemsTransform);
  const currentProject = useProjectStore((s) => s.currentProject);

  // Get selected items using derived selector with shallow comparison
  // useShallow prevents re-renders when unrelated items change in the store
  const selectedItems = useTimelineStore(
    useShallow(useCallback(
      (s: TimelineState & TimelineActions) => s.items.filter((item: TimelineItem) => selectedItemIds.includes(item.id)),
      [selectedItemIds]
    ))
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
    hasGifItems,
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

  // Determine which tabs should be visible
  const showTransformTab = hasVisualItems && !isOnlyAdjustmentItems;
  const showEffectsTab = hasVisualItems;
  const showMediaTab = hasTextItems || hasShapeItems || hasVideoItems || hasGifItems || hasAudioItems;

  // Determine default tab based on what's available
  const defaultTab = showTransformTab ? 'transform' : showEffectsTab ? 'effects' : 'media';

  if (selectedItems.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {/* Source info - always shown at top */}
      <SourceSection items={selectedItems} fps={fps} />

      <Separator />

      {/* Tabbed sections */}
      <Tabs defaultValue={defaultTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 h-8">
          <TabsTrigger
            value="transform"
            disabled={!showTransformTab}
            className="text-xs gap-1 px-2"
          >
            <Move className="h-3 w-3" />
            Transform
          </TabsTrigger>
          <TabsTrigger
            value="effects"
            disabled={!showEffectsTab}
            className="text-xs gap-1 px-2"
          >
            <Sparkles className="h-3 w-3" />
            Effects
          </TabsTrigger>
          <TabsTrigger
            value="media"
            disabled={!showMediaTab}
            className="text-xs gap-1 px-2"
          >
            <Film className="h-3 w-3" />
            Media
          </TabsTrigger>
        </TabsList>

        {/* Transform Tab - Layout & Fill */}
        <TabsContent value="transform" className="space-y-4 mt-3">
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
              <FillSection
                items={layoutFillItems}
                canvas={canvas}
                onTransformChange={handleTransformChange}
              />
            </>
          )}
        </TabsContent>

        {/* Effects Tab - Effects & Keyframes */}
        <TabsContent value="effects" className="space-y-4 mt-3">
          {hasVisualItems && (
            <>
              {/* Explanatory text for adjustment layers */}
              {hasAdjustmentItems && (
                <div className="px-2 py-2 text-xs text-muted-foreground bg-purple-500/10 rounded border border-purple-500/20">
                  Effects on adjustment layers apply to all items on tracks above.
                </div>
              )}
              <EffectsSection items={visualItems} />
            </>
          )}

          {/* Keyframe Graph - for single item with keyframes */}
          {selectedItems.length === 1 && (
            <>
              <Separator />
              <KeyframeGraphSection items={selectedItems} />
            </>
          )}
        </TabsContent>

        {/* Media Tab - Type-specific sections */}
        <TabsContent value="media" className="space-y-4 mt-3">
          {/* Text - only for text items */}
          {hasTextItems && (
            <>
              <TextSection items={selectedItems} />
              {(hasShapeItems || hasVideoItems || hasGifItems || hasAudioItems) && <Separator />}
            </>
          )}

          {/* Shape - only for shape items */}
          {hasShapeItems && (
            <>
              <ShapeSection items={selectedItems} />
              {(hasVideoItems || hasGifItems || hasAudioItems) && <Separator />}
            </>
          )}

          {/* Video - only for video items */}
          {hasVideoItems && (
            <>
              <VideoSection items={selectedItems} />
              {(hasGifItems || hasAudioItems) && <Separator />}
            </>
          )}

          {/* GIF - only for animated GIF items */}
          {hasGifItems && (
            <>
              <GifSection items={selectedItems} />
              {hasAudioItems && <Separator />}
            </>
          )}

          {/* Audio - for video and audio items */}
          {hasAudioItems && <AudioSection items={selectedItems} />}
        </TabsContent>
      </Tabs>
    </div>
  );
});
