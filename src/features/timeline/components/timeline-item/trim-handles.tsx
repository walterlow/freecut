import { memo } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';

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
    (activeTool === 'select' || activeTool === 'rolling-edit') &&
    (hoveredEdge === 'start' || (isTrimming && trimHandle === 'start'));

  const showRightHandle = !trackLocked &&
    (!isAnyDragActive || isTrimming) &&
    (activeTool === 'select' || activeTool === 'rolling-edit') &&
    (hoveredEdge === 'end' || (isTrimming && trimHandle === 'end'));

  return (
    <>
      {/* Left trim handle with context menu for join - w-2 (8px) matches EDGE_HOVER_ZONE */}
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={trackLocked || !hasJoinableLeft}>
          <div
            className={cn(
              "absolute left-0 top-0 bottom-0 w-2 bg-primary cursor-ew-resize transition-opacity duration-75",
              showLeftHandle ? "opacity-100" : "opacity-0 pointer-events-none"
            )}
            onMouseDown={(e) => onTrimStart(e, 'start')}
          />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={onJoinLeft}>
            Join
            <ContextMenuShortcut>J</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Right trim handle with context menu for join - w-2 (8px) matches EDGE_HOVER_ZONE */}
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={trackLocked || !hasJoinableRight}>
          <div
            className={cn(
              "absolute right-0 top-0 bottom-0 w-2 bg-primary cursor-ew-resize transition-opacity duration-75",
              showRightHandle ? "opacity-100" : "opacity-0 pointer-events-none"
            )}
            onMouseDown={(e) => onTrimStart(e, 'end')}
          />
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
