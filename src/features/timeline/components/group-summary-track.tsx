import { memo, useMemo } from 'react';
import type { TimelineTrack } from '@/types/timeline';
import { useTimelineStore } from '../stores/timeline-store';
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context';
import { getChildTrackIds, getGroupCoverageRange } from '../utils/group-utils';

interface GroupSummaryTrackProps {
  track: TimelineTrack;
}

function arePropsEqual(prev: GroupSummaryTrackProps, next: GroupSummaryTrackProps) {
  return prev.track === next.track;
}

/**
 * Renders a single summary bar for a collapsed group track,
 * spanning from the earliest child item start to the latest end.
 */
export const GroupSummaryTrack = memo(function GroupSummaryTrack({ track }: GroupSummaryTrackProps) {
  const { frameToPixels } = useTimelineZoomContext();

  const allTracks = useTimelineStore((s) => s.tracks);
  const childTrackIds = useMemo(
    () => new Set(getChildTrackIds(allTracks, track.id)),
    [allTracks, track.id]
  );

  const items = useTimelineStore((s) => s.items);
  const range = useMemo(
    () => getGroupCoverageRange(items, childTrackIds),
    [items, childTrackIds]
  );

  return (
    <div
      className="relative border-b border-border bg-secondary/20"
      style={{ height: `${track.height}px` }}
      data-track-id={track.id}
    >
      {range && (() => {
        const left = frameToPixels(range.from);
        const width = frameToPixels(range.to) - left;
        return (
          <div
            className="absolute top-1 rounded-sm"
            style={{
              left: `${left}px`,
              width: `${Math.max(width, 2)}px`,
              height: `${track.height - 8}px`,
              backgroundColor: 'rgba(59, 130, 246, 0.6)',
            }}
          />
        );
      })()}
    </div>
  );
}, arePropsEqual);
