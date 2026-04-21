import { memo, useCallback, useMemo } from 'react';
import { Blend, Info } from 'lucide-react';
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import { useSelectionStore } from '@/shared/state/selection';
import { resolveTransitionTargetFromSelection } from '@/features/editor/deps/timeline-utils';
import type {
  WipeDirection,
  SlideDirection,
  FlipDirection,
  PresentationConfig,
} from '@/types/transition';
import { cn } from '@/shared/ui/cn';
import { TRANSITION_DRAG_MIME, useTransitionDragStore } from '@/shared/state/transition-drag';
import {
  TRANSITION_ICON_MAP,
  TRANSITION_CATEGORY_INFO,
  TRANSITION_CATEGORY_ORDER,
  getTransitionPresentationConfigs,
  getTransitionConfigsByCategory,
  getTransitionCategoryStartIndices,
} from '@/features/editor/utils/transition-ui-config';

interface TransitionCardProps {
  config: PresentationConfig;
  configIndex: number;
  onApply: (index: number) => void;
  clickDisabled?: boolean;
  onDragStart: (event: React.DragEvent<HTMLButtonElement>, index: number) => void;
  onDragEnd: () => void;
}

/**
 * Compact transition card - displays as a small clickable tile
 */
const TransitionCard = memo(function TransitionCard({
  config,
  configIndex,
  onApply,
  clickDisabled,
  onDragStart,
  onDragEnd,
}: TransitionCardProps) {
  const Icon = TRANSITION_ICON_MAP[config.icon] ?? Blend;

  const handleClick = useCallback(() => {
    if (clickDisabled) return;
    onApply(configIndex);
  }, [clickDisabled, configIndex, onApply]);

  return (
    <button
      type="button"
      onClick={handleClick}
      draggable={true}
      onDragStart={(event) => onDragStart(event, configIndex)}
      onDragEnd={onDragEnd}
      aria-disabled={clickDisabled}
      className={cn(
        'flex flex-col items-center justify-center gap-1 p-2 rounded-lg',
        'border border-border bg-secondary/30',
        'hover:bg-secondary/50 hover:border-primary/50',
        'transition-colors group text-center cursor-grab active:cursor-grabbing',
        'min-w-[60px] h-[56px]',
        clickDisabled && 'focus-visible:outline-muted-foreground/40'
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
  clickDisabled?: boolean;
  onDragStart: (event: React.DragEvent<HTMLButtonElement>, index: number) => void;
  onDragEnd: () => void;
}

const CategorySection = memo(function CategorySection({
  category,
  configs,
  startIndex,
  onApply,
  clickDisabled,
  onDragStart,
  onDragEnd,
}: CategorySectionProps) {
  const info = TRANSITION_CATEGORY_INFO[category] || { title: category };

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
            clickDisabled={clickDisabled}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        ))}
      </div>
    </div>
  );
});

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
    return resolveTransitionTargetFromSelection({ selectedItemIds: [selectedId], items, transitions });
  }, [selectedId, items, transitions]);

  const setDraggedTransition = useTransitionDragStore((s) => s.setDraggedTransition);
  const setInvalidHint = useTransitionDragStore((s) => s.setInvalidHint);
  const clearTransitionDrag = useTransitionDragStore((s) => s.clearDrag);

  const handleDragStart = useCallback((event: React.DragEvent<HTMLButtonElement>, configIndex: number) => {
    const config = getTransitionPresentationConfigs()[configIndex];
    if (!config) return;

    const dragDescriptor = {
      presentation: config.id,
      direction: config.direction as WipeDirection | SlideDirection | FlipDirection | undefined,
    };

    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(TRANSITION_DRAG_MIME, JSON.stringify(dragDescriptor));
    setDraggedTransition(dragDescriptor);
    setInvalidHint(null);
  }, [setDraggedTransition, setInvalidHint]);

  const handleDragEnd = useCallback(() => {
    clearTransitionDrag();
  }, [clearTransitionDrag]);

  // Apply a transition by config index
  const handleApplyByIndex = useCallback(
    (configIndex: number) => {
      const config = getTransitionPresentationConfigs()[configIndex];
      if (!config) return;

      // Get fresh state at click time
      const { items: currentItems, transitions: currentTransitions } = useTimelineStore.getState();
      const currentSelectedIds = useSelectionStore.getState().selectedItemIds;
      const info = resolveTransitionTargetFromSelection({
        selectedItemIds: currentSelectedIds,
        items: currentItems,
        transitions: currentTransitions,
      });

      if (!info || (!info.hasExisting && !info.canApply)) return;

      const { leftClipId, rightClipId, hasExisting, existingTransitionId } = info;
      const presentation = config.id;
      const direction = config.direction as WipeDirection | SlideDirection | FlipDirection | undefined;

      if (hasExisting && existingTransitionId) {
        updateTransition(existingTransitionId, { presentation, direction });
      } else {
        addTransition(
          leftClipId,
          rightClipId,
          'crossfade',
          info.suggestedDurationInFrames,
          presentation,
          direction,
        );
      }
    },
    [addTransition, updateTransition]
  );

  const hasValidClickTarget = !!adjacentInfo && (adjacentInfo.hasExisting || adjacentInfo.canApply);

  return (
    <div className="h-full flex flex-col">
      {/* Info banner */}
      <div className="px-3 py-2 border-b border-border bg-secondary/30">
        <div className="flex items-start gap-2 text-xs">
          <Info className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
          <div className="text-muted-foreground leading-relaxed">
            {hasValidClickTarget ? (
              <span className="text-primary">
                点击可应用到当前剪切点，或将转场拖拽到时间线上任意有效剪切点。
              </span>
            ) : adjacentInfo?.reason ? (
              <span>可拖拽转场到有效剪切点。当前无法点击应用：{adjacentInfo.reason}。</span>
            ) : selectionCount === 1 ? (
              <span>可拖拽转场到有效剪切点，或将片段首尾相接后选中其中一个片段再点击应用。</span>
            ) : selectionCount > 1 ? (
              <span>可拖拽转场到有效剪切点，或只选中一个视频/图片片段后点击应用。</span>
            ) : (
              <span>可拖拽转场到有效剪切点，或选中一个视频/图片片段为其相邻片段添加转场。</span>
            )}
          </div>
        </div>
      </div>

      {/* Transitions grid by category */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {TRANSITION_CATEGORY_ORDER.map((category) => {
          const configs = getTransitionConfigsByCategory()[category];
          if (!configs || configs.length === 0) return null;

          return (
            <CategorySection
              key={category}
              category={category}
              configs={configs}
              startIndex={getTransitionCategoryStartIndices()[category]!}
              onApply={handleApplyByIndex}
              clickDisabled={!hasValidClickTarget}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            />
          );
        })}
      </div>
    </div>
  );
});
