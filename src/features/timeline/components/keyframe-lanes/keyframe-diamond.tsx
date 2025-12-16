/**
 * Keyframe diamond marker component.
 * Renders a diamond shape representing a keyframe on a lane.
 * Includes advanced easing picker in context menu.
 */

import { memo, useCallback, useState } from 'react';
import { Trash2, Copy, CopyPlus, MousePointerClick, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Keyframe, AnimatableProperty, EasingType, EasingConfig, KeyframeRef } from '@/types/keyframe';
import { EASING_LABELS, BASIC_EASING_TYPES } from '@/types/keyframe';
import { useTimelineStore } from '../../stores/timeline-store';
import { useKeyframeSelectionStore } from '../../stores/keyframe-selection-store';
import { useKeyframesStore } from '../../stores/keyframes-store';
import { AdvancedEasingPicker } from '@/features/keyframes/components/advanced-easing-picker';

interface KeyframeDiamondProps {
  /** The keyframe data */
  keyframe: Keyframe;
  /** The item ID this keyframe belongs to */
  itemId: string;
  /** The property this keyframe animates */
  property: AnimatableProperty;
  /** Left position in pixels from lane start */
  leftPx: number;
  /** Whether this keyframe is selected */
  isSelected?: boolean;
  /** Callback when keyframe is clicked */
  onSelect?: (keyframeId: string, shiftKey: boolean) => void;
  /** Callback when drag starts */
  onDragStart?: (e: React.MouseEvent, ref: KeyframeRef) => void;
  /** Offset in pixels during drag (for preview) */
  dragOffsetPx?: number;
  /** Whether this keyframe is part of a multi-selection being dragged */
  isDragging?: boolean;
}

/**
 * Individual keyframe marker on a keyframe lane.
 * Diamond-shaped indicator that can be selected and dragged.
 */
