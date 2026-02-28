/**
 * Keyframe toggle button component.
 * Diamond-shaped button that appears next to animatable properties.
 * - Hollow diamond: No keyframe at current frame (click to add)
 * - Filled diamond: Keyframe exists at current frame (click to remove)
 * - Disabled with strikethrough: Frame is in transition region (keyframes not allowed)
 */

import { useCallback, useMemo } from 'react';
import { Diamond } from 'lucide-react';
import { cn } from '@/shared/ui/cn';
import { useTimelineStore } from '@/features/keyframes/deps/timeline';
import { useThrottledFrame } from '@/features/keyframes/deps/preview-contract';
import type { AnimatableProperty } from '@/types/keyframe';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  isFrameInTransitionRegion,
  getTransitionBlockedMessage,
} from '../utils/transition-region';

interface KeyframeToggleProps {
  /** The item ID(s) to toggle keyframes for */
  itemIds: string[];
  /** The property to animate */
  property: AnimatableProperty;
  /** Current value of the property (used when adding keyframe) */
  currentValue: number;
  /** Optional class name for the button */
  className?: string;
  /** Disabled state */
  disabled?: boolean;
}

/**
 * Keyframe toggle button for property panels.
 * Adds or removes a keyframe at the current playhead position.
 */
export function KeyframeToggle({
  itemIds,
  property,
  currentValue,
  className,
  disabled = false,
}: KeyframeToggleProps) {
  // Get current frame (throttled to reduce re-renders during playback)
  const currentFrame = useThrottledFrame();

  // Get keyframes for the first item (for multi-select, we show state of first item)
  const firstItemId = itemIds[0];
  const itemKeyframes = useTimelineStore(
    useCallback(
      (s) => (firstItemId ? s.keyframes.find((k) => k.itemId === firstItemId) : undefined),
      [firstItemId]
    )
  );

  // Get store actions
  const addKeyframe = useTimelineStore((s) => s.addKeyframe);
  const removeKeyframe = useTimelineStore((s) => s.removeKeyframe);

  // Get the first item to calculate relative frame
  const firstItem = useTimelineStore(
    useCallback(
      (s) => (firstItemId ? s.items.find((i) => i.id === firstItemId) : undefined),
      [firstItemId]
    )
  );

  // Get transitions to check for blocked regions
  const transitions = useTimelineStore((s) => s.transitions);

  // Calculate frame relative to item start
  const relativeFrame = useMemo(() => {
    if (!firstItem) return 0;
    return currentFrame - firstItem.from;
  }, [currentFrame, firstItem]);

  // Check if frame is in a transition region (blocked for keyframes)
  const transitionBlockedRange = useMemo(() => {
    if (!firstItem || !firstItemId) return undefined;
    return isFrameInTransitionRegion(relativeFrame, firstItemId, firstItem, transitions);
  }, [relativeFrame, firstItemId, firstItem, transitions]);

  const isInTransition = transitionBlockedRange !== undefined;

  // Check if keyframe exists at current frame
  const keyframeAtFrame = useMemo(() => {
    if (!itemKeyframes) return undefined;
    const propKeyframes = itemKeyframes.properties.find((p) => p.property === property);
    if (!propKeyframes) return undefined;
    return propKeyframes.keyframes.find((k) => k.frame === relativeFrame);
  }, [itemKeyframes, property, relativeFrame]);

  const hasKeyframe = keyframeAtFrame !== undefined;

  // Check if property has any keyframes at all
  const hasAnyKeyframes = useMemo(() => {
    if (!itemKeyframes) return false;
    const propKeyframes = itemKeyframes.properties.find((p) => p.property === property);
    return propKeyframes ? propKeyframes.keyframes.length > 0 : false;
  }, [itemKeyframes, property]);

  // Handle toggle click
  const handleToggle = useCallback(() => {
    if (disabled || isInTransition || !firstItemId || relativeFrame < 0) return;

    if (hasKeyframe && keyframeAtFrame) {
      // Remove keyframe
      removeKeyframe(firstItemId, property, keyframeAtFrame.id);
    } else {
      // Add keyframe at current frame with current value
      addKeyframe(firstItemId, property, relativeFrame, currentValue);
    }
  }, [
    disabled,
    isInTransition,
    firstItemId,
    relativeFrame,
    hasKeyframe,
    keyframeAtFrame,
    removeKeyframe,
    addKeyframe,
    property,
    currentValue,
  ]);

  // Don't render if outside item bounds
  // Valid frame range is [0, durationInFrames - 1] since durationInFrames is a count
  if (!firstItem || relativeFrame < 0 || relativeFrame >= firstItem.durationInFrames) {
    return null;
  }

  // Compute effective disabled state
  const effectiveDisabled = disabled || isInTransition;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleToggle}
          disabled={effectiveDisabled}
          className={cn(
            'flex items-center justify-center w-5 h-5 rounded-sm transition-colors',
            'hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            effectiveDisabled && 'opacity-50 cursor-not-allowed',
            isInTransition && 'line-through',
            hasKeyframe && !isInTransition && 'text-amber-500',
            !hasKeyframe && hasAnyKeyframes && !isInTransition && 'text-amber-500/50',
            !hasKeyframe && !hasAnyKeyframes && !isInTransition && 'text-muted-foreground',
            isInTransition && 'text-muted-foreground/50',
            className
          )}
          aria-label={
            isInTransition
              ? 'Keyframes blocked (transition region)'
              : hasKeyframe
                ? 'Remove keyframe'
                : 'Add keyframe'
          }
        >
          <Diamond
            className={cn(
              'w-3 h-3 rotate-0 transition-transform',
              hasKeyframe && !isInTransition && 'fill-current'
            )}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-[200px]">
        {isInTransition && transitionBlockedRange ? (
          <>{getTransitionBlockedMessage(transitionBlockedRange)}</>
        ) : hasKeyframe ? (
          <>Remove keyframe at frame {relativeFrame}</>
        ) : (
          <>Add keyframe at frame {relativeFrame}</>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

