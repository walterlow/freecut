import { useMemo, useCallback, memo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Blend,
  Scissors,
  ArrowRight,
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  MoveRight,
  MoveLeft,
  MoveDown,
  MoveUp,
  FlipHorizontal,
  FlipVertical,
  Clock,
  Circle,
  Trash2,
  Zap,
  Copy,
  type LucideIcon,
} from 'lucide-react';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { PropertySection, PropertyRow, SliderInput } from '../components';
import type { TimelineState, TimelineActions } from '@/features/timeline/types';
import type { SelectionState, SelectionActions } from '@/features/editor/types';
import {
  TRANSITION_CONFIGS,
  PRESENTATION_CONFIGS,
  type Transition,
  type TransitionPresentation,
  type TransitionTiming,
  type WipeDirection,
  type SlideDirection,
  type FlipDirection,
  type PresentationConfig,
} from '@/types/transition';
import { cn } from '@/lib/utils';

// Icon mapping for presentation types
const ICON_MAP: Record<string, LucideIcon> = {
  Blend,
  Scissors,
  ArrowRight,
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  MoveRight,
  MoveLeft,
  MoveDown,
  MoveUp,
  FlipHorizontal,
  FlipHorizontal2: FlipHorizontal, // Use same icon, rotated via CSS if needed
  FlipVertical,
  FlipVertical2: FlipVertical,
  Clock,
  Circle,
};

// Group presentations by category for the picker
const PRESENTATION_BY_CATEGORY = PRESENTATION_CONFIGS.reduce<
  Record<string, PresentationConfig[]>
>((acc, config) => {
  const category = config.category;
  if (!acc[category]) {
    acc[category] = [];
  }
  acc[category]!.push(config);
  return acc;
}, {});

const CATEGORY_LABELS: Record<string, string> = {
  basic: 'Basic',
  wipe: 'Wipe',
  slide: 'Slide',
  flip: 'Flip',
  special: 'Special',
};

/**
 * Single presentation option button
 */
const PresentationButton = memo(function PresentationButton({
  config,
  isSelected,
  onClick,
}: {
  config: PresentationConfig;
  isSelected: boolean;
  onClick: () => void;
}) {
  const Icon = ICON_MAP[config.icon] || Blend;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center gap-1 p-2 rounded-md border transition-all',
        'hover:bg-secondary/50 hover:border-primary/50',
        isSelected
          ? 'bg-primary/10 border-primary text-primary'
          : 'bg-secondary/30 border-border text-muted-foreground'
      )}
      title={config.description}
    >
      <Icon className="w-4 h-4" />
      <span className="text-[10px] font-medium truncate max-w-full">
        {config.label}
      </span>
    </button>
  );
});

/**
 * Grid of presentation options grouped by category
 */
