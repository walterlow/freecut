/**
 * Keyframe Graph Panel Component
 *
 * Collapsible panel that shows the value graph editor for selected items.
 * Integrates with the timeline to provide visual keyframe editing.
 */

import { memo, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ValueGraphEditor } from '@/features/keyframes/components/value-graph-editor';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { useTimelineStore } from '../stores/timeline-store';
import { useKeyframesStore } from '../stores/keyframes-store';
import { useKeyframeSelectionStore } from '../stores/keyframe-selection-store';
import { useTimelineCommandStore } from '../stores/timeline-command-store';
import { captureSnapshot } from '../stores/commands/snapshot';
import type { TimelineSnapshot } from '../stores/commands/types';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useTimelineSettingsStore } from '../stores/timeline-settings-store';
import type { AnimatableProperty, KeyframeRef } from '@/types/keyframe';
import * as timelineActions from '../stores/timeline-actions';
import { getTransitionBlockedRanges } from '@/features/keyframes/utils/transition-region';

/** Height of the panel header bar in pixels */
const GRAPH_PANEL_HEADER_HEIGHT = 32;

/** Height of the resize handle in pixels */
const RESIZE_HANDLE_HEIGHT = 6;

/** Default height of the graph content area in pixels */
const GRAPH_PANEL_CONTENT_HEIGHT = 200;

/** Minimum content height */
const MIN_CONTENT_HEIGHT = 100;

/** Maximum content height */
const MAX_CONTENT_HEIGHT = 500;

interface KeyframeGraphPanelProps {
  /** Whether the panel is open */
  isOpen: boolean;
  /** Callback to toggle panel visibility */
  onToggle: () => void;
  /** Callback to close the panel */
  onClose: () => void;
}

/**
 * Collapsible panel showing the keyframe value graph editor.
 * Displays graph for the first selected item that has keyframes.
 * Automatically uses full width of container.
 */
