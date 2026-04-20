import { memo, useCallback, useMemo, useState, useRef, useEffect } from 'react';
import type { Transition } from '@/types/transition';
import { useShallow } from 'zustand/react/shallow';
import { useTimelineStore } from '../stores/timeline-store';
import { useItemsStore } from '../stores/items-store';
import { useRollingEditPreviewStore } from '../stores/rolling-edit-preview-store';
import { useRippleEditPreviewStore } from '../stores/ripple-edit-preview-store';
import { useSlideEditPreviewStore } from '../stores/slide-edit-preview-store';
import { useTransitionBreakPreviewStore } from '../stores/transition-break-preview-store';
import { useTrackPushPreviewStore } from '../stores/track-push-preview-store';
import { useSelectionStore } from '@/shared/state/selection';
import {
  TRANSITION_DRAG_MIME,
  useTransitionDragStore,
  type DraggedTransitionDescriptor,
} from '@/shared/state/transition-drag';
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context';
import { useTransitionResize } from '../hooks/use-transition-resize';
import { dragOffsetRef } from '../hooks/use-timeline-drag';
import type { TimelineState, TimelineActions } from '../types';
import type { SelectionState, SelectionActions } from '@/shared/state/selection';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/shared/ui/cn';
import { EDITOR_LAYOUT_CSS_VALUES } from '@/app/editor-layout';
import { Trash2 } from 'lucide-react';
import {
  applyPreviewGeometryToClip,
  getTransitionBridgeBounds,
} from '../utils/transition-preview-geometry';
import { useLinkedEditPreviewStore } from '../stores/linked-edit-preview-store';

interface TransitionItemProps {
  transition: Transition;
  trackHidden?: boolean;
}

/**
 * Transition Item Component
 *
 * Renders a cut-centered transition bridge overlay between adjacent clips.
 * The clips keep their full visual width under the bridge, similar to DaVinci.
 */
const BRIDGE_SELECT_SIDE_INSET = 6;
const CUT_PASS_THROUGH_ZONE = 24;

function readDraggedTransitionDescriptor(event: React.DragEvent): DraggedTransitionDescriptor | null {
  const cached = useTransitionDragStore.getState().draggedTransition;
  if (cached) return cached;

  const raw = event.dataTransfer.getData(TRANSITION_DRAG_MIME);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<DraggedTransitionDescriptor>;
    if (typeof parsed.presentation !== 'string') return null;
    return {
      presentation: parsed.presentation,
      direction: parsed.direction,
    };
  } catch {
    return null;
  }
}

