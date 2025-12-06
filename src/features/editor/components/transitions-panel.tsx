import { memo, useCallback, useState } from 'react';
import {
  Blend,
  Scissors,
  ArrowRight,
  MoveRight,
  FlipHorizontal,
  Clock,
  Circle,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { useSelectionStore } from '../stores/selection-store';
import {
  PRESENTATION_CONFIGS,
  type TransitionPresentation,
  type WipeDirection,
  type SlideDirection,
  type FlipDirection,
} from '@/types/transition';
import { cn } from '@/lib/utils';

// Icon mapping for presentations
const ICON_MAP: Record<string, typeof Blend> = {
  Blend,
  Scissors,
  ArrowRight,
  MoveRight,
  FlipHorizontal,
  Clock,
  Circle,
};

// Color classes for each category
const CATEGORY_COLORS: Record<string, { bg: string; border: string; icon: string; hoverBg: string }> = {
  basic: {
    bg: 'bg-blue-500/20',
    border: 'border-blue-500/50',
    icon: 'text-blue-400',
    hoverBg: 'group-hover:bg-blue-500/30',
  },
  directional: {
    bg: 'bg-purple-500/20',
    border: 'border-purple-500/50',
    icon: 'text-purple-400',
    hoverBg: 'group-hover:bg-purple-500/30',
  },
  special: {
    bg: 'bg-amber-500/20',
    border: 'border-amber-500/50',
    icon: 'text-amber-400',
    hoverBg: 'group-hover:bg-amber-500/30',
  },
};

interface TransitionCardProps {
  presentation: TransitionPresentation;
  label: string;
  description: string;
  icon: string;
  category: 'basic' | 'directional' | 'special';
  supportsDirection?: boolean;
  directions?: Array<{ value: string; label: string }>;
  onApply: (presentation: TransitionPresentation, direction?: string) => void;
}

const TransitionCard = memo(function TransitionCard({
  presentation,
  label,
  description,
  icon,
  category,
  supportsDirection,
  directions,
  onApply,
}: TransitionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [selectedDirection, setSelectedDirection] = useState<string>(directions?.[0]?.value ?? '');
  const Icon = ICON_MAP[icon] ?? Blend;
  const colors = CATEGORY_COLORS[category] || CATEGORY_COLORS.basic!;

  const handleClick = useCallback(() => {
    if (supportsDirection && directions) {
      // Toggle expansion for directional transitions
      setExpanded(!expanded);
    } else {
      // Apply directly for non-directional transitions
      onApply(presentation);
    }
  }, [presentation, supportsDirection, directions, expanded, onApply]);

  const handleDirectionSelect = useCallback((direction: string) => {
    setSelectedDirection(direction);
    onApply(presentation, direction);
    setExpanded(false);
  }, [presentation, onApply]);

  return (
    <div className="flex flex-col">
      <button
        onClick={handleClick}
        className={cn(
          'flex items-center gap-2 p-2 rounded-lg border border-border',
          'bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50',
          'transition-colors group text-left w-full',
          expanded && 'border-primary/50 bg-secondary/50'
        )}
        title={description}
      >
        <div
          className={cn(
            'w-8 h-8 rounded flex items-center justify-center flex-shrink-0 border',
            colors.bg,
            colors.border,
            colors.hoverBg
          )}
        >
          <Icon className={cn('w-4 h-4', colors.icon)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-foreground truncate">{label}</div>
          <div className="text-[10px] text-muted-foreground truncate">{description}</div>
        </div>
        {supportsDirection && directions && (
          <div className="flex-shrink-0">
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </div>
        )}
      </button>

      {/* Direction options (expanded) */}
      {expanded && supportsDirection && directions && (
        <div className="mt-1 ml-4 pl-4 border-l border-border space-y-1">
          {directions.map((dir) => (
            <button
              key={dir.value}
              onClick={() => handleDirectionSelect(dir.value)}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs',
                'hover:bg-secondary/50 transition-colors',
                selectedDirection === dir.value && 'bg-primary/10 text-primary'
              )}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-current opacity-50" />
              {dir.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export const TransitionsPanel = memo(function TransitionsPanel() {
  const addTransition = useTimelineStore((s) => s.addTransition);
  const updateTransition = useTimelineStore((s) => s.updateTransition);
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);

  // Group presentations by category
  const basicTransitions = PRESENTATION_CONFIGS.filter((p) => p.category === 'basic');
  const directionalTransitions = PRESENTATION_CONFIGS.filter((p) => p.category === 'directional');
  const specialTransitions = PRESENTATION_CONFIGS.filter((p) => p.category === 'special');

  // Check if we can apply a transition between selected clips
  const canApplyTransition = useCallback(() => {
    if (selectedItemIds.length !== 2) return false;

    const items = useTimelineStore.getState().items;
    const transitions = useTimelineStore.getState().transitions;
    const selectedItems = items.filter((i) => selectedItemIds.includes(i.id));

    if (selectedItems.length !== 2) return false;

    const item0 = selectedItems[0]!;
    const item1 = selectedItems[1]!;

    // Both must be on the same track
    if (item0.trackId !== item1.trackId) return false;

    // Must be video or image
    const validTypes = ['video', 'image'];
    if (!validTypes.includes(item0.type) || !validTypes.includes(item1.type)) {
      return false;
    }

    // Sort by position
    const sorted = [...selectedItems].sort((a, b) => a.from - b.from);
    const left = sorted[0]!;
    const right = sorted[1]!;

    const leftEnd = left.from + left.durationInFrames;
    const rightStart = right.from;

    // Check if adjacent (for new transition)
    const isAdjacent = leftEnd === rightStart;

    // Check if overlapping (transition already exists between them)
    const existingTransition = transitions.find(
      (t) => (t.leftClipId === left.id && t.rightClipId === right.id) ||
             (t.leftClipId === right.id && t.rightClipId === left.id)
    );
    const hasExistingTransition = !!existingTransition;

    // Valid if adjacent OR already has a transition (can update it)
    return isAdjacent || hasExistingTransition;
  }, [selectedItemIds]);

  // Apply a transition to selected clips
  const handleApplyTransition = useCallback(
    (presentation: TransitionPresentation, direction?: string) => {
      if (!canApplyTransition()) {
        // Show info message - no valid selection
        return;
      }

      const items = useTimelineStore.getState().items;
      const selectedItems = items.filter((i) => selectedItemIds.includes(i.id));
      const sorted = [...selectedItems].sort((a, b) => a.from - b.from);

      const leftClip = sorted[0];
      const rightClip = sorted[1];
      if (!leftClip || !rightClip) return;

      const leftClipId = leftClip.id;
      const rightClipId = rightClip.id;

      // Add or update transition
      const transitions = useTimelineStore.getState().transitions;
      const existingTransition = transitions.find(
        (t) => t.leftClipId === leftClipId && t.rightClipId === rightClipId
      );

      if (existingTransition) {
        // Update existing transition
        updateTransition(existingTransition.id, {
          presentation,
          direction: direction as WipeDirection | SlideDirection | FlipDirection | undefined,
        });
      } else {
        // Add new transition
        addTransition(leftClipId, rightClipId, 'crossfade');
        // Then update the presentation
        const newTransitions = useTimelineStore.getState().transitions;
        const newTransition = newTransitions.find(
          (t) => t.leftClipId === leftClipId && t.rightClipId === rightClipId
        );
        if (newTransition) {
          updateTransition(newTransition.id, {
            presentation,
            direction: direction as WipeDirection | SlideDirection | FlipDirection | undefined,
          });
        }
      }
    },
    [selectedItemIds, canApplyTransition, addTransition, updateTransition]
  );

  const hasValidSelection = canApplyTransition();

  return (
    <div className="h-full flex flex-col">
      {/* Info banner */}
      <div className="px-3 py-2 border-b border-border bg-secondary/30">
        <div className="flex items-start gap-2 text-xs">
          <Info className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
          <div className="text-muted-foreground leading-relaxed">
            {hasValidSelection ? (
              <span className="text-primary">Select a transition to apply between the two selected clips.</span>
            ) : (
              <span>Select two adjacent clips on the same track to apply a transition between them.</span>
            )}
          </div>
        </div>
      </div>

      {/* Transitions list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Basic transitions */}
        <div>
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Basic
          </div>
          <div className="space-y-1.5">
            {basicTransitions.map((config) => (
              <TransitionCard
                key={config.id}
                presentation={config.id}
                label={config.label}
                description={config.description}
                icon={config.icon}
                category={config.category}
                supportsDirection={config.supportsDirection}
                directions={config.directions}
                onApply={handleApplyTransition}
              />
            ))}
          </div>
        </div>

        {/* Directional transitions */}
        <div>
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Directional
          </div>
          <div className="space-y-1.5">
            {directionalTransitions.map((config) => (
              <TransitionCard
                key={config.id}
                presentation={config.id}
                label={config.label}
                description={config.description}
                icon={config.icon}
                category={config.category}
                supportsDirection={config.supportsDirection}
                directions={config.directions}
                onApply={handleApplyTransition}
              />
            ))}
          </div>
        </div>

        {/* Special transitions */}
        <div>
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Special
          </div>
          <div className="space-y-1.5">
            {specialTransitions.map((config) => (
              <TransitionCard
                key={config.id}
                presentation={config.id}
                label={config.label}
                description={config.description}
                icon={config.icon}
                category={config.category}
                supportsDirection={config.supportsDirection}
                directions={config.directions}
                onApply={handleApplyTransition}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});
