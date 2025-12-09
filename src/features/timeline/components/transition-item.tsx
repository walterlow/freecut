import { memo, useCallback, useMemo, useState } from 'react';
import type { Transition } from '@/types/transition';
import { useTimelineStore } from '../stores/timeline-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { useTimelineZoom } from '../hooks/use-timeline-zoom';
import { useTransitionResize } from '../hooks/use-transition-resize';
import type { TimelineState, TimelineActions } from '../types';
import type { SelectionState, SelectionActions } from '@/features/editor/types';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { Trash2 } from 'lucide-react';

export interface TransitionItemProps {
  transition: Transition;
  trackHeight: number;
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
}: TransitionItemProps) {
  const { frameToPixels } = useTimelineZoom();
  const fps = useTimelineStore((s: TimelineState) => s.fps);
  const removeTransition = useTimelineStore(
    (s: TimelineActions) => s.removeTransition
  );

  // Get the clips involved in this transition
  const leftClip = useTimelineStore(
    useCallback(
      (s: TimelineState) => s.items.find((i) => i.id === transition.leftClipId),
      [transition.leftClipId]
    )
  );
  const rightClip = useTimelineStore(
    useCallback(
      (s: TimelineState) => s.items.find((i) => i.id === transition.rightClipId),
      [transition.rightClipId]
    )
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

  // Track hovered edge for showing resize handles
  const [hoveredEdge, setHoveredEdge] = useState<'left' | 'right' | null>(null);

  // Calculate position and size for the transition region
  // The transition happens BEFORE the junction (last N frames of left clip overlapping first N frames of right clip)
  // So the indicator should END at the junction, not be centered on it
  // Use previewDuration during resize for visual feedback
  const position = useMemo(() => {
    if (!leftClip || !rightClip) return null;

    // The junction is where the clips meet (rightClip.from)
    const junctionFrame = rightClip.from;
    const junctionPixel = frameToPixels(junctionFrame);

    // Transition region: ends at junction, spans transitionDuration frames before it
    // Use previewDuration for visual feedback during resize
    const transitionStart = Math.max(
      leftClip.from,
      junctionFrame - previewDuration
    );
    const startPixel = frameToPixels(transitionStart);
    const naturalWidth = junctionPixel - startPixel;

    // Minimum width for visibility, but keep right edge at junction
    const minWidth = 32;
    const effectiveWidth = Math.max(naturalWidth, minWidth);
    const left = junctionPixel - effectiveWidth;

    return { left, width: effectiveWidth, junctionPixel };
  }, [leftClip, rightClip, frameToPixels, previewDuration]);

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

  // Handle click to select
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      selectTransition(transition.id);
    },
    [transition.id, selectTransition]
  );

  // Handle delete
  const handleDelete = useCallback(() => {
    removeTransition(transition.id);
  }, [transition.id, removeTransition]);

  if (!position || !leftClip || !rightClip) {
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
          className={cn(
            'absolute transition-all duration-75',
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
            cursor,
          }}
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
              'absolute left-0 top-0 bottom-0 w-1.5 bg-purple-400 cursor-ew-resize transition-opacity duration-75 rounded-l',
              hoveredEdge === 'left' || (isResizing && resizeHandle === 'left')
                ? 'opacity-100'
                : 'opacity-0'
            )}
            onMouseDown={(e) => handleResizeStart(e, 'left')}
          />

          {/* Right resize handle */}
          <div
            className={cn(
              'absolute right-0 top-0 bottom-0 w-1.5 bg-purple-400 cursor-ew-resize transition-opacity duration-75 rounded-r',
              hoveredEdge === 'right' || (isResizing && resizeHandle === 'right')
                ? 'opacity-100'
                : 'opacity-0'
            )}
            onMouseDown={(e) => handleResizeStart(e, 'right')}
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
