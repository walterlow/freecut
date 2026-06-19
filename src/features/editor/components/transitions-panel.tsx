import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Blend, Info } from 'lucide-react'
import { TransitionPreview } from './transition-preview/transition-preview'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { useSelectionStore } from '@/shared/state/selection'
import { resolveTransitionTargetFromSelection } from '@/features/editor/deps/timeline-utils'
import type {
  WipeDirection,
  SlideDirection,
  FlipDirection,
  PresentationConfig,
} from '@/types/transition'
import { cn } from '@/shared/ui/cn'
import { transitionRegistry } from '@/shared/timeline/transitions'
import { TRANSITION_DRAG_MIME, useTransitionDragStore } from '@/shared/state/transition-drag'
import {
  TRANSITION_ICON_MAP,
  TRANSITION_CATEGORY_INFO,
  TRANSITION_CATEGORY_ORDER,
  getTransitionPresentationConfigs,
  getTransitionConfigsByCategory,
  getTransitionCategoryStartIndices,
} from '@/features/editor/utils/transition-ui-config'

interface TransitionCardProps {
  config: PresentationConfig
  configIndex: number
  onApply: (index: number) => void
  clickDisabled?: boolean
  onDragStart: (event: React.DragEvent<HTMLButtonElement>, index: number) => void
  onDragEnd: () => void
}

/**
 * Resolve a transition card's visual mode from its config: the fallback icon,
 * whether an animated A/B preview is available (GPU shader or Canvas 2D path),
 * and the direction to preview.
 */
function resolveTransitionCardVisuals(config: PresentationConfig) {
  const renderer = transitionRegistry.getRenderer(config.id)
  return {
    Icon: TRANSITION_ICON_MAP[config.icon] ?? Blend,
    showPreview: !!(renderer?.gpuTransitionId || renderer?.renderCanvas),
    previewDirection: config.direction ?? config.defaultDirection,
  }
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
  const { Icon, showPreview, previewDirection } = resolveTransitionCardVisuals(config)
  const [hovered, setHovered] = useState(false)

  const handleClick = useCallback(() => {
    if (clickDisabled) return
    onApply(configIndex)
  }, [clickDisabled, configIndex, onApply])

  return (
    <button
      type="button"
      onClick={handleClick}
      draggable={true}
      onDragStart={(event) => onDragStart(event, configIndex)}
      onDragEnd={onDragEnd}
      onPointerEnter={showPreview ? () => setHovered(true) : undefined}
      onPointerLeave={showPreview ? () => setHovered(false) : undefined}
      aria-disabled={clickDisabled}
      className={cn(
        'flex flex-col items-center gap-1 p-2 rounded-lg min-w-[60px]',
        'border border-border bg-secondary/30',
        'hover:bg-secondary/50 hover:border-primary/50',
        'transition-colors group text-center cursor-grab active:cursor-grabbing',
        clickDisabled && 'focus-visible:outline-muted-foreground/40',
      )}
      title={config.description}
    >
      {showPreview ? (
        <TransitionPreview
          presentationId={config.id}
          direction={previewDirection}
          active={hovered}
        />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded-[3px] bg-black/40">
          <Icon className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
        </div>
      )}
      <span className="text-[10px] text-muted-foreground group-hover:text-foreground truncate w-full">
        {config.label}
      </span>
    </button>
  )
})

/**
 * Category section with header and grid of cards
 */
interface CategorySectionProps {
  category: string
  configs: PresentationConfig[]
  startIndex: number
  onApply: (index: number) => void
  clickDisabled?: boolean
  onDragStart: (event: React.DragEvent<HTMLButtonElement>, index: number) => void
  onDragEnd: () => void
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
  const { t } = useTranslation()
  const info = TRANSITION_CATEGORY_INFO[category]
  const title = info ? t(info.titleKey) : category

  if (configs.length === 0) return null

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        {title}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
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
  )
})

