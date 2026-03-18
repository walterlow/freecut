import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/shared/ui/cn';

interface InteractionLockRegionProps {
  locked: boolean;
  children: ReactNode;
  className?: string;
  overlayClassName?: string;
  style?: CSSProperties;
}

/**
 * Blocks pointer interaction for a region while leaving the DOM mounted.
 * Used to keep mask editing modal without tearing down editor panels.
 */
export function InteractionLockRegion({
  locked,
  children,
  className,
  overlayClassName,
  style,
}: InteractionLockRegionProps) {
  return (
    <div
      className={cn('relative min-h-0', className)}
      data-interaction-locked={locked ? 'true' : 'false'}
      style={style}
    >
      <div
        className={cn(
          'h-full min-h-0',
          locked ? 'pointer-events-none select-none opacity-60' : undefined
        )}
      >
        {children}
      </div>
      {locked ? (
        <div
          aria-hidden="true"
          className={cn(
            'absolute inset-0 z-10 cursor-not-allowed rounded-[inherit] bg-background/10',
            overlayClassName
          )}
          title="Finish or exit mask editing to continue"
        />
      ) : null}
    </div>
  );
}
