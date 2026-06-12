import { useCallback, useMemo, useRef, useState, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Palette, CircleOff, Layers, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { TimelineItem } from '@/types/timeline'
import type { ItemEffect, GpuEffect } from '@/types/effects'
import { useTimelineStore } from '@/features/effects/deps/timeline-contract'
import { useGizmoStore } from '@/features/effects/deps/preview-contract'
import { PropertySection } from '@/shared/ui/property-controls'
import { GpuWheelsPanel, GpuCurvesPanel } from './panels'
import {
  getGpuEffect,
  getGpuEffectDefaultParams,
  isColorGradeEffectType,
} from '@/infrastructure/gpu-effects'
import { useUserPresetsStore } from '../stores/user-presets-store'

type GradeEffectType = 'gpu-color-wheels' | 'gpu-curves'
type EffectParams = Record<string, number | boolean | string>

const GRADE_EFFECT_TYPES: readonly GradeEffectType[] = ['gpu-color-wheels', 'gpu-curves']

function syntheticGradeId(type: GradeEffectType): string {
  return `__grade:${type}__`
}

function findGradeEntry(item: TimelineItem, type: GradeEffectType): ItemEffect | undefined {
  return (item.effects ?? []).find(
    (entry) => entry.effect.type === 'gpu-effect' && entry.effect.gpuEffectType === type,
  )
}

interface ColorGradeSectionProps {
  /** Visual items (already filtered to exclude audio) */
  items: TimelineItem[]
  /** Optional quick action: create an adjustment layer for scene-wide grading */
  onCreateAdjustmentLayer?: () => void
}

/**
 * DaVinci-style grade controls: color wheels and curves are always visible
 * for the selected clip — no "Add Effect" ceremony. When the clip has no
 * grade yet, the panels render at defaults and the underlying effect is
 * created lazily on the first adjustment (live drags preview through the
 * gizmo effects-preview path before the effect exists).
 */
export const ColorGradeSection = memo(function ColorGradeSection({
  items,
  onCreateAdjustmentLayer,
}: ColorGradeSectionProps) {
  const { t } = useTranslation()
  const addEffects = useTimelineStore((s) => s.addEffects)
  const updateEffect = useTimelineStore((s) => s.updateEffect)
  const removeEffect = useTimelineStore((s) => s.removeEffect)
  const toggleEffect = useTimelineStore((s) => s.toggleEffect)
  const setEffectsPreviewNew = useGizmoStore((s) => s.setEffectsPreviewNew)
  const clearPreview = useGizmoStore((s) => s.clearPreview)
  const colorGradeBypassed = useGizmoStore((s) => s.colorGradeBypassed)
  const toggleColorGradeBypass = useGizmoStore((s) => s.toggleColorGradeBypass)

  const visualItems = items
  const itemIds = useMemo(() => visualItems.map((item) => item.id), [visualItems])
  const displayItem = visualItems[0] ?? null

  // Params accumulated from live events for a grade effect that doesn't
  // exist yet (created on commit at gesture end).
  const pendingParamsRef = useRef<Partial<Record<GradeEffectType, EffectParams>>>({})

  const displayEntries = useMemo(() => {
    const entries = {} as Record<GradeEffectType, ItemEffect>
    for (const type of GRADE_EFFECT_TYPES) {
      const existing = displayItem ? findGradeEntry(displayItem, type) : undefined
      entries[type] =
        existing ??
        ({
          id: syntheticGradeId(type),
          enabled: true,
          effect: {
            type: 'gpu-effect',
            gpuEffectType: type,
            params: getGpuEffectDefaultParams(type),
          },
        } satisfies ItemEffect)
    }
    return entries
  }, [displayItem])

  const resolveGradeType = useCallback(
    (effectId: string): GradeEffectType | null => {
      for (const type of GRADE_EFFECT_TYPES) {
        if (displayEntries[type].id === effectId) return type
      }
      return null
    },
    [displayEntries],
  )

  // Commit param updates: update existing grade effects, lazily create the
  // effect (defaults + pending live params + this update) where missing.
  const commitParams = useCallback(
    (type: GradeEffectType, updates: EffectParams) => {
      const pending = pendingParamsRef.current[type]
      pendingParamsRef.current[type] = undefined

      const createUpdates: Array<{ itemId: string; effects: GpuEffect[] }> = []
      visualItems.forEach((item) => {
        const entry = findGradeEntry(item, type)
        if (entry && entry.effect.type === 'gpu-effect') {
          updateEffect(item.id, entry.id, {
            effect: { ...entry.effect, params: { ...entry.effect.params, ...updates } },
          })
          return
        }
        createUpdates.push({
          itemId: item.id,
          effects: [
            {
              type: 'gpu-effect',
              gpuEffectType: type,
              params: { ...getGpuEffectDefaultParams(type), ...pending, ...updates },
            },
          ],
        })
      })
      if (createUpdates.length > 0) {
        addEffects(createUpdates)
      }
      queueMicrotask(() => clearPreview())
    },
    [addEffects, clearPreview, updateEffect, visualItems],
  )

  // Live preview during drags. For items without the grade effect, the
  // preview list gains a synthetic entry — the gizmo preview replaces the
  // item's effects wholesale, so previewing a not-yet-created effect works.
  const liveParams = useCallback(
    (type: GradeEffectType, updates: EffectParams) => {
      pendingParamsRef.current[type] = { ...pendingParamsRef.current[type], ...updates }
      const previews: Record<string, ItemEffect[]> = {}
      visualItems.forEach((item) => {
        const entry = findGradeEntry(item, type)
        if (entry && entry.effect.type === 'gpu-effect') {
          previews[item.id] = (item.effects ?? []).map((candidate) =>
            candidate.id === entry.id && candidate.effect.type === 'gpu-effect'
              ? {
                  ...candidate,
                  effect: {
                    ...candidate.effect,
                    params: { ...candidate.effect.params, ...updates },
                  },
                }
              : candidate,
          )
          return
        }
        previews[item.id] = [
          ...(item.effects ?? []),
          {
            id: syntheticGradeId(type),
            enabled: true,
            effect: {
              type: 'gpu-effect',
              gpuEffectType: type,
              params: { ...getGpuEffectDefaultParams(type), ...pendingParamsRef.current[type] },
            },
          },
        ]
      })
      setEffectsPreviewNew(previews)
    },
    [setEffectsPreviewNew, visualItems],
  )

  const handleParamChange = useCallback(
    (effectId: string, paramKey: string, value: number | boolean | string) => {
      const type = resolveGradeType(effectId)
      if (type) commitParams(type, { [paramKey]: value })
    },
    [commitParams, resolveGradeType],
  )

  const handleParamsBatchChange = useCallback(
    (effectId: string, updates: EffectParams) => {
      const type = resolveGradeType(effectId)
      if (type) commitParams(type, updates)
    },
    [commitParams, resolveGradeType],
  )

  const handleParamLiveChange = useCallback(
    (effectId: string, paramKey: string, value: number | boolean | string) => {
      const type = resolveGradeType(effectId)
      if (type) liveParams(type, { [paramKey]: value })
    },
    [liveParams, resolveGradeType],
  )

  const handleParamsBatchLiveChange = useCallback(
    (effectId: string, updates: EffectParams) => {
      const type = resolveGradeType(effectId)
      if (type) liveParams(type, updates)
    },
    [liveParams, resolveGradeType],
  )

  const handleReset = useCallback(
    (effectId: string) => {
      const type = resolveGradeType(effectId)
      if (!type) return
      pendingParamsRef.current[type] = undefined
      visualItems.forEach((item) => {
        const entry = findGradeEntry(item, type)
        if (entry && entry.effect.type === 'gpu-effect') {
          updateEffect(item.id, entry.id, {
            effect: { ...entry.effect, params: getGpuEffectDefaultParams(type) },
          })
        }
      })
      queueMicrotask(() => clearPreview())
    },
    [clearPreview, resolveGradeType, updateEffect, visualItems],
  )

  const handleToggle = useCallback(
    (effectId: string) => {
      const type = resolveGradeType(effectId)
      if (!type) return
      visualItems.forEach((item) => {
        const entry = findGradeEntry(item, type)
        if (entry) toggleEffect(item.id, entry.id)
      })
    },
    [resolveGradeType, toggleEffect, visualItems],
  )

  const handleRemove = useCallback(
    (effectId: string) => {
      const type = resolveGradeType(effectId)
      if (!type) return
      pendingParamsRef.current[type] = undefined
      visualItems.forEach((item) => {
        const entry = findGradeEntry(item, type)
        if (entry) removeEffect(item.id, entry.id)
      })
    },
    [removeEffect, resolveGradeType, visualItems],
  )

  const getKeyframeProperty = useCallback(() => null, [])

  // Save the display item's current grade (its color-category effects) as a
  // named preset in the workspace.
  const addPreset = useUserPresetsStore((s) => s.addPreset)
  const [presetNameDraft, setPresetNameDraft] = useState<string | null>(null)
  const gradeEffects = useMemo(
    () =>
      (displayItem?.effects ?? [])
        .filter(
          (entry) =>
            entry.enabled &&
            entry.effect.type === 'gpu-effect' &&
            isColorGradeEffectType(entry.effect.gpuEffectType),
        )
        .map((entry) => entry.effect),
    [displayItem],
  )

  const handleSavePreset = useCallback(() => {
    const name = presetNameDraft?.trim()
    if (!name || gradeEffects.length === 0) return
    void addPreset(name, gradeEffects)
    setPresetNameDraft(null)
  }, [addPreset, gradeEffects, presetNameDraft])

  const wheelsDefinition = getGpuEffect('gpu-color-wheels')
  const curvesDefinition = getGpuEffect('gpu-curves')

  if (visualItems.length === 0 || !wheelsDefinition || !curvesDefinition) return null

  const wheelsEntry = displayEntries['gpu-color-wheels']
  const curvesEntry = displayEntries['gpu-curves']

  return (
    <PropertySection title={t('effects.colorPanel.title')} icon={Palette} defaultOpen={true}>
      <div className="px-2 pb-2 flex gap-1">
        <Button
          variant={colorGradeBypassed ? 'default' : 'outline'}
          size="sm"
          className="flex-1 h-7 text-xs"
          onClick={toggleColorGradeBypass}
          title={t('effects.colorPanel.bypassTooltip')}
          aria-pressed={colorGradeBypassed}
        >
          <CircleOff className="w-3 h-3 mr-1" />
          {colorGradeBypassed ? t('effects.colorPanel.bypassOn') : t('effects.colorPanel.bypass')}
        </Button>
        {onCreateAdjustmentLayer && (
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-7 text-xs"
            onClick={onCreateAdjustmentLayer}
            title={t('effects.colorPanel.adjustmentLayerTooltip')}
          >
            <Layers className="w-3 h-3 mr-1" />
            {t('effects.colorPanel.adjustmentLayer')}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2"
          onClick={() => setPresetNameDraft((current) => (current === null ? '' : null))}
          disabled={gradeEffects.length === 0}
          title={t('effects.colorPanel.savePresetTooltip')}
        >
          <Save className="w-3.5 h-3.5" />
        </Button>
      </div>

      {presetNameDraft !== null && (
        <div className="px-2 pb-2 flex gap-1">
          <input
            type="text"
            value={presetNameDraft}
            onChange={(event) => setPresetNameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleSavePreset()
              if (event.key === 'Escape') setPresetNameDraft(null)
              event.stopPropagation()
            }}
            placeholder={t('effects.colorPanel.presetNamePlaceholder')}
            className="h-7 flex-1 min-w-0 rounded-sm border border-input bg-transparent px-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <Button
            variant="default"
            size="sm"
            className="h-7 text-xs"
            onClick={handleSavePreset}
            disabled={!presetNameDraft.trim()}
          >
            {t('effects.colorPanel.savePreset')}
          </Button>
        </div>
      )}

      <div className="space-y-0">
        <GpuWheelsPanel
          itemIds={itemIds}
          effect={wheelsEntry}
          gpuEffect={wheelsEntry.effect as GpuEffect}
          definition={wheelsDefinition}
          getKeyframeProperty={getKeyframeProperty}
          onParamChange={handleParamChange}
          onParamLiveChange={handleParamLiveChange}
          onParamsBatchChange={handleParamsBatchChange}
          onParamsBatchLiveChange={handleParamsBatchLiveChange}
          onReset={handleReset}
          onToggle={handleToggle}
          onRemove={handleRemove}
        />
        <GpuCurvesPanel
          effect={curvesEntry}
          gpuEffect={curvesEntry.effect as GpuEffect}
          definition={curvesDefinition}
          onParamChange={handleParamChange}
          onParamLiveChange={handleParamLiveChange}
          onParamsBatchChange={handleParamsBatchChange}
          onParamsBatchLiveChange={handleParamsBatchLiveChange}
          onReset={handleReset}
          onToggle={handleToggle}
          onRemove={handleRemove}
        />
      </div>
    </PropertySection>
  )
})
