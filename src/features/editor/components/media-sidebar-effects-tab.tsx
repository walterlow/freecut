import { memo, useCallback, useEffect, useMemo, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers, Sparkles } from 'lucide-react'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { useSelectionStore } from '@/shared/state/selection'
import type { VisualEffect, GpuEffect } from '@/types/effects'
import { EFFECT_PRESETS } from '@/types/effects'
import {
  getGpuCategoriesWithEffects,
  getGpuEffectDefaultParams,
} from '@/infrastructure/gpu-effects'
import { useEffectPreviews } from '@/features/editor/deps/effects-contract'

interface MediaSidebarEffectsTabProps {
  onAddAdjustmentLayer: (effects?: VisualEffect[], label?: string) => void
  onTemplateDragStart: (payload: {
    itemType: 'adjustment'
    label: string
    effects?: VisualEffect[]
  }) => (event: DragEvent<HTMLButtonElement>) => void
  onTemplateDragEnd: () => void
  shouldSuppressGeneratedItemClick: () => boolean
}

export const MediaSidebarEffectsTab = memo(function MediaSidebarEffectsTab({
  onAddAdjustmentLayer,
  onTemplateDragStart,
  onTemplateDragEnd,
  shouldSuppressGeneratedItemClick,
}: MediaSidebarEffectsTabProps) {
  const { t } = useTranslation()
  const gpuCategories = useMemo(() => getGpuCategoriesWithEffects(), [])
  const allEffectEntries = useMemo(
    () =>
      gpuCategories.flatMap(({ effects: catEffects }) =>
        catEffects.map((def) => ({ id: def.id, def })),
      ),
    [gpuCategories],
  )
  const presetIds = useMemo(() => EFFECT_PRESETS.map((p) => p.id), [])
  const { previews: effectPreviews, trigger: triggerPreviews } = useEffectPreviews(
    allEffectEntries,
    presetIds,
  )

  useEffect(() => {
    triggerPreviews()
  }, [triggerPreviews])

  const handleAddPreset = useCallback(
    (presetId: string) => {
      const preset = EFFECT_PRESETS.find((p) => p.id === presetId)
      if (!preset) return
      onAddAdjustmentLayer(preset.effects, preset.name)
    },
    [onAddAdjustmentLayer],
  )

  const handleAddGpuEffect = useCallback(
    (gpuEffectId: string) => {
      const { selectedItemIds } = useSelectionStore.getState()
      const { items, addEffect } = useTimelineStore.getState()
      const visualIds = selectedItemIds.filter((id) => {
        const item = items.find((i) => i.id === id)
        return item && item.type !== 'audio'
      })

      if (visualIds.length > 0) {
        const defaults = getGpuEffectDefaultParams(gpuEffectId)
        const effect: GpuEffect = {
          type: 'gpu-effect',
          gpuEffectType: gpuEffectId,
          params: defaults,
        }
        visualIds.forEach((id) => addEffect(id, effect))
        return
      }

      const defaults = getGpuEffectDefaultParams(gpuEffectId)
      onAddAdjustmentLayer([{ type: 'gpu-effect', gpuEffectType: gpuEffectId, params: defaults }])
    },
    [onAddAdjustmentLayer],
  )

  return (
    <div className="space-y-3">
      <button
        draggable={true}
        onDragStart={onTemplateDragStart({
          itemType: 'adjustment',
          label: t('editor.mediaSidebar.adjustmentLayer'),
        })}
        onDragEnd={onTemplateDragEnd}
        onClick={() => {
          if (shouldSuppressGeneratedItemClick()) return
          onAddAdjustmentLayer()
        }}
        className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
      >
        <div className="w-8 h-8 rounded-md border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70 flex-shrink-0">
          <Layers className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
        </div>
        <div className="text-left">
          <div className="text-xs text-muted-foreground group-hover:text-foreground">
            {t('editor.mediaSidebar.blankAdjustmentLayer')}
          </div>
        </div>
      </button>

      <div>
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
          {t('editor.mediaSidebar.presets')}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {EFFECT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              draggable={true}
              onDragStart={onTemplateDragStart({
                itemType: 'adjustment',
                label: preset.name,
                effects: preset.effects,
              })}
              onDragEnd={onTemplateDragEnd}
              onClick={() => {
                if (shouldSuppressGeneratedItemClick()) return
                handleAddPreset(preset.id)
              }}
              className="flex flex-col items-center gap-1 p-1.5 rounded-md border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
            >
              {effectPreviews.has(`preset:${preset.id}`) ? (
                <img
                  src={effectPreviews.get(`preset:${preset.id}`)}
                  alt=""
                  draggable={false}
                  className="w-full aspect-video rounded-sm object-cover"
                />
              ) : (
                <div className="w-full aspect-video rounded-sm bg-muted flex items-center justify-center">
                  <Sparkles className="w-3 h-3 text-muted-foreground/50" />
                </div>
              )}
              <span className="text-[9px] text-muted-foreground group-hover:text-foreground text-center leading-tight">
                {preset.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      {gpuCategories.map(({ category, effects: catEffects }) => (
        <div key={category}>
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
            {category}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {catEffects.map((def) => (
              <button
                key={def.id}
                draggable={true}
                onDragStart={onTemplateDragStart({
                  itemType: 'adjustment',
                  label: def.name,
                  effects: [
                    {
                      type: 'gpu-effect',
                      gpuEffectType: def.id,
                      params: getGpuEffectDefaultParams(def.id),
                    },
                  ],
                })}
                onDragEnd={onTemplateDragEnd}
                onClick={() => {
                  if (shouldSuppressGeneratedItemClick()) return
                  handleAddGpuEffect(def.id)
                }}
                className="flex flex-col items-center gap-1 p-1.5 rounded-md border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
              >
                {effectPreviews.has(def.id) ? (
                  <img
                    src={effectPreviews.get(def.id)}
                    alt=""
                    draggable={false}
                    className="w-full aspect-video rounded-sm object-cover"
                  />
                ) : (
                  <div className="w-full aspect-video rounded-sm bg-muted" />
                )}
                <span className="text-[9px] text-muted-foreground group-hover:text-foreground text-center leading-tight truncate w-full">
                  {def.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
})
