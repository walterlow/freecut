import { useCallback, useMemo, memo, useRef, useState, useEffect, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles, Plus, Eye, EyeOff, Search } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@/components/ui/button'
import type { TimelineItem } from '@/types/timeline'
import type { ItemEffect, GpuEffect } from '@/types/effects'
import { EFFECT_PRESETS } from '@/types/effects'
import { useKeyframesStore, useTimelineStore } from '@/features/effects/deps/timeline-contract'
import { useGizmoStore, useThrottledFrame } from '@/features/effects/deps/preview-contract'
import { PropertySection } from '@/shared/ui/property-controls'
import { GpuEffectPanel, GpuWheelsPanel, GpuCurvesPanel } from './panels'
import {
  getGpuCategoriesWithEffects,
  getGpuEffect,
  getGpuEffectDefaultParams,
} from '@/infrastructure/gpu/effects'
import { useEffectPreviews } from '../hooks/use-effect-previews'
import { getMappedSelectionEffectEntry } from '../utils/effect-selection'
import {
  getAutoKeyframeOperation,
  getResolvedAnimatedEffectParamValue,
} from '@/features/effects/deps/keyframes-contract'
import { buildEffectAnimatableProperty, type AnimatableProperty } from '@/types/keyframe'

interface EffectsSectionProps {
  /** Visual items (already filtered to exclude audio) */
  items: TimelineItem[]
}

/**
 * Effects section - GPU shader effects for visual items.
 * Only shown when selection includes video, image, text, or shape clips.
 * Memoized to prevent re-renders when items prop hasn't changed.
 */
