import { useMemo, useCallback, useEffect, memo } from 'react';
import { Film, Sparkles, Volume2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { useEditorStore } from '@/shared/state/editor';
import { useSelectionStore } from '@/shared/state/selection';
import { useItemsStore, useTimelineStore } from '@/features/editor/deps/timeline-store';
import { useProjectStore } from '@/features/editor/deps/projects';
import type { ClipInspectorTab } from '@/shared/state/editor';
import type { SelectionState, SelectionActions } from '@/shared/state/selection';
import type { TimelineState, TimelineActions } from '@/features/editor/deps/timeline-store';
import type { TransformProperties } from '@/types/transform';
import type { TimelineItem } from '@/types/timeline';

import { LayoutSection } from './layout-section';
import { FillSection } from './fill-section';
import { VideoSection } from './video-section';
import { GifSection } from './gif-section';
import { AudioSection } from './audio-section';
import { TextSection } from './text-section';
import { ShapeSection } from './shape-section';
import { CornerPinSection } from './corner-pin-section';
import { EffectsSection } from '@/features/editor/deps/effects-contract';

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
    hasVisualItems: types.has('video') || types.has('image') || types.has('text') || types.has('shape') || types.has('adjustment') || types.has('composition'),
    hasVideoItems: types.has('video'),
    hasGifItems,
    hasAudioItems: types.has('video') || types.has('audio'),
    hasTextItems: types.has('text'),
    hasShapeItems: types.has('shape'),
    hasAdjustmentItems: types.has('adjustment'),
    isOnlyTextOrShape: items.length > 0 && items.every(
      item => item.type === 'text' || item.type === 'shape'
    ),
  };
}

/**
 * Clip properties panel - shown when one or more clips are selected.
 * Displays and allows editing of clip visual, audio, and effect properties.
 * Memoized to prevent re-renders when props haven't changed.
 */
export const ClipPanel = memo(function ClipPanel() {
  // Granular selectors with explicit types
  const clipInspectorTab = useEditorStore((s) => s.clipInspectorTab);
  const setClipInspectorTab = useEditorStore((s) => s.setClipInspectorTab);
  const selectedItemIds = useSelectionStore((s: SelectionState & SelectionActions) => s.selectedItemIds);
  const updateItemsTransform = useTimelineStore((s: TimelineState & TimelineActions) => s.updateItemsTransform);
  const projectWidth = useProjectStore((s) => s.currentProject?.metadata.width ?? 1920);
  const projectHeight = useProjectStore((s) => s.currentProject?.metadata.height ?? 1080);
  const projectFps = useProjectStore((s) => s.currentProject?.metadata.fps ?? 30);
  const selectedItems = useItemsStore(
    useShallow(
      useCallback((s) => {
        const items: TimelineItem[] = [];

        for (const itemId of selectedItemIds) {
          const item = s.itemById[itemId];
          if (item) {
            items.push(item);
          }
        }

        return items;
      }, [selectedItemIds])
    )
  );

  // Canvas settings
  const canvas = useMemo(
    () => ({
      width: projectWidth,
      height: projectHeight,
      fps: projectFps,
    }),
    [projectFps, projectHeight, projectWidth]
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

  // Determine which categories should be visible
  const showVideoTab = layoutFillItems.length > 0;
  const showAudioTab = hasAudioItems;
  const showEffectsTab = hasVisualItems;

  const availableTabs = useMemo(() => {
    const tabs: ClipInspectorTab[] = [];
    if (showVideoTab) tabs.push('video');
    if (showAudioTab) tabs.push('audio');
    if (showEffectsTab) tabs.push('effects');
    return tabs;
  }, [showAudioTab, showEffectsTab, showVideoTab]);

  const fallbackTab = availableTabs[0] ?? 'video';
  const activeTab = availableTabs.includes(clipInspectorTab) ? clipInspectorTab : fallbackTab;

  useEffect(() => {
    if (selectedItems.length === 0) return;
    if (clipInspectorTab !== activeTab) {
      setClipInspectorTab(activeTab);
    }
  }, [activeTab, clipInspectorTab, selectedItems.length, setClipInspectorTab]);

  const handleTabChange = useCallback((value: string) => {
    setClipInspectorTab(value as ClipInspectorTab);
  }, [setClipInspectorTab]);

  if (selectedItems.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {/* Tabbed sections */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid w-full grid-cols-3 h-8">
          <TabsTrigger
            value="video"
            disabled={!showVideoTab}
            className="text-xs gap-1 px-2"
          >
            <Film className="h-3 w-3" />
            Video
          </TabsTrigger>
          <TabsTrigger
            value="audio"
            disabled={!showAudioTab}
            className="text-xs gap-1 px-2"
          >
            <Volume2 className="h-3 w-3" />
            Audio
          </TabsTrigger>
          <TabsTrigger
            value="effects"
            disabled={!showEffectsTab}
            className="text-xs gap-1 px-2"
          >
            <Sparkles className="h-3 w-3" />
            Effects
          </TabsTrigger>
        </TabsList>

        {/* Video Tab - visual layout, content, and clip-specific controls */}
        <TabsContent value="video" className="mt-3">
          {showVideoTab && (
            <div className="divide-y divide-border [&>*]:py-4 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
              {showVideoTab && (
                <LayoutSection
                  items={layoutFillItems}
                  canvas={canvas}
                  onTransformChange={handleTransformChange}
                  aspectLocked={aspectLocked}
                  onAspectLockToggle={handleAspectLockToggle}
                />
              )}
              {hasVideoItems && <VideoSection items={selectedItems} />}
              {showVideoTab && (
                <FillSection
                  items={layoutFillItems}
                  canvas={canvas}
                  onTransformChange={handleTransformChange}
                />
              )}
              {showVideoTab && (
                <CornerPinSection items={layoutFillItems} />
              )}
              {hasTextItems && (
                <TextSection
                  items={selectedItems}
                  canvas={canvas}
                  showEffectSection={false}
                  showAnimationSection={false}
                />
              )}
              {hasShapeItems && <ShapeSection items={selectedItems} />}
              {hasGifItems && <GifSection items={selectedItems} />}
            </div>
          )}
        </TabsContent>

        {/* Audio Tab - gain and fades */}
        <TabsContent value="audio" className="space-y-4 mt-3">
          {hasAudioItems && <AudioSection items={selectedItems} />}
        </TabsContent>

        {/* Effects Tab - clip effects plus text styling and animation */}
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
              {hasTextItems && <Separator />}
              {hasTextItems && (
                <TextSection
                  items={selectedItems}
                  canvas={canvas}
                  showContentSection={false}
                />
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
});
