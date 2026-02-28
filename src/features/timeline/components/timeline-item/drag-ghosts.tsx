import { forwardRef, memo } from 'react';
import { cn } from '@/shared/ui/cn';

interface DragGhostsProps {
  isAltDrag: boolean;
  isDragging: boolean;
  left: number;
  width: number;
  dragOffset: { x: number; y: number };
}

/**
 * Ghost elements for alt-drag duplication
 * Shows visual feedback when duplicating clips via alt+drag
 */
export const AnchorDragGhost = memo(function AnchorDragGhost({
  isAltDrag,
  isDragging,
  left,
  width,
  dragOffset,
}: DragGhostsProps) {
  return (
    <div
      className={cn(
        "absolute inset-y-0 rounded border-2 border-dashed border-primary bg-primary/20 pointer-events-none z-50",
        !(isAltDrag && isDragging) && "hidden"
      )}
      style={{
        left: `${left + dragOffset.x}px`,
        width: `${width}px`,
        transform: `translateY(${dragOffset.y}px)`,
      }}
    >
      <div className="absolute -top-1 -right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center text-xs font-bold text-primary-foreground shadow-md">
        +
      </div>
    </div>
  );
});

interface FollowerDragGhostProps {
  left: number;
  width: number;
}

/**
 * Ghost element for follower items during alt-drag
 * Visibility is controlled via RAF in parent component
 */
export const FollowerDragGhost = memo(forwardRef<HTMLDivElement, FollowerDragGhostProps>(
  function FollowerDragGhost({ left, width }, ref) {
    return (
      <div
        ref={ref}
        className="absolute inset-y-0 rounded border-2 border-dashed border-primary bg-primary/20 pointer-events-none z-50"
        style={{
          left: `${left}px`,
          width: `${width}px`,
          display: 'none',
        }}
      >
        <div className="absolute -top-1 -right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center text-xs font-bold text-primary-foreground shadow-md">
          +
        </div>
      </div>
    );
  }
));