export const TransitionsPanel = memo(function TransitionsPanel() {
  const { t } = useTranslation()
  const addTransition = useTimelineStore((s) => s.addTransition)
  const updateTransition = useTimelineStore((s) => s.updateTransition)
  const items = useTimelineStore((s) => s.items)
  const transitions = useTimelineStore((s) => s.transitions)
  // Get selection
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const selectionCount = selectedItemIds.length
  const selectedId = selectionCount === 1 ? selectedItemIds[0] : null

  const adjacentInfo = useMemo(() => {
    if (!selectedId) return null
    return resolveTransitionTargetFromSelection({
      selectedItemIds: [selectedId],
      items,
      transitions,
    })
  }, [selectedId, items, transitions])

  const setDraggedTransition = useTransitionDragStore((s) => s.setDraggedTransition)
  const setInvalidHint = useTransitionDragStore((s) => s.setInvalidHint)
  const clearTransitionDrag = useTransitionDragStore((s) => s.clearDrag)

  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLButtonElement>, configIndex: number) => {
      const config = getTransitionPresentationConfigs()[configIndex]
      if (!config) return

      const dragDescriptor = {
        presentation: config.id,
        direction: (config.direction ?? config.defaultDirection) as
          | WipeDirection
          | SlideDirection
          | FlipDirection
          | undefined,
      }

      event.dataTransfer.effectAllowed = 'copy'
      event.dataTransfer.setData(TRANSITION_DRAG_MIME, JSON.stringify(dragDescriptor))
      setDraggedTransition(dragDescriptor)
      setInvalidHint(null)
    },
    [setDraggedTransition, setInvalidHint],
  )

  const handleDragEnd = useCallback(() => {
    clearTransitionDrag()
  }, [clearTransitionDrag])

  // Apply a transition by config index
  const handleApplyByIndex = useCallback(
    (configIndex: number) => {
      const config = getTransitionPresentationConfigs()[configIndex]
      if (!config) return

      // Get fresh state at click time
      const { items: currentItems, transitions: currentTransitions } = useTimelineStore.getState()
      const currentSelectedIds = useSelectionStore.getState().selectedItemIds
      const info = resolveTransitionTargetFromSelection({
        selectedItemIds: currentSelectedIds,
        items: currentItems,
        transitions: currentTransitions,
      })

      if (!info || (!info.hasExisting && !info.canApply)) return

      const { leftClipId, rightClipId, hasExisting, existingTransitionId } = info
      const presentation = config.id
      const direction = (config.direction ?? config.defaultDirection) as
        | WipeDirection
        | SlideDirection
        | FlipDirection
        | undefined

      if (hasExisting && existingTransitionId) {
        updateTransition(existingTransitionId, { presentation, direction })
      } else {
        addTransition(
          leftClipId,
          rightClipId,
          'crossfade',
          info.suggestedDurationInFrames,
          presentation,
          direction,
        )
      }
    },
    [addTransition, updateTransition],
  )

  const hasValidClickTarget = !!adjacentInfo && (adjacentInfo.hasExisting || adjacentInfo.canApply)

  return (
    <div className="h-full flex flex-col">
      {/* Info banner */}
      <div className="px-3 py-2 border-b border-border bg-secondary/30">
        <div className="flex items-start gap-2 text-xs">
          <Info className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
          <div className="text-muted-foreground leading-relaxed">
            {hasValidClickTarget ? (
              <span className="text-primary">{t('editor.transitions.hintClickToApply')}</span>
            ) : adjacentInfo?.reason ? (
              <span>
                {t('editor.transitions.hintUnavailable', { reason: adjacentInfo.reason })}
              </span>
            ) : selectionCount === 1 ? (
              <span>{t('editor.transitions.hintSelectOne')}</span>
            ) : selectionCount > 1 ? (
              <span>{t('editor.transitions.hintSelectSingle')}</span>
            ) : (
              <span>{t('editor.transitions.hintSelectClip')}</span>
            )}
          </div>
        </div>
      </div>

      {/* Transitions grid by category */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {TRANSITION_CATEGORY_ORDER.map((category) => {
          const configs = getTransitionConfigsByCategory()[category]
          if (!configs || configs.length === 0) return null

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
          )
        })}
      </div>
    </div>
  )
})
