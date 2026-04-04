import { memo } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/shared/ui/cn';
import type { SmartTrimIntent } from '../../utils/smart-trim-zones';
import { CONSTRAINED_COLORS, FREE_COLORS } from './trim-constants';
import type { EdgeColors, ActiveEdgeState } from './trim-constants';

const TRIM_COLORS: EdgeColors = {
  edge: 'rgba(255, 255, 255, 0.85)',
  glow: '0 0 6px rgba(255, 255, 255, 0.3)',
  fade: 'rgba(255, 255, 255, 0.2)',
};

const RIPPLE_COLORS: EdgeColors = {
  edge: 'rgba(251, 191, 36, 0.95)',
  glow: '0 0 8px rgba(251, 191, 36, 0.5)',
  fade: 'rgba(251, 191, 36, 0.3)',
};

const ROLL_COLORS: EdgeColors = {
  edge: 'rgba(251, 191, 36, 0.9)',
  glow: '0 0 8px rgba(251, 191, 36, 0.6)',
  fade: 'rgba(251, 191, 36, 0.35)',
};

interface TrimHandlesProps {
  trackLocked: boolean;
  isAnyDragActive: boolean;
  isTrimming: boolean;
  trimHandle: 'start' | 'end' | null;
  activeTool: string;
  hoveredEdge: 'start' | 'end' | null;
  smartTrimIntent: SmartTrimIntent;
  rollHoverEdge: 'start' | 'end' | null;
  /** Active edge state from any gesture (trim, roll-neighbor, slip, slide, stretch) */
  activeEdges: ActiveEdgeState | null;
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

function resolveEdgeColors(
  tone: 'default' | 'ripple',
  isRolling: boolean,
  isActiveHandle: boolean,
  isConstrained: boolean,
): EdgeColors {
  if (isActiveHandle) return isConstrained ? CONSTRAINED_COLORS : FREE_COLORS;
  if (isRolling) return ROLL_COLORS;
  if (tone === 'ripple') return RIPPLE_COLORS;
  return TRIM_COLORS;
}

/**
 * Trim handles for timeline items.
 * All modes (trim, ripple, roll, slip, slide) use a solid edge + gradient fade halo.
 * During active operations the halo turns green (free) or red (constrained).
 * Roll mode additionally renders a double-edge across the edit point.
 */
export const TrimHandles = memo(function TrimHandles({
  trackLocked,
  isAnyDragActive,
  isTrimming,
  trimHandle,
  activeTool,
  hoveredEdge,
  smartTrimIntent,
  rollHoverEdge,
  activeEdges,
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
  const isRollingStart = smartTrimIntent === 'roll-start';
  const isRollingEnd = smartTrimIntent === 'roll-end';
  const isNeighborRollStart = rollHoverEdge === 'start';
  const isNeighborRollEnd = rollHoverEdge === 'end';

  const leftActive = activeEdges?.start ?? false;
  const rightActive = activeEdges?.end ?? false;
  const leftConstrained = !!activeEdges && leftActive && (activeEdges.constrainedEdge === 'start' || activeEdges.constrainedEdge === 'both');
  const rightConstrained = !!activeEdges && rightActive && (activeEdges.constrainedEdge === 'end' || activeEdges.constrainedEdge === 'both');

  const showLeftHandle = !trackLocked &&
    (!isAnyDragActive || isTrimming || leftActive) &&
    (activeTool === 'select' || activeTool === 'trim-edit') &&
    (hoveredEdge === 'start' || (isTrimming && trimHandle === 'start') || isNeighborRollStart || leftActive);

  const showRightHandle = !trackLocked &&
    (!isAnyDragActive || isTrimming || rightActive) &&
    (activeTool === 'select' || activeTool === 'trim-edit') &&
    (hoveredEdge === 'end' || (isTrimming && trimHandle === 'end') || isNeighborRollEnd || rightActive);

  const leftColors = resolveEdgeColors(
    startTone,
    isRollingStart || isNeighborRollStart,
    (isTrimming && trimHandle === 'start') || leftActive,
    leftConstrained,
  );
  const rightColors = resolveEdgeColors(
    endTone,
    isRollingEnd || isNeighborRollEnd,
    (isTrimming && trimHandle === 'end') || rightActive,
    rightConstrained,
  );

  return (
    <>
      {/* Left trim handle */}
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
            {/* Halo visuals — only during hover; active operations use external overlay */}
            {!activeEdges && (
              <>
                <div
                  className="absolute inset-y-0 left-0"
                  style={{ width: '2px', background: leftColors.edge, boxShadow: leftColors.glow }}
                />
                <div
                  className="absolute inset-y-0"
                  style={{ left: '2px', width: '8px', background: `linear-gradient(to right, ${leftColors.fade}, transparent)` }}
                />
                {isRollingStart && (
                  <>
                    <div
                      className="absolute inset-y-0"
                      style={{ left: '-2px', width: '2px', background: leftColors.edge, boxShadow: leftColors.glow }}
                    />
                    <div
                      className="absolute inset-y-0"
                      style={{ left: '-10px', width: '8px', background: `linear-gradient(to left, ${leftColors.fade}, transparent)` }}
                    />
                  </>
                )}
              </>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={onJoinLeft}>
            Join
            <ContextMenuShortcut>J</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Right trim handle */}
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
            {!activeEdges && (
              <>
                <div
                  className="absolute inset-y-0 right-0"
                  style={{ width: '2px', background: rightColors.edge, boxShadow: rightColors.glow }}
                />
                <div
                  className="absolute inset-y-0"
                  style={{ right: '2px', width: '8px', background: `linear-gradient(to left, ${rightColors.fade}, transparent)` }}
                />
                {isRollingEnd && (
                  <>
                    <div
                      className="absolute inset-y-0"
                      style={{ right: '-2px', width: '2px', background: rightColors.edge, boxShadow: rightColors.glow }}
                    />
                    <div
                      className="absolute inset-y-0"
                      style={{ right: '-10px', width: '8px', background: `linear-gradient(to right, ${rightColors.fade}, transparent)` }}
                    />
                  </>
                )}
              </>
            )}
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
