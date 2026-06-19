import { lazy, memo, Suspense, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Palette } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useSelectionStore } from '@/shared/state/selection'
import { useItemsStore } from '@/features/editor/deps/timeline-store'
import { KeyframeGraphPanel } from '@/features/editor/deps/timeline-contract'
import { addAdjustmentLayer } from '@/features/editor/utils/add-adjustment-layer'
import type { TimelineItem } from '@/types/timeline'

const LazyColorGradeSection = lazy(() =>
  import('@/features/editor/deps/effects-contract').then((module) => ({
    default: module.ColorGradeSection,
  })),
)
const LazyEffectsSection = lazy(() =>
  import('@/features/editor/deps/effects-contract').then((module) => ({
    default: module.EffectsSection,
  })),
)

/**
 * Color workspace inspector: always-visible grade controls (wheels + curves)
 * on top, with the remaining effect stack below. Shown in place of the
 * regular clip panel while the Color workspace is active.
 */
const COLOR_PANEL_EFFECT_TYPES = ['gpu-color-wheels', 'gpu-curves'] as const

interface ColorGradePanelProps {
  layout?: 'sidebar' | 'dock'
}

export const ColorGradePanel = memo(function ColorGradePanel({
  layout = 'sidebar',
}: ColorGradePanelProps) {
  const { t } = useTranslation()
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const visualItems = useItemsStore(
    useShallow(
      useCallback(
        (s) => {
          const items: TimelineItem[] = []
          for (const itemId of selectedItemIds) {
            const item = s.itemById[itemId]
            if (item && item.type !== 'audio') {
              items.push(item)
            }
          }
          return items
        },
        [selectedItemIds],
      ),
    ),
  )

  const handleCreateAdjustmentLayer = useCallback(() => {
    addAdjustmentLayer(undefined, t('editor.colorPanel.adjustmentLayerLabel'))
  }, [t])
  const handleKeepKeyframesOpen = useCallback(() => {
    // The Color page owns this dock; the shared keyframe editor needs a close
    // callback for its sidebar placement but the color lane is intentionally fixed.
  }, [])

  const hasVisualSelection = useMemo(() => visualItems.length > 0, [visualItems])

  if (!hasVisualSelection) {
    return (
      <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-2 px-4 py-10 text-center">
        <Palette className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-xs text-muted-foreground">{t('editor.colorPanel.emptyState')}</p>
      </div>
    )
  }

  const sectionClassName = layout === 'dock' ? 'min-h-0 overflow-hidden' : undefined

  if (layout === 'dock') {
    return (
      <div className="grid h-full min-h-0 grid-cols-[minmax(0,10fr)_minmax(0,3fr)_minmax(0,7fr)] gap-3">
        <Suspense fallback={null}>
          <div className={sectionClassName}>
            <LazyColorGradeSection
              items={visualItems}
              layout={layout}
              onCreateAdjustmentLayer={handleCreateAdjustmentLayer}
            />
          </div>
          <div className="min-h-0 overflow-hidden rounded-[3px] border border-border/70 bg-background/35">
            <LazyEffectsSection
              items={visualItems}
              hiddenGpuEffectTypes={COLOR_PANEL_EFFECT_TYPES}
              layout="dock"
            />
          </div>
          <div
            className="min-h-0 overflow-hidden rounded-[3px] border border-border/70 bg-background/35"
            data-testid="color-keyframes-lane"
          >
            <KeyframeGraphPanel
              isOpen={true}
              placement="side"
              showCloseButton={false}
              onClose={handleKeepKeyframesOpen}
            />
          </div>
        </Suspense>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Suspense fallback={null}>
        <div className={sectionClassName}>
          <LazyColorGradeSection
            items={visualItems}
            layout={layout}
            onCreateAdjustmentLayer={handleCreateAdjustmentLayer}
          />
        </div>
        <div className={sectionClassName}>
          <LazyEffectsSection items={visualItems} hiddenGpuEffectTypes={COLOR_PANEL_EFFECT_TYPES} />
        </div>
      </Suspense>
    </div>
  )
})
