/**
 * Keyframe Graph Panel Component
 *
 * Collapsible panel that shows the value graph editor for selected items.
 * Integrates with the timeline to provide visual keyframe editing.
 */

import { memo, useState, useCallback, useMemo } from 'react';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ValueGraphEditor } from '@/features/keyframes/components/value-graph-editor';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { useTimelineStore } from '../stores/timeline-store';
import { useKeyframesStore } from '../stores/keyframes-store';
import { useKeyframeSelectionStore } from '../stores/keyframe-selection-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import type { AnimatableProperty, KeyframeRef } from '@/types/keyframe';

/** Height of the panel header bar in pixels */
export const GRAPH_PANEL_HEADER_HEIGHT = 32;

/** Default height of the graph content area in pixels */
export const GRAPH_PANEL_CONTENT_HEIGHT = 200;

interface KeyframeGraphPanelProps {
  /** Whether the panel is open */
  isOpen: boolean;
  /** Callback to toggle panel visibility */
  onToggle: () => void;
  /** Callback to close the panel */
  onClose: () => void;
  /** Width of the panel (defaults to full width) */
  width?: number;
  /** Height of the graph content area when expanded */
  contentHeight?: number;
}

/**
 * Collapsible panel showing the keyframe value graph editor.
 * Displays graph for the first selected item that has keyframes.
 */