export const KeyframeGraphPanel = memo(function KeyframeGraphPanel({
  isOpen,
  onToggle,
  onClose,
}: KeyframeGraphPanelProps) {
  // Ref to measure container width
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Track content height (user can resize)
  const [contentHeight, setContentHeight] = useState(GRAPH_PANEL_CONTENT_HEIGHT);

  // Resize state
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartY = useRef(0);
  const resizeStartHeight = useRef(0);

  // Measure container width on mount and resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateWidth = () => {
      setContainerWidth(container.clientWidth);
    };

    // Initial measurement
    updateWidth();

    // Use ResizeObserver to track size changes
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isOpen]); // Re-measure when panel opens

  // Handle resize drag
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeStartY.current = e.clientY;
    resizeStartHeight.current = contentHeight;
  }, [contentHeight]);

  // Handle resize move and end via document events
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Dragging up (negative deltaY) should increase height
      const deltaY = resizeStartY.current - e.clientY;
      const newHeight = Math.min(
        MAX_CONTENT_HEIGHT,
        Math.max(MIN_CONTENT_HEIGHT, resizeStartHeight.current + deltaY)
      );
      setContentHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      // Note: We intentionally do NOT call onHeightChange during resize
      // The timeline panel should only resize when the graph panel is opened/closed,
      // not when the user drags the resize handle within the existing space
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Selected items
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);

  // Timeline state
  const items = useTimelineStore((s) => s.items);
  const keyframes = useKeyframesStore((s) => s.keyframes);
  const transitions = useTimelineStore((s) => s.transitions);
  // Use _updateKeyframe directly (no undo per call) for dragging
  const _updateKeyframe = useKeyframesStore((s) => s._updateKeyframe);

  // Ref to store snapshot captured on drag start for undo batching
  const dragSnapshotRef = useRef<TimelineSnapshot | null>(null);

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

  // Calculate transition-blocked frame ranges for the selected item
  const transitionBlockedRanges = useMemo(() => {
    if (!selectedItemWithKeyframes) return [];
    return getTransitionBlockedRanges(
      selectedItemWithKeyframes.item.id,
      selectedItemWithKeyframes.item,
      transitions
    );
  }, [selectedItemWithKeyframes, transitions]);

  // Handle drag start - capture snapshot for undo batching
  const handleDragStart = useCallback(() => {
    dragSnapshotRef.current = captureSnapshot();
  }, []);

  // Handle drag end - commit undo entry with pre-captured snapshot
  const handleDragEnd = useCallback(() => {
    const beforeSnapshot = dragSnapshotRef.current;
    if (beforeSnapshot) {
      useTimelineCommandStore.getState().addUndoEntry(
        { type: 'MOVE_KEYFRAME_GRAPH', payload: {} },
        beforeSnapshot
      );
      useTimelineSettingsStore.getState().markDirty();
      dragSnapshotRef.current = null;
    }
  }, []);

  // Handle keyframe move in graph editor (no undo per call - batched via drag start/end)
  const handleKeyframeMove = useCallback(
    (ref: KeyframeRef, newFrame: number, newValue: number) => {
      _updateKeyframe(ref.itemId, ref.property, ref.keyframeId, {
        frame: Math.max(0, Math.round(newFrame)),
        value: newValue,
      });
    },
    [_updateKeyframe]
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

  // Handle scrubbing in graph editor - convert clip-relative frame to absolute frame
  const handleScrub = useCallback(
    (clipRelativeFrame: number) => {
      if (!selectedItemWithKeyframes) return;
      
      // Convert clip-relative frame to absolute frame
      const absoluteFrame = selectedItemWithKeyframes.item.from + clipRelativeFrame;
      
      // Update the playback store's current frame
      usePlaybackStore.getState().setCurrentFrame(absoluteFrame);
    },
    [selectedItemWithKeyframes]
  );

  // Handle adding a keyframe at the current frame
  const handleAddKeyframe = useCallback(
    (property: AnimatableProperty, frame: number) => {
      if (!selectedItemWithKeyframes) return;

      // Get the interpolated value at this frame from existing keyframes
      const propKeyframes = selectedItemWithKeyframes.itemKeyframes.properties.find(
        (p) => p.property === property
      );
      
      // Default value based on property or interpolate from existing keyframes
      let value = 1; // Default for scale, opacity
      if (property === 'x' || property === 'y') value = 0;
      if (property === 'rotation') value = 0;

      // If there are existing keyframes, interpolate value
      if (propKeyframes && propKeyframes.keyframes.length > 0) {
        const sorted = propKeyframes.keyframes.toSorted((a, b) => a.frame - b.frame);
        const before = sorted.filter((kf) => kf.frame <= frame).pop();
        const after = sorted.find((kf) => kf.frame > frame);

        if (before && after) {
          // Linear interpolation between before and after
          const t = (frame - before.frame) / (after.frame - before.frame);
          value = before.value + (after.value - before.value) * t;
        } else if (before) {
          value = before.value;
        } else if (after) {
          value = after.value;
        }
      }

      timelineActions.addKeyframe(
        selectedItemWithKeyframes.item.id,
        property,
        frame,
        value
      );
    },
    [selectedItemWithKeyframes]
  );

  // Handle removing keyframes
  const handleRemoveKeyframes = useCallback(
    (refs: KeyframeRef[]) => {
      if (refs.length === 0) return;
      timelineActions.removeKeyframes(refs);
    },
    []
  );

  // Handle navigation to a keyframe - convert clip-relative frame to absolute
  const handleNavigateToKeyframe = useCallback(
    (clipRelativeFrame: number) => {
      if (!selectedItemWithKeyframes) return;
      const absoluteFrame = selectedItemWithKeyframes.item.from + clipRelativeFrame;
      usePlaybackStore.getState().setCurrentFrame(absoluteFrame);
    },
    [selectedItemWithKeyframes]
  );

  // Don't show panel if no item with keyframes is selected and panel is not explicitly open
  const hasContent = !!selectedItemWithKeyframes;

  if (!hasContent && !isOpen) {
    return null;
  }

  // Calculate total panel height for proper flex sizing
  // When closed, show just the header; when open, show header + resize handle + content
  const panelHeight = isOpen
    ? GRAPH_PANEL_HEADER_HEIGHT + RESIZE_HANDLE_HEIGHT + contentHeight
    : GRAPH_PANEL_HEADER_HEIGHT;

  return (
    <div
      className={cn(
        'flex-shrink-0 border-t border-border bg-background overflow-hidden',
        isOpen ? 'opacity-100' : 'opacity-90',
        !isResizing && 'transition-all duration-200'
      )}
      style={{ height: panelHeight }}
    >
      {/* Resize handle - only visible when open */}
      {isOpen && (
        <div
          className={cn(
            'h-1.5 cursor-ns-resize flex items-center justify-center',
            'bg-secondary/30 hover:bg-primary/30 transition-colors',
            isResizing && 'bg-primary/50'
          )}
          onMouseDown={handleResizeStart}
        >
          <div className="w-8 h-0.5 rounded-full bg-muted-foreground/30" />
        </div>
      )}

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
        <div ref={containerRef} className="p-2" style={{ height: contentHeight }}>
          {selectedItemWithKeyframes && containerWidth > 0 ? (
            <ValueGraphEditor
              itemId={selectedItemWithKeyframes.item.id}
              keyframesByProperty={keyframesByProperty}
              selectedProperty={selectedProperty}
              selectedKeyframeIds={selectedKeyframeIds}
              currentFrame={relativeFrame}
              totalFrames={selectedItemWithKeyframes.item.durationInFrames}
              width={containerWidth - 16} // Full width minus padding
              height={contentHeight - 16}
              onKeyframeMove={handleKeyframeMove}
              onSelectionChange={handleSelectionChange}
              onPropertyChange={handlePropertyChange}
              onScrub={handleScrub}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onAddKeyframe={handleAddKeyframe}
              onRemoveKeyframes={handleRemoveKeyframes}
              onNavigateToKeyframe={handleNavigateToKeyframe}
              transitionBlockedRanges={transitionBlockedRanges}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              {selectedItemWithKeyframes ? 'Loading...' : 'Select an item with keyframes to view the graph'}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
