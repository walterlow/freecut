import { memo, useCallback, useMemo } from 'react';
import type { Transition } from '@/types/transition';
import { useTimelineStore } from '../stores/timeline-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { useTimelineZoom } from '../hooks/use-timeline-zoom';
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
export const TransitionItem = memo(function TransitionItem({
  transition,
  trackHeight,
}: TransitionItemProps) {
  const { frameToPixels } = useTimelineZoom();
  const fps = useTimelineStore((s) => s.fps);
  const removeTransition = useTimelineStore((s) => s.removeTransition);

  // Get the clips involved in this transition
  const leftClip = useTimelineStore(
    useCallback(
      (s) => s.items.find((i) => i.id === transition.leftClipId),
      [transition.leftClipId]
    )
  );
  const rightClip = useTimelineStore(
    useCallback(
      (s) => s.items.find((i) => i.id === transition.rightClipId),
      [transition.rightClipId]
    )
  );

  // Check if transition is selected
  const isSelected = useSelectionStore(
    useCallback(
      (s) => s.selectedTransitionId === transition.id,
      [transition.id]
    )
  );
  const selectTransition = useSelectionStore((s) => s.selectTransition);

  // Calculate position and size for the transition region
  // Always centered at the junction point between clips
  const position = useMemo(() => {
    if (!leftClip || !rightClip) return null;

    // The junction is where the clips meet (rightClip.from)
    const junctionFrame = rightClip.from;
    const junctionPixel = frameToPixels(junctionFrame);

    // Calculate the visual width based on transition duration
    // Width spans from junction - duration to junction + duration
    const transitionStart = junctionFrame - transition.durationInFrames;
    const transitionEnd = junctionFrame + transition.durationInFrames;

    // Clamp to clip bounds
    const clampedStart = Math.max(leftClip.from, transitionStart);
    const clampedEnd = Math.min(rightClip.from + rightClip.durationInFrames, transitionEnd);

    // Convert to pixels
    const startPixel = frameToPixels(clampedStart);
    const endPixel = frameToPixels(clampedEnd);
    const width = endPixel - startPixel;

    // Minimum width for visibility, but always centered at junction
    const minWidth = 32;
    const effectiveWidth = Math.max(width, minWidth);

    // Calculate left position to keep centered at junction
    const left = junctionPixel - effectiveWidth / 2;

    return { left, width: effectiveWidth, junctionPixel };
  }, [leftClip, rightClip, frameToPixels, transition.durationInFrames]);

  // Duration in seconds for display
  const durationSec = useMemo(() => {
    return (transition.durationInFrames / fps).toFixed(1);
  }, [transition.durationInFrames, fps]);

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

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'absolute cursor-pointer transition-all duration-75',
            isSelected && 'ring-2 ring-primary ring-offset-1 ring-offset-background rounded'
          )}
          style={{
            left: `${position.left}px`,
            width: `${position.width}px`,
            top: `${overlayTop}px`,
            height: `${overlayHeight}px`,
            zIndex: 10,
          }}
          onClick={handleClick}
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
