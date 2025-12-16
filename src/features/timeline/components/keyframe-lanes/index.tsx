/**
 * Keyframe lanes container component.
 * Expandable sub-tracks showing keyframe lanes for all animated properties.
 */

import { memo, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TimelineItem } from '@/types/timeline';
import type { AnimatableProperty, KeyframeRef } from '@/types/keyframe';
import { KeyframeLane, LANE_HEIGHT } from './keyframe-lane';
import { useTimelineStore } from '../../stores/timeline-store';
import { useKeyframeSelectionStore } from '../../stores/keyframe-selection-store';

interface KeyframeLanesProps {
  /** The timeline item */
  item: TimelineItem;
  /** Whether the lanes are expanded */
  isExpanded: boolean;
  /** Callback to toggle expansion */
  onToggleExpand: () => void;
  /** Timeline FPS */
  fps: number;
}

/**
 * Container for all keyframe lanes for an item.
 * Shows when expanded, with lanes for each animated property.
 * Uses global keyframe selection store for unified selection across all lanes.
 */
export const KeyframeLanes = memo(function KeyframeLanes({
  item,
  isExpanded,
  onToggleExpand,
  fps,
}: KeyframeLanesProps) {
  // Get keyframes for this item
  const itemKeyframes = useTimelineStore(
    useCallback((s) => s.keyframes.find((k) => k.itemId === item.id), [item.id])
  );

  // Use global selection store
  const selectedKeyframes = useKeyframeSelectionStore((s) => s.selectedKeyframes);
  const selectKeyframe = useKeyframeSelectionStore((s) => s.selectKeyframe);
  const toggleSelection = useKeyframeSelectionStore((s) => s.toggleSelection);

  // Convert global selection to Set of IDs for this item
  const selectedKeyframeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const ref of selectedKeyframes) {
      if (ref.itemId === item.id) {
        ids.add(ref.keyframeId);
      }
    }
    return ids;
  }, [selectedKeyframes, item.id]);

  // Get properties that have keyframes
  const animatedProperties = useMemo(() => {
    if (!itemKeyframes) return [];
    return itemKeyframes.properties
      .filter((p) => p.keyframes.length > 0)
      .map((p) => p.property);
  }, [itemKeyframes]);

  // Check if item has any keyframes
  const hasKeyframes = animatedProperties.length > 0;

  // Handle keyframe selection using global store
  const handleKeyframeSelect = useCallback(
    (keyframeId: string, property: AnimatableProperty, shiftKey: boolean) => {
      const ref: KeyframeRef = {
        itemId: item.id,
        property,
        keyframeId,
      };

      if (shiftKey) {
        toggleSelection(ref);
      } else {
        selectKeyframe(ref);
      }
    },
    [item.id, selectKeyframe, toggleSelection]
  );

  // Don't render if no keyframes
  if (!hasKeyframes) return null;

  // Calculate total height when expanded
  const expandedHeight = animatedProperties.length * LANE_HEIGHT;

  return (
    <div className="relative">
      {/* Expand/collapse button */}
      <button
        type="button"
        onClick={onToggleExpand}
        className={cn(
          'absolute -left-4 top-0 z-10',
          'flex items-center justify-center w-4 h-4',
          'text-muted-foreground hover:text-foreground',
          'transition-colors'
        )}
        title={isExpanded ? 'Collapse keyframes' : 'Expand keyframes'}
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
      </button>

      {/* Lanes container */}
      {isExpanded && (
        <div
          className="flex flex-col overflow-hidden"
          style={{ height: expandedHeight }}
        >
          {animatedProperties.map((property) => {
            const propKeyframes = itemKeyframes?.properties.find(
              (p) => p.property === property
            );
            if (!propKeyframes) return null;

            return (
              <KeyframeLane
                key={property}
                itemId={item.id}
                property={property}
                keyframes={propKeyframes.keyframes}
                itemFrom={item.from}
                itemDuration={item.durationInFrames}
                fps={fps}
                selectedKeyframeIds={selectedKeyframeIds}
                onKeyframeSelect={handleKeyframeSelect}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});

// Export the lane height for use in track height calculations
export { LANE_HEIGHT };
