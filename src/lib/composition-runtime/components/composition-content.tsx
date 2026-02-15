import React, { useMemo } from 'react';
import { AbsoluteFill, Sequence } from '@/features/player/composition';
import type { CompositionItem as CompositionItemType, TimelineItem } from '@/types/timeline';
import { useCompositionsStore } from '@/features/timeline/stores/compositions-store';
import { blobUrlManager } from '@/lib/blob-url-manager';
import { Item } from './item';

interface CompositionContentProps {
  item: CompositionItemType;
  parentMuted?: boolean;
  renderDepth?: number;
}

/**
 * Resolve media URLs on sub-comp items using the centralized blob URL manager.
 * The parent preview has already acquired blob URLs for all mediaIds —
 * we just need to look them up and set `src`.
 */
function resolveSubCompItem(subItem: TimelineItem): TimelineItem {
  if (
    subItem.mediaId &&
    (subItem.type === 'video' || subItem.type === 'audio' || subItem.type === 'image')
  ) {
    const src = blobUrlManager.get(subItem.mediaId) ?? '';
    if (src !== subItem.src) {
      return { ...subItem, src } as TimelineItem;
    }
  }
  return subItem;
}

/**
 * Renders the contents of a sub-composition inline within the main preview.
 *
 * Each sub-composition item is rendered via a Sequence at its local `from`,
 * offset so that frame 0 of the sub-comp maps to the CompositionItem's
 * `from` on the parent timeline.
 *
 * The sub-comp is rendered at its own resolution and then CSS-scaled to fit
 * the parent transform bounds (handled by the parent ItemVisualWrapper).
 */
export const CompositionContent = React.memo<CompositionContentProps>(({ item, parentMuted = false, renderDepth = 0 }) => {
  const subComp = useCompositionsStore((s) => s.compositions.find((c) => c.id === item.compositionId));

  // Resolve media URLs for sub-comp items so they can render in preview
  const resolvedItems = useMemo(() => {
    if (!subComp) return [];
    return subComp.items.map(resolveSubCompItem);
  }, [subComp]);

  if (!subComp) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: '#2a1a2a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <p style={{ color: '#a855f7', fontSize: 14 }}>Composition not found</p>
      </AbsoluteFill>
    );
  }

  // Sort tracks so lower order renders first (bottom), higher order on top
  const sortedTracks = [...subComp.tracks].sort((a, b) => b.order - a.order);

  return (
    <AbsoluteFill>
      {sortedTracks.map((track) => {
        if (!track.visible) return null;

        const trackItems = resolvedItems.filter((i) => i.trackId === track.id);

        return trackItems.map((subItem) => (
          <Sequence
            key={subItem.id}
            from={subItem.from}
            durationInFrames={subItem.durationInFrames}
          >
            <Item item={subItem} muted={parentMuted || track.muted} masks={[]} renderDepth={renderDepth} />
          </Sequence>
        ));
      })}
    </AbsoluteFill>
  );
});