export const EffectsSection = memo(function EffectsSection({ items }: EffectsSectionProps) {
  const addEffect = useTimelineStore((s) => s.addEffect)
  const addEffects = useTimelineStore((s) => s.addEffects)
  const updateEffect = useTimelineStore((s) => s.updateEffect)
  const removeEffect = useTimelineStore((s) => s.removeEffect)
  const toggleEffect = useTimelineStore((s) => s.toggleEffect)
  const applyAutoKeyframeOperations = useTimelineStore((s) => s.applyAutoKeyframeOperations)

  // Gizmo store for live effect preview
  const setEffectsPreviewNew = useGizmoStore((s) => s.setEffectsPreviewNew)
  const clearPreview = useGizmoStore((s) => s.clearPreview)
  const currentFrame = useThrottledFrame()

  // Items are already filtered by parent - use directly
  const visualItems = items

  // Memoize item IDs for stable callback dependencies
  const itemIds = useMemo(() => visualItems.map((item) => item.id), [visualItems])

  // Get effects from first selected item (for display)
  // Multi-select shows first item's effects
  const effects = useMemo<ItemEffect[]>(() => visualItems[0]?.effects ?? [], [visualItems])
  const displayItem = visualItems[0] ?? null
  const itemKeyframes = useKeyframesStore(
    useShallow(
      useCallback((s) => itemIds.map((itemId) => s.keyframesByItemId[itemId] ?? null), [itemIds]),
    ),
  )
  const keyframesByItemId = useMemo(() => {
    const map = new Map<string, (typeof itemKeyframes)[number]>()
    for (const [index, itemId] of itemIds.entries()) {
      map.set(itemId, itemKeyframes[index] ?? null)
    }
    return map
  }, [itemIds, itemKeyframes])

  const getMappedEffectEntry = useCallback(
    (item: TimelineItem, displayEffectId: string): ItemEffect | null => {
      return getMappedSelectionEffectEntry(effects, item.effects, displayEffectId)
    },
    [effects],
  )

  const getKeyframeProperty = useCallback(
    (effectId: string, paramKey: string): AnimatableProperty | null => {
      const effect = effects.find((entry) => entry.id === effectId)
      if (!effect || effect.effect.type !== 'gpu-effect') {
        return null
      }

      const definition = getGpuEffect(effect.effect.gpuEffectType)
      const param = definition?.params[paramKey]
      if (!definition || param?.type !== 'number' || !param.animatable) {
        return null
      }

      return buildEffectAnimatableProperty(effect.effect.gpuEffectType, effectId, paramKey)
    },
    [effects],
  )

  const getResolvedDisplayGpuEffect = useCallback(
    (effectEntry: ItemEffect): GpuEffect => {
      const gpuEffect = effectEntry.effect as GpuEffect
      if (!displayItem) {
        return gpuEffect
      }

      const definition = getGpuEffect(gpuEffect.gpuEffectType)
      if (!definition) {
        return gpuEffect
      }

      const itemKeyframeState = keyframesByItemId.get(displayItem.id) ?? undefined
      const relativeFrame = currentFrame - displayItem.from
      let nextParams = gpuEffect.params
      let changed = false

      for (const [paramKey, param] of Object.entries(definition.params)) {
        if (param.type !== 'number' || !param.animatable) {
          continue
        }

        const value = getResolvedAnimatedEffectParamValue(
          effectEntry,
          itemKeyframeState ?? undefined,
          relativeFrame,
          paramKey,
        )
        if (value === null || nextParams[paramKey] === value) {
          continue
        }

        if (!changed) {
          nextParams = { ...gpuEffect.params }
          changed = true
        }

        nextParams[paramKey] = value
      }

      return changed
        ? {
            ...gpuEffect,
            params: nextParams,
          }
        : gpuEffect
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

  // GPU effect categories for dropdown menu
  const gpuCategories = useMemo(() => getGpuCategoriesWithEffects(), [])

  // Effect preview thumbnails — lazily GPU-rendered on first dropdown open
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

  const openPicker = useCallback(() => {
    triggerPreviews()
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
  }, [triggerPreviews])

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
    if (!searchQuery.trim()) return gpuCategories
    const q = searchQuery.toLowerCase()
    return gpuCategories
      .map(({ category, effects: catEffects }) => ({
        category,
        effects: catEffects.filter((def) => def.name.toLowerCase().includes(q)),
      }))
      .filter(({ effects: catEffects }) => catEffects.length > 0)
  }, [gpuCategories, searchQuery])

  const filteredPresets = useMemo(() => {
    if (!searchQuery.trim()) return EFFECT_PRESETS
    const q = searchQuery.toLowerCase()
    return EFFECT_PRESETS.filter((p) => p.name.toLowerCase().includes(q))
  }, [searchQuery])

  const hasResults = filteredCategories.length > 0 || filteredPresets.length > 0

  if (visualItems.length === 0) return null

  return (
    <PropertySection title="Effects" icon={Sparkles} defaultOpen={true}>
      {/* Add Effect Picker + Toggle All */}
      <div className="px-2 pb-2 flex gap-1">
        <Button
          ref={triggerRef}
          variant="outline"
          size="sm"
          className="flex-1 h-7 text-xs"
          onClick={() => (pickerOpen ? closePicker() : openPicker())}
        >
          <Plus className="w-3 h-3 mr-1" />
          Add Effect
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
                    placeholder="Search effects..."
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
                      {category.charAt(0).toUpperCase() + category.slice(1)}
                    </div>
                    {catEffects.map((def) => (
                      <button
                        key={def.id}
                        type="button"
                        className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none hover:bg-accent hover:text-accent-foreground"
                        onClick={() => {
                          handleAddGpuEffect(def.id)
                          closePicker()
                        }}
                      >
                        {effectPreviews.has(def.id) ? (
                          <img
                            src={effectPreviews.get(def.id)}
                            alt=""
                            className="w-8 h-[18px] rounded-sm object-cover flex-shrink-0"
                          />
                        ) : (
                          <span className="w-8 h-[18px] rounded-sm bg-muted flex-shrink-0" />
                        )}
                        {def.name}
                      </button>
                    ))}
                  </div>
                ))}

                {filteredPresets.length > 0 && (
                  <>
                    {filteredCategories.length > 0 && <div className="-mx-1 my-1 h-px bg-muted" />}
                    <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                      Presets
                    </div>
                    {filteredPresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none hover:bg-accent hover:text-accent-foreground"
                        onClick={() => {
                          handleApplyPreset(preset.id)
                          closePicker()
                        }}
                      >
                        {effectPreviews.has(`preset:${preset.id}`) ? (
                          <img
                            src={effectPreviews.get(`preset:${preset.id}`)}
                            alt=""
                            className="w-8 h-[18px] rounded-sm object-cover flex-shrink-0"
                          />
                        ) : (
                          <span className="w-8 h-[18px] rounded-sm bg-muted flex-shrink-0" />
                        )}
                        {preset.name}
                      </button>
                    ))}
                  </>
                )}

                {/* No results */}
                {!hasResults && (
                  <div className="px-2 py-4 text-xs text-muted-foreground text-center">
                    No effects found
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
            title={allEffectsEnabled ? 'Disable all effects' : 'Enable all effects'}
          >
            {allEffectsEnabled ? (
              <EyeOff className="w-3.5 h-3.5" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            )}
          </Button>
        )}
      </div>

      {/* Active Effects List - wrapped to prevent space-y-3 from PropertySection */}
      <div className="space-y-0">
        {effects.map((effect) => {
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
                  onParamChange={handleGpuParamChange}
                  onParamLiveChange={handleGpuParamLiveChange}
                  onParamsBatchChange={handleGpuParamsBatchChange}
                  onParamsBatchLiveChange={handleGpuParamsBatchLiveChange}
                  onReset={handleResetGpuEffect}
                  onToggle={handleToggle}
                  onRemove={handleRemove}
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
                  getKeyframeProperty={getKeyframeProperty}
                  onParamChange={handleGpuParamChange}
                  onParamLiveChange={handleGpuParamLiveChange}
                  onParamsBatchChange={handleGpuParamsBatchChange}
                  onParamsBatchLiveChange={handleGpuParamsBatchLiveChange}
                  onReset={handleResetGpuEffect}
                  onToggle={handleToggle}
                  onRemove={handleRemove}
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
              />
            )
          }

          return null
        })}
      </div>

      {/* Empty state */}
      {effects.length === 0 && (
        <div className="px-2 py-3 text-xs text-muted-foreground text-center">
          No effects applied. Click "Add Effect" to get started.
        </div>
      )}
    </PropertySection>
  )
})
