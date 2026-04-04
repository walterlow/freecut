import type { MouseEvent, PropsWithChildren } from 'react';
import { TRACK_SECTION_DIVIDER_HEIGHT } from '@/features/timeline/constants';
import { cn } from '@/shared/ui/cn';

interface TrackRowFrameProps extends PropsWithChildren {
  className?: string;
  showTopDivider?: boolean;
  hideBottomDivider?: boolean;
  onResizeMouseDown?: (event: MouseEvent<HTMLButtonElement>) => void;
  onResizeDoubleClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  resizeHandleLabel?: string;
  resizeHandlePosition?: 'top' | 'bottom';
}

interface TrackSectionDividerProps {
  className?: string;
  onMouseDown?: (event: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * Keeps the row separator outside the lane content so clips can fill the row.
 */
export function TrackRowFrame({
  children,
  className,
  showTopDivider = false,
  hideBottomDivider = false,
  onResizeMouseDown,
  onResizeDoubleClick,
  resizeHandleLabel,
  resizeHandlePosition = 'bottom',
}: TrackRowFrameProps) {
  const resizeHandlePositionClass = resizeHandlePosition === 'top' ? 'top-0' : 'bottom-0';

  return (
    <div className={cn('relative', className)}>
      {showTopDivider && (
        <div
          aria-hidden="true"
          data-testid="track-row-top-divider"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-border"
        />
      )}
      {children}
      {!hideBottomDivider && (
        <div
          aria-hidden="true"
          data-testid="track-row-divider"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border"
        />
      )}
      {onResizeMouseDown && (
        <button
          type="button"
          tabIndex={-1}
          className={cn(
            'absolute inset-x-0 z-30 h-[6px] cursor-row-resize bg-transparent focus-visible:outline-none',
            resizeHandlePositionClass
          )}
          aria-label={resizeHandleLabel ?? 'Resize track height'}
          onMouseDown={onResizeMouseDown}
          onDoubleClick={onResizeDoubleClick}
        />
      )}
    </div>
  );
}

export function TrackSectionDivider({ className, onMouseDown }: TrackSectionDividerProps) {
  return (
    <div className={cn('relative', className)} style={{ height: `${TRACK_SECTION_DIVIDER_HEIGHT}px` }}>
      <div
        aria-hidden="true"
        data-testid="track-row-section-divider"
        className="pointer-events-none absolute inset-0 z-30"
      >
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/80 shadow-[0_1px_0_rgba(255,255,255,0.15)]" />
      </div>
      {onMouseDown && (
        <button
          type="button"
          className="absolute inset-0 z-40 cursor-row-resize bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          aria-label="Resize video and audio track sections"
          onMouseDown={onMouseDown}
        />
      )}
    </div>
  );
}
