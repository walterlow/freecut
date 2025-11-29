import { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useGizmoStore } from '../stores/gizmo-store';
import { TransformGizmo } from './transform-gizmo';
import { GroupGizmo } from './group-gizmo';
import { SelectableItem } from './selectable-item';
import { SnapGuides } from './snap-guides';
import { screenToCanvas, transformToScreenBounds } from '../utils/coordinate-transform';
import { useMarqueeSelection, isMarqueeJustFinished, type Rect } from '@/hooks/use-marquee-selection';
import { resolveTransform, getSourceDimensions } from '@/lib/remotion/utils/transform-resolver';
import type { CoordinateParams, Transform, Point } from '../types/gizmo';
import type { TransformProperties } from '@/types/transform';
import type { TimelineItem } from '@/types/timeline';

interface GizmoOverlayProps {
  containerRect: DOMRect | null;
  playerSize: { width: number; height: number };
  projectSize: { width: number; height: number };
  zoom: number;
  /** Ref to the hit area element for marquee bounds checking */
  hitAreaRef?: React.RefObject<HTMLDivElement>;
  /** Padding around player for marquee display when starting from outside */
  overlayPadding?: number;
}

/**
 * Overlay that renders transform gizmos for selected items
 * and clickable hit areas for all visible items.
 * Positioned absolutely over the video player.
 */