export const KeyframeDiamond = memo(function KeyframeDiamond({
  keyframe,
  itemId,
  property,
  leftPx,
  isSelected = false,
  onSelect,
  onDragStart,
  dragOffsetPx = 0,
  isDragging = false,
}: KeyframeDiamondProps) {
  // State for advanced easing dialog
  const [showAdvancedEasing, setShowAdvancedEasing] = useState(false);

  const removeKeyframe = useTimelineStore((s) => s.removeKeyframe);
  const updateKeyframe = useTimelineStore((s) => s.updateKeyframe);

  // Selection store
  const copySelectedKeyframes = useKeyframeSelectionStore((s) => s.copySelectedKeyframes);
  const selectAllForProperty = useKeyframeSelectionStore((s) => s.selectAllForProperty);
  const selectedKeyframes = useKeyframeSelectionStore((s) => s.selectedKeyframes);

  // Keyframes store
  const duplicateKeyframes = useKeyframesStore((s) => s._duplicateKeyframes);

  // Check if multiple keyframes selected
  const hasMultipleSelected = selectedKeyframes.length > 1;

  // Create ref for this keyframe
  const keyframeRef: KeyframeRef = {
    itemId,
    property,
    keyframeId: keyframe.id,
  };

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect?.(keyframe.id, e.shiftKey);
    },
    [keyframe.id, onSelect]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only start drag on left click without modifier keys
      if (e.button !== 0 || e.ctrlKey || e.metaKey) return;

      // If not selected, select first
      if (!isSelected) {
        onSelect?.(keyframe.id, false);
      }

      // Start drag
      onDragStart?.(e, keyframeRef);
    },
    [keyframe.id, isSelected, onSelect, onDragStart, keyframeRef]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      // Double-click to delete
      removeKeyframe(itemId, property, keyframe.id);
    },
    [itemId, property, keyframe.id, removeKeyframe]
  );

  const handleDelete = useCallback(() => {
    removeKeyframe(itemId, property, keyframe.id);
  }, [itemId, property, keyframe.id, removeKeyframe]);

  const handleEasingChange = useCallback(
    (value: string) => {
      updateKeyframe(itemId, property, keyframe.id, { easing: value as EasingType });
    },
    [itemId, property, keyframe.id, updateKeyframe]
  );

  const handleCopy = useCallback(() => {
    copySelectedKeyframes();
  }, [copySelectedKeyframes]);

  const handleDuplicate = useCallback(() => {
    // Duplicate selected keyframes 10 frames forward
    duplicateKeyframes(selectedKeyframes, 10);
  }, [duplicateKeyframes, selectedKeyframes]);

  const handleSelectAll = useCallback(() => {
    selectAllForProperty(itemId, property);
  }, [selectAllForProperty, itemId, property]);

  // Handle advanced easing change
  const handleAdvancedEasingChange = useCallback(
    (type: EasingType, config?: EasingConfig) => {
      updateKeyframe(itemId, property, keyframe.id, {
        easing: type,
        easingConfig: config,
      });
      setShowAdvancedEasing(false);
    },
    [itemId, property, keyframe.id, updateKeyframe]
  );

  // Calculate position with drag offset
  const displayLeft = leftPx + dragOffsetPx;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              'absolute top-1/2 -translate-y-1/2 -translate-x-1/2',
              'w-2.5 h-2.5 rotate-45 cursor-grab',
              'transition-colors duration-100',
              'hover:scale-110',
              isDragging && 'cursor-grabbing opacity-70',
              isSelected
                ? 'bg-amber-400 border border-amber-600'
                : 'bg-amber-500/80 border border-amber-600/50 hover:bg-amber-400'
            )}
            style={{ left: displayLeft }}
            onClick={handleClick}
            onMouseDown={handleMouseDown}
            onDoubleClick={handleDoubleClick}
            title={`Frame ${keyframe.frame}: ${keyframe.value.toFixed(1)} (${EASING_LABELS[keyframe.easing]})`}
          />
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {/* Quick easing options */}
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <span>Quick Easing</span>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48">
              <ContextMenuRadioGroup value={keyframe.easing} onValueChange={handleEasingChange}>
                {BASIC_EASING_TYPES.map((type) => (
                  <ContextMenuRadioItem key={type} value={type}>
                    {EASING_LABELS[type]}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>

          {/* Advanced easing - opens dialog */}
          <ContextMenuItem onClick={() => setShowAdvancedEasing(true)}>
            <Settings2 className="mr-2 h-4 w-4" />
            Advanced Easing...
          </ContextMenuItem>

          <ContextMenuSeparator />

          {/* Clipboard operations */}
          <ContextMenuItem onClick={handleCopy}>
            <Copy className="mr-2 h-4 w-4" />
            Copy {hasMultipleSelected ? `(${selectedKeyframes.length})` : ''}
            <span className="ml-auto text-xs text-muted-foreground">Ctrl+C</span>
          </ContextMenuItem>

          <ContextMenuItem onClick={handleDuplicate}>
            <CopyPlus className="mr-2 h-4 w-4" />
            Duplicate
            <span className="ml-auto text-xs text-muted-foreground">Ctrl+D</span>
          </ContextMenuItem>

          <ContextMenuSeparator />

          {/* Selection operations */}
          <ContextMenuItem onClick={handleSelectAll}>
            <MousePointerClick className="mr-2 h-4 w-4" />
            Select All Keyframes
            <span className="ml-auto text-xs text-muted-foreground">Ctrl+A</span>
          </ContextMenuItem>

          <ContextMenuSeparator />

          {/* Delete */}
          <ContextMenuItem onClick={handleDelete} className="text-destructive focus:text-destructive">
            <Trash2 className="mr-2 h-4 w-4" />
            Delete {hasMultipleSelected ? `(${selectedKeyframes.length})` : ''}
            <span className="ml-auto text-xs text-muted-foreground">Del</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Advanced Easing Dialog */}
      <Dialog open={showAdvancedEasing} onOpenChange={setShowAdvancedEasing}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Keyframe Easing</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <AdvancedEasingPicker
              value={keyframe.easing}
              easingConfig={keyframe.easingConfig}
              onChange={handleAdvancedEasingChange}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
});
