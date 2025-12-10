import { memo, useCallback, useMemo } from 'react';
import {
  Blend,
  Scissors,
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  MoveRight,
  MoveLeft,
  MoveUp,
  MoveDown,
  FlipHorizontal,
  FlipVertical,
  Clock,
  Circle,
  Info,
  type LucideIcon,
} from 'lucide-react';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { useSelectionStore } from '../stores/selection-store';
import {
  PRESENTATION_CONFIGS,
  type WipeDirection,
  type SlideDirection,
  type FlipDirection,
  type PresentationConfig,
} from '@/types/transition';
import { cn } from '@/lib/utils';

// Icon mapping for presentations
const ICON_MAP: Record<string, LucideIcon> = {
  Blend,
  Scissors,
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  MoveRight,
  MoveLeft,
  MoveUp,
  MoveDown,
  FlipHorizontal,
  FlipHorizontal2: FlipHorizontal,
  FlipVertical,
  FlipVertical2: FlipVertical,
  Clock,
  Circle,
};

// Category display info
const CATEGORY_INFO: Record<string, { title: string }> = {
  basic: { title: 'Basic' },
  wipe: { title: 'Wipe' },
  slide: { title: 'Slide' },
  flip: { title: 'Flip' },
  special: { title: 'Special' },
};

// Pre-computed categories (static data)
const CATEGORIES: Record<string, PresentationConfig[]> = {};
for (const config of PRESENTATION_CONFIGS) {
  if (!CATEGORIES[config.category]) {
    CATEGORIES[config.category] = [];
  }
  CATEGORIES[config.category]!.push(config);
}
const CATEGORY_ORDER = ['basic', 'wipe', 'slide', 'flip', 'special'];

// Pre-compute start indices for each category (static)
const CATEGORY_START_INDICES: Record<string, number> = {};
let _runningIndex = 0;
for (const category of CATEGORY_ORDER) {
  CATEGORY_START_INDICES[category] = _runningIndex;
  _runningIndex += (CATEGORIES[category]?.length || 0);
}

interface TransitionCardProps {
  config: PresentationConfig;
  configIndex: number;
  onApply: (index: number) => void;
  disabled?: boolean;
}

/**
 * Compact transition card - displays as a small clickable tile
 */
const TransitionCard = memo(function TransitionCard({
  config,
  configIndex,
  onApply,
  disabled,
}: TransitionCardProps) {
  const Icon = ICON_MAP[config.icon] ?? Blend;

  const handleClick = useCallback(() => {
    onApply(configIndex);
  }, [configIndex, onApply]);

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={cn(
        'flex flex-col items-center justify-center gap-1 p-2 rounded-lg',
        'border border-border bg-secondary/30',
        'hover:bg-secondary/50 hover:border-primary/50',
        'transition-colors group text-center',
        'min-w-[60px] h-[56px]',
        disabled && 'opacity-50 cursor-not-allowed hover:bg-secondary/30 hover:border-border'
      )}
      title={config.description}
    >
      <Icon className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
      <span className="text-[10px] text-muted-foreground group-hover:text-foreground truncate w-full">
        {config.label}
      </span>
    </button>
  );
});

/**
 * Category section with header and grid of cards
 */
interface CategorySectionProps {
  category: string;
  configs: PresentationConfig[];
  startIndex: number;
  onApply: (index: number) => void;
  disabled?: boolean;
}

