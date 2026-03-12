import type { PropsWithChildren } from 'react';
import { cn } from '@/shared/ui/cn';

interface TrackRowFrameProps extends PropsWithChildren {
  className?: string;
}

/**
 * Keeps the row separator outside the lane content so clips can fill the row.
 */
export function TrackRowFrame({ children, className }: TrackRowFrameProps) {
  return (
    <div className={cn('relative', className)}>
      {children}
      <div
        aria-hidden="true"
        data-testid="track-row-divider"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border"
      />
    </div>
  );
}
