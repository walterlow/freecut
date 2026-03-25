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
  trimConstrained: boolean;
  startCursorClass: string;
  endCursorClass: string;
  startTone: 'default' | 'ripple';
  endTone: 'default' | 'ripple';
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
  trimConstrained,
  startCursorClass,
  endCursorClass,
  startTone,
  endTone,
  hasJoinableLeft,
  hasJoinableRight,
  onTrimStart,
  onJoinLeft,
  onJoinRight,
}: TrimHandlesProps) {
  const showLeftHandle = !trackLocked &&
    (!isAnyDragActive || isTrimming) &&
    (activeTool === 'select' || activeTool === 'trim-edit') &&
    (hoveredEdge === 'start' || (isTrimming && trimHandle === 'start'));

  const showRightHandle = !trackLocked &&
    (!isAnyDragActive || isTrimming) &&
    (activeTool === 'select' || activeTool === 'trim-edit') &&
    (hoveredEdge === 'end' || (isTrimming && trimHandle === 'end'));

  return (
    <>
      {/* Left trim handle: wider hit area, thin visible indicator */}
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={trackLocked || !hasJoinableLeft}>
          <div
            className={cn(
              'absolute left-0 top-0 bottom-0 w-3 transition-opacity duration-75',
              startCursorClass,
              showLeftHandle ? 'opacity-100' : 'opacity-0 pointer-events-none'
            )}
            onMouseDown={(e) => onTrimStart(e, 'start')}
          >
            <div className={cn(
              'absolute inset-y-0 left-0 w-px rounded-l-sm bg-primary/80 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]',
              isTrimming && trimHandle === 'start' && 'opacity-0',
              startTone === 'ripple' && 'bg-amber-300/95 shadow-[0_0_0_1px_rgba(253,224,71,0.34),0_0_12px_rgba(251,191,36,0.3)]',
              trimConstrained && trimHandle === 'start' && 'bg-red-300/95 shadow-[0_0_0_1px_rgba(252,165,165,0.35)]'
            )} />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={onJoinLeft}>
            Join
            <ContextMenuShortcut>J</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Right trim handle: wider hit area, thin visible indicator */}
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={trackLocked || !hasJoinableRight}>
          <div
            className={cn(
              'absolute right-0 top-0 bottom-0 w-3 transition-opacity duration-75',
              endCursorClass,
              showRightHandle ? 'opacity-100' : 'opacity-0 pointer-events-none'
            )}
            onMouseDown={(e) => onTrimStart(e, 'end')}
          >
            <div className={cn(
              'absolute inset-y-0 right-0 w-px rounded-r-sm bg-primary/80 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]',
              isTrimming && trimHandle === 'end' && 'opacity-0',
              endTone === 'ripple' && 'bg-amber-300/95 shadow-[0_0_0_1px_rgba(253,224,71,0.34),0_0_12px_rgba(251,191,36,0.3)]',
              trimConstrained && trimHandle === 'end' && 'bg-red-300/95 shadow-[0_0_0_1px_rgba(252,165,165,0.35)]'
            )} />
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
