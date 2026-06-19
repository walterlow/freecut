import { useCallback, useMemo, memo, useRef, useState, useEffect, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { Sparkles, Plus, Eye, EyeOff, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { TimelineItem } from '@/types/timeline'
import type { ItemEffect, GpuEffect, VisualEffect } from '@/types/effects'
import { EFFECT_PRESETS } from '@/types/effects'
import { useTimelineStore } from '@/features/effects/deps/timeline-contract'
import { useGizmoStore, useThrottledFrame } from '@/features/effects/deps/preview-contract'
import { PropertySection } from '@/shared/ui/property-controls'
import {
  GpuEffectPanel,
  GpuWheelsPanel,
  GpuCurvesPanel,
  GpuLutPanel,
  GpuPowerWindowPanel,
  GpuSecondaryQualifierPanel,
} from './panels'
import { getGpuEffect, getGpuEffectDefaultParams } from '@/infrastructure/gpu-effects'
import { useGpuEffectPreviewData } from '../hooks/use-gpu-effect-preview-data'
import { EffectThumbnail } from './effect-thumbnail'
import { getMappedSelectionEffectEntry } from '../utils/effect-selection'
import { useUserPresetsStore } from '../stores/user-presets-store'
import { getAutoKeyframeOperation } from '@/features/effects/deps/keyframes-contract'
import { buildEffectAnimatableProperty, type AnimatableProperty } from '@/types/keyframe'
import {
  getEffectCategoryLabel,
  getEffectDefinitionName,
} from '@/features/effects/utils/effect-i18n'
import {
  getGpuEffectKeyframeProperty,
  getResolvedGpuEffectForFrame,
} from '@/features/effects/utils/effect-keyframes'
import { useKeyframesByItemId } from '../hooks/use-keyframes-by-item-id'

interface EffectsSectionProps {
  /** Visual items (already filtered to exclude audio) */
  items: TimelineItem[]
  /** Effect types rendered by a parent-specific control surface. */
  hiddenGpuEffectTypes?: readonly string[]
  /** Sidebar keeps the legacy inspector shell; dock fits inside the Color page lane. */
  layout?: 'sidebar' | 'dock'
  /**
   * Jump to the Color workspace. When provided, heavyweight grade panels
   * (wheels, curves) render collapsed in the sidebar with an "Edit in Color"
   * affordance instead of the full grading surface.
   */
  onEditInColor?: () => void
}

const EMPTY_HIDDEN_GPU_EFFECT_TYPES: readonly string[] = []

/**
 * Effects section - GPU shader effects for visual items.
 * Only shown when selection includes video, image, text, or shape clips.
 * Memoized to prevent re-renders when items prop hasn't changed.
 */
export const EffectsSection = memo(function EffectsSection({
  items,
  hiddenGpuEffectTypes = EMPTY_HIDDEN_GPU_EFFECT_TYPES,
  layout = 'sidebar',
  onEditInColor,
}: EffectsSectionProps) {
  const { t } = useTranslation()
  const isDock = layout === 'dock'
  // Grade panels collapse to a summary row in the sidebar (the Edit workspace);
  // the dock owns the full grading surface, so it never collapses.
  const gradePanelCollapsible = !isDock
  const addEffect = useTimelineStore((s) => s.addEffect)
  const addEffects = useTimelineStore((s) => s.addEffects)
  const updateEffect = useTimelineStore((s) => s.updateEffect)
  const removeEffect = useTimelineStore((s) => s.removeEffect)
  const toggleEffect = useTimelineStore((s) => s.toggleEffect)
  const setItemEffects = useTimelineStore((s) => s.setItemEffects)
  const applyAutoKeyframeOperations = useTimelineStore((s) => s.applyAutoKeyframeOperations)

  // Gizmo store for live effect preview
  const setEffectsPreviewNew = useGizmoStore((s) => s.setEffectsPreviewNew)
  const clearPreview = useGizmoStore((s) => s.clearPreview)
  const currentFrame = useThrottledFrame({ updateDuringScrub: !isDock })

  // Items are already filtered by parent - use directly
  const visualItems = items

  // Memoize item IDs for stable callback dependencies
  const itemIds = useMemo(() => visualItems.map((item) => item.id), [visualItems])
  const hiddenGpuEffectTypeSet = useMemo(
    () => new Set(hiddenGpuEffectTypes),
    [hiddenGpuEffectTypes],
  )
  const isHiddenEffectEntry = useCallback(
    (entry: ItemEffect): boolean =>
      entry.effect.type === 'gpu-effect' && hiddenGpuEffectTypeSet.has(entry.effect.gpuEffectType),
    [hiddenGpuEffectTypeSet],
  )
  const hasHiddenGpuEffect = useCallback(
    (presetEffects: readonly VisualEffect[]): boolean =>
      presetEffects.some((effect) => hiddenGpuEffectTypeSet.has(effect.gpuEffectType)),
    [hiddenGpuEffectTypeSet],
  )

  // Get effects from first selected item (for display)
  // Multi-select shows first item's effects
  const effects = useMemo<ItemEffect[]>(
    () => (visualItems[0]?.effects ?? []).filter((entry) => !isHiddenEffectEntry(entry)),
    [isHiddenEffectEntry, visualItems],
  )
  const displayItem = visualItems[0] ?? null
  const keyframesByItemId = useKeyframesByItemId(itemIds)

  const getMappedEffectEntry = useCallback(
    (item: TimelineItem, displayEffectId: string): ItemEffect | null => {
      return getMappedSelectionEffectEntry(
        effects,
        item.effects?.filter((entry) => !isHiddenEffectEntry(entry)),
        displayEffectId,
      )
    },
    [effects, isHiddenEffectEntry],
  )

  const getKeyframeProperty = useCallback(
    (effectId: string, paramKey: string): AnimatableProperty | null => {
      const effect = effects.find((entry) => entry.id === effectId)
      return effect ? getGpuEffectKeyframeProperty(effect, paramKey) : null
    },
    [effects],
  )

  const getResolvedDisplayGpuEffect = useCallback(
    (effectEntry: ItemEffect): GpuEffect => {
      const itemKeyframeState = displayItem
        ? (keyframesByItemId.get(displayItem.id) ?? undefined)
        : undefined
      return getResolvedGpuEffectForFrame(effectEntry, displayItem, itemKeyframeState, currentFrame)
    },
    [currentFrame, displayItem, keyframesByItemId],
  )

  // Add a GPU shader effect
  const handleAddGpuEffect = useCallback(
    (gpuEffectId: string) => {
      const defaults = getGpuEffectDefaultParams(gpuEffectId)
      itemIds.forEach((id) => {
        addEffect(id, {
          type: 'gpu-effect',
          gpuEffectType: gpuEffectId,
          params: defaults,
        } as GpuEffect)
      })
    },
    [itemIds, addEffect],
  )

  const { gpuCategories, triggerPreviews } = useGpuEffectPreviewData()
  // Which picker row is hovered — drives that thumbnail's live sweep animation.
  const [hoveredPickerKey, setHoveredPickerKey] = useState<string | null>(null)

  // Update GPU effect parameter(s)
  const handleGpuParamChange = useCallback(
    (effectId: string, paramKey: string, value: number | boolean | string) => {
      const effect = effects.find((e) => e.id === effectId)
      if (!effect || effect.effect.type !== 'gpu-effect') return

      const gpuEff = effect.effect as GpuEffect
      const definition = getGpuEffect(gpuEff.gpuEffectType)
      const param = definition?.params[paramKey]
      const autoOperations =
        typeof value === 'number' && definition && param?.type === 'number' && param.animatable
          ? visualItems.flatMap((item) => {
              const targetEffect = getMappedEffectEntry(item, effectId)
              if (!targetEffect || targetEffect.effect.type !== 'gpu-effect') {
                return []
              }

              const itemKeyframeState = keyframesByItemId.get(item.id) ?? undefined
              const property = buildEffectAnimatableProperty(
                targetEffect.effect.gpuEffectType,
                targetEffect.id,
                paramKey,
              )
              const operation = getAutoKeyframeOperation(
                item,
                itemKeyframeState ?? undefined,
                property,
                value,
                currentFrame,
              )
              return operation ? [operation] : []
            })
          : []

      if (autoOperations.length > 0) {
        applyAutoKeyframeOperations(autoOperations)
      }

      visualItems.forEach((item) => {
        const targetEffect = getMappedEffectEntry(item, effectId)
        if (!targetEffect || targetEffect.effect.type !== 'gpu-effect') {
          return
        }

        const property = buildEffectAnimatableProperty(
          targetEffect.effect.gpuEffectType,
          targetEffect.id,
          paramKey,
        )
        const autoHandled =
          typeof value === 'number' &&
          autoOperations.some(
            (operation) => operation.itemId === item.id && operation.property === property,
          )
        if (autoHandled) {
          return
        }

        updateEffect(item.id, targetEffect.id, {
          effect: {
            ...targetEffect.effect,
            params: { ...targetEffect.effect.params, [paramKey]: value },
          },
        })
      })
      queueMicrotask(() => clearPreview())
    },
    [
      applyAutoKeyframeOperations,
      clearPreview,
      currentFrame,
      effects,
      getMappedEffectEntry,
      keyframesByItemId,
      updateEffect,
      visualItems,
    ],
  )

  // Batch update multiple GPU effect params atomically
  const handleGpuParamsBatchChange = useCallback(
    (effectId: string, updates: Record<string, number | boolean | string>) => {
      const effect = effects.find((e) => e.id === effectId)
      if (!effect || effect.effect.type !== 'gpu-effect') return

      const gpuEff = effect.effect as GpuEffect
      const definition = getGpuEffect(gpuEff.gpuEffectType)
      const autoOperations = visualItems.flatMap((item) => {
        const targetEffect = getMappedEffectEntry(item, effectId)
        if (!targetEffect || targetEffect.effect.type !== 'gpu-effect') {
          return []
        }

        const itemKeyframeState = keyframesByItemId.get(item.id) ?? undefined

        return Object.entries(updates).flatMap(([paramKey, paramValue]) => {
          const param = definition?.params[paramKey]
          if (
            typeof paramValue !== 'number' ||
            !definition ||
            param?.type !== 'number' ||
            !param.animatable
          ) {
            return []
          }

          const property = buildEffectAnimatableProperty(
            targetEffect.effect.gpuEffectType,
            targetEffect.id,
            paramKey,
          )
          const operation = getAutoKeyframeOperation(
            item,
            itemKeyframeState ?? undefined,
            property,
            paramValue,
            currentFrame,
          )
          return operation ? [operation] : []
        })
      })

      if (autoOperations.length > 0) {
        applyAutoKeyframeOperations(autoOperations)
      }

      visualItems.forEach((item) => {
        const targetEffect = getMappedEffectEntry(item, effectId)
        if (!targetEffect || targetEffect.effect.type !== 'gpu-effect') {
          return
        }

        const fallbackUpdates = { ...updates }
        for (const [paramKey, paramValue] of Object.entries(updates)) {
          const property = buildEffectAnimatableProperty(
            targetEffect.effect.gpuEffectType,
            targetEffect.id,
            paramKey,
          )
          const autoHandled =
            typeof paramValue === 'number' &&
            autoOperations.some(
              (operation) => operation.itemId === item.id && operation.property === property,
            )
          if (autoHandled) {
            delete fallbackUpdates[paramKey]
          }
        }

        if (Object.keys(fallbackUpdates).length === 0) {
          return
        }

        updateEffect(item.id, targetEffect.id, {
          effect: {
            ...targetEffect.effect,
            params: { ...targetEffect.effect.params, ...fallbackUpdates },
          },
        })
      })
      queueMicrotask(() => clearPreview())
    },
    [
      applyAutoKeyframeOperations,
      clearPreview,
      currentFrame,
      effects,
      getMappedEffectEntry,
      keyframesByItemId,
      updateEffect,
      visualItems,
    ],
  )

  // Live preview for GPU effect parameter
  const handleGpuParamLiveChange = useCallback(
    (effectId: string, paramKey: string, value: number | boolean | string) => {
      const previews: Record<string, ItemEffect[]> = {}
      visualItems.forEach((item) => {
        const targetEffect = getMappedEffectEntry(item, effectId)
        if (!targetEffect) return
        previews[item.id] = (item.effects ?? []).map((entry) => {
          if (entry.id !== targetEffect.id || entry.effect.type !== 'gpu-effect') return entry
          const entryGpu = entry.effect as GpuEffect
          return {
            ...entry,
            effect: {
              ...entryGpu,
              params: { ...entryGpu.params, [paramKey]: value },
            },
          }
        })
      })
      setEffectsPreviewNew(previews)
    },
    [getMappedEffectEntry, setEffectsPreviewNew, visualItems],
  )

  // Batch live preview for multiple GPU effect params atomically
  const handleGpuParamsBatchLiveChange = useCallback(
    (effectId: string, updates: Record<string, number | boolean | string>) => {
      const previews: Record<string, ItemEffect[]> = {}
      visualItems.forEach((item) => {
        const targetEffect = getMappedEffectEntry(item, effectId)
        if (!targetEffect) return
        previews[item.id] = (item.effects ?? []).map((entry) => {
          if (entry.id !== targetEffect.id || entry.effect.type !== 'gpu-effect') return entry
          const entryGpu = entry.effect as GpuEffect
          return {
            ...entry,
            effect: {
              ...entryGpu,
              params: { ...entryGpu.params, ...updates },
            },
          }
        })
      })
      setEffectsPreviewNew(previews)
    },
    [getMappedEffectEntry, setEffectsPreviewNew, visualItems],
  )

  // Reset GPU effect to defaults
  const handleResetGpuEffect = useCallback(
    (effectId: string) => {
      visualItems.forEach((item) => {
        const targetEffect = getMappedEffectEntry(item, effectId)
        if (!targetEffect || targetEffect.effect.type !== 'gpu-effect') {
          return
        }

        const defaults = getGpuEffectDefaultParams(targetEffect.effect.gpuEffectType)
        updateEffect(item.id, targetEffect.id, {
          effect: { ...targetEffect.effect, params: defaults },
        })
      })
    },
    [getMappedEffectEntry, updateEffect, visualItems],
  )

  // Apply a preset (adds multiple GPU effects as single undo/redo action)
  const handleApplyPreset = useCallback(
    (presetId: string) => {
      const preset = EFFECT_PRESETS.find((p) => p.id === presetId)
      if (!preset) return

      // Batch all effects for all items into a single store update
      const updates = itemIds.map((id) => ({
        itemId: id,
        effects: preset.effects,
      }))
      addEffects(updates)
    },
    [itemIds, addEffects],
  )

  // Toggle effect visibility
  const handleToggle = useCallback(
    (effectId: string) => {
      visualItems.forEach((item) => {
        const targetEffect = getMappedEffectEntry(item, effectId)
        if (targetEffect) {
          toggleEffect(item.id, targetEffect.id)
        }
      })
    },
    [getMappedEffectEntry, toggleEffect, visualItems],
  )

  // Check if all effects are enabled
  const allEffectsEnabled = useMemo(
    () => effects.length > 0 && effects.every((e) => e.enabled),
    [effects],
  )

  // Toggle all effects on/off
  const handleToggleAll = useCallback(() => {
    const newEnabled = !allEffectsEnabled
    visualItems.forEach((item) => {
      effects.forEach((effect) => {
        const targetEffect = getMappedEffectEntry(item, effect.id)
        // Only toggle if current state differs from target
        if (targetEffect && targetEffect.enabled !== newEnabled) {
          toggleEffect(item.id, targetEffect.id)
        }
      })
    })
  }, [allEffectsEnabled, effects, getMappedEffectEntry, toggleEffect, visualItems])

  // Move effect up/down within the stack (order matters for color math).
  // One undo step across all selected items.
  const handleMoveEffect = useCallback(
    (effectId: string, direction: -1 | 1) => {
      const updates: Array<{ itemId: string; effects: ItemEffect[] }> = []
      visualItems.forEach((item) => {
        const targetEffect = getMappedEffectEntry(item, effectId)
        if (!targetEffect) return
        const itemEffects = item.effects ?? []
        const visibleItemEffects = itemEffects.filter((entry) => !isHiddenEffectEntry(entry))
        const visibleIndex = visibleItemEffects.findIndex((entry) => entry.id === targetEffect.id)
        const swapTarget = visibleItemEffects[visibleIndex + direction]
        if (visibleIndex < 0 || !swapTarget) return

        const index = itemEffects.findIndex((entry) => entry.id === targetEffect.id)
        const swapIndex = itemEffects.findIndex((entry) => entry.id === swapTarget.id)
        if (index < 0 || swapIndex < 0) return

        const reordered = [...itemEffects]
        const moved = reordered[index]!
        reordered[index] = reordered[swapIndex]!
        reordered[swapIndex] = moved
        updates.push({ itemId: item.id, effects: reordered })
      })
      if (updates.length > 0) {
        setItemEffects(updates)
      }
    },
    [getMappedEffectEntry, isHiddenEffectEntry, setItemEffects, visualItems],
  )

  // Remove effect
  const handleRemove = useCallback(
    (effectId: string) => {
      visualItems.forEach((item) => {
        const targetEffect = getMappedEffectEntry(item, effectId)
        if (targetEffect) {
          removeEffect(item.id, targetEffect.id)
        }
      })
    },
    [getMappedEffectEntry, removeEffect, visualItems],
  )

  // Effect picker popover state
  const [pickerOpen, setPickerOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Position the picker panel below the trigger button
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({})

  const userPresets = useUserPresetsStore((s) => s.presets)
  const loadUserPresets = useUserPresetsStore((s) => s.loadPresets)
  const removeUserPreset = useUserPresetsStore((s) => s.removePreset)

  // Apply a user-saved preset (grade) to all selected items as one batch
  const handleApplyUserPreset = useCallback(
    (presetId: string) => {
      const preset = useUserPresetsStore.getState().presets.find((p) => p.id === presetId)
      if (!preset) return
      addEffects(itemIds.map((id) => ({ itemId: id, effects: preset.effects })))
    },
    [itemIds, addEffects],
  )

  const openPicker = useCallback(() => {
    triggerPreviews()
    void loadUserPresets()
    setSearchQuery('')
    // Measure the trigger synchronously so the portal mounts already
    // positioned — otherwise the first render flashes a full-width,
    // unconstrained panel before the positioning effect runs.
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPanelStyle({
        position: 'fixed',
        top: `${rect.bottom + 4}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
      })
    }
    setPickerOpen(true)
  }, [loadUserPresets, triggerPreviews])

  const closePicker = useCallback(() => {
    setPickerOpen(false)
    setSearchQuery('')
    triggerRef.current?.blur()
  }, [])

  // Focus the search input after the panel mounts.
  useEffect(() => {
    if (!pickerOpen) return
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [pickerOpen])

  // Close on click outside
  useEffect(() => {
    if (!pickerOpen) return
    const handlePointerDown = (e: PointerEvent) => {
      if (
        panelRef.current?.contains(e.target as Node) ||
        triggerRef.current?.contains(e.target as Node)
      )
        return
      closePicker()
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePicker()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [pickerOpen, closePicker])

  // Filter effects and presets by search query
  const filteredCategories = useMemo(() => {
    const visibleCategories =
      hiddenGpuEffectTypeSet.size === 0
        ? gpuCategories
        : gpuCategories
            .map(({ category, effects: catEffects }) => ({
              category,
              effects: catEffects.filter((def) => !hiddenGpuEffectTypeSet.has(def.id)),
            }))
            .filter(({ effects: catEffects }) => catEffects.length > 0)

    if (!searchQuery.trim()) return visibleCategories
    const q = searchQuery.toLowerCase()
    return visibleCategories
      .map(({ category, effects: catEffects }) => ({
        category,
        effects: catEffects.filter((def) => getEffectDefinitionName(def).toLowerCase().includes(q)),
      }))
      .filter(({ effects: catEffects }) => catEffects.length > 0)
  }, [gpuCategories, hiddenGpuEffectTypeSet, searchQuery])

  const filteredPresets = useMemo(() => {
    const visiblePresets =
      hiddenGpuEffectTypeSet.size === 0
        ? EFFECT_PRESETS
        : EFFECT_PRESETS.filter((preset) => !hasHiddenGpuEffect(preset.effects))
    if (!searchQuery.trim()) return visiblePresets
    const q = searchQuery.toLowerCase()
    return visiblePresets.filter((p) => p.name.toLowerCase().includes(q))
  }, [hasHiddenGpuEffect, hiddenGpuEffectTypeSet, searchQuery])

  const filteredUserPresets = useMemo(() => {
    const visibleUserPresets =
      hiddenGpuEffectTypeSet.size === 0
        ? userPresets
        : userPresets.filter((preset) => !hasHiddenGpuEffect(preset.effects))
    if (!searchQuery.trim()) return visibleUserPresets
    const q = searchQuery.toLowerCase()
    return visibleUserPresets.filter((p) => p.name.toLowerCase().includes(q))
  }, [hasHiddenGpuEffect, hiddenGpuEffectTypeSet, searchQuery, userPresets])

  const hasResults =
    filteredCategories.length > 0 || filteredPresets.length > 0 || filteredUserPresets.length > 0

  const addEffectControls = (
    <div className={isDock ? 'flex min-w-0 flex-1 gap-1' : 'px-2 pb-2 flex gap-1'}>
      <Button
        ref={triggerRef}
        variant="outline"
        size="sm"
        className="flex-1 h-7 min-w-0 text-xs"
        onClick={() => (pickerOpen ? closePicker() : openPicker())}
      >
        <Plus className="w-3 h-3 mr-1" />
        <span className="truncate">{t('effects.section.addEffect')}</span>
      </Button>
      {pickerOpen &&
        createPortal(
          <div
            ref={panelRef}
            style={panelStyle}
            className="z-50 rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 slide-in-from-top-2"
          >
            {/* Search input */}
            <div className="p-1.5 border-b">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('effects.section.searchEffects')}
                  className="w-full h-7 pl-7 pr-2 text-xs bg-transparent rounded-sm border border-input placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </div>

            {/* Scrollable effect list */}
            <div className="max-h-[280px] overflow-y-auto overflow-x-hidden p-1">
              {/* GPU Shader Effects */}
              {filteredCategories.map(({ category, effects: catEffects }, index) => (
                <div key={category}>
                  {index > 0 && <div className="-mx-1 my-1 h-px bg-muted" />}
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                    {getEffectCategoryLabel(t, category)}
                  </div>
                  {catEffects.map((def) => (
                    <button
                      key={def.id}
                      type="button"
                      className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none hover:bg-accent hover:text-accent-foreground"
                      onMouseEnter={() => setHoveredPickerKey(def.id)}
                      onMouseLeave={() => setHoveredPickerKey((k) => (k === def.id ? null : k))}
                      onClick={() => {
                        handleAddGpuEffect(def.id)
                        closePicker()
                      }}
                    >
                      <EffectThumbnail
                        effectId={def.id}
                        active={hoveredPickerKey === def.id}
                        className="w-8 h-[18px] rounded-sm flex-shrink-0"
                      />
                      {getEffectDefinitionName(def)}
                    </button>
                  ))}
                </div>
              ))}

              {filteredPresets.length > 0 && (
                <>
                  {filteredCategories.length > 0 && <div className="-mx-1 my-1 h-px bg-muted" />}
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                    {t('effects.section.presets')}
                  </div>
                  {filteredPresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none hover:bg-accent hover:text-accent-foreground"
                      onMouseEnter={() => setHoveredPickerKey(`preset:${preset.id}`)}
                      onMouseLeave={() =>
                        setHoveredPickerKey((k) => (k === `preset:${preset.id}` ? null : k))
                      }
                      onClick={() => {
                        handleApplyPreset(preset.id)
                        closePicker()
                      }}
                    >
                      <EffectThumbnail
                        effects={preset.effects}
                        active={hoveredPickerKey === `preset:${preset.id}`}
                        className="w-8 h-[18px] rounded-sm flex-shrink-0"
                      />
                      {preset.name}
                    </button>
                  ))}
                </>
              )}

              {filteredUserPresets.length > 0 && (
                <>
                  {(filteredCategories.length > 0 || filteredPresets.length > 0) && (
                    <div className="-mx-1 my-1 h-px bg-muted" />
                  )}
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                    {t('effects.section.myPresets')}
                  </div>
                  {filteredUserPresets.map((preset) => (
                    <div key={preset.id} className="group relative flex items-center">
                      <button
                        type="button"
                        className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 pr-7 text-xs outline-none hover:bg-accent hover:text-accent-foreground"
                        onClick={() => {
                          handleApplyUserPreset(preset.id)
                          closePicker()
                        }}
                      >
                        <span className="w-8 h-[18px] rounded-sm bg-muted flex-shrink-0" />
                        <span className="truncate">{preset.name}</span>
                      </button>
                      <button
                        type="button"
                        className="absolute right-1.5 hidden h-4 w-4 items-center justify-center rounded-sm text-muted-foreground hover:text-destructive group-hover:flex"
                        onClick={(event) => {
                          event.stopPropagation()
                          void removeUserPreset(preset.id)
                        }}
                        title={t('effects.section.deletePreset')}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </>
              )}

              {/* No results */}
              {!hasResults && (
                <div className="px-2 py-4 text-xs text-muted-foreground text-center">
                  {t('effects.section.noEffectsFound')}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
      {effects.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2"
          onClick={handleToggleAll}
          title={
            allEffectsEnabled ? t('effects.section.disableAll') : t('effects.section.enableAll')
          }
        >
          {allEffectsEnabled ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </Button>
      )}
    </div>
  )

  const effectList = (
    <div className="space-y-0">
      {effects.map((effect, effectIndex) => {
        if (effect.effect.type === 'gpu-effect') {
          const gpuEff = effect.effect as GpuEffect
          const def = getGpuEffect(gpuEff.gpuEffectType)
          if (!def) return null
          const displayGpuEffect = getResolvedDisplayGpuEffect(effect)

          if (gpuEff.gpuEffectType === 'gpu-curves') {
            return (
              <GpuCurvesPanel
                key={effect.id}
                effect={effect}
                gpuEffect={displayGpuEffect}
                definition={def}
                collapsible={gradePanelCollapsible}
                onEditInColor={onEditInColor}
                onParamChange={handleGpuParamChange}
                onParamLiveChange={handleGpuParamLiveChange}
                onParamsBatchChange={handleGpuParamsBatchChange}
                onParamsBatchLiveChange={handleGpuParamsBatchLiveChange}
                onReset={handleResetGpuEffect}
                onToggle={handleToggle}
                onRemove={handleRemove}
                onMove={handleMoveEffect}
                canMoveUp={effectIndex > 0}
                canMoveDown={effectIndex < effects.length - 1}
              />
            )
          }

          if (gpuEff.gpuEffectType === 'gpu-lut') {
            return (
              <GpuLutPanel
                key={effect.id}
                itemIds={itemIds}
                effect={effect}
                gpuEffect={displayGpuEffect}
                definition={def}
                getKeyframeProperty={getKeyframeProperty}
                onParamChange={handleGpuParamChange}
                onParamLiveChange={handleGpuParamLiveChange}
                onParamsBatchChange={handleGpuParamsBatchChange}
                onReset={handleResetGpuEffect}
                onToggle={handleToggle}
                onRemove={handleRemove}
                onMove={handleMoveEffect}
                canMoveUp={effectIndex > 0}
                canMoveDown={effectIndex < effects.length - 1}
              />
            )
          }

          if (gpuEff.gpuEffectType === 'gpu-color-wheels') {
            return (
              <GpuWheelsPanel
                key={effect.id}
                itemIds={itemIds}
                effect={effect}
                gpuEffect={displayGpuEffect}
                definition={def}
                collapsible={gradePanelCollapsible}
                onEditInColor={onEditInColor}
                getKeyframeProperty={getKeyframeProperty}
                onParamChange={handleGpuParamChange}
                onParamLiveChange={handleGpuParamLiveChange}
                onParamsBatchChange={handleGpuParamsBatchChange}
                onParamsBatchLiveChange={handleGpuParamsBatchLiveChange}
                onReset={handleResetGpuEffect}
                onToggle={handleToggle}
                onRemove={handleRemove}
                onMove={handleMoveEffect}
                canMoveUp={effectIndex > 0}
                canMoveDown={effectIndex < effects.length - 1}
              />
            )
          }

          if (gpuEff.gpuEffectType === 'gpu-secondary-qualifier') {
            return (
              <GpuSecondaryQualifierPanel
                key={effect.id}
                itemIds={itemIds}
                effect={effect}
                gpuEffect={displayGpuEffect}
                definition={def}
                getKeyframeProperty={getKeyframeProperty}
                onParamChange={handleGpuParamChange}
                onParamLiveChange={handleGpuParamLiveChange}
                onReset={handleResetGpuEffect}
                onToggle={handleToggle}
                onRemove={handleRemove}
                onMove={handleMoveEffect}
                canMoveUp={effectIndex > 0}
                canMoveDown={effectIndex < effects.length - 1}
              />
            )
          }

          if (gpuEff.gpuEffectType === 'gpu-power-window') {
            return (
              <GpuPowerWindowPanel
                key={effect.id}
                itemIds={itemIds}
                effect={effect}
                gpuEffect={displayGpuEffect}
                definition={def}
                getKeyframeProperty={getKeyframeProperty}
                onParamChange={handleGpuParamChange}
                onParamLiveChange={handleGpuParamLiveChange}
                onReset={handleResetGpuEffect}
                onToggle={handleToggle}
                onRemove={handleRemove}
                onMove={handleMoveEffect}
                canMoveUp={effectIndex > 0}
                canMoveDown={effectIndex < effects.length - 1}
              />
            )
          }

          return (
            <GpuEffectPanel
              key={effect.id}
              itemIds={itemIds}
              effect={effect}
              gpuEffect={displayGpuEffect}
              definition={def}
              getKeyframeProperty={getKeyframeProperty}
              onParamChange={handleGpuParamChange}
              onParamLiveChange={handleGpuParamLiveChange}
              onReset={handleResetGpuEffect}
              onToggle={handleToggle}
              onRemove={handleRemove}
              onMove={handleMoveEffect}
              canMoveUp={effectIndex > 0}
              canMoveDown={effectIndex < effects.length - 1}
            />
          )
        }

        return null
      })}
    </div>
  )

  const emptyState = effects.length === 0 && (
    <div className="px-2 py-3 text-xs text-muted-foreground text-center">
      {t('effects.section.emptyState')}
    </div>
  )

  if (visualItems.length === 0) return null

  if (isDock) {
    return (
      <section
        className="flex h-full min-h-0 flex-col overflow-hidden"
        data-testid="effects-section-dock"
      >
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/70 px-2">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h3 className="min-w-[4rem] truncate text-[11px] font-semibold text-muted-foreground">
            {t('effects.section.title')}
          </h3>
          {addEffectControls}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1">
          {effectList}
          {emptyState}
        </div>
      </section>
    )
  }

  return (
    <PropertySection title={t('effects.section.title')} icon={Sparkles} defaultOpen={true}>
      {/* Add Effect Picker + Toggle All */}
      {addEffectControls}

      {/* Active Effects List - wrapped to prevent space-y-3 from PropertySection */}
      {effectList}

      {/* Empty state */}
      {emptyState}
    </PropertySection>
  )
})
