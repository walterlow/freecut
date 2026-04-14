import { memo } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/shared/ui/cn';

interface TrimHandlesProps {
  trackLocked: boolean;
  isAnyDragActive: boolean;
  isTrimming: boolean;
  trimHandle: 'start' | 'end' | null;
  activeTool: string;
  hoveredEdge: 'start' | 'end' | null;
  hasJoinableLeft: boolean;
  hasJoinableRight: boolean;
  onTrimStart: (e: React.MouseEvent, handle: 'start' | 'end') => void;
  onJoinLeft: () => void;
  onJoinRight: () => void;
}

/**
 * Trim handles for timeline items
 * Renders left and right trim handles with context menus for joining
 */
export const TrimHandles = memo(function TrimHandles({
  trackLocked,
  isAnyDragActive,
  isTrimming,
  trimHandle,
  activeTool,
  hoveredEdge,
  hasJoinableLeft,
  hasJoinableRight,
  onTrimStart,
  onJoinLeft,
  onJoinRight,
}: TrimHandlesProps) {
  const showLeftHandle = !trackLocked &&
    (!isAnyDragActive || isTrimming) &&
    (activeTool === 'select' || activeTool === 'rolling-edit' || activeTool === 'ripple-edit') &&
    (hoveredEdge === 'start' || (isTrimming && trimHandle === 'start'));

  const showRightHandle = !trackLocked &&
    (!isAnyDragActive || isTrimming) &&
    (activeTool === 'select' || activeTool === 'rolling-edit' || activeTool === 'ripple-edit') &&
    (hoveredEdge === 'end' || (isTrimming && trimHandle === 'end'));

  return (
    <>
      {/* Left trim handle - w-2 (8px) visible; min-w-6 on mobile for touch target */}
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={trackLocked || !hasJoinableLeft}>
          <div
            className={cn(
              "absolute left-0 top-0 bottom-0 w-2 min-w-6 md:min-w-0 flex items-stretch touch-none",
              showLeftHandle ? "opacity-100" : "opacity-0 pointer-events-none"
            )}
            onMouseDown={(e) => onTrimStart(e, 'start')}
          >
            <div className="w-2 bg-primary cursor-ew-resize transition-opacity duration-75 shrink-0" />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={onJoinLeft}>
            Join
            <ContextMenuShortcut>J</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Right trim handle - w-2 (8px) visible; min-w-6 on mobile for touch target */}
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={trackLocked || !hasJoinableRight}>
          <div
            className={cn(
              "absolute right-0 top-0 bottom-0 w-2 min-w-6 md:min-w-0 flex items-stretch justify-end touch-none",
              showRightHandle ? "opacity-100" : "opacity-0 pointer-events-none"
            )}
            onMouseDown={(e) => onTrimStart(e, 'end')}
          >
            <div className="w-2 bg-primary cursor-ew-resize transition-opacity duration-75 shrink-0" />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={onJoinRight}>
            Join
            <ContextMenuShortcut>J</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </>
  );
});