const CategorySection = memo(function CategorySection({
  category,
  configs,
  startIndex,
  onApply,
  disabled,
}: CategorySectionProps) {
  const info = CATEGORY_INFO[category] || { title: category };

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        {info.title}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {configs.map((config, index) => (
          <TransitionCard
            key={`${config.id}-${config.direction || index}`}
            config={config}
            configIndex={startIndex + index}
            onApply={onApply}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
});

// Type for adjacent info result
interface AdjacentInfo {
  leftClipId: string;
  rightClipId: string;
  hasExisting: boolean;
  existingTransitionId?: string;
}

/**
 * Compute adjacent clip info for transition.
 * This is called inside a selector to avoid re-renders.
 */
function computeAdjacentInfo(
  selectedItemIds: string[],
  items: typeof useTimelineStore.getState extends () => infer S ? S extends { items: infer I } ? I : never : never,
  transitions: typeof useTimelineStore.getState extends () => infer S ? S extends { transitions: infer T } ? T : never : never
): AdjacentInfo | null {
  if (selectedItemIds.length !== 1) return null;

  const selectedId = selectedItemIds[0]!;
  const selectedItem = items.find((i) => i.id === selectedId);
  if (!selectedItem) return null;

  const validTypes = ['video', 'image'];
  if (!validTypes.includes(selectedItem.type)) return null;

  const trackItems = items
    .filter((i) => i.trackId === selectedItem.trackId && validTypes.includes(i.type))
    .sort((a, b) => a.from - b.from);

  const selectedIndex = trackItems.findIndex((i) => i.id === selectedId);
  if (selectedIndex === -1) return null;

  const selectedEnd = selectedItem.from + selectedItem.durationInFrames;

  // Check neighbors
  const leftNeighbor = trackItems[selectedIndex - 1];
  const rightNeighbor = trackItems[selectedIndex + 1];

  let canAddLeft = false;
  let leftClipId: string | undefined;
  let hasTransitionLeft = false;

  if (leftNeighbor) {
    const leftEnd = leftNeighbor.from + leftNeighbor.durationInFrames;
    canAddLeft = leftEnd === selectedItem.from;
    leftClipId = leftNeighbor.id;
    hasTransitionLeft = transitions.some(
      (t) => t.leftClipId === leftNeighbor.id && t.rightClipId === selectedId
    );
  }

  let canAddRight = false;
  let rightClipId: string | undefined;
  let hasTransitionRight = false;

  if (rightNeighbor) {
    canAddRight = selectedEnd === rightNeighbor.from;
    rightClipId = rightNeighbor.id;
    hasTransitionRight = transitions.some(
      (t) => t.leftClipId === selectedId && t.rightClipId === rightNeighbor.id
    );
  }

  // Prefer right neighbor
  if (canAddRight && !hasTransitionRight) {
    return { leftClipId: selectedId, rightClipId: rightClipId!, hasExisting: false };
  } else if (canAddLeft && !hasTransitionLeft) {
    return { leftClipId: leftClipId!, rightClipId: selectedId, hasExisting: false };
  } else if (canAddRight && hasTransitionRight) {
    return {
      leftClipId: selectedId,
      rightClipId: rightClipId!,
      hasExisting: true,
      existingTransitionId: transitions.find(
        (t) => t.leftClipId === selectedId && t.rightClipId === rightClipId
      )?.id,
    };
  } else if (canAddLeft && hasTransitionLeft) {
    return {
      leftClipId: leftClipId!,
      rightClipId: selectedId,
      hasExisting: true,
      existingTransitionId: transitions.find(
        (t) => t.leftClipId === leftClipId && t.rightClipId === selectedId
      )?.id,
    };
  }

  return null;
}

export const TransitionsPanel = memo(function TransitionsPanel() {
  const addTransition = useTimelineStore((s) => s.addTransition);
  const updateTransition = useTimelineStore((s) => s.updateTransition);
  const items = useTimelineStore((s) => s.items);
  const transitions = useTimelineStore((s) => s.transitions);

  // Get selection
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);
  const selectionCount = selectedItemIds.length;
  const selectedId = selectionCount === 1 ? selectedItemIds[0] : null;

  // Compute adjacentInfo with useMemo (stable reference)
  const adjacentInfo = useMemo(() => {
    if (!selectedId) return null;
    return computeAdjacentInfo([selectedId], items, transitions);
  }, [selectedId, items, transitions]);

  // Apply a transition by config index - reads from store directly to avoid stale closure
  const handleApplyByIndex = useCallback(
    (configIndex: number) => {
      const config = PRESENTATION_CONFIGS[configIndex];
      if (!config) return;

      // Get fresh state at click time
      const { items, transitions } = useTimelineStore.getState();
      const currentSelectedIds = useSelectionStore.getState().selectedItemIds;
      const info = computeAdjacentInfo(currentSelectedIds, items, transitions);

      if (!info) return;

      const { leftClipId, rightClipId, hasExisting, existingTransitionId } = info;
      const presentation = config.id;
      const direction = config.direction as WipeDirection | SlideDirection | FlipDirection | undefined;

      if (hasExisting && existingTransitionId) {
        // Update existing transition
        updateTransition(existingTransitionId, { presentation, direction });
      } else {
        // Add new transition with presentation and direction in a single operation
        // This ensures undo/redo works as a single step
        addTransition(leftClipId, rightClipId, 'crossfade', undefined, presentation, direction);
      }
    },
    [addTransition, updateTransition]
  );

  const hasValidSelection = adjacentInfo !== null;

  return (
    <div className="h-full flex flex-col">
      {/* Info banner */}
      <div className="px-3 py-2 border-b border-border bg-secondary/30">
        <div className="flex items-start gap-2 text-xs">
          <Info className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
          <div className="text-muted-foreground leading-relaxed">
            {hasValidSelection ? (
              <span className="text-primary">
                Click a transition to apply it{' '}
                {adjacentInfo?.hasExisting ? '(will update existing)' : 'between clips'}.
              </span>
            ) : selectionCount === 1 ? (
              <span>No adjacent clip found. Place clips next to each other on the timeline.</span>
            ) : selectionCount > 1 ? (
              <span>Select a single video or image clip to add a transition.</span>
            ) : (
              <span>Select a video or image clip to add a transition to its neighbor.</span>
            )}
          </div>
        </div>
      </div>

      {/* Transitions grid by category */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {CATEGORY_ORDER.map((category) => (
          <CategorySection
            key={category}
            category={category}
            configs={CATEGORIES[category] || []}
            startIndex={CATEGORY_START_INDICES[category]!}
            onApply={handleApplyByIndex}
            disabled={!hasValidSelection}
          />
        ))}
      </div>
    </div>
  );
});
