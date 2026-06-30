import { useCallback, useEffect, useMemo, useRef, useState, memo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Palette,
  CircleOff,
  ClipboardPaste,
  Columns2,
  Copy,
  Eye,
  Layers,
  Save,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { TimelineItem } from '@/types/timeline'
import type { ItemEffect, GpuEffect } from '@/types/effects'
import { useTimelineStore } from '@/features/effects/deps/timeline-contract'
import { useGizmoStore, useThrottledFrame } from '@/features/effects/deps/preview-contract'
import { useGradeClipboardStore, type GradeClipboardEntry } from '@/shared/state/grade-clipboard'
import { PropertySection } from '@/shared/ui/property-controls'
import { cn } from '@/shared/ui/cn'
import { GpuWheelsPanel, GpuCurvesPanel } from './panels'
import {
  getGpuEffect,
  getGpuEffectDefaultParams,
  isColorGradeEffectType,
} from '@/infrastructure/gpu-effects'
import { useUserPresetsStore } from '../stores/user-presets-store'
import { getAutoKeyframeOperation } from '@/features/effects/deps/keyframes-contract'
import type { AnimatableProperty } from '@/types/keyframe'
import { useKeyframesByItemId } from '../hooks/use-keyframes-by-item-id'
import {
  getGpuEffectKeyframeProperty,
  getResolvedGpuEffectForFrame,
} from '../utils/effect-keyframes'
import { applyGradePresetToEffectStack, hasGradePresetEffects } from '../utils/grade-presets'

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

function isColorGradeEntry(entry: ItemEffect): boolean {
  return entry.effect.type === 'gpu-effect' && isColorGradeEffectType(entry.effect.gpuEffectType)
}

function itemHasGrade(item: TimelineItem): boolean {
  return (item.effects ?? []).some(isColorGradeEntry)
}

function itemHasEnabledGrade(item: TimelineItem): boolean {
  return (item.effects ?? []).some((entry) => entry.enabled && isColorGradeEntry(entry))
}

function cloneGpuEffect(effect: GpuEffect): GpuEffect {
  return { ...effect, params: { ...effect.params } }
}

function copyGradeEntries(item: TimelineItem): GradeClipboardEntry[] {
  return (item.effects ?? []).filter(isColorGradeEntry).map((entry) => ({
    effect: cloneGpuEffect(entry.effect),
    enabled: entry.enabled,
  }))
}

function buildPastedGradeEffects(grade: GradeClipboardEntry[]): ItemEffect[] {
  return grade.map((entry) => ({
    id: crypto.randomUUID(),
    effect: cloneGpuEffect(entry.effect),
    enabled: entry.enabled,
  }))
}

function replaceColorEffectsInPlace(
  effects: ItemEffect[] | undefined,
  grade: GradeClipboardEntry[],
): ItemEffect[] {
  const pastedEffects = buildPastedGradeEffects(grade)
  let inserted = false
  const nextEffects: ItemEffect[] = []

  for (const entry of effects ?? []) {
    if (!isColorGradeEntry(entry)) {
      nextEffects.push(entry)
      continue
    }
    if (!inserted) {
      nextEffects.push(...pastedEffects)
      inserted = true
    }
  }

  if (!inserted) {
    nextEffects.push(...pastedEffects)
  }

  return nextEffects
}

interface ColorGradeSectionProps {
  /** Visual items (already filtered to exclude audio) */
  items: TimelineItem[]
  /** Sidebar keeps the legacy stacked inspector; dock renders fitted color-page panes. */
  layout?: 'sidebar' | 'dock'
  /** Optional quick action: create an adjustment layer for scene-wide grading */
  onCreateAdjustmentLayer?: () => void
}

function DockPane({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn('flex h-full min-h-0 flex-col overflow-hidden', className)}>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  )
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
  layout = 'sidebar',
  onCreateAdjustmentLayer,
}: ColorGradeSectionProps) {
  const { t } = useTranslation()
  const addEffects = useTimelineStore((s) => s.addEffects)
  const setItemEffects = useTimelineStore((s) => s.setItemEffects)
  const updateEffect = useTimelineStore((s) => s.updateEffect)
  const removeEffect = useTimelineStore((s) => s.removeEffect)
  const toggleEffect = useTimelineStore((s) => s.toggleEffect)
  const applyAutoKeyframeOperations = useTimelineStore((s) => s.applyAutoKeyframeOperations)
  const setEffectsPreviewNew = useGizmoStore((s) => s.setEffectsPreviewNew)
  const clearPreview = useGizmoStore((s) => s.clearPreview)
  const colorGradeComparisonMode = useGizmoStore((s) => s.colorGradeComparisonMode)
  const setColorGradeComparisonMode = useGizmoStore((s) => s.setColorGradeComparisonMode)
  const hasCopiedGrade = useGradeClipboardStore((s) => s.grade !== null && s.grade.length > 0)
  const currentFrame = useThrottledFrame({ updateDuringScrub: layout !== 'dock' })

  const visualItems = items
  const itemIds = useMemo(() => visualItems.map((item) => item.id), [visualItems])
  const displayItem = visualItems[0] ?? null
  const keyframesByItemId = useKeyframesByItemId(itemIds)

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
      const autoOperations = visualItems.flatMap((item) => {
        const entry = findGradeEntry(item, type)
        if (!entry || entry.effect.type !== 'gpu-effect') return []
        const itemKeyframeState = keyframesByItemId.get(item.id) ?? undefined
        return Object.entries(updates).flatMap(([paramKey, paramValue]) => {
          if (typeof paramValue !== 'number') return []
          const property = getGpuEffectKeyframeProperty(entry, paramKey)
          const operation =
            property &&
            getAutoKeyframeOperation(item, itemKeyframeState, property, paramValue, currentFrame)
          return operation ? [operation] : []
        })
      })

      if (autoOperations.length > 0) {
        applyAutoKeyframeOperations(autoOperations)
      }

      visualItems.forEach((item) => {
        const entry = findGradeEntry(item, type)
        if (entry && entry.effect.type === 'gpu-effect') {
          const fallbackUpdates = { ...updates }
          for (const [paramKey, paramValue] of Object.entries(updates)) {
            const property =
              typeof paramValue === 'number' ? getGpuEffectKeyframeProperty(entry, paramKey) : null
            const autoHandled =
              property &&
              autoOperations.some(
                (operation) => operation.itemId === item.id && operation.property === property,
              )
            if (autoHandled) delete fallbackUpdates[paramKey]
          }
          if (Object.keys(fallbackUpdates).length === 0) return
          updateEffect(item.id, entry.id, {
            effect: { ...entry.effect, params: { ...entry.effect.params, ...fallbackUpdates } },
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
    [
      addEffects,
      applyAutoKeyframeOperations,
      clearPreview,
      currentFrame,
      keyframesByItemId,
      updateEffect,
      visualItems,
    ],
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

  const getKeyframeProperty = useCallback(
    (effectId: string, paramKey: string): AnimatableProperty | null => {
      if (effectId.startsWith('__grade:')) return null
      const entry = Object.values(displayEntries).find((candidate) => candidate.id === effectId)
      return entry ? getGpuEffectKeyframeProperty(entry, paramKey) : null
    },
    [displayEntries],
  )

  // Save the display item's current grade (its color-category effects) as a
  // named preset in the workspace.
  const addPreset = useUserPresetsStore((s) => s.addPreset)
  const userPresets = useUserPresetsStore((s) => s.presets)
  const loadUserPresets = useUserPresetsStore((s) => s.loadPresets)
  const removeUserPreset = useUserPresetsStore((s) => s.removePreset)
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
  const canCopyGrade = useMemo(() => visualItems.some(itemHasGrade), [visualItems])
  const canCompareGrade = useMemo(() => visualItems.some(itemHasEnabledGrade), [visualItems])
  const gradePresets = useMemo(
    () => userPresets.filter((preset) => hasGradePresetEffects(preset.effects)),
    [userPresets],
  )

  useEffect(() => {
    void loadUserPresets()
  }, [loadUserPresets])

  useEffect(() => {
    if (colorGradeComparisonMode === 'split' && !canCompareGrade) {
      setColorGradeComparisonMode('off')
    }
  }, [canCompareGrade, colorGradeComparisonMode, setColorGradeComparisonMode])

  const handleSavePreset = useCallback(() => {
    const name = presetNameDraft?.trim()
    if (!name || gradeEffects.length === 0) return
    void addPreset(name, gradeEffects)
    setPresetNameDraft(null)
  }, [addPreset, gradeEffects, presetNameDraft])

  const handleApplyGradePreset = useCallback(
    (presetId: string) => {
      const preset = useUserPresetsStore
        .getState()
        .presets.find((candidate) => candidate.id === presetId)
      if (!preset || !hasGradePresetEffects(preset.effects)) return
      setItemEffects(
        visualItems.map((item) => ({
          itemId: item.id,
          effects: applyGradePresetToEffectStack(item.effects, preset.effects),
        })),
      )
      queueMicrotask(() => clearPreview())
    },
    [clearPreview, setItemEffects, visualItems],
  )

  const handleCopyGrade = useCallback(() => {
    const sourceItem = visualItems.find(itemHasGrade)
    if (!sourceItem) return
    const grade = copyGradeEntries(sourceItem)
    if (grade.length === 0) return
    useGradeClipboardStore.getState().setGrade(grade)
  }, [visualItems])

  const handlePasteGrade = useCallback(() => {
    const grade = useGradeClipboardStore.getState().grade
    if (!grade || grade.length === 0) return
    setItemEffects(
      visualItems.map((item) => ({
        itemId: item.id,
        effects: replaceColorEffectsInPlace(item.effects, grade),
      })),
    )
    queueMicrotask(() => clearPreview())
  }, [clearPreview, setItemEffects, visualItems])

  const wheelsDefinition = getGpuEffect('gpu-color-wheels')
  const curvesDefinition = getGpuEffect('gpu-curves')
  const savePresetLabel = t('effects.colorPanel.savePresetTooltip')

  if (visualItems.length === 0 || !wheelsDefinition || !curvesDefinition) return null

  const wheelsEntry = displayEntries['gpu-color-wheels']
  const curvesEntry = displayEntries['gpu-curves']
  const wheelsGpuEffect = getResolvedGpuEffectForFrame(
    wheelsEntry,
    displayItem,
    displayItem ? (keyframesByItemId.get(displayItem.id) ?? undefined) : undefined,
    currentFrame,
  )
  const curvesGpuEffect = getResolvedGpuEffectForFrame(
    curvesEntry,
    displayItem,
    displayItem ? (keyframesByItemId.get(displayItem.id) ?? undefined) : undefined,
    currentFrame,
  )
  const splitCompareTitle = canCompareGrade
    ? t('effects.colorPanel.compareSplitTooltip')
    : t('effects.colorPanel.compareSplitDisabledTooltip')

  const compareControls = (
    <div
      className="grid grid-cols-3 gap-1"
      role="group"
      aria-label={t('effects.colorPanel.compareMode')}
    >
      <Button
        variant={colorGradeComparisonMode === 'off' ? 'default' : 'outline'}
        size="sm"
        className="h-7 px-1 text-xs"
        onClick={() => setColorGradeComparisonMode('off')}
        title={t('effects.colorPanel.compareAfterTooltip')}
        aria-label={t('effects.colorPanel.compareAfterTooltip')}
        aria-pressed={colorGradeComparisonMode === 'off'}
      >
        <Eye className="mr-1 h-3 w-3" />
        {t('effects.colorPanel.compareAfter')}
      </Button>
      <Button
        variant={colorGradeComparisonMode === 'before' ? 'default' : 'outline'}
        size="sm"
        className="h-7 px-1 text-xs"
        onClick={() => setColorGradeComparisonMode('before')}
        title={t('effects.colorPanel.compareBeforeTooltip')}
        aria-label={t('effects.colorPanel.compareBeforeTooltip')}
        aria-pressed={colorGradeComparisonMode === 'before'}
      >
        <CircleOff className="mr-1 h-3 w-3" />
        {t('effects.colorPanel.compareBefore')}
      </Button>
      <Button
        variant={colorGradeComparisonMode === 'split' ? 'default' : 'outline'}
        size="sm"
        className="h-7 px-1 text-xs"
        onClick={() => setColorGradeComparisonMode('split')}
        disabled={!canCompareGrade}
        title={splitCompareTitle}
        aria-label={splitCompareTitle}
        aria-pressed={colorGradeComparisonMode === 'split'}
      >
        <Columns2 className="mr-1 h-3 w-3" />
        {t('effects.colorPanel.compareSplit')}
      </Button>
    </div>
  )

  const gradeActions = (
    <div className="flex flex-wrap gap-1">
      <Button
        variant="outline"
        size="sm"
        className="h-7 min-w-[5.75rem] flex-1 text-xs"
        onClick={handleCopyGrade}
        disabled={!canCopyGrade}
        title={t('timeline.contextMenu.copyGrade')}
      >
        <Copy className="mr-1 h-3 w-3" />
        {t('timeline.contextMenu.copyGrade')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 min-w-[5.75rem] flex-1 text-xs"
        onClick={handlePasteGrade}
        disabled={!hasCopiedGrade}
        title={t('timeline.contextMenu.pasteGrade')}
      >
        <ClipboardPaste className="mr-1 h-3 w-3" />
        {t('timeline.contextMenu.pasteGrade')}
      </Button>
      {onCreateAdjustmentLayer && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 min-w-[7.5rem] flex-1 text-xs"
          onClick={onCreateAdjustmentLayer}
          title={t('effects.colorPanel.adjustmentLayerTooltip')}
        >
          <Layers className="mr-1 h-3 w-3" />
          {t('effects.colorPanel.adjustmentLayer')}
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2"
        onClick={() => setPresetNameDraft((current) => (current === null ? '' : null))}
        disabled={gradeEffects.length === 0}
        title={savePresetLabel}
        aria-label={savePresetLabel}
      >
        <Save className="h-3.5 w-3.5" />
      </Button>
    </div>
  )

  const presetNameInput = presetNameDraft !== null && (
    <div className="flex gap-1 px-2 pb-2">
      <input
        type="text"
        name="gradePresetName"
        autoComplete="off"
        aria-label={t('effects.colorPanel.presetNamePlaceholder')}
        value={presetNameDraft}
        onChange={(event) => setPresetNameDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') handleSavePreset()
          if (event.key === 'Escape') setPresetNameDraft(null)
          event.stopPropagation()
        }}
        placeholder={t('effects.colorPanel.presetNamePlaceholder')}
        className="h-7 min-w-0 flex-1 rounded-sm border border-input bg-transparent px-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
  )

  const gradeGallery = gradePresets.length > 0 && (
    <div className="px-2 pb-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('effects.colorPanel.gallery')}
        </span>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {gradePresets.map((preset) => (
          <div
            key={preset.id}
            className="group relative min-w-[104px] rounded-sm border border-border/70 bg-secondary/35"
          >
            <button
              type="button"
              className="flex h-12 w-full flex-col items-start justify-between rounded-sm px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => handleApplyGradePreset(preset.id)}
              title={t('effects.colorPanel.applyPresetTooltip', { name: preset.name })}
              aria-label={t('effects.colorPanel.applyPresetTooltip', { name: preset.name })}
            >
              <span className="h-1 w-full rounded-full bg-gradient-to-r from-slate-500 via-amber-300 to-sky-400" />
              <span className="max-w-[80px] truncate text-xs font-medium">{preset.name}</span>
            </button>
            <button
              type="button"
              className="absolute right-1 top-1 hidden h-4 w-4 items-center justify-center rounded-sm bg-black/55 text-white/80 hover:text-white focus:flex group-hover:flex group-focus-within:flex"
              onClick={(event) => {
                event.stopPropagation()
                void removeUserPreset(preset.id)
              }}
              title={t('effects.colorPanel.deletePresetTooltip', { name: preset.name })}
              aria-label={t('effects.colorPanel.deletePresetTooltip', { name: preset.name })}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )

  const wheelsPanel = (
    <GpuWheelsPanel
      itemIds={itemIds}
      effect={wheelsEntry}
      gpuEffect={wheelsGpuEffect}
      definition={wheelsDefinition}
      layout={layout}
      getKeyframeProperty={getKeyframeProperty}
      onParamChange={handleParamChange}
      onParamLiveChange={handleParamLiveChange}
      onParamsBatchChange={handleParamsBatchChange}
      onParamsBatchLiveChange={handleParamsBatchLiveChange}
      onReset={handleReset}
      onToggle={handleToggle}
      onRemove={handleRemove}
    />
  )

  const curvesPanel = (
    <GpuCurvesPanel
      effect={curvesEntry}
      gpuEffect={curvesGpuEffect}
      definition={curvesDefinition}
      layout={layout}
      onParamChange={handleParamChange}
      onParamLiveChange={handleParamLiveChange}
      onParamsBatchChange={handleParamsBatchChange}
      onParamsBatchLiveChange={handleParamsBatchLiveChange}
      onReset={handleReset}
      onToggle={handleToggle}
      onRemove={handleRemove}
    />
  )

  if (layout === 'dock') {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[3px] border border-border/70 bg-background/35">
        <div className="grid shrink-0 gap-2 border-b border-border/70 p-2 lg:grid-cols-[minmax(220px,1fr)_minmax(180px,0.75fr)]">
          {compareControls}
          {gradeActions}
        </div>
        {presetNameInput}
        {gradeGallery}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.5fr)_minmax(0,0.5fr)]">
          <DockPane className="border-r border-border/70">{wheelsPanel}</DockPane>
          <DockPane>{curvesPanel}</DockPane>
        </div>
      </div>
    )
  }

  return (
    <PropertySection title={t('effects.colorPanel.title')} icon={Palette} defaultOpen={true}>
      <div className="px-2 pb-1">{compareControls}</div>

      <div className="px-2 pb-2">{gradeActions}</div>

      {presetNameInput}

      {gradeGallery}

      <div className="space-y-0">
        {wheelsPanel}
        {curvesPanel}
      </div>
    </PropertySection>
  )
})
