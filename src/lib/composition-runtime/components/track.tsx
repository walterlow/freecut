import React from 'react';
import { AbsoluteFill, Sequence } from '@/features/player/composition';
import type { TimelineTrack } from '@/types/timeline';
import { Item } from './item';

export interface TrackProps {
  track: TimelineTrack;
  muted?: boolean;
}

/**
 * Composition Track Component
 *
 * NOTE: This component is no longer used by MainComposition.
 * MainComposition now renders all items at composition level to prevent
 * remounting when items are split or moved across tracks.
 *
 * This component is kept for potential future use with non-media items
 * or as a reference implementation.
 *
 * For the current architecture, see MainComposition which:
 * - Renders video/audio at composition level with stable keys
 * - Renders text/images/shapes per-track for proper z-index layering
 */
export const Track: React.FC<TrackProps> = ({ track, muted = false }) => {
  // Filter to non-media items only (video/audio handled at composition level)
  const nonMediaItems = track.items.filter(
    (item) => item.type !== 'video' && item.type !== 'audio'
  );

  return (
    <AbsoluteFill>
      {nonMediaItems.map((item) => (
        <Sequence
          key={item.id}
          from={item.from}
          durationInFrames={item.durationInFrames}
        >
          <Item item={item} muted={muted} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