export const TransitionItem = memo(function TransitionItem({
  transition,
  trackHidden = false,
}: TransitionItemProps) {
  const { frameToPixels } = useTimelineZoomContext();
  const fps = useTimelineStore((s: TimelineState) => s.fps);
  const removeTransition = useTimelineStore(
    (s: TimelineActions) => s.removeTransition
  );
  const updateTransition = useTimelineStore(
    (s: TimelineActions) => s.updateTransition
  );

  // Get the clips involved in this transition
  const leftClip = useItemsStore(
    useCallback((s) => s.itemById[transition.leftClipId], [transition.leftClipId])
  );
  const rightClip = useItemsStore(
    useCallback((s) => s.itemById[transition.rightClipId], [transition.rightClipId])
  );

  // Check if transition is selected
  const isSelected = useSelectionStore(
    useCallback(
      (s: SelectionState) => s.selectedTransitionId === transition.id,
      [transition.id]
    )
  );
  const selectTransition = useSelectionStore(
    (s: SelectionActions) => s.selectTransition
  );

  // Resize functionality
  const { isResizing, handleResizeStart, previewDuration } =
    useTransitionResize(transition);

  // Rolling preview (only when this transition's clips are involved)
  const rollingPreview = useRollingEditPreviewStore(
    useShallow(
      useCallback(
        (s) => {
          const touches =
            s.trimmedItemId === transition.leftClipId ||
            s.trimmedItemId === transition.rightClipId ||
            s.neighborItemId === transition.leftClipId ||
            s.neighborItemId === transition.rightClipId;

          if (!touches) {
            return {
              trimmedItemId: null as string | null,
              neighborItemId: null as string | null,
              handle: null as 'start' | 'end' | null,
              delta: 0,
            };
          }

          return {
            trimmedItemId: s.trimmedItemId,
            neighborItemId: s.neighborItemId,
            handle: s.handle,
            delta: s.neighborDelta,
          };
        },
        [transition.leftClipId, transition.rightClipId],
      ),
    ),
  );

  // Slide preview (only when this transition's clips are involved)
  const slidePreview = useSlideEditPreviewStore(
    useShallow(
      useCallback(
        (s) => {
          const touches =
            s.itemId === transition.leftClipId ||
            s.itemId === transition.rightClipId ||
            s.leftNeighborId === transition.leftClipId ||
            s.leftNeighborId === transition.rightClipId ||
            s.rightNeighborId === transition.leftClipId ||
            s.rightNeighborId === transition.rightClipId;

          if (!touches) {
            return {
              itemId: null as string | null,
              leftNeighborId: null as string | null,
              rightNeighborId: null as string | null,
              delta: 0,
            };
          }

          return {
            itemId: s.itemId,
            leftNeighborId: s.leftNeighborId,
            rightNeighborId: s.rightNeighborId,
            delta: s.slideDelta,
          };
        },
        [transition.leftClipId, transition.rightClipId],
      ),
    ),
  );

  // Ripple preview (trimmed item + downstream shifts)
  const ripplePreview = useRippleEditPreviewStore(
    useShallow(
      useCallback(
        (s) => {
          const leftDownstream = s.downstreamItemIds.has(transition.leftClipId);
          const rightDownstream = s.downstreamItemIds.has(transition.rightClipId);
          const touches =
            s.trimmedItemId === transition.leftClipId ||
            s.trimmedItemId === transition.rightClipId ||
            leftDownstream ||
            rightDownstream;

          if (!touches) {
            return {
              trimmedItemId: null as string | null,
              delta: 0,
              leftDownstream: false,
              rightDownstream: false,
            };
          }

          return {
            trimmedItemId: s.trimmedItemId,
            delta: s.delta,
            leftDownstream,
            rightDownstream,
          };
        },
        [transition.leftClipId, transition.rightClipId],
      ),
    ),
  );

  const isHiddenForBreakPreview = useTransitionBreakPreviewStore(
    useCallback((s) => (
      (s.itemId === transition.leftClipId && s.handle === 'end')
      || (s.itemId === transition.rightClipId && s.handle === 'start')
    ), [transition.leftClipId, transition.rightClipId])
  );

  // Linked edit preview (rate stretch ripple and other generic previews)
  // Extract only the geometry fields the bridge needs, with useShallow to prevent
  // re-renders when the store rebuilds objects with identical values.
  const leftLinkedEditPreview = useLinkedEditPreviewStore(
    useShallow(
      useCallback((s) => {
        const update = s.updatesById[transition.leftClipId];
        if (!update) return null;
        return { from: update.from, durationInFrames: update.durationInFrames, hidden: update.hidden };
      }, [transition.leftClipId])
    )
  );
  const rightLinkedEditPreview = useLinkedEditPreviewStore(
    useShallow(
      useCallback((s) => {
        const update = s.updatesById[transition.rightClipId];
        if (!update) return null;
        return { from: update.from, durationInFrames: update.durationInFrames, hidden: update.hidden };
      }, [transition.rightClipId])
    )
  );

  // Track push preview: only subscribe to delta when this clip is shifted.
  // Return undefined for non-shifted clips so they skip re-renders entirely.
  const trackPushLeft = useTrackPushPreviewStore(
    useShallow(
      useCallback((s) => (
        s.shiftedItemIds.has(transition.leftClipId)
          ? { delta: s.delta, isShifted: true as const }
          : undefined
      ), [transition.leftClipId])
    )
  );
  const trackPushRight = useTrackPushPreviewStore(
    useShallow(
      useCallback((s) => (
        s.shiftedItemIds.has(transition.rightClipId)
          ? { delta: s.delta, isShifted: true as const }
          : undefined
      ), [transition.rightClipId])
    )
  );

  // Track hovered edge for showing resize handles
  const [hoveredEdge, setHoveredEdge] = useState<'left' | 'right' | null>(null);

  // Ref for applying drag offset when both clips are being dragged
  const containerRef = useRef<HTMLDivElement>(null);
  const rafIdRef = useRef<number | null>(null);
  const bothClipsDragged = useSelectionStore(
    useCallback((state: SelectionState) => {
      if (!state.dragState?.isDragging) {
        return false;
      }

      const draggedItemIdSet = state.dragState.draggedItemIdSet ?? new Set(state.dragState.draggedItemIds);
      return draggedItemIdSet.has(transition.leftClipId) && draggedItemIdSet.has(transition.rightClipId);
    }, [transition.leftClipId, transition.rightClipId])
  );
  /*
   * This effect subscribes to a boolean derived from selection state instead
   * of the full drag payload. Per-frame movement still comes directly from
   * dragOffsetRef in RAF so the bridge follows both clips without waking
   * every transition instance on each selection-store drag UI churn.
   */

  useEffect(() => {
    const updateDragOffset = () => {
      if (!containerRef.current) return;
      const offset = dragOffsetRef.current;
      containerRef.current.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
      rafIdRef.current = requestAnimationFrame(updateDragOffset);
    };

    if (!bothClipsDragged) {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (containerRef.current) {
        containerRef.current.style.transform = '';
      }
      return;
    }

    rafIdRef.current = requestAnimationFrame(updateDragOffset);

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (containerRef.current) {
        containerRef.current.style.transform = '';
      }
    };
  }, [bothClipsDragged]);
  // Calculate position and size for the transition indicator.
  // The bridge covers the actual overlap region: from (leftEnd - duration) to leftEnd.
  // The right edge is anchored at leftEnd (the left clip's end); the left edge moves
  // as the duration changes. The left handle tracks the cursor 1:1.
  const effectiveLeftClip = useMemo(() => {
    if (!leftClip) return null;
    if (leftLinkedEditPreview?.hidden) return null;
    return applyPreviewGeometryToClip(
      leftClip.id,
      leftClip.from,
      leftClip.durationInFrames,
      {
        rolling: rollingPreview,
        slide: slidePreview,
        ripple: {
          trimmedItemId: ripplePreview.trimmedItemId,
          delta: ripplePreview.delta,
          isDownstream: ripplePreview.leftDownstream,
        },
        linkedEdit: leftLinkedEditPreview,
        trackPush: trackPushLeft,
      },
    );
  }, [leftClip, rollingPreview, slidePreview, ripplePreview, leftLinkedEditPreview, trackPushLeft]);

  const effectiveRightClip = useMemo(() => {
    if (!rightClip) return null;
    if (rightLinkedEditPreview?.hidden) return null;
    return applyPreviewGeometryToClip(
      rightClip.id,
      rightClip.from,
      rightClip.durationInFrames,
      {
        rolling: rollingPreview,
        slide: slidePreview,
        ripple: {
          trimmedItemId: ripplePreview.trimmedItemId,
          delta: ripplePreview.delta,
          isDownstream: ripplePreview.rightDownstream,
        },
        linkedEdit: rightLinkedEditPreview,
        trackPush: trackPushRight,
      },
    );
  }, [rightClip, rollingPreview, slidePreview, ripplePreview, rightLinkedEditPreview, trackPushRight]);

  const position = useMemo(() => {
    if (!effectiveLeftClip || !effectiveRightClip) return null;

    const bridge = getTransitionBridgeBounds(
      effectiveLeftClip.from,
      effectiveLeftClip.durationInFrames,
      effectiveRightClip.from,
      previewDuration,
      transition.alignment,
    );
    // Round each edge independently - same pixel grid as timeline items
    const bridgeRight = Math.round(frameToPixels(bridge.rightFrame));
    const bridgeLeft = Math.round(frameToPixels(bridge.leftFrame));
    const naturalWidth = bridgeRight - bridgeLeft;
    const leftEnd = effectiveLeftClip.from + effectiveLeftClip.durationInFrames;
    const leftClipStart = Math.round(frameToPixels(effectiveLeftClip.from));
    const rightClipEnd = Math.round(frameToPixels(effectiveRightClip.from + effectiveRightClip.durationInFrames));
    const cutFrame = Math.abs(leftEnd - effectiveRightClip.from) <= 1
      ? effectiveRightClip.from
      : leftEnd;
    const cutPx = Math.round(frameToPixels(cutFrame));

    // Minimum width for visibility
    const minWidth = 32;
    const maxVisualWidth = Math.max(naturalWidth, rightClipEnd - leftClipStart);
    const effectiveWidth = Math.min(Math.max(naturalWidth, minWidth), maxVisualWidth);
    // Center the minimum-width bridge on the overlap midpoint, but keep all
    // geometry snapped to integer pixels so the center cut line does not jitter.
    const centeredLeft = naturalWidth >= effectiveWidth
      ? bridgeLeft
      : Math.round(((bridgeLeft + bridgeRight) / 2) - (effectiveWidth / 2));
    const left = Math.min(Math.max(centeredLeft, leftClipStart), rightClipEnd - effectiveWidth);

    return {
      left,
      width: effectiveWidth,
      cutOffset: cutPx - left,
    };
  }, [effectiveLeftClip, effectiveRightClip, frameToPixels, previewDuration, transition.alignment]);

  // Duration in seconds for display (use previewDuration for visual feedback)
  const durationSec = useMemo(() => {
    return (previewDuration / fps).toFixed(1);
  }, [previewDuration, fps]);
  const draggedTransition = useTransitionDragStore((s) => s.draggedTransition);
  const dragPreviewMatches = useTransitionDragStore(
    useCallback((s) => s.preview?.existingTransitionId === transition.id, [transition.id])
  );

  // Handle click to select (only if not resizing)
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      // Don't select if we just finished resizing
      if (!isResizing) {
        selectTransition(transition.id);
      }
    },
    [transition.id, selectTransition, isResizing]
  );

  // Stop all events on resize handles from bubbling
  const stopEvent = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Handle mousedown on main container - stop propagation when on resize edge
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Always stop propagation to prevent timeline drag
      e.stopPropagation();
    },
    []
  );

  const handleResizeMouseDown = useCallback((e: React.MouseEvent, handle: 'left' | 'right') => {
    selectTransition(transition.id);
    handleResizeStart(e, handle);
  }, [handleResizeStart, selectTransition, transition.id]);

  // Handle delete
  const handleDelete = useCallback(() => {
    removeTransition(transition.id);
  }, [transition.id, removeTransition]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const dragDescriptor = readDraggedTransitionDescriptor(e);
    if (!dragDescriptor || !draggedTransition) return;

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    const dragState = useTransitionDragStore.getState();
    dragState.setInvalidHint(null);
    dragState.setPreview({
      leftClipId: transition.leftClipId,
      rightClipId: transition.rightClipId,
      durationInFrames: transition.durationInFrames,
      alignment: transition.alignment ?? 0.5,
      existingTransitionId: transition.id,
    });
  }, [draggedTransition, transition]);

  const handleDragLeave = useCallback(() => {
    const dragState = useTransitionDragStore.getState();
    if (dragState.preview?.existingTransitionId === transition.id) {
      dragState.clearPreview();
    }
    dragState.setInvalidHint(null);
  }, [transition.id]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const dragDescriptor = readDraggedTransitionDescriptor(e);
    if (!dragDescriptor) return;

    e.preventDefault();
    e.stopPropagation();
    updateTransition(transition.id, {
      presentation: dragDescriptor.presentation,
      direction: dragDescriptor.direction,
    });
    useTransitionDragStore.getState().clearDrag();
  }, [transition.id, updateTransition]);

  if (!position || !effectiveLeftClip || !effectiveRightClip || isHiddenForBreakPreview) {
    return null;
  }

  const presentationLabel = transition.presentation?.charAt(0).toUpperCase() + transition.presentation?.slice(1) || 'Fade';

  // Determine cursor based on hover state
  const cursor = hoveredEdge ? 'ew-resize' : 'pointer';
  const leftSelectWidth = Math.max(0, position.cutOffset - (CUT_PASS_THROUGH_ZONE / 2) - BRIDGE_SELECT_SIDE_INSET);
  const rightSelectLeft = Math.min(
    position.width - BRIDGE_SELECT_SIDE_INSET,
    position.cutOffset + (CUT_PASS_THROUGH_ZONE / 2),
  );
  const rightSelectWidth = Math.max(0, position.width - BRIDGE_SELECT_SIDE_INSET - rightSelectLeft);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={containerRef}
          data-transition-id={transition.id}
          className={cn(
            'absolute inset-y-0 overflow-visible rounded-sm pointer-events-none',
            isSelected &&
              'ring-2 ring-inset ring-orange-400',
            dragPreviewMatches && 'ring-2 ring-inset ring-amber-300',
            isResizing && 'ring-2 ring-inset ring-purple-400'
          )}
          style={{
            left: `${position.left}px`,
            width: `${position.width}px`,
            top: `calc(${EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight} + 1px)`,
            bottom: '1px',
            zIndex: isResizing ? 50 : 10,
            opacity: trackHidden ? 0.3 : undefined,
            cursor: isResizing ? 'ew-resize' : undefined,
          }}
          title={`${presentationLabel} (${durationSec}s)`}
        >
          <div
            className={cn(
              'pointer-events-none relative h-full w-full rounded-sm border bg-transparent',
              isSelected
                ? 'border-orange-400/90 shadow-[0_0_0_1px_rgba(251,146,60,0.18)]'
                : 'border-slate-100/80 shadow-[0_0_0_1px_rgba(248,250,252,0.1)]'
            )}
          >
            <div className="absolute inset-x-0 top-0 h-px bg-slate-50/70" />
            <div className="absolute inset-x-0 bottom-0 h-px bg-slate-900/15" />
          </div>

          {leftSelectWidth > 0 && (
            <div
              className="absolute inset-y-0 pointer-events-auto"
              style={{
                left: `${BRIDGE_SELECT_SIDE_INSET}px`,
                width: `${leftSelectWidth}px`,
                cursor: isResizing ? 'ew-resize' : cursor,
              }}
              onMouseDown={handleMouseDown}
              onClick={handleClick}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            />
          )}

          {rightSelectWidth > 0 && (
            <div
              className="absolute inset-y-0 pointer-events-auto"
              style={{
                left: `${rightSelectLeft}px`,
                width: `${rightSelectWidth}px`,
                cursor: isResizing ? 'ew-resize' : cursor,
              }}
              onMouseDown={handleMouseDown}
              onClick={handleClick}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            />
          )}

          {/* Left resize handle (invisible hit zone, cursor-only feedback) */}
          <div
            className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-l pointer-events-auto"
            data-transition-hit-zone="left-edge"
            onMouseEnter={() => setHoveredEdge('left')}
            onMouseLeave={() => {
              if (!isResizing) setHoveredEdge(null);
            }}
            onMouseDown={(e) => handleResizeMouseDown(e, 'left')}
            onMouseUp={stopEvent}
            onClick={stopEvent}
          />

          {/* Right resize handle (invisible hit zone, cursor-only feedback) */}
          <div
            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-r pointer-events-auto"
            data-transition-hit-zone="right-edge"
            onMouseEnter={() => setHoveredEdge('right')}
            onMouseLeave={() => {
              if (!isResizing) setHoveredEdge(null);
            }}
            onMouseDown={(e) => handleResizeMouseDown(e, 'right')}
            onMouseUp={stopEvent}
            onClick={stopEvent}
          />
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem onClick={handleDelete} className="text-destructive">
          <Trash2 className="w-4 h-4 mr-2" />
          Remove Transition
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
