import { memo } from 'react';
import { Link2Off, Diamond } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ClipIndicatorsProps {
  /** Whether the item has keyframe animations */
  hasKeyframes: boolean;
  /** Current playback speed (1 = normal) */
  currentSpeed: number;
  /** Whether the item is currently being rate stretched */
  isStretching: boolean;
  /** Visual feedback during stretch (speed preview) */
  stretchFeedback: { speed: number } | null;
  /** Whether the item's media is broken/missing */
  isBroken: boolean;
  /** Whether the item has a mediaId */
  hasMediaId: boolean;
  /** Whether the item is a shape configured as a mask */
  isMask: boolean;
  /** Whether the item is a shape */
  isShape: boolean;
}

/**
 * Renders status indicators/badges on timeline clips:
 * - Keyframe diamond icon (amber)
 * - Speed badge when not 1x (shows current or preview speed)
 * - Broken media indicator (red link-off icon)
 * - Mask badge for shape items
 */
export const ClipIndicators = memo(function ClipIndicators({
  hasKeyframes,
  currentSpeed,
  isStretching,
  stretchFeedback,
  isBroken,
  hasMediaId,
  isMask,
  isShape,
}: ClipIndicatorsProps) {
  const showSpeedBadge = Math.abs(currentSpeed - 1) > 0.005 && !isStretching;

  return (
    <>
      {/* Keyframe indicator */}
      {hasKeyframes && (
        <div
          className="absolute top-1 right-1 z-10 pointer-events-none"
          title="Has keyframe animations"
        >
          <Diamond className="w-3 h-3 text-amber-500 fill-amber-500/50" />
        </div>
      )}

      {/* Mask indicator for shape items */}
      {isShape && isMask && (
        <div className="absolute top-1 right-1 px-1 py-0.5 text-[10px] font-bold bg-cyan-500/80 text-white rounded">
          M
        </div>
      )}

      {/* Speed badge - show when speed is not 1x */}
      {showSpeedBadge && (
        <div className="absolute top-1 right-1 px-1 py-0.5 text-[10px] font-bold bg-black/60 text-white rounded font-mono">
          {currentSpeed.toFixed(2)}x
        </div>
      )}

      {/* Missing media indicator */}
      {isBroken && hasMediaId && (
        <div
          className="absolute bottom-1 left-1 p-0.5 rounded bg-destructive/90 text-destructive-foreground"
          title="Media file missing - relink in Media Library"
        >
          <Link2Off className="w-3 h-3" />
        </div>
      )}

      {/* Preview speed overlay during stretch */}
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none z-10 transition-opacity duration-75",
          isStretching && stretchFeedback ? "opacity-100" : "opacity-0"
        )}
      >
        <span className="text-white font-mono text-sm font-bold">
          {stretchFeedback?.speed.toFixed(2) ?? '1.00'}x
        </span>
      </div>
    </>
  );
});
