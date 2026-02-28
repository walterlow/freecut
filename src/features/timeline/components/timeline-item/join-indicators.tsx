import { memo } from 'react';
import { cn } from '@/shared/ui/cn';

interface JoinIndicatorsProps {
  hasJoinableLeft: boolean;
  hasJoinableRight: boolean;
  trackLocked: boolean;
  dragAffectsJoin: { left: boolean; right: boolean };
  hoveredEdge: 'start' | 'end' | null;
  isTrimming: boolean;
  isStretching: boolean;
  isBeingDragged: boolean;
}

/**
 * Join indicators for timeline items
 * Shows glowing edges when clips can be joined with neighbors
 */
export const JoinIndicators = memo(function JoinIndicators({
  hasJoinableLeft,
  hasJoinableRight,
  trackLocked,
  dragAffectsJoin,
  hoveredEdge,
  isTrimming,
  isStretching,
  isBeingDragged,
}: JoinIndicatorsProps) {
  // Hide join indicators when this item is being dragged (anchor or follower)
  // This ensures indicators don't show when moving to a different track
  const showLeft = hasJoinableLeft &&
    !trackLocked &&
    !dragAffectsJoin.left &&
    !isBeingDragged &&
    hoveredEdge !== 'start' &&
    !isTrimming &&
    !isStretching;

  const showRight = hasJoinableRight &&
    !trackLocked &&
    !dragAffectsJoin.right &&
    !isBeingDragged &&
    hoveredEdge !== 'end' &&
    !isTrimming &&
    !isStretching;

  return (
    <>
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-px pointer-events-none transition-opacity duration-75",
          showLeft ? "opacity-100" : "opacity-0"
        )}
        style={{ backgroundColor: 'var(--color-timeline-join)', boxShadow: '0 0 6px 1px var(--color-timeline-join)' }}
        title="Can join with previous clip (J)"
      />
      <div
        className={cn(
          "absolute right-0 top-0 bottom-0 w-px pointer-events-none transition-opacity duration-75",
          showRight ? "opacity-100" : "opacity-0"
        )}
        style={{ backgroundColor: 'var(--color-timeline-join)', boxShadow: '0 0 6px 1px var(--color-timeline-join)' }}
        title="Can join with next clip (J)"
      />
    </>
  );
});

