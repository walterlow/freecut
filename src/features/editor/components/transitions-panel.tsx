import { memo, useCallback, useMemo } from 'react';
import {
  Blend,
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
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import { useSelectionStore } from '@/shared/state/selection';
import { transitionRegistry } from '@/domain/timeline/transitions';
import { areFramesAligned } from '@/features/editor/deps/timeline-utils';
import type { Transition } from '@/types/transition';
import type {
  TransitionCategory,
  WipeDirection,
  SlideDirection,
  FlipDirection,
  PresentationConfig,
} from '@/types/transition';
import { cn } from '@/shared/ui/cn';

// Icon mapping for presentations
const ICON_MAP: Record<string, LucideIcon> = {
  Blend,
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
  mask: { title: 'Mask' },
  light: { title: 'Light' },
  custom: { title: 'Custom' },
};

const CATEGORY_ORDER: TransitionCategory[] = [
  'basic', 'wipe', 'slide', 'flip', 'mask',
];

// Direction labels for directional transitions
const DIRECTION_LABELS: Record<string, { label: string; icon: string }> = {
  'from-left': { label: 'Left', icon: 'ArrowRight' },
  'from-right': { label: 'Right', icon: 'ArrowLeft' },
  'from-top': { label: 'Top', icon: 'ArrowDown' },
  'from-bottom': { label: 'Bottom', icon: 'ArrowUp' },
};

/**
 * Generate PresentationConfig array from the transition registry.
 * Directional transitions produce one config per direction.
 */
function generateConfigsFromRegistry(): PresentationConfig[] {
  const configs: PresentationConfig[] = [];
  const definitions = transitionRegistry.getDefinitions();

  for (const def of definitions) {
    if (def.hasDirection && def.directions && def.directions.length > 0) {
      for (const dir of def.directions) {
        const dirInfo = DIRECTION_LABELS[dir] || { label: dir, icon: def.icon };
        configs.push({
          id: def.id,
          label: dirInfo.label,
          description: `${def.label} ${dirInfo.label.toLowerCase()}`,
          icon: dirInfo.icon,
          category: def.category,
          direction: dir,
        });
      }
    } else {
      configs.push({
        id: def.id,
        label: def.label,
        description: def.description,
        icon: def.icon,
        category: def.category,
      });
    }
  }

  return configs;
}

// Generate configs once (registry is populated at module load)
const REGISTRY_CONFIGS = generateConfigsFromRegistry();

// Pre-compute categories from registry configs
function computeCategories(configs: PresentationConfig[]) {
  const categories: Record<string, PresentationConfig[]> = {};
  for (const config of configs) {
    if (!categories[config.category]) {
      categories[config.category] = [];
    }
    categories[config.category]!.push(config);
  }

  const startIndices: Record<string, number> = {};
  let running = 0;
  for (const category of CATEGORY_ORDER) {
    startIndices[category] = running;
    running += (categories[category]?.length || 0);
  }

  return { categories, startIndices };
}

const { categories: CATEGORIES, startIndices: CATEGORY_START_INDICES } = computeCategories(REGISTRY_CONFIGS);

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

  if (configs.length === 0) return null;

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
  transitions: Transition[]
): AdjacentInfo | null {
  if (selectedItemIds.length !== 1) return null;

  const selectedId = selectedItemIds[0]!;
  const selectedItem = items.find((i) => i.id === selectedId);
  if (!selectedItem) return null;

  const validTypes = ['video', 'image'];
  if (!validTypes.includes(selectedItem.type)) return null;

  const trackItems = items
    .filter((i) => i.trackId === selectedItem.trackId && validTypes.includes(i.type))
    .toSorted((a, b) => a.from - b.from);

  const selectedEnd = selectedItem.from + selectedItem.durationInFrames;

  // Build lookup of existing transition pairs
  const transitionByPair = new Map<string, string>();
  for (const t of transitions) {
    transitionByPair.set(`${t.leftClipId}->${t.rightClipId}`, t.id);
  }

  // Priority 1: Find adjacent clips WITHOUT an existing transition (for adding new)
  const rightAdjacentWithout = trackItems.find(
    (i) => i.id !== selectedId
      && areFramesAligned(selectedEnd, i.from)
      && !transitionByPair.has(`${selectedId}->${i.id}`)
  );
  if (rightAdjacentWithout) {
    return { leftClipId: selectedId, rightClipId: rightAdjacentWithout.id, hasExisting: false };
  }

  const leftAdjacentWithout = trackItems.findLast(
    (i) => i.id !== selectedId
      && areFramesAligned(i.from + i.durationInFrames, selectedItem.from)
      && !transitionByPair.has(`${i.id}->${selectedId}`)
  );
  if (leftAdjacentWithout) {
    return { leftClipId: leftAdjacentWithout.id, rightClipId: selectedId, hasExisting: false };
  }

  // Priority 2: Find existing transitions involving the selected clip
  // (clips may be overlapping now, so use transition records directly)
  for (const t of transitions) {
    if (t.leftClipId === selectedId && trackItems.some((i) => i.id === t.rightClipId)) {
      return {
        leftClipId: selectedId,
        rightClipId: t.rightClipId,
        hasExisting: true,
        existingTransitionId: t.id,
      };
    }
    if (t.rightClipId === selectedId && trackItems.some((i) => i.id === t.leftClipId)) {
      return {
        leftClipId: t.leftClipId,
        rightClipId: selectedId,
        hasExisting: true,
        existingTransitionId: t.id,
      };
    }
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

  const adjacentInfo = useMemo(() => {
    if (!selectedId) return null;
    return computeAdjacentInfo([selectedId], items, transitions);
  }, [selectedId, items, transitions]);

  // Apply a transition by config index
  const handleApplyByIndex = useCallback(
    (configIndex: number) => {
      const config = REGISTRY_CONFIGS[configIndex];
      if (!config) return;

      // Get fresh state at click time
      const { items: currentItems, transitions: currentTransitions } = useTimelineStore.getState();
      const currentSelectedIds = useSelectionStore.getState().selectedItemIds;
      const info = computeAdjacentInfo(currentSelectedIds, currentItems, currentTransitions);

      if (!info) return;

      const { leftClipId, rightClipId, hasExisting, existingTransitionId } = info;
      const presentation = config.id;
      const direction = config.direction as WipeDirection | SlideDirection | FlipDirection | undefined;

      if (hasExisting && existingTransitionId) {
        updateTransition(existingTransitionId, { presentation, direction });
      } else {
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
        {CATEGORY_ORDER.map((category) => {
          const configs = CATEGORIES[category];
          if (!configs || configs.length === 0) return null;

          return (
            <CategorySection
              key={category}
              category={category}
              configs={configs}
              startIndex={CATEGORY_START_INDICES[category]!}
              onApply={handleApplyByIndex}
              disabled={!hasValidSelection}
            />
          );
        })}
      </div>
    </div>
  );
});


