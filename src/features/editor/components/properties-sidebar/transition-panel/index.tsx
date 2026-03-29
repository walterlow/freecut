import { useMemo, useCallback, memo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Blend,
  Trash2,
  Zap,
  Copy,
  RotateCcw,
} from 'lucide-react';
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import { useSelectionStore } from '@/shared/state/selection';
import { PropertySection, PropertyRow, SliderInput } from '../components';
import type { TimelineState, TimelineActions } from '@/features/editor/deps/timeline-store';
import type { SelectionState, SelectionActions } from '@/shared/state/selection';
import {
  TRANSITION_CONFIGS,
  type Transition,
  type TransitionPresentation,
  type TransitionTiming,
  type WipeDirection,
  type SlideDirection,
  type FlipDirection,
  type PresentationConfig,
} from '@/types/transition';
import { cn } from '@/shared/ui/cn';
import {
  TRANSITION_ICON_MAP,
  TRANSITION_CATEGORY_INFO,
  TRANSITION_CATEGORY_ORDER,
  TRANSITION_CONFIGS_BY_CATEGORY,
} from '@/features/editor/utils/transition-ui-config';

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
  const Icon = TRANSITION_ICON_MAP[config.icon] || Blend;

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
      {TRANSITION_CATEGORY_ORDER.map((category) => {
        const configs = TRANSITION_CONFIGS_BY_CATEGORY[category];
        if (!configs || configs.length === 0) return null;
        return (
          <div key={category}>
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {TRANSITION_CATEGORY_INFO[category]?.title ?? category}
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
        );
      })}
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
  const updateTransitions = useTimelineStore(
    (s: TimelineActions) => s.updateTransitions
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

  // Presentations that support spring timing (transforms that can overshoot)
  const supportsSpringTiming = useCallback(
    (presentation: TransitionPresentation) => {
      return presentation === 'slide' || presentation === 'flip';
    },
    []
  );

  const minDuration = fps;
  const maxDuration = fps * 3;

  // Handle presentation change
  const handlePresentationChange = useCallback(
    (
      presentation: TransitionPresentation,
      direction?: WipeDirection | SlideDirection | FlipDirection
    ) => {
      if (selectedTransitionId) {
        // Reset timing to linear if switching to a presentation that doesn't support spring
        const updates: Partial<Transition> = { presentation, direction };
        if (!supportsSpringTiming(presentation) && selectedTransition?.timing === 'spring') {
          updates.timing = 'linear';
        }
        updateTransition(selectedTransitionId, updates);
      }
    },
    [selectedTransitionId, updateTransition, supportsSpringTiming, selectedTransition?.timing]
  );

  // Handle duration change (in frames)
  const handleDurationChange = useCallback(
    (durationInFrames: number) => {
      if (selectedTransitionId && transitionConfig) {
        const clamped = Math.max(
          minDuration,
          Math.min(maxDuration, Math.round(durationInFrames))
        );
        updateTransition(selectedTransitionId, { durationInFrames: clamped });
      }
    },
    [selectedTransitionId, transitionConfig, updateTransition, minDuration, maxDuration]
  );

  // Default duration is 1 second (fps frames)
  const defaultDuration = fps;

  // Handle reset duration to default (1 second)
  const handleResetDuration = useCallback(() => {
    if (selectedTransitionId && transitionConfig) {
      const clamped = Math.max(
        minDuration,
        Math.min(maxDuration, defaultDuration)
      );
      updateTransition(selectedTransitionId, { durationInFrames: clamped });
    }
  }, [selectedTransitionId, transitionConfig, updateTransition, defaultDuration, minDuration, maxDuration]);

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

  // Handle apply duration to all other transitions (single undo)
  const handleApplyDurationToAll = useCallback(() => {
    if (!selectedTransition) return;

    const otherTransitions = transitions.filter(
      (t: Transition) => t.id !== selectedTransition.id
    );

    if (otherTransitions.length === 0) return;

    // Batch update for single undo
    updateTransitions(
      otherTransitions.map((t) => ({
        id: t.id,
        updates: { durationInFrames: selectedTransition.durationInFrames },
      }))
    );
  }, [selectedTransition, transitions, updateTransitions]);

  // Count other transitions for button label
  const otherTransitionsCount = useMemo(() => {
    if (!selectedTransition) return 0;
    return transitions.filter(
      (t: Transition) => t.id !== selectedTransition.id
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

  const formatDurationInput = useCallback(
    (frames: number): string => (frames / fps).toFixed(2),
    [fps]
  );

  const parseDurationInput = useCallback(
    (rawValue: string): number => {
      const normalized = rawValue.trim().replace(/s$/i, '');
      const seconds = parseFloat(normalized);
      return Number.isFinite(seconds) ? seconds * fps : Number.NaN;
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
        <PropertyRow label="Duration" tooltip="Transition duration">
          <div className="flex items-center gap-1 w-full">
            <SliderInput
              value={selectedTransition.durationInFrames}
              onChange={handleDurationChange}
              min={minDuration}
              max={maxDuration}
              step={1}
              formatValue={formatDuration}
              formatInputValue={formatDurationInput}
              parseInputValue={parseDurationInput}
              className="flex-1 min-w-0"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={handleResetDuration}
              title="Reset to 1s"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>

        {/* Timing toggle - only show for slide/flip presentations that support spring */}
        {supportsSpringTiming(selectedTransition.presentation) && (
          <PropertyRow label="Timing" tooltip="Easing function for the transition">
            <div className="flex items-center gap-0.5 p-0.5 bg-secondary rounded-md">
              <button
                type="button"
                onClick={() => handleTimingChange('linear')}
                className={cn(
                  'px-3 py-1 text-xs rounded transition-colors',
                  selectedTransition.timing === 'linear'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                Linear
              </button>
              <button
                type="button"
                onClick={() => handleTimingChange('spring')}
                className={cn(
                  'px-3 py-1 text-xs rounded transition-colors',
                  selectedTransition.timing === 'spring'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                Spring
              </button>
            </div>
          </PropertyRow>
        )}

        {/* Action buttons */}
        <div className="pt-2 space-y-2">
          {/* Apply duration to all - only show if there are other transitions */}
          {otherTransitionsCount > 0 && (
            <Button
              variant="secondary"
              size="sm"
              className="w-full h-7 text-xs"
              onClick={handleApplyDurationToAll}
              title={`Apply ${formatDuration(selectedTransition.durationInFrames)} duration to ${otherTransitionsCount} other transition${otherTransitionsCount > 1 ? 's' : ''}`}
            >
              <Copy className="w-3 h-3 mr-1.5" />
              Apply duration to all ({otherTransitionsCount})
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
            Delete
          </Button>
        </div>
      </PropertySection>
    </div>
  );
}