const PresentationPicker = memo(function PresentationPicker({
  currentPresentation,
  currentDirection,
  onSelect,
}: {
  currentPresentation: TransitionPresentation;
  currentDirection?: WipeDirection | SlideDirection | FlipDirection;
  onSelect: (
    presentation: TransitionPresentation,
    direction?: WipeDirection | SlideDirection | FlipDirection
  ) => void;
}) {
  // Check if a config matches current selection
  const isSelected = useCallback(
    (config: PresentationConfig) => {
      if (config.id !== currentPresentation) return false;
      // For directional transitions, also check direction
      if (config.direction) {
        return config.direction === currentDirection;
      }
      return true;
    },
    [currentPresentation, currentDirection]
  );

  return (
    <div className="space-y-3">
      {Object.entries(PRESENTATION_BY_CATEGORY).map(([category, configs]) => (
        <div key={category}>
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {CATEGORY_LABELS[category]}
          </span>
          <div className="grid grid-cols-4 gap-1 mt-1">
            {configs.map((config, idx) => (
              <PresentationButton
                key={`${config.id}-${config.direction || idx}`}
                config={config}
                isSelected={isSelected(config)}
                onClick={() => onSelect(config.id, config.direction)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
});

/**
 * Transition properties panel - shown when a transition is selected.
 * Allows editing presentation style, duration, timing, and direction.
 */
export function TransitionPanel() {
  // Granular selectors (Zustand v5 best practice)
  const selectedTransitionId = useSelectionStore(
    (s: SelectionState) => s.selectedTransitionId
  );
  const clearSelection = useSelectionStore(
    (s: SelectionActions) => s.clearSelection
  );
  const transitions = useTimelineStore((s: TimelineState) => s.transitions);
  const updateTransition = useTimelineStore(
    (s: TimelineActions) => s.updateTransition
  );
  const removeTransition = useTimelineStore(
    (s: TimelineActions) => s.removeTransition
  );
  const fps = useTimelineStore((s: TimelineState) => s.fps);

  // Derive selected transition
  const selectedTransition = useMemo<Transition | undefined>(
    () => transitions.find((t: Transition) => t.id === selectedTransitionId),
    [transitions, selectedTransitionId]
  );

  // Get config for current transition type
  const transitionConfig =
    selectedTransition && selectedTransition.type in TRANSITION_CONFIGS
      ? TRANSITION_CONFIGS[selectedTransition.type]
      : null;

  // Handle presentation change
  const handlePresentationChange = useCallback(
    (
      presentation: TransitionPresentation,
      direction?: WipeDirection | SlideDirection | FlipDirection
    ) => {
      if (selectedTransitionId) {
        updateTransition(selectedTransitionId, { presentation, direction });
      }
    },
    [selectedTransitionId, updateTransition]
  );

  // Handle duration change (in frames)
  const handleDurationChange = useCallback(
    (durationInFrames: number) => {
      if (selectedTransitionId && transitionConfig) {
        const clamped = Math.max(
          transitionConfig.minDuration,
          Math.min(transitionConfig.maxDuration, Math.round(durationInFrames))
        );
        updateTransition(selectedTransitionId, { durationInFrames: clamped });
      }
    },
    [selectedTransitionId, transitionConfig, updateTransition]
  );

  // Handle timing change
  const handleTimingChange = useCallback(
    (timing: TransitionTiming) => {
      if (selectedTransitionId) {
        updateTransition(selectedTransitionId, { timing });
      }
    },
    [selectedTransitionId, updateTransition]
  );

  // Handle delete
  const handleDelete = useCallback(() => {
    if (selectedTransitionId) {
      removeTransition(selectedTransitionId);
      clearSelection();
    }
  }, [selectedTransitionId, removeTransition, clearSelection]);

  // Handle apply to all similar transitions
  // Applies current transition's settings to all transitions with same presentation type
  const handleApplyToAllSimilar = useCallback(() => {
    if (!selectedTransition) return;

    const similarTransitions = transitions.filter(
      (t: Transition) =>
        t.id !== selectedTransition.id &&
        t.presentation === selectedTransition.presentation
    );

    if (similarTransitions.length === 0) return;

    // Apply current settings to all similar transitions
    for (const t of similarTransitions) {
      updateTransition(t.id, {
        direction: selectedTransition.direction,
        timing: selectedTransition.timing,
        durationInFrames: selectedTransition.durationInFrames,
      });
    }
  }, [selectedTransition, transitions, updateTransition]);

  // Count similar transitions for button label
  const similarCount = useMemo(() => {
    if (!selectedTransition) return 0;
    return transitions.filter(
      (t: Transition) =>
        t.id !== selectedTransition.id &&
        t.presentation === selectedTransition.presentation
    ).length;
  }, [selectedTransition, transitions]);

  // Format duration for display
  const formatDuration = useCallback(
    (frames: number): string => {
      const seconds = frames / fps;
      return `${seconds.toFixed(2)}s`;
    },
    [fps]
  );

  if (!selectedTransition || !transitionConfig) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Zap className="w-8 h-8 text-muted-foreground/50 mb-2" />
        <p className="text-xs text-muted-foreground">Transition not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PropertySection title="Transition" icon={Zap} defaultOpen={true}>
        {/* Presentation picker */}
        <div className="py-2">
          <PresentationPicker
            currentPresentation={selectedTransition.presentation}
            currentDirection={selectedTransition.direction}
            onSelect={handlePresentationChange}
          />
        </div>

        {/* Duration slider */}
        <PropertyRow label="Duration" tooltip="Transition duration in frames">
          <SliderInput
            value={selectedTransition.durationInFrames}
            onChange={handleDurationChange}
            min={transitionConfig.minDuration}
            max={transitionConfig.maxDuration}
            step={1}
            formatValue={formatDuration}
          />
        </PropertyRow>

        {/* Timing selector */}
        <PropertyRow label="Timing" tooltip="Easing function for the transition">
          <Select
            value={selectedTransition.timing}
            onValueChange={(value) =>
              handleTimingChange(value as TransitionTiming)
            }
          >
            <SelectTrigger className="h-7 text-xs flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="linear">Linear</SelectItem>
              <SelectItem value="spring">Spring</SelectItem>
            </SelectContent>
          </Select>
        </PropertyRow>

        {/* Action buttons */}
        <div className="pt-2 space-y-2">
          {/* Apply to All Similar button - only show if there are similar transitions */}
          {similarCount > 0 && (
            <Button
              variant="secondary"
              size="sm"
              className="w-full h-7 text-xs"
              onClick={handleApplyToAllSimilar}
            >
              <Copy className="w-3 h-3 mr-1.5" />
              Apply to {similarCount} Similar
            </Button>
          )}

          {/* Delete button */}
          <Button
            variant="destructive"
            size="sm"
            className="w-full h-7 text-xs"
            onClick={handleDelete}
          >
            <Trash2 className="w-3 h-3 mr-1.5" />
            Delete Transition
          </Button>
        </div>
      </PropertySection>
    </div>
  );
}
