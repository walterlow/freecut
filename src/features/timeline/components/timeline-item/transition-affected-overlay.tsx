import { memo, useMemo } from 'react';
import { EDITOR_LAYOUT_CSS_VALUES } from '@/shared/ui/editor-layout';

export interface TransitionAffectedRangeVisual {
  key: string;
  start: number;
  end: number;
  role: 'incoming' | 'outgoing';
  label: string;
}

interface TransitionAffectedOverlayProps {
  clipDurationInFrames: number;
  clipWidth: number;
  ranges: TransitionAffectedRangeVisual[];
}

export const TransitionAffectedOverlay = memo(function TransitionAffectedOverlay({
  clipDurationInFrames,
  clipWidth,
  ranges,
}: TransitionAffectedOverlayProps) {
  const visuals = useMemo(() => {
    if (clipDurationInFrames <= 0 || clipWidth <= 0) return [];

    return ranges
      .map((range) => {
        const start = Math.max(0, Math.min(range.start, clipDurationInFrames));
        const end = Math.max(start, Math.min(range.end, clipDurationInFrames));
        if (end <= start) return null;

        const left = (start / clipDurationInFrames) * clipWidth;
        const width = Math.max(1, ((end - start) / clipDurationInFrames) * clipWidth);
        const clampedLeft = Math.max(0, Math.min(left, Math.max(0, clipWidth - 1)));
        const clampedWidth = Math.min(width, clipWidth - clampedLeft);
        if (clampedWidth <= 0) return null;

        return {
          key: range.key,
          left: clampedLeft,
          width: clampedWidth,
          role: range.role,
          label: range.label,
        };
      })
      .filter((visual): visual is NonNullable<typeof visual> => visual !== null);
  }, [clipDurationInFrames, clipWidth, ranges]);

  if (visuals.length === 0) return null;

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-[11] pointer-events-none"
      style={{ top: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight }}
      aria-hidden="true"
    >
      {visuals.map((visual) => {
        const isIncoming = visual.role === 'incoming';
        return (
          <div
            key={visual.key}
            data-transition-affected-role={visual.role}
            title={visual.label}
            className="absolute inset-y-0 overflow-hidden"
            style={{
              left: `${visual.left}px`,
              width: `${visual.width}px`,
              borderLeft: isIncoming ? '1px solid rgba(248,250,252,0.72)' : undefined,
              borderRight: isIncoming ? undefined : '1px solid rgba(248,250,252,0.72)',
              backgroundImage: isIncoming
                ? 'linear-gradient(to right, rgba(248,250,252,0.18), rgba(248,250,252,0.04)), repeating-linear-gradient(135deg, rgba(248,250,252,0.12) 0px, rgba(248,250,252,0.12) 5px, transparent 5px, transparent 10px)'
                : 'linear-gradient(to left, rgba(248,250,252,0.18), rgba(248,250,252,0.04)), repeating-linear-gradient(45deg, rgba(248,250,252,0.12) 0px, rgba(248,250,252,0.12) 5px, transparent 5px, transparent 10px)',
            }}
          >
            <div className="absolute inset-x-0 top-0 h-px bg-white/20" />
            <div className="absolute inset-x-0 bottom-0 h-px bg-slate-950/20" />
          </div>
        );
      })}
    </div>
  );
});