export const KeyframeGraphPanel = memo(function KeyframeGraphPanel({
  isOpen,
  onToggle,
  onClose,
  width,
  contentHeight = GRAPH_PANEL_CONTENT_HEIGHT,
}: KeyframeGraphPanelProps) {
  // Selected items
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);

  // Timeline state
  const items = useTimelineStore((s) => s.items);
  const keyframes = useKeyframesStore((s) => s.keyframes);
  const updateKeyframe = useTimelineStore((s) => s.updateKeyframe);

  // Keyframe selection
  const selectedKeyframes = useKeyframeSelectionStore((s) => s.selectedKeyframes);
  const selectKeyframe = useKeyframeSelectionStore((s) => s.selectKeyframe);
  const selectKeyframes = useKeyframeSelectionStore((s) => s.selectKeyframes);

  // Playback state
  const currentFrame = usePlaybackStore((s) => s.currentFrame);

  // Track selected property for graph editor
  const [selectedProperty, setSelectedProperty] = useState<AnimatableProperty | null>(null);

  // Find the first selected item that has keyframes
  const selectedItemWithKeyframes = useMemo(() => {
    for (const itemId of selectedItemIds) {
      const item = items.find((i) => i.id === itemId);
      const itemKeyframes = keyframes.find((k) => k.itemId === itemId);

      if (item && itemKeyframes && itemKeyframes.properties.some((p) => p.keyframes.length > 0)) {
        return { item, itemKeyframes };
      }
    }
    return null;
  }, [selectedItemIds, items, keyframes]);

  // Build keyframes by property for the graph editor
  const keyframesByProperty = useMemo(() => {
    if (!selectedItemWithKeyframes) return {};

    const result: Partial<Record<AnimatableProperty, typeof selectedItemWithKeyframes.itemKeyframes.properties[0]['keyframes']>> = {};

    for (const prop of selectedItemWithKeyframes.itemKeyframes.properties) {
      if (prop.keyframes.length > 0) {
        result[prop.property] = prop.keyframes;
      }
    }

    return result;
  }, [selectedItemWithKeyframes]);

  // Selected keyframe IDs for the current item
  const selectedKeyframeIds = useMemo(() => {
    if (!selectedItemWithKeyframes) return new Set<string>();

    const ids = new Set<string>();
    for (const ref of selectedKeyframes) {
      if (ref.itemId === selectedItemWithKeyframes.item.id) {
        ids.add(ref.keyframeId);
      }
    }
    return ids;
  }, [selectedKeyframes, selectedItemWithKeyframes]);

  // Calculate relative frame for the current item
  const relativeFrame = useMemo(() => {
    if (!selectedItemWithKeyframes) return 0;
    return Math.max(0, currentFrame - selectedItemWithKeyframes.item.from);
  }, [currentFrame, selectedItemWithKeyframes]);

  // Handle keyframe move in graph editor
  const handleKeyframeMove = useCallback(
    (ref: KeyframeRef, newFrame: number, newValue: number) => {
      updateKeyframe(ref.itemId, ref.property, ref.keyframeId, {
        frame: Math.max(0, Math.round(newFrame)),
        value: newValue,
      });
    },
    [updateKeyframe]
  );

  // Handle selection change in graph editor
  const handleSelectionChange = useCallback(
    (keyframeIds: Set<string>) => {
      if (!selectedItemWithKeyframes) return;

      const refs: KeyframeRef[] = [];
      for (const id of keyframeIds) {
        // Find which property this keyframe belongs to
        for (const prop of selectedItemWithKeyframes.itemKeyframes.properties) {
          const kf = prop.keyframes.find((k) => k.id === id);
          if (kf) {
            refs.push({
              itemId: selectedItemWithKeyframes.item.id,
              property: prop.property,
              keyframeId: id,
            });
            break;
          }
        }
      }

      if (refs.length === 1 && refs[0]) {
        selectKeyframe(refs[0]);
      } else if (refs.length > 1) {
        selectKeyframes(refs);
      }
    },
    [selectedItemWithKeyframes, selectKeyframe, selectKeyframes]
  );

  // Handle property change in graph editor
  const handlePropertyChange = useCallback((property: AnimatableProperty | null) => {
    setSelectedProperty(property);
  }, []);

  // Don't show panel if no item with keyframes is selected and panel is not explicitly open
  const hasContent = !!selectedItemWithKeyframes;

  if (!hasContent && !isOpen) {
    return null;
  }

  // Calculate total panel height for proper flex sizing
  // When closed, show just the header; when open, show header + content
  const panelHeight = isOpen
    ? GRAPH_PANEL_HEADER_HEIGHT + contentHeight
    : GRAPH_PANEL_HEADER_HEIGHT;

  return (
    <div
      className={cn(
        'flex-shrink-0 border-t border-border bg-background transition-all duration-200 overflow-hidden',
        isOpen ? 'opacity-100' : 'opacity-90'
      )}
      style={{ height: panelHeight }}
    >
      {/* Header bar - always visible */}
      <div
        className="h-8 flex items-center justify-between px-3 bg-secondary/30 border-b border-border cursor-pointer hover:bg-secondary/50"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-5 w-5 p-0">
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </Button>
          <span className="text-xs font-medium text-muted-foreground">
            Keyframe Graph
            {selectedItemWithKeyframes && (
              <span className="ml-2 text-foreground">
                - {selectedItemWithKeyframes.item.label || selectedItemWithKeyframes.item.type}
                <span className="ml-1 text-muted-foreground">
                  ({selectedItemWithKeyframes.item.id.slice(0, 8)})
                </span>
              </span>
            )}
          </span>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 p-0"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X className="w-3 h-3" />
        </Button>
      </div>

      {/* Graph editor content */}
      {isOpen && (
        <div className="p-2" style={{ height: contentHeight }}>
          {selectedItemWithKeyframes ? (
            <ValueGraphEditor
              itemId={selectedItemWithKeyframes.item.id}
              keyframesByProperty={keyframesByProperty}
              selectedProperty={selectedProperty}
              selectedKeyframeIds={selectedKeyframeIds}
              currentFrame={relativeFrame}
              totalFrames={selectedItemWithKeyframes.item.durationInFrames}
              width={width ? width - 16 : undefined} // Account for padding
              height={contentHeight - 16}
              onKeyframeMove={handleKeyframeMove}
              onSelectionChange={handleSelectionChange}
              onPropertyChange={handlePropertyChange}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Select an item with keyframes to view the graph
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default KeyframeGraphPanel;
