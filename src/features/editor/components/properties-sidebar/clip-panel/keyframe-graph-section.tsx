/**
 * Keyframe graph section for clip properties panel.
 * Shows an interactive value graph editor for keyframe animation.
 */

import { memo, useMemo, useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, Activity } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { ValueGraphEditor } from '@/features/keyframes/components/value-graph-editor';
import { useKeyframesStore } from '@/features/timeline/stores/keyframes-store';
import { useKeyframeSelectionStore } from '@/features/timeline/stores/keyframe-selection-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import type { TimelineItem } from '@/types/timeline';
import type { AnimatableProperty, KeyframeRef, BezierControlPoints, Keyframe } from '@/types/keyframe';

interface KeyframeGraphSectionProps {
  /** Selected timeline items */
  items: TimelineItem[];
}

/**
 * Section showing the keyframe value graph editor.
 * Only shown when a single item with keyframes is selected.
 */
export const KeyframeGraphSection = memo(function KeyframeGraphSection({
  items,
}: KeyframeGraphSectionProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [selectedProperty, setSelectedProperty] = useState<AnimatableProperty | null>(null);

  // Only show for single item selection
  const item = items.length === 1 ? items[0] : null;

  // Get keyframe data - subscribe to the actual keyframes array for this item
  const itemKeyframes = useKeyframesStore((s) =>
    item ? s.keyframes.find((k) => k.itemId === item.id) : undefined
  );
  const _updateKeyframe = useKeyframesStore((s) => s._updateKeyframe);

  // Get selection state
  const selectedKeyframes = useKeyframeSelectionStore((s) => s.selectedKeyframes);
  const selectKeyframes = useKeyframeSelectionStore((s) => s.selectKeyframes);

  // Get current frame
  const currentFrame = usePlaybackStore((s) => s.currentFrame);

  // Get keyframes by property for the selected item
  const keyframesByProperty = useMemo((): Partial<Record<AnimatableProperty, Keyframe[]>> => {
    if (!itemKeyframes) return {};

    const result: Partial<Record<AnimatableProperty, Keyframe[]>> = {};

    for (const propKeyframes of itemKeyframes.properties) {
      if (propKeyframes.keyframes && propKeyframes.keyframes.length > 0) {
        result[propKeyframes.property] = propKeyframes.keyframes;
      }
    }

    return result;
  }, [itemKeyframes]);

  // Check if item has any keyframes
  const hasKeyframes = Object.keys(keyframesByProperty).length > 0;

  // Get selected keyframe IDs for this item
  const selectedKeyframeIds = useMemo(() => {
    if (!item) return new Set<string>();
    return new Set(
      selectedKeyframes
        .filter((ref) => ref.itemId === item.id)
        .map((ref) => ref.keyframeId)
    );
  }, [item, selectedKeyframes]);

  // Handle keyframe move
  const handleKeyframeMove = useCallback(
    (ref: KeyframeRef, newFrame: number, newValue: number) => {
      _updateKeyframe(ref.itemId, ref.property, ref.keyframeId, {
        frame: Math.max(0, newFrame),
        value: newValue,
      });
    },
    [_updateKeyframe]
  );

  // Handle bezier handle move
  const handleBezierHandleMove = useCallback(
    (ref: KeyframeRef, bezier: BezierControlPoints) => {
      _updateKeyframe(ref.itemId, ref.property, ref.keyframeId, {
        easingConfig: { type: 'cubic-bezier', bezier },
      });
    },
    [_updateKeyframe]
  );

  // Handle selection change
  const handleSelectionChange = useCallback(
    (keyframeIds: Set<string>) => {
      if (!item || !selectedProperty) return;

      const refs: KeyframeRef[] = Array.from(keyframeIds).map((keyframeId) => ({
        itemId: item.id,
        property: selectedProperty,
        keyframeId,
      }));

      selectKeyframes(refs);
    },
    [item, selectedProperty, selectKeyframes]
  );

  // Handle property change
  const handlePropertyChange = useCallback((property: AnimatableProperty | null) => {
    setSelectedProperty(property);
  }, []);

  // Don't render if no item or no keyframes
  if (!item || !hasKeyframes) {
    return null;
  }

  // Calculate total frames from item duration
  const totalFrames = item.durationInFrames;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between p-2 h-auto">
          <div className="flex items-center gap-2">
            {isOpen ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            <Activity className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Keyframe Graph</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {Object.keys(keyframesByProperty).length} properties
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <ValueGraphEditor
          itemId={item.id}
          keyframesByProperty={keyframesByProperty}
          selectedProperty={selectedProperty}
          selectedKeyframeIds={selectedKeyframeIds}
          currentFrame={currentFrame}
          totalFrames={totalFrames}
          width={308}
          height={200}
          onKeyframeMove={handleKeyframeMove}
          onBezierHandleMove={handleBezierHandleMove}
          onSelectionChange={handleSelectionChange}
          onPropertyChange={handlePropertyChange}
        />
      </CollapsibleContent>
    </Collapsible>
  );
});
