import { memo } from 'react';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Eye, EyeOff, Lock, GripVertical, Volume2, VolumeX, Radio, ChevronRight, ChevronDown, FoldHorizontal } from 'lucide-react';
import type { TimelineTrack } from '@/types/timeline';
import { useTrackDrag } from '../hooks/use-track-drag';

interface TrackHeaderProps {
  track: TimelineTrack;
  isActive: boolean;
  isSelected: boolean;
  /** Whether this group track is a drop target for dragged tracks */
  isDropTarget?: boolean;
  groupDepth: number;
  /** Whether grouping is available for current selection (2+ top-level non-group tracks) */
  canGroup: boolean;
  onToggleLock: () => void;
  onToggleVisibility: () => void;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onToggleCollapse?: () => void;
  onSelect: (e: React.MouseEvent) => void;
  onCloseGaps?: () => void;
  onGroup?: () => void;
  onUngroup?: () => void;
  onRemoveFromGroup?: () => void;
}

/**
 * Custom equality for TrackHeader memo - ignores callback props which are recreated each render
 */
function areTrackHeaderPropsEqual(prev: TrackHeaderProps, next: TrackHeaderProps): boolean {
  return (
    prev.track === next.track &&
    prev.isActive === next.isActive &&
    prev.isSelected === next.isSelected &&
    prev.isDropTarget === next.isDropTarget &&
    prev.groupDepth === next.groupDepth &&
    prev.canGroup === next.canGroup
  );
  // Callbacks (onToggleLock, etc.) are ignored - they're recreated each render but functionality is same
}

/**
 * Track Header Component
 *
 * Displays track name, controls, and handles selection.
 * Shows active state with background color.
 * Supports group tracks with collapse/expand and indentation.
 * Right-click context menu for group operations.
 * Memoized to prevent re-renders when props haven't changed.
 */
export const TrackHeader = memo(function TrackHeader({
  track,
  isActive,
  isSelected,
  isDropTarget,
  groupDepth,
  canGroup,
  onToggleLock,
  onToggleVisibility,
  onToggleMute,
  onToggleSolo,
  onToggleCollapse,
  onSelect,
  onCloseGaps,
  onGroup,
  onUngroup,
  onRemoveFromGroup,
}: TrackHeaderProps) {
  // Use track drag hook (visuals handled centrally by timeline.tsx via DOM)
  const { handleDragStart } = useTrackDrag(track);
  const isGroup = !!track.isGroup;
  const isInGroup = !!track.parentTrackId;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`
            flex items-center px-1 border-b border-border
            cursor-grab active:cursor-grabbing relative
            ${isSelected ? 'bg-primary/10' : 'hover:bg-secondary/50'}
            ${isActive ? 'border-l-3 border-l-primary' : 'border-l-3 border-l-transparent'}
            ${isDropTarget ? 'ring-2 ring-blue-500/60 bg-blue-500/15' : ''}
            transition-all duration-150
            ${isGroup && !isDropTarget && !isSelected ? 'bg-secondary/30' : ''}
          `}
          style={{
            height: `${track.height}px`,
            paddingLeft: `${4 + groupDepth * 16}px`,
            // content-visibility optimization for long track lists (rendering-content-visibility)
            contentVisibility: 'auto',
            containIntrinsicSize: `192px ${track.height}px`,
          }}
          onClick={onSelect}
          onMouseDown={handleDragStart}
          data-track-id={track.id}
        >
          {/* Left column: Drag handle + collapse toggle */}
          <div className="flex items-center shrink-0 mr-1">
            <GripVertical className="w-4 h-4 text-muted-foreground" />
            {isGroup && (
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 shrink-0 p-0 ml-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCollapse?.();
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {track.isCollapsed ? (
                  <ChevronRight className="w-3 h-3 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-muted-foreground" />
                )}
              </Button>
            )}
          </div>

          {/* Right column: Name row + Icons row, centered as a block */}
          <div className="flex items-center justify-center min-w-0 flex-1">
          <div className="flex flex-col items-start">
            {/* Row 1: Name */}
            <span className="text-sm font-bold font-mono truncate">
              {track.name}
            </span>

            {/* Row 2: Control icons */}
            <div className="flex items-center gap-0.5">
            {/* Visibility Button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 rounded hover:bg-secondary"
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisibility();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              data-tooltip={track.visible ? 'Hide track' : 'Show track'}
            >
              {track.visible ? (
                <Eye className="w-3 h-3" />
              ) : (
                <EyeOff className="w-3 h-3 opacity-50" />
              )}
            </Button>

            {/* Audio Mute Button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 rounded hover:bg-secondary"
              onClick={(e) => {
                e.stopPropagation();
                onToggleMute();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              data-tooltip={track.muted ? 'Unmute track' : 'Mute track'}
            >
              {track.muted ? (
                <VolumeX className="w-3 h-3 opacity-50" />
              ) : (
                <Volume2 className="w-3 h-3" />
              )}
            </Button>

            {/* Solo Button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 rounded hover:bg-secondary"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSolo();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              data-tooltip={track.solo ? 'Unsolo track' : 'Solo track'}
            >
              <Radio
                className={`w-3 h-3 ${track.solo ? 'text-primary' : ''}`}
              />
            </Button>

            {/* Lock Button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 rounded hover:bg-secondary"
              onClick={(e) => {
                e.stopPropagation();
                onToggleLock();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              data-tooltip={track.locked ? 'Unlock track' : 'Lock track'}
            >
              <Lock
                className={`w-3 h-3 ${track.locked ? 'opacity-50' : ''}`}
              />
            </Button>

            {/* Close Gaps Button - only for non-group tracks */}
            {!isGroup && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 rounded hover:bg-secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseGaps?.();
                }}
                onMouseDown={(e) => e.stopPropagation()}
                data-tooltip="Close all gaps"
              >
                <FoldHorizontal className="w-3 h-3" />
              </Button>
            )}
          </div>
          </div>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-52">
        {/* Group operations */}
        {canGroup && !isGroup && (
          <ContextMenuItem onClick={onGroup}>
            Group Selected Tracks
            <span className="ml-auto text-xs text-muted-foreground">Ctrl+G</span>
          </ContextMenuItem>
        )}
        {isGroup && (
          <ContextMenuItem onClick={onUngroup}>
            Ungroup
            <span className="ml-auto text-xs text-muted-foreground">Ctrl+Shift+G</span>
          </ContextMenuItem>
        )}
        {isInGroup && !isGroup && (
          <ContextMenuItem onClick={onRemoveFromGroup}>
            Remove from Group
          </ContextMenuItem>
        )}

        {/* Close gaps - non-group tracks only */}
        {!isGroup && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onCloseGaps}>
              Close All Gaps
            </ContextMenuItem>
          </>
        )}

        {/* Track controls */}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onToggleVisibility}>
          {track.visible ? 'Hide Track' : 'Show Track'}
        </ContextMenuItem>
        <ContextMenuItem onClick={onToggleMute}>
          {track.muted ? 'Unmute Track' : 'Mute Track'}
        </ContextMenuItem>
        <ContextMenuItem onClick={onToggleLock}>
          {track.locked ? 'Unlock Track' : 'Lock Track'}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}, areTrackHeaderPropsEqual);
