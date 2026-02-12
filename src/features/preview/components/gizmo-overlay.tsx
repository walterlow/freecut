import { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
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
import { MarqueeOverlay } from '@/components/marquee-overlay';
import { useAnimatedTransforms } from '@/features/keyframes/hooks/use-animated-transform';
import { autoKeyframeProperty, GIZMO_ANIMATABLE_PROPS } from '@/features/keyframes/utils/auto-keyframe';
import type { AnimatableProperty } from '@/types/keyframe';
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

  // Create Set for O(1) lookups instead of O(n) includes()
  const selectedItemIdsSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds]);

  // Timeline state and actions - use derived selector for visual items only
  // This avoids re-renders when audio items change (audio has no gizmo overlay)
  // useShallow prevents infinite loops from array reference changes
  const visualItems = useTimelineStore(
    useShallow((s) =>
      s.items.filter((item) => item.type !== 'audio' && item.type !== 'adjustment')
    )
  );
  const tracks = useTimelineStore((s) => s.tracks);
  const keyframes = useTimelineStore((s) => s.keyframes);
  const updateItemTransform = useTimelineStore((s) => s.updateItemTransform);
  const updateItemsTransformMap = useTimelineStore((s) => s.updateItemsTransformMap);
  const addKeyframe = useTimelineStore((s) => s.addKeyframe);
  const updateKeyframe = useTimelineStore((s) => s.updateKeyframe);

  // Ref to track if we just finished a drag (to prevent background click from deselecting)
  const justFinishedDragRef = useRef(false);

  // Playback state - only subscribe to isPlaying to avoid re-renders during playback
  // Read currentFrame directly from store when needed (not during playback)
  const isPlaying = usePlaybackStore((s) => s.isPlaying);

  // Track the "frozen" frame when playback starts - gizmos stay at this frame during playback
  // This prevents re-renders during playback while maintaining accuracy when paused
  const frozenFrameRef = useRef<number>(usePlaybackStore.getState().currentFrame);

  // Update frozen frame when playback stops or when paused and frame changes
  useEffect(() => {
    if (!isPlaying) {
      // When paused, sync to current frame
      frozenFrameRef.current = usePlaybackStore.getState().currentFrame;
    }
  }, [isPlaying]);

  // Subscribe to frame changes - always update when paused, or at clip boundaries during playback
  // NOTE: Reads items on-demand inside subscribe callback to avoid re-rendering on items change
  useEffect(() => {
    let prevFrame = usePlaybackStore.getState().currentFrame;

    return usePlaybackStore.subscribe((state, prevState) => {
      const currentFrame = state.currentFrame;

      if (!state.isPlaying) {
        // When paused, always update on frame change
        if (currentFrame !== prevState.currentFrame) {
          frozenFrameRef.current = currentFrame;
          setForceUpdate((n) => n + 1);
        }
      } else {
        // During playback, only update when crossing a clip boundary
        // Read items on-demand for fresh clip edges (avoids re-subscribing on items change)
        const currentItems = useTimelineStore.getState().items;
        const minFrame = Math.min(prevFrame, currentFrame);
        const maxFrame = Math.max(prevFrame, currentFrame);

        for (const item of currentItems) {
          const start = item.from;
          const end = item.from + item.durationInFrames;
          // Check if we crossed this item's start or end
          if ((start > minFrame && start <= maxFrame) || (end > minFrame && end <= maxFrame)) {
            // Crossed a clip boundary - update frozen frame
            frozenFrameRef.current = currentFrame;
            setForceUpdate((n) => n + 1);
            break;
          }
        }
      }

      prevFrame = currentFrame;
    });
  }, []); // No dependencies - reads items on-demand

  // Force update state to trigger re-render and useMemo recalculation when frame changes while paused
  const [frameUpdateKey, setForceUpdate] = useState(0);

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

  // Get visual items visible at current frame (excluding hidden tracks and locked tracks)
  // Sorted by track order: items on top tracks (lower order) come LAST for proper stacking/click priority
  // Uses frozenFrameRef to avoid re-renders during playback - only updates when paused
  const visibleItems = useMemo(() => {
    // Read the frozen frame (updated via effect when paused)
    const frame = frozenFrameRef.current;

    // Create maps for track properties
    const trackVisible = new Map<string, boolean>();
    const trackLocked = new Map<string, boolean>();
    const trackOrder = new Map<string, number>();
    for (const track of tracks) {
      trackVisible.set(track.id, track.visible);
      trackLocked.set(track.id, track.locked);
      trackOrder.set(track.id, track.order);
    }

    // visualItems already excludes audio and adjustment (filtered in selector)
    return visualItems
      .filter((item) => {
        // Check if item's track is visible
        if (!trackVisible.get(item.trackId)) return false;
        // Check if item's track is locked (locked items can't be selected)
        if (trackLocked.get(item.trackId)) return false;
        // Check if item is visible at current frame
        const itemEnd = item.from + item.durationInFrames;
        return frame >= item.from && frame < itemEnd;
      })
      // Sort by track order descending: higher order (bottom tracks) first, lower order (top tracks) last
      // This ensures top track items render last (on top) and get click priority (toSorted for immutability)
      .toSorted((a, b) => (trackOrder.get(b.trackId) ?? 0) - (trackOrder.get(a.trackId) ?? 0));
  }, [visualItems, tracks, isPlaying, frameUpdateKey]);

  // Get selected items (use Set for O(1) lookups)
  const selectedItems = useMemo(() => {
    return visibleItems.filter((item) => selectedItemIdsSet.has(item.id));
  }, [visibleItems, selectedItemIdsSet]);

  // Get unselected visible items (for click-to-select, use Set for O(1) lookups)
  const unselectedItems = useMemo(() => {
    return visibleItems.filter((item) => !selectedItemIdsSet.has(item.id));
  }, [visibleItems, selectedItemIdsSet]);

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

  // Get animated transforms for all visible items using centralized hook
  const animatedTransformsMap = useAnimatedTransforms(visibleItems, projectSize);

  // Create marquee items with pre-computed bounding rects for collision detection
  // Rects are calculated once when items/coords change, not on every mouse move
  const marqueeItems = useMemo(() => {
    if (!coordParams || !containerRect) return [];
    return visibleItems.map((item) => {
      // Get pre-computed animated transform from the hook
      const resolved = animatedTransformsMap.get(item.id);
      if (!resolved) return { id: item.id, getBoundingRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }) };

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
  }, [visibleItems, coordParams, containerRect, animatedTransformsMap]);

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

  // Handle transform end - commit the transform to the timeline with auto-keyframing
  const handleTransformEnd = useCallback(
    (itemId: string, transform: Transform) => {
      const currentFrame = usePlaybackStore.getState().currentFrame;
      const item = visualItems.find((i) => i.id === itemId);
      if (!item) return;

      const itemKeyframes = keyframes.find((k) => k.itemId === itemId);

      // Map of property to value for gizmo-animatable properties
      const propValues: Record<AnimatableProperty, number> = {
        x: transform.x,
        y: transform.y,
        width: transform.width,
        height: transform.height,
        rotation: transform.rotation,
        opacity: transform.opacity,
        cornerRadius: transform.cornerRadius ?? 0,
      };

      // Track which properties were auto-keyframed
      const autoKeyframedProps = new Set<AnimatableProperty>();

      // Auto-keyframe properties that have existing keyframes
      for (const prop of GIZMO_ANIMATABLE_PROPS) {
        const wasAutoKeyframed = autoKeyframeProperty(
          item,
          itemKeyframes,
          prop,
          propValues[prop],
          currentFrame,
          addKeyframe,
          updateKeyframe
        );
        if (wasAutoKeyframed) {
          autoKeyframedProps.add(prop);
        }
      }

      // Update base transform only for non-keyframed properties
      const transformProps: Partial<TransformProperties> = {};
      if (!autoKeyframedProps.has('x')) transformProps.x = transform.x;
      if (!autoKeyframedProps.has('y')) transformProps.y = transform.y;
      if (!autoKeyframedProps.has('width')) transformProps.width = transform.width;
      if (!autoKeyframedProps.has('height')) transformProps.height = transform.height;
      if (!autoKeyframedProps.has('rotation')) transformProps.rotation = transform.rotation;
      // Always update cornerRadius (not keyframeable via gizmo)
      transformProps.cornerRadius = transform.cornerRadius;

      // Only call updateItemTransform if there are non-keyframed properties to update
      if (Object.keys(transformProps).length > 1 || !autoKeyframedProps.size) {
        updateItemTransform(itemId, transformProps);
      }

      // Prevent background click from deselecting after drag
      justFinishedDragRef.current = true;
      setTimeout(() => {
        justFinishedDragRef.current = false;
      }, 100);
    },
    [visualItems, keyframes, updateItemTransform, addKeyframe, updateKeyframe]
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
      // Use setTimeout instead of requestAnimationFrame because click events
      // may fire after the next animation frame
      justFinishedDragRef.current = true;
      setTimeout(() => {
        justFinishedDragRef.current = false;
      }, 100);
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
      const isSelected = selectedItemIdsSet.has(itemId);
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
    [selectItems, selectedItemIds, selectedItemIdsSet]
  );

  // Helper to find all items at a canvas point (for context menu)
  const findAllItemsAtPoint = useCallback(
    (canvasPoint: Point): TimelineItem[] => {
      const canvasCenterX = projectSize.width / 2;
      const canvasCenterY = projectSize.height / 2;
      const result: TimelineItem[] = [];

      for (const item of visibleItems) {
        // Get animated transform from the pre-computed map
        const resolved = animatedTransformsMap.get(item.id);
        if (!resolved) continue;

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
    [visibleItems, projectSize, animatedTransformsMap]
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
        selectItems([itemsAtPoint[0]!.id]);
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
        updateInteraction(movePoint, moveEvent.shiftKey, moveEvent.ctrlKey);
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
      <MarqueeOverlay marqueeState={marqueeState} />

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
            isPlaying={isPlaying}
          />
        ) : selectedItems.length > 1 ? (
          <GroupGizmo
            items={selectedItems}
            coordParams={coordParams}
            onTransformStart={handleTransformStart}
            onTransformEnd={handleGroupTransformEnd}
            onItemClick={(itemId) => selectItems([itemId])}
            isPlaying={isPlaying}
          />
        ) : null}

        {/* Snap guides shown during drag */}
        <SnapGuides snapLines={snapLines} coordParams={coordParams} />
      </div>

      {/* Context menu for selecting from overlapping items - rendered via portal to ensure it's above all other elements */}
      {contextMenu &&
        createPortal(
          <div
            className="fixed z-[9999] bg-popover border border-border rounded-md shadow-lg py-1 min-w-[160px]"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2 py-1.5 text-xs text-muted-foreground border-b border-border mb-1">
              Select Layer
            </div>
            {contextMenu.items.map((item, index) => {
              const track = tracks.find((t) => t.id === item.trackId);
              const trackName = track?.name ?? `Track ${index + 1}`;
              const itemName = item.label || `${item.type} clip`;

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
          </div>,
          document.body
        )}
    </div>
  );
}
