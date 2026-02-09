import { memo } from 'react';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff, Lock, GripVertical, Volume2, VolumeX, Radio } from 'lucide-react';
import type { TimelineTrack } from '@/types/timeline';
import { useTrackDrag } from '../hooks/use-track-drag';

interface TrackHeaderProps {
  track: TimelineTrack;
  isActive: boolean;
  isSelected: boolean;
  onToggleLock: () => void;
  onToggleVisibility: () => void;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onSelect: (e: React.MouseEvent) => void;
}

/**
 * Custom equality for TrackHeader memo - ignores callback props which are recreated each render
 */
function areTrackHeaderPropsEqual(prev: TrackHeaderProps, next: TrackHeaderProps): boolean {
  return (
    prev.track === next.track &&
    prev.isActive === next.isActive &&
    prev.isSelected === next.isSelected
  );
  // Callbacks (onToggleLock, etc.) are ignored - they're recreated each render but functionality is same
}

/**
 * Track Header Component
 *
 * Displays track name, controls, and handles selection.
 * Shows active state with background color.
 * Memoized to prevent re-renders when props haven't changed.
 */
export const TrackHeader = memo(function TrackHeader({
  track,
  isActive,
  isSelected,
  onToggleLock,
  onToggleVisibility,
  onToggleMute,
  onToggleSolo,
  onSelect,
}: TrackHeaderProps) {
  // Use track drag hook
  const { isDragging, dragOffset, handleDragStart } = useTrackDrag(track);
  const isBeingDragged = isDragging;

  return (
    <div
      className={`
        flex items-center justify-between px-2 border-b border-border
        cursor-grab active:cursor-grabbing relative
        ${isSelected ? 'bg-primary/10' : 'hover:bg-secondary/50'}
        ${isActive ? 'border-l-3 border-l-primary' : 'border-l-3 border-l-transparent'}
        ${isBeingDragged ? 'opacity-50 shadow-lg ring-2 ring-primary/30' : ''}
        ${!isBeingDragged ? 'transition-all duration-150' : ''}
      `}
      style={{
        height: `${track.height}px`,
        transform: isDragging ? `translateY(${dragOffset}px) scale(1.02)` : undefined,
        transition: isDragging ? 'none' : undefined,
        zIndex: isBeingDragged ? 100 : undefined,
        // content-visibility optimization for long track lists (rendering-content-visibility)
        contentVisibility: 'auto',
        containIntrinsicSize: `192px ${track.height}px`,
      }}
      onClick={onSelect}
      onMouseDown={handleDragStart}
      data-track-id={track.id}
    >
      {/* Drag Handle Icon & Track Name */}
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <GripVertical className="w-4 h-4 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium font-mono whitespace-nowrap">
          {track.name}
        </span>
      </div>

      <div className="flex items-center gap-0.2 shrink-0">
        {/* Visibility Button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility();
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {track.visible ? (
            <Eye className="w-1 h-1" />
          ) : (
            <EyeOff className="w-1 h-1 opacity-50" />
          )}
        </Button>

        {/* Audio Mute Button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation();
            onToggleMute();
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {track.muted ? (
            <VolumeX className="w-1 h-1 text-muted-foreground" />
          ) : (
            <Volume2 className="w-1 h-1" />
          )}
        </Button>

        {/* Solo Button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSolo();
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Radio
            className={`w-1 h-1 ${track.solo ? 'text-primary' : ''}`}
          />
        </Button>

        {/* Lock Button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock();
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Lock
            className={`w-1 h-1 ${track.locked ? 'text-primary' : ''}`}
          />
        </Button>
      </div>
    </div>
  );
}, areTrackHeaderPropsEqual);
