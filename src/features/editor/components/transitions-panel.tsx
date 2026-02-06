import { memo, useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
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
  Search,
  Sparkles,
  Sun,
  Columns2,
  AlignJustify,
  TrendingUp,
  ArrowRightFromLine,
  Layers,
  ArrowLeftRight,
  Box,
  BookOpen,
  ZoomIn,
  ZoomOut,
  Heart,
  Star,
  Diamond,
  Cloudy,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { useSelectionStore } from '../stores/selection-store';
import { transitionRegistry } from '@/lib/transitions';
import type {
  TransitionCategory,
  WipeDirection,
  SlideDirection,
  FlipDirection,
  PresentationConfig,
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
  Sparkles,
  Sun,
  Columns2,
  AlignJustify,
  TrendingUp,
  ArrowRightFromLine,
  Layers,
  ArrowLeftRight,
  Box,
  BookOpen,
  ZoomIn,
  ZoomOut,
  Heart,
  Star,
  Diamond,
  Cloudy,
  Zap,
};

// Category display info
const CATEGORY_INFO: Record<string, { title: string }> = {
  basic: { title: 'Basic' },
  wipe: { title: 'Wipe' },
  slide: { title: 'Slide' },
  flip: { title: 'Flip' },
  zoom: { title: 'Zoom' },
  mask: { title: 'Mask' },
  blur: { title: 'Blur' },
  distortion: { title: 'Distortion' },
  light: { title: 'Light' },
  custom: { title: 'Custom' },
};

const CATEGORY_ORDER: TransitionCategory[] = [
  'basic', 'wipe', 'slide', 'flip', 'zoom', 'mask', 'blur', 'distortion',
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
    .toSorted((a, b) => a.from - b.from);

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
  const [searchQuery, setSearchQuery] = useState('');

  // Get selection
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);
  const selectionCount = selectedItemIds.length;
  const selectedId = selectionCount === 1 ? selectedItemIds[0] : null;

  // Compute adjacentInfo via derived selector with shallow comparison
  const adjacentInfo = useTimelineStore(
    useShallow(
      useCallback(
        (s) => {
          if (!selectedId) return null;
          return computeAdjacentInfo([selectedId], s.items, s.transitions);
        },
        [selectedId]
      )
    )
  );

  // Filter configs by search query
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return CATEGORIES;

    const query = searchQuery.toLowerCase();
    const filtered: Record<string, PresentationConfig[]> = {};
    for (const [cat, configs] of Object.entries(CATEGORIES)) {
      const matching = configs.filter(
        (c) =>
          c.label.toLowerCase().includes(query) ||
          c.description.toLowerCase().includes(query) ||
          c.id.toLowerCase().includes(query)
      );
      if (matching.length > 0) {
        filtered[cat] = matching;
      }
    }
    return filtered;
  }, [searchQuery]);

  // Recompute start indices for filtered results
  const filteredStartIndices = useMemo(() => {
    if (!searchQuery.trim()) return CATEGORY_START_INDICES;

    // When filtering, we need to map each filtered config back to its index in REGISTRY_CONFIGS
    const indices: Record<string, number> = {};
    let running = 0;
    for (const category of CATEGORY_ORDER) {
      indices[category] = running;
      running += (filteredCategories[category]?.length || 0);
    }
    return indices;
  }, [searchQuery, filteredCategories]);

  // Apply a transition by config index
  const handleApplyByIndex = useCallback(
    (configIndex: number) => {
      // When searching, we need to find the actual config
      let config: PresentationConfig | undefined;

      if (searchQuery.trim()) {
        // Flatten filtered categories in order
        const allFiltered: PresentationConfig[] = [];
        for (const category of CATEGORY_ORDER) {
          allFiltered.push(...(filteredCategories[category] || []));
        }
        config = allFiltered[configIndex];
      } else {
        config = REGISTRY_CONFIGS[configIndex];
      }

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
        updateTransition(existingTransitionId, { presentation, direction });
      } else {
        addTransition(leftClipId, rightClipId, 'crossfade', undefined, presentation, direction);
      }
    },
    [addTransition, updateTransition, searchQuery, filteredCategories]
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

      {/* Search bar */}
      <div className="px-3 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search transitions..."
            className={cn(
              'w-full pl-7 pr-2 py-1.5 text-xs rounded-md',
              'bg-secondary/50 border border-border',
              'placeholder:text-muted-foreground/50',
              'focus:outline-none focus:ring-1 focus:ring-primary/50'
            )}
          />
        </div>
      </div>

      {/* Transitions grid by category */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {CATEGORY_ORDER.map((category) => {
          const configs = filteredCategories[category];
          if (!configs || configs.length === 0) return null;

          return (
            <CategorySection
              key={category}
              category={category}
              configs={configs}
              startIndex={filteredStartIndices[category]!}
              onApply={handleApplyByIndex}
              disabled={!hasValidSelection}
            />
          );
        })}
      </div>
    </div>
  );
});
