import { memo, useCallback, useMemo, useState, useRef, useEffect } from 'react';
import type { Transition } from '@/types/transition';
import { useShallow } from 'zustand/react/shallow';
import { useTimelineStore } from '../stores/timeline-store';
import { useItemsStore } from '../stores/items-store';
import { useRollingEditPreviewStore } from '../stores/rolling-edit-preview-store';
import { useRippleEditPreviewStore } from '../stores/ripple-edit-preview-store';
import { useSlideEditPreviewStore } from '../stores/slide-edit-preview-store';
import { useSelectionStore } from '@/shared/state/selection';
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
import { Trash2 } from 'lucide-react';
import {
  applyPreviewGeometryToClip,
  getTransitionBridgeBounds,
} from '../utils/transition-preview-geometry';

interface TransitionItemProps {
  transition: Transition;
  trackHeight: number;
  trackHidden?: boolean;
}

/**
 * Transition Item Component
 *
 * Renders a CapCut-style transition overlay between adjacent clips.
 * Shows the transition region spanning both clips (fade out from left, fade in to right).
 * Displays duration and transition type.
 */
// Width in pixels for edge hover detection (resize handles)
const EDGE_HOVER_ZONE = 6;

export const TransitionItem = memo(function TransitionItem({
  transition,
  trackHeight,
  trackHidden = false,
}: TransitionItemProps) {
  const { frameToPixels } = useTimelineZoomContext();
  const fps = useTimelineStore((s: TimelineState) => s.fps);
  const removeTransition = useTimelineStore(
    (s: TimelineActions) => s.removeTransition
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
  const { isResizing, resizeHandle, handleResizeStart, previewDuration } =
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

  // Track hovered edge for showing resize handles
  const [hoveredEdge, setHoveredEdge] = useState<'left' | 'right' | null>(null);

  // Ref for applying drag offset when both clips are being dragged
  const containerRef = useRef<HTMLDivElement>(null);
  const rafIdRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);

  // Subscribe to drag state and apply offset when both clips are dragged together
  useEffect(() => {
    const updateDragOffset = () => {
      if (!containerRef.current || !isDraggingRef.current) return;
      const offset = dragOffsetRef.current;
      containerRef.current.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
      rafIdRef.current = requestAnimationFrame(updateDragOffset);
    };

    const unsubscribe = useSelectionStore.subscribe((state) => {
      const dragState = state.dragState;
      const bothClipsDragged = dragState?.isDragging &&
        dragState.draggedItemIds.includes(transition.leftClipId) &&
        dragState.draggedItemIds.includes(transition.rightClipId);

      const wasDragging = isDraggingRef.current;
      isDraggingRef.current = !!bothClipsDragged;

      // Start RAF loop when both clips start dragging
      if (!wasDragging && bothClipsDragged) {
        rafIdRef.current = requestAnimationFrame(updateDragOffset);
      }

      // Cleanup when drag ends
      if (wasDragging && !bothClipsDragged) {
        if (rafIdRef.current) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        if (containerRef.current) {
          containerRef.current.style.transform = '';
        }
      }
    });

    return () => {
      unsubscribe();
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [transition.leftClipId, transition.rightClipId]);
  // Calculate position and size for the transition indicator.
  // The bridge covers the actual overlap region: from (leftEnd - duration) to leftEnd.
  // The right edge is anchored at leftEnd (the left clip's end); the left edge moves
  // as the duration changes. The left handle tracks the cursor 1:1.
  const effectiveLeftClip = useMemo(() => {
    if (!leftClip) return null;
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
      },
    );
  }, [leftClip, rollingPreview, slidePreview, ripplePreview]);

  const effectiveRightClip = useMemo(() => {
    if (!rightClip) return null;
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
      },
    );
  }, [rightClip, rollingPreview, slidePreview, ripplePreview]);

  const position = useMemo(() => {
    if (!effectiveLeftClip || !effectiveRightClip) return null;

    const bridge = getTransitionBridgeBounds(
      effectiveLeftClip.from,
      effectiveLeftClip.durationInFrames,
      previewDuration,
    );
    // Round each edge independently - same pixel grid as timeline items
    const bridgeRight = Math.round(frameToPixels(bridge.rightFrame));
    const bridgeLeft = Math.round(frameToPixels(bridge.leftFrame));
    const naturalWidth = bridgeRight - bridgeLeft;

    // Minimum width for visibility
    const minWidth = 32;
    const effectiveWidth = Math.max(naturalWidth, minWidth);
    // Center the minimum-width bridge on the overlap midpoint
    const left = naturalWidth >= minWidth
      ? bridgeLeft
      : bridgeLeft - (minWidth - naturalWidth) / 2;

    return { left, width: effectiveWidth };
  }, [effectiveLeftClip, effectiveRightClip, frameToPixels, previewDuration]);

  // Duration in seconds for display (use previewDuration for visual feedback)
  const durationSec = useMemo(() => {
    return (previewDuration / fps).toFixed(1);
  }, [previewDuration, fps]);

  // Handle mouse move to detect edge hover
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isResizing) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;

      if (x < EDGE_HOVER_ZONE) {
        setHoveredEdge('left');
      } else if (x > rect.width - EDGE_HOVER_ZONE) {
        setHoveredEdge('right');
      } else {
        setHoveredEdge(null);
      }
    },
    [isResizing]
  );

  // Clear hover state when mouse leaves
  const handleMouseLeave = useCallback(() => {
    if (!isResizing) {
      setHoveredEdge(null);
    }
  }, [isResizing]);

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

  // Handle delete
  const handleDelete = useCallback(() => {
    removeTransition(transition.id);
  }, [transition.id, removeTransition]);

  if (!position || !effectiveLeftClip || !effectiveRightClip) {
    return null;
  }

  // Calculate dimensions
  const overlayHeight = Math.min(28, trackHeight - 4);
  const overlayTop = (trackHeight - overlayHeight) / 2;

  // Get presentation label
  const presentationLabel = transition.presentation?.charAt(0).toUpperCase() + transition.presentation?.slice(1) || 'Fade';

  // Determine cursor based on hover state
  const cursor = hoveredEdge ? 'ew-resize' : 'pointer';

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={containerRef}
          className={cn(
            'absolute',
            isSelected &&
              'ring-2 ring-primary ring-offset-1 ring-offset-background rounded',
            isResizing && 'ring-2 ring-purple-400'
          )}
          style={{
            left: `${position.left}px`,
            width: `${position.width}px`,
            top: `${overlayTop}px`,
            height: `${overlayHeight}px`,
            zIndex: isResizing ? 50 : 10,
            opacity: trackHidden ? 0.3 : undefined,
            cursor,
          }}
          onMouseDown={handleMouseDown}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          title={`${presentationLabel} (${durationSec}s)`}
        >
          {/* CapCut-style transition region overlay - more transparent */}
          <div
            className={cn(
              'w-full h-full rounded-md flex items-center justify-center gap-1 px-1',
              'bg-gradient-to-r from-purple-500/20 via-purple-400/35 to-purple-500/20',
              'border border-purple-400/30',
              'hover:from-purple-500/30 hover:via-purple-400/45 hover:to-purple-500/30',
              'hover:border-purple-400/50'
            )}
          >
            {/* Bowtie icon - hide when too small */}
            {position.width >= 24 && (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="w-3.5 h-3.5 flex-shrink-0"
              >
                <path d="M4 6 L12 12 L4 18 Z" fill="white" fillOpacity="0.7" />
                <path d="M20 6 L12 12 L20 18 Z" fill="white" fillOpacity="0.7" />
              </svg>
            )}
            {/* Duration label - only show if enough width */}
            {position.width >= 50 && (
              <span className="text-[10px] text-white/80 font-medium truncate">
                {durationSec}s
              </span>
            )}
          </div>

          {/* Left resize handle */}
          <div
            className={cn(
              'absolute left-0 top-0 bottom-0 w-1.5 bg-purple-400 cursor-ew-resize rounded-l',
              hoveredEdge === 'left' || (isResizing && resizeHandle === 'left')
                ? 'opacity-100'
                : 'opacity-0'
            )}
            onMouseDown={(e) => handleResizeStart(e, 'left')}
            onMouseUp={stopEvent}
            onClick={stopEvent}
          />

          {/* Right resize handle */}
          <div
            className={cn(
              'absolute right-0 top-0 bottom-0 w-1.5 bg-purple-400 cursor-ew-resize rounded-r',
              hoveredEdge === 'right' || (isResizing && resizeHandle === 'right')
                ? 'opacity-100'
                : 'opacity-0'
            )}
            onMouseDown={(e) => handleResizeStart(e, 'right')}
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


