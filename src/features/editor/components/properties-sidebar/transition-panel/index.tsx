import { useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Trash2,
  Zap,
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
import { transitionRegistry } from '@/core/timeline/transitions';
import {
  TRANSITION_CATEGORY_INFO,
  getTransitionConfigsByCategory,
} from '@/features/editor/utils/transition-ui-config';
import { getMaxTransitionDurationForHandles } from '@/features/editor/deps/timeline-utils';

function getPresentationOptionValue(config: Pick<PresentationConfig, 'id' | 'direction'>): string {
  return config.direction ? `${config.id}:${config.direction}` : config.id;
}

function getPresentationOptionLabel(config: Pick<PresentationConfig, 'label' | 'description' | 'direction'>): string {
  return config.direction ? config.description : config.label;
}

const EASE_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'In' },
  { value: 'ease-out', label: 'Out' },
  { value: 'ease-in-out', label: 'In & Out' },
] as const satisfies ReadonlyArray<{ value: TransitionTiming; label: string }>;

function getSupportedEaseOptions(
  supportedTimings: readonly TransitionTiming[],
): ReadonlyArray<(typeof EASE_OPTIONS)[number]> {
  return EASE_OPTIONS.filter((option) => supportedTimings.includes(option.value));
}

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
  const items = useTimelineStore((s: TimelineState) => s.items);

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
  const leftClip = useMemo(
    () => selectedTransition ? items.find((item) => item.id === selectedTransition.leftClipId) : null,
    [items, selectedTransition],
  );
  const rightClip = useMemo(
    () => selectedTransition ? items.find((item) => item.id === selectedTransition.rightClipId) : null,
    [items, selectedTransition],
  );
  const presentationConfigGroups = useMemo(
    () => Object.entries(getTransitionConfigsByCategory()).filter(([, configs]) => configs.length > 0),
    [],
  );
  const presentationConfigs = useMemo(
    () => presentationConfigGroups.flatMap(([, configs]) => configs),
    [presentationConfigGroups],
  );
  const currentPresentationConfig = useMemo(
    () => presentationConfigs.find((config) => (
      config.id === selectedTransition?.presentation
      && (config.direction ?? undefined) === (selectedTransition?.direction ?? undefined)
    )),
    [presentationConfigs, selectedTransition?.presentation, selectedTransition?.direction],
  );
  const transitionDefinition = useMemo(
    () => selectedTransition ? transitionRegistry.getDefinition(selectedTransition.presentation) : undefined,
    [selectedTransition],
  );
  const easeOptions = useMemo(
    () => getSupportedEaseOptions(transitionDefinition?.supportedTimings ?? []),
    [transitionDefinition],
  );

  const minDuration = 1;
  const maxDuration = useMemo(() => {
    if (!transitionConfig || !selectedTransition || !leftClip || !rightClip) {
      return fps * 3;
    }

    const leftEnd = leftClip.from + leftClip.durationInFrames;
    const isAdjacent = Math.abs(leftEnd - rightClip.from) <= 1;
    if (!isAdjacent) {
      const legacyMax = Math.floor(Math.min(leftClip.durationInFrames, rightClip.durationInFrames) - 1);
      return Math.max(minDuration, Math.max(selectedTransition.durationInFrames, Math.min(fps * 3, legacyMax)));
    }

    const handleMax = getMaxTransitionDurationForHandles(leftClip, rightClip, selectedTransition.alignment);
    return Math.max(minDuration, Math.max(selectedTransition.durationInFrames, Math.min(fps * 3, handleMax)));
  }, [transitionConfig, selectedTransition, leftClip, rightClip, fps]);

  // Handle presentation change
  const handlePresentationChange = useCallback(
    (
      presentation: TransitionPresentation,
      direction?: WipeDirection | SlideDirection | FlipDirection
    ) => {
      if (selectedTransitionId) {
        const updates: Partial<Transition> = { presentation, direction };
        const nextDefinition = transitionRegistry.getDefinition(presentation);
        const nextEaseOptions = getSupportedEaseOptions(nextDefinition?.supportedTimings ?? []);
        const fallbackEase = nextEaseOptions[0];
        const currentTiming = selectedTransition?.timing;
        if (
          fallbackEase
          && nextDefinition
          && currentTiming
          && !nextDefinition.supportedTimings.includes(currentTiming)
        ) {
          updates.timing = fallbackEase.value;
        }
        updateTransition(selectedTransitionId, updates);
      }
    },
    [selectedTransitionId, selectedTransition?.timing, updateTransition]
  );

  const handlePresentationPresetChange = useCallback((value: string) => {
    const config = presentationConfigs.find((entry) => getPresentationOptionValue(entry) === value);
    if (!config) return;
    handlePresentationChange(config.id, config.direction);
  }, [handlePresentationChange, presentationConfigs]);

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
  const defaultDuration = Math.min(fps, maxDuration);

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
        <PropertyRow label="Preset" tooltip="Transition style preset">
          <div className="w-full">
            <Select
              value={currentPresentationConfig ? getPresentationOptionValue(currentPresentationConfig) : undefined}
              onValueChange={handlePresentationPresetChange}
            >
              <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                <SelectValue placeholder="Select preset" />
              </SelectTrigger>
              <SelectContent>
                {presentationConfigGroups.map(([category, configs]) => (
                  <SelectGroup key={category}>
                    <SelectLabel className="text-[10px] text-muted-foreground">
                      {TRANSITION_CATEGORY_INFO[category]?.title ?? category}
                    </SelectLabel>
                    {configs.map((config) => (
                      <SelectItem
                        key={getPresentationOptionValue(config)}
                        value={getPresentationOptionValue(config)}
                        className="text-xs"
                      >
                        {getPresentationOptionLabel(config)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
        </PropertyRow>

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

        {easeOptions.length > 0 && (
          <PropertyRow label="Ease" tooltip="Easing curve for the transition">
            <div className="flex items-center gap-0.5 p-0.5 bg-secondary rounded-md">
              {easeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleTimingChange(option.value)}
                className={cn(
                  'px-3 py-1 text-xs rounded transition-colors',
                  selectedTransition.timing === option.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {option.label}
              </button>
              ))}
            </div>
          </PropertyRow>
        )}

        {/* Action buttons */}
        <div className="pt-2">
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