export function GizmoOverlay({
  containerRect,
  playerSize,
  projectSize,
  zoom,
  hitAreaRef,
  overlayPadding = 100,
}: GizmoOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Context menu state for selecting from overlapping items
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: TimelineItem[];
  } | null>(null);

  // Selection state
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);
  const selectItems = useSelectionStore((s) => s.selectItems);

  // Timeline state and actions
  const items = useTimelineStore((s) => s.items);
  const tracks = useTimelineStore((s) => s.tracks);
  const updateItemTransform = useTimelineStore((s) => s.updateItemTransform);
  const updateItemsTransformMap = useTimelineStore((s) => s.updateItemsTransformMap);

  // Ref to track if we just finished a drag (to prevent background click from deselecting)
  const justFinishedDragRef = useRef(false);

  // Playback state - get current frame to determine visible items
  const currentFrame = usePlaybackStore((s) => s.currentFrame);

  // Gizmo store
  const setCanvasSize = useGizmoStore((s) => s.setCanvasSize);
  const snapLines = useGizmoStore((s) => s.snapLines);
  const startTranslate = useGizmoStore((s) => s.startTranslate);
  const updateInteraction = useGizmoStore((s) => s.updateInteraction);
  const endInteraction = useGizmoStore((s) => s.endInteraction);
  const clearInteraction = useGizmoStore((s) => s.clearInteraction);

  // Update canvas size in gizmo store when project size changes
  useEffect(() => {
    setCanvasSize(projectSize.width, projectSize.height);
  }, [projectSize.width, projectSize.height, setCanvasSize]);

  // Get visual items visible at current frame (excluding audio, hidden tracks, and locked tracks)
  // Sorted by track order: items on top tracks (lower order) come LAST for proper stacking/click priority
  const visibleItems = useMemo(() => {
    // Create maps for track properties
    const trackVisible = new Map<string, boolean>();
    const trackLocked = new Map<string, boolean>();
    const trackOrder = new Map<string, number>();
    for (const track of tracks) {
      trackVisible.set(track.id, track.visible);
      trackLocked.set(track.id, track.locked);
      trackOrder.set(track.id, track.order);
    }

    return items
      .filter((item) => {
        // Only visual items (not audio)
        if (item.type === 'audio') return false;
        // Check if item's track is visible
        if (!trackVisible.get(item.trackId)) return false;
        // Check if item's track is locked (locked items can't be selected)
        if (trackLocked.get(item.trackId)) return false;
        // Check if item is visible at current frame
        const itemEnd = item.from + item.durationInFrames;
        return currentFrame >= item.from && currentFrame < itemEnd;
      })
      // Sort by track order descending: higher order (bottom tracks) first, lower order (top tracks) last
      // This ensures top track items render last (on top) and get click priority
      .sort((a, b) => (trackOrder.get(b.trackId) ?? 0) - (trackOrder.get(a.trackId) ?? 0));
  }, [items, tracks, currentFrame]);

  // Get selected items
  const selectedItems = useMemo(() => {
    return visibleItems.filter((item) => selectedItemIds.includes(item.id));
  }, [visibleItems, selectedItemIds]);

  // Get unselected visible items (for click-to-select)
  const unselectedItems = useMemo(() => {
    return visibleItems.filter((item) => !selectedItemIds.includes(item.id));
  }, [visibleItems, selectedItemIds]);

  // Coordinate params for gizmo positioning
  const coordParams: CoordinateParams | null = useMemo(() => {
    if (!containerRect) return null;

    return {
      containerRect,
      playerSize,
      projectSize,
      zoom,
    };
  }, [containerRect, playerSize, projectSize, zoom]);


  // Create marquee items with pre-computed bounding rects for collision detection
  // Rects are calculated once when items/coords change, not on every mouse move
  const marqueeItems = useMemo(() => {
    if (!coordParams || !containerRect) return [];
    return visibleItems.map((item) => {
      // Pre-compute the bounding rect
      const sourceDims = getSourceDimensions(item);
      const resolved = resolveTransform(item, { ...projectSize, fps: 30 }, sourceDims);
      const screenBounds = transformToScreenBounds(
        {
          x: resolved.x,
          y: resolved.y,
          width: resolved.width,
          height: resolved.height,
          rotation: resolved.rotation,
          opacity: resolved.opacity,
          cornerRadius: resolved.cornerRadius,
        },
        coordParams
      );
      const rect: Rect = {
        left: containerRect.left + screenBounds.left,
        top: containerRect.top + screenBounds.top,
        right: containerRect.left + screenBounds.left + screenBounds.width,
        bottom: containerRect.top + screenBounds.top + screenBounds.height,
        width: screenBounds.width,
        height: screenBounds.height,
      };
      return {
        id: item.id,
        getBoundingRect: () => rect,
      };
    });
  }, [visibleItems, coordParams, projectSize, containerRect]);

  // Marquee selection hook
  // Use hitAreaRef for bounds checking (fills container), overlayRef for coordinate display
  const { marqueeState } = useMarqueeSelection({
    containerRef: overlayRef as React.RefObject<HTMLElement>,
    hitAreaRef: hitAreaRef as React.RefObject<HTMLElement> | undefined,
    items: marqueeItems,
    onSelectionChange: useCallback(
      (ids: string[]) => {
        selectItems(ids);
      },
      [selectItems]
    ),
    enabled: true,
    threshold: 5,
  });


  // Handle transform start - nothing needed, gizmo store handles it
  const handleTransformStart = useCallback(() => {
    // Optionally: could pause playback here
  }, []);

  // Handle transform end - commit the transform to the timeline
  const handleTransformEnd = useCallback(
    (itemId: string, transform: Transform) => {
      // Convert gizmo transform to TransformProperties
      // Include cornerRadius to preserve it during transform operations
      const transformProps: Partial<TransformProperties> = {
        x: transform.x,
        y: transform.y,
        width: transform.width,
        height: transform.height,
        rotation: transform.rotation,
        opacity: transform.opacity,
        cornerRadius: transform.cornerRadius,
      };

      updateItemTransform(itemId, transformProps);

      // Prevent background click from deselecting after drag
      justFinishedDragRef.current = true;
      requestAnimationFrame(() => {
        justFinishedDragRef.current = false;
      });
    },
    [updateItemTransform]
  );

  // Handle group transform end - commit transforms for all items as a single undo operation
  const handleGroupTransformEnd = useCallback(
    (transforms: Map<string, Transform>) => {
      // Convert Transform to TransformProperties for the batch update
      const transformsMap = new Map<string, Partial<TransformProperties>>();
      for (const [itemId, transform] of transforms) {
        transformsMap.set(itemId, {
          x: transform.x,
          y: transform.y,
          width: transform.width,
          height: transform.height,
          rotation: transform.rotation,
          opacity: transform.opacity,
          cornerRadius: transform.cornerRadius,
        });
      }
      // Use batch update for single undo operation
      updateItemsTransformMap(transformsMap);

      // Prevent background click from deselecting after drag
      justFinishedDragRef.current = true;
      requestAnimationFrame(() => {
        justFinishedDragRef.current = false;
      });
    },
    [updateItemsTransformMap]
  );

  // Handle click on overlay background to deselect
  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't deselect if we just finished a drag or marquee operation
      if (justFinishedDragRef.current || isMarqueeJustFinished()) {
        return;
      }
      // Don't clear if clicking on gizmo elements
      const target = e.target as HTMLElement;
      if (target.closest('[data-gizmo]')) return;

      // Stop propagation so video-preview doesn't also clear
      e.stopPropagation();
      useSelectionStore.getState().clearItemSelection();
    },
    []
  );

  // Handle clicking an item to select it
  // For unselected items: select that item (or add to selection with shift)
  // For selected items in a group: select just that item (break group selection)
  const handleItemClick = useCallback(
    (itemId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const isSelected = selectedItemIds.includes(itemId);
      const isGroupSelection = selectedItemIds.length > 1;

      if (e.shiftKey) {
        // Shift+click: toggle in selection
        if (isSelected) {
          selectItems(selectedItemIds.filter((id) => id !== itemId));
        } else {
          selectItems([...selectedItemIds, itemId]);
        }
      } else if (isSelected && isGroupSelection) {
        // Clicking on a selected item in a group: select just that item
        selectItems([itemId]);
      } else if (!isSelected) {
        // Clicking on an unselected item: select it
        selectItems([itemId]);
      }
      // If single selected item is clicked again, do nothing (keeps selection)
    },
    [selectItems, selectedItemIds]
  );

  // Helper to find all items at a canvas point (for context menu)
  const findAllItemsAtPoint = useCallback(
    (canvasPoint: Point): TimelineItem[] => {
      const canvasCenterX = projectSize.width / 2;
      const canvasCenterY = projectSize.height / 2;
      const result: TimelineItem[] = [];

      for (const item of visibleItems) {
        const sourceDims = getSourceDimensions(item);
        const resolved = resolveTransform(item, { ...projectSize, fps: 30 }, sourceDims);

        // Convert transform position to absolute canvas coordinates
        const itemCenterX = canvasCenterX + resolved.x;
        const itemCenterY = canvasCenterY + resolved.y;

        // AABB check
        const left = itemCenterX - resolved.width / 2;
        const right = itemCenterX + resolved.width / 2;
        const top = itemCenterY - resolved.height / 2;
        const bottom = itemCenterY + resolved.height / 2;

        if (
          canvasPoint.x >= left &&
          canvasPoint.x <= right &&
          canvasPoint.y >= top &&
          canvasPoint.y <= bottom
        ) {
          result.push(item);
        }
      }

      return result;
    },
    [visibleItems, projectSize]
  );

  // Handle right-click to show context menu for overlapping items
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!coordParams) return;

      e.preventDefault();
      e.stopPropagation();

      const canvasPoint = screenToCanvas(e.clientX, e.clientY, coordParams);
      const itemsAtPoint = findAllItemsAtPoint(canvasPoint);

      // Only show menu if there are multiple overlapping items
      if (itemsAtPoint.length > 1) {
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          items: itemsAtPoint,
        });
      } else if (itemsAtPoint.length === 1) {
        // Single item: just select it
        selectItems([itemsAtPoint[0].id]);
      }
    },
    [coordParams, findAllItemsAtPoint, selectItems]
  );

  // Handle selecting an item from context menu
  const handleContextMenuSelect = useCallback(
    (itemId: string) => {
      selectItems([itemId]);
      setContextMenu(null);
    },
    [selectItems]
  );

  // Close context menu when clicking elsewhere
  useEffect(() => {
    if (!contextMenu) return;

    const handleClickOutside = () => setContextMenu(null);
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('contextmenu', handleClickOutside);

    return () => {
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('contextmenu', handleClickOutside);
    };
  }, [contextMenu]);

  // Check if transform actually changed (within tolerance)
  const transformChanged = useCallback((a: Transform, b: Transform): boolean => {
    const tolerance = 0.01;
    return (
      Math.abs(a.x - b.x) > tolerance ||
      Math.abs(a.y - b.y) > tolerance ||
      Math.abs(a.width - b.width) > tolerance ||
      Math.abs(a.height - b.height) > tolerance ||
      Math.abs(a.rotation - b.rotation) > tolerance
    );
  }, []);

  // Handle drag start from SelectableItem - select and start dragging in one motion
  const handleItemDragStart = useCallback(
    (itemId: string, e: React.MouseEvent, transform: Transform) => {
      if (!coordParams) return;

      const startTransformSnapshot = { ...transform };
      const point = screenToCanvas(e.clientX, e.clientY, coordParams);

      startTranslate(itemId, point, transform);
      document.body.style.cursor = 'move';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const movePoint = screenToCanvas(moveEvent.clientX, moveEvent.clientY, coordParams);
        updateInteraction(movePoint, moveEvent.shiftKey);
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';

        const finalTransform = endInteraction();
        if (finalTransform && transformChanged(startTransformSnapshot, finalTransform)) {
          handleTransformEnd(itemId, finalTransform);
        }
        requestAnimationFrame(() => {
          clearInteraction();
        });
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [coordParams, startTranslate, updateInteraction, endInteraction, clearInteraction, handleTransformEnd, transformChanged]
  );

  // Don't render if no coordinate params (container not measured yet)
  if (!coordParams) {
    return null;
  }

  // Note: We render even with no visible items so users can still interact
  // with the canvas (e.g., marquee selection area is ready when items appear)

  return (
    <div
      ref={overlayRef}
      className="absolute z-10"
      style={{
        top: -overlayPadding,
        left: -overlayPadding,
        width: playerSize.width + overlayPadding * 2,
        height: playerSize.height + overlayPadding * 2,
        pointerEvents: 'none',
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* Marquee selection rectangle */}
      {marqueeState.active && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: Math.min(marqueeState.startX, marqueeState.currentX),
            top: Math.min(marqueeState.startY, marqueeState.currentY),
            width: Math.abs(marqueeState.currentX - marqueeState.startX),
            height: Math.abs(marqueeState.currentY - marqueeState.startY),
            border: '1px dashed #f97316',
            backgroundColor: 'rgba(249, 115, 22, 0.1)',
          }}
        />
      )}

      {/* Player area - receives clicks for deselection and contains gizmos */}
      <div
        className="absolute"
        style={{
          top: overlayPadding,
          left: overlayPadding,
          width: playerSize.width,
          height: playerSize.height,
          pointerEvents: 'auto',
        }}
        onClick={handleBackgroundClick}
        onContextMenu={handleContextMenu}
      >
        {/* Clickable areas for UNSELECTED visible items */}
        {/* Selected items are handled by their respective gizmos (TransformGizmo or GroupGizmo) */}
        {unselectedItems.map((item) => (
          <SelectableItem
            key={item.id}
            item={item}
            coordParams={coordParams}
            onSelect={(e) => handleItemClick(item.id, e)}
            onDragStart={(e, transform) => handleItemDragStart(item.id, e, transform)}
          />
        ))}

        {/* Transform gizmo(s) for selected items - single or group */}
        {selectedItems.length === 1 && selectedItems[0] ? (
          <TransformGizmo
            item={selectedItems[0]}
            coordParams={coordParams}
            onTransformStart={handleTransformStart}
            onTransformEnd={(transform) => handleTransformEnd(selectedItems[0]!.id, transform)}
          />
        ) : selectedItems.length > 1 ? (
          <GroupGizmo
            items={selectedItems}
            coordParams={coordParams}
            onTransformStart={handleTransformStart}
            onTransformEnd={handleGroupTransformEnd}
            onItemClick={(itemId) => selectItems([itemId])}
          />
        ) : null}

        {/* Snap guides shown during drag */}
        <SnapGuides snapLines={snapLines} coordParams={coordParams} />
      </div>

      {/* Context menu for selecting from overlapping items */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[160px]"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            pointerEvents: 'auto',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1.5 text-xs text-muted-foreground border-b border-border mb-1">
            Select Layer
          </div>
          {contextMenu.items.map((item, index) => {
            const track = tracks.find((t) => t.id === item.trackId);
            const trackName = track?.name ?? `Track ${index + 1}`;
            const itemName = item.name || `${item.type} clip`;

            return (
              <button
                key={item.id}
                className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
                onClick={() => handleContextMenuSelect(item.id)}
              >
                <span className="text-muted-foreground text-xs">{trackName}:</span>
                <span className="truncate">{itemName}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
