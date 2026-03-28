import { memo } from 'react';
import { cn } from '@/shared/ui/cn';
import type { TimelineItemOverlay, TimelineItemOverlayTone } from '../../stores/timeline-item-overlay-store';

interface SegmentStatusOverlaysProps {
  overlays: readonly TimelineItemOverlay[];
}

const TONE_CLASSES: Record<TimelineItemOverlayTone, string> = {
  neutral: 'bg-black/75 text-white ring-white/10',
  info: 'bg-sky-600/85 text-white ring-sky-100/20',
  success: 'bg-emerald-600/85 text-white ring-emerald-100/20',
  warning: 'bg-amber-500/90 text-black ring-amber-50/30',
  error: 'bg-destructive/90 text-destructive-foreground ring-destructive-foreground/20',
};

function formatOverlayProgress(progress: number): string {
  return `${Math.max(0, Math.min(100, Math.round(progress)))}%`;
}

export const SegmentStatusOverlays = memo(function SegmentStatusOverlays({
  overlays,
}: SegmentStatusOverlaysProps) {
  if (overlays.length === 0) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center px-2">
      <div className="flex max-w-full flex-col items-center gap-1">
        {overlays.map((overlay) => (
          <div
            key={overlay.id}
            className={cn(
              'flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-[10px] font-medium shadow-lg ring-1 backdrop-blur-sm',
              TONE_CLASSES[overlay.tone ?? 'neutral'],
            )}
            title={overlay.progress === undefined
              ? overlay.label
              : `${overlay.label} ${formatOverlayProgress(overlay.progress)}`}
          >
            <span className="truncate">{overlay.label}</span>
            {overlay.progress !== undefined && (
              <span className="shrink-0 font-mono tabular-nums">
                {formatOverlayProgress(overlay.progress)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});
