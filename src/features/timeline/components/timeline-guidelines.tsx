import type { SnapTarget } from '../types/drag';
import { useTimelineZoom } from '../hooks/use-timeline-zoom';

export interface TimelineGuidelinesProps {
  /** Currently snapped target (highlighted) */
  activeSnapTarget: SnapTarget | null;
}

/**
 * Timeline Guidelines Component
 *
 * Renders vertical snap line for the active snap target during drag operations
 * - Green line for magnetic snap (item edges)
 * - Primary color for playhead snap
 *
 * Only shows when actively snapping to magnetic or playhead targets
 */
export function TimelineGuidelines({ activeSnapTarget }: TimelineGuidelinesProps) {
  const { frameToPixels } = useTimelineZoom();

  // Only show when there's an active snap target
  if (!activeSnapTarget) {
    return null;
  }

  // Only show magnetic (item edges) and playhead snaps
  const isMagnetic = activeSnapTarget.type === 'item-start' || activeSnapTarget.type === 'item-end';
  const isPlayhead = activeSnapTarget.type === 'playhead';

  // Don't show grid snaps
  if (!isMagnetic && !isPlayhead) {
    return null;
  }

  const left = frameToPixels(activeSnapTarget.frame);

  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      <div
        className={`absolute top-0 bottom-0 w-px transition-opacity ${
          isPlayhead ? 'bg-primary opacity-90' : 'bg-green-500 opacity-60'
        }`}
        style={{ left: `${left}px` }}
      />
    </div>
  );
}
