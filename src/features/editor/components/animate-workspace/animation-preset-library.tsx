import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ExternalLink,
  Layers3,
  ListFilter,
  Plus,
  Search,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import type { CanvasSettings } from '@/types/transform'
import type { AnimationKeyframeSource, AnimatableProperty } from '@/types/keyframe'
import type { TextItem } from '@/types/timeline'
import type { TextMotionSlot } from '@/types/text-motion'
import type { MotionModifierType } from '@/types/motion'
import { cn } from '@/shared/ui/cn'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { MotionBakeConfirmationDialog } from '@/shared/ui/motion-bake-confirmation-dialog'
import { useSelectionStore } from '@/shared/state/selection'
import { usePlaybackStore } from '@/shared/state/playback'
import { useProjectStore } from '@/features/editor/deps/projects'
import {
  applyAnimationPreset,
  applyMotionLayersToItems,
  applyMotionPresetKeyframes,
  applyMotionModifierToItems,
  updateMotionModifiersLive,
  beginMotionModifierEdit,
  commitMotionModifierEdit,
  removeMotionModifierFromItems,
  removePresetKeyframeApplication,
  removeManualKeyframes,
  trimAnimationToItemBounds,
  removeTextMotionEffect,
  bakeMotionToKeyframes,
  captureAnimationFromItem,
  getPresetCompatibility,
  createMotionClip,
  openComposition,
  useItemsStore,
  useKeyframesStore,
  useTimelineCommandStore,
  useCompositionsStore,
  type MotionPresetClear,
  type MotionPresetVectorApply,
} from '@/features/editor/deps/timeline-store'
import { getSourceDimensions, resolveTransform } from '@/features/editor/deps/composition-runtime'
import {
  getAnimatablePropertiesForItem,
  getKeyframePropertyLabel,
  getMotionPresetAnchorFrame,
  MOTION_MODULATORS,
  MOTION_PRESET_CATEGORIES,
  MOTION_PRESETS,
  motionPresetScalesBox,
  DEFAULT_MOTION_GENERATOR_SETTINGS,
  applyMotionGeneratorSettings,
  createMotionModifier,
  getMotionModifierSettings,
  updateMotionModifierSettings,
  createMotionAnimationLayer,
  buildBakeMotionPlan,
  countTrimmedKeyframes,
  resolveAnimatedTransform,
  type MotionPreset,
  type MotionPresetCategory,
  type MotionGeneratorSettings,
  type MotionModulator,
} from '@/features/editor/deps/keyframes'
import { getTextMotionTimelineBands } from '@/shared/timeline/text-motion-timeline'
import {
  readAnimationPresets,
  saveAnimationPresets,
  type AnimationPreset,
} from '@/infrastructure/storage'
import { MotionPresetThumbnail } from './motion-preset-thumbnail'
import { SaveAnimationPresetDialog } from './save-animation-preset-dialog'
import { TextMotionSlotRows } from '../text-motion/text-motion-slot-rows'
import { filterAnimationPresetCandidates } from './animation-preset-filter'
import { AppliedMotionSummary } from './applied-motion-summary'
import { ContinuousMotionRow, type ModifierEditSettings } from './continuous-motion-row'
import { MotionPresetControls } from './motion-preset-controls'
import { MotionPresetSection } from './motion-preset-section'
import { StageSection } from './stage-section'
import {
  EDIT_QUICK_PRESET_IDS,
  MOTION_PRESET_PROPERTIES,
  presetsByCategory,
  TEXT_SLOT_BY_MOTION_CATEGORY,
} from './animation-preset-catalogue'
import { selectPresetSelectedItems } from './preset-selection'

/**
 * Animation preset library (U7, R16): browse and save/apply the project's saved
 * animation presets from the unified Motion workspace. Presentational shell over the
 * storage layer (U5) and apply path (U6); presets incompatible with the current
 * selection render disabled with a reason tooltip. (Per-keyframe easing curves
 * live in the dopesheet's interpolation icon row, not here.)
 */
export const AnimationPresetLibrary = memo(function AnimationPresetLibrary({
  canvas,
  embedded = false,
  variant = 'full',
  itemIds,
}: {
  canvas: CanvasSettings
  /** Fill the shared Motion inspector rather than rendering a standalone sidebar. */
  embedded?: boolean
  /** Edit exposes a compact clip-level surface; Motion keeps the full authoring library. */
  variant?: 'full' | 'edit'
  /** Optional explicit targets, used to omit linked audio from clip-level animation. */
  itemIds?: string[]
}) {
  const { t } = useTranslation()
  const projectId = useProjectStore((s) => s.currentProject?.id ?? null)
  const storeSelectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const selectedItemIds = itemIds ?? storeSelectedItemIds
  const selectedItems = useItemsStore(
    useShallow(
      useCallback((s) => selectPresetSelectedItems(s, selectedItemIds), [selectedItemIds]),
    ),
  )
  const selectedItem = selectedItems[0] ?? null
  // Motion-text stage targets the text items in the selection (the actions
  // skip non-text items anyway; this also gates the stage's visibility).
  const selectedTextItems = useMemo(
    () => selectedItems.filter((item): item is TextItem => item.type === 'text'),
    [selectedItems],
  )
  const selectedItemKeyframes = useKeyframesStore(
    useCallback(
      (s) => (selectedItem ? (s.keyframesByItemId[selectedItem.id] ?? null) : null),
      [selectedItem],
    ),
  )
  const keyframesByItemId = useKeyframesStore((s) => s.keyframesByItemId)

  const [presets, setPresets] = useState<AnimationPreset[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [bakeDialogOpen, setBakeDialogOpen] = useState(false)
  // 'replace' (default) clears a preset's target properties before applying so
  // reapplying an entrance/exit preset swaps it; 'add' layers onto what's there.
  const [applyMode, setApplyMode] = useState<'replace' | 'merge' | 'layer'>('replace')
  const [searchQuery, setSearchQuery] = useState('')
  const [compatibleOnly, setCompatibleOnly] = useState(false)
  // Keyframe-preset parameters are authoring inputs, not timeline state. Keep
  // the live slider state inside MotionPresetControls and expose the current
  // value through a ref so dragging does not re-render the full preset grid.
  const motionGeneratorSettingsRef = useRef<MotionGeneratorSettings>({
    ...DEFAULT_MOTION_GENERATOR_SETTINGS,
  })
  const deferredSearchQuery = useDeferredValue(searchQuery)

  useEffect(() => {
    if (!projectId) {
      setPresets([])
      return
    }
    let cancelled = false
    void readAnimationPresets(projectId).then((loaded) => {
      if (!cancelled) setPresets(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const canCapture = Boolean(
    selectedItem &&
    (selectedItemKeyframes?.properties.some((property) => property.keyframes.length > 0) ||
      selectedItemKeyframes?.vectorProperties?.some((property) => property.keyframes.length > 0) ||
      selectedItem.motionModifiers?.some(
        (modifier) => modifier.enabled && modifier.amplitude > 0,
      ) ||
      selectedItem.motionLayers?.some((layer) => layer.enabled && layer.tracks.length > 0) ||
      (selectedItem.type === 'text' && selectedItem.textMotion)),
  )

  const handleSave = useCallback(
    async (name: string): Promise<boolean> => {
      if (!projectId || !selectedItem) return false
      const captured = captureAnimationFromItem(selectedItem, selectedItemKeyframes ?? undefined)
      if (!captured) return false

      const withoutDuplicate = presets.filter(
        (preset) => preset.name.toLowerCase() !== name.toLowerCase(),
      )
      const next: AnimationPreset[] = [
        ...withoutDuplicate,
        { id: crypto.randomUUID(), name, createdAt: Date.now(), ...captured },
      ]
      try {
        await saveAnimationPresets(projectId, next)
        setPresets(next)
        toast.success(t('editor.animatePresets.savedToast', { name }))
        return true
      } catch {
        return false
      }
    },
    [presets, projectId, selectedItem, selectedItemKeyframes, t],
  )

  const handleApply = useCallback(
    (preset: AnimationPreset) => {
      if (!selectedItem) {
        toast.warning(t('editor.animatePresets.selectClipFirst'))
        return
      }
      if (applyMode === 'layer') {
        toast.warning(t('editor.animateStages.savedLayerUnsupported'))
        return
      }
      const result = applyAnimationPreset(selectedItem.id, preset, 0, {
        replace: applyMode === 'replace',
      })
      // Report failure only when nothing was committed. An effect can be added
      // even if every keyframe clamped out — that still mutated the clip.
      if (
        result.incompatible ||
        (result.applied === 0 && result.addedEffects === 0 && result.appliedProcedural === 0)
      ) {
        toast.warning(t('editor.animatePresets.applyFailed'))
        return
      }
      toast.success(t('editor.animatePresets.appliedToast', { name: preset.name }))
    },
    [applyMode, selectedItem, t],
  )

  // Built-in motion presets resolve the clip's resting transform, build their
  // keyframes against it, then commit through the same undo-integrated path as
  // the text-animation presets.
  const motionPropertySets = useMemo(
    () =>
      new Map(
        selectedItems.map((item) => [
          item.id,
          new Set<AnimatableProperty>(getAnimatablePropertiesForItem(item)),
        ]),
      ),
    [selectedItems],
  )

  // Disabled reason for a motion preset on the current selection, or null when
  // it can apply. Scale presets reflow text, so they are gated for text clips.
  const motionReason = useCallback(
    (preset: MotionPreset): string | null => {
      if (selectedItems.length === 0) return t('editor.animatePresets.selectClipFirst')
      for (const item of selectedItems) {
        const motionPropertySet = motionPropertySets.get(item.id)
        if (item.type === 'text' && motionPresetScalesBox(preset)) {
          return t('editor.motionPresets.textIncompatible')
        }
        if (
          !motionPropertySet ||
          !preset.properties.every((property) => motionPropertySet.has(property))
        ) {
          return t('editor.animatePresets.incompatibleProperty')
        }
      }
      return null
    },
    [motionPropertySets, selectedItems, t],
  )

  const modulatorReason = useCallback(
    (modulator: MotionModulator): string | null => {
      if (selectedItems.length === 0) return t('editor.animatePresets.selectClipFirst')
      for (const item of selectedItems) {
        const motionPropertySet = motionPropertySets.get(item.id)
        if (item.type === 'text' && modulator.scalesBox) {
          return t('editor.motionPresets.textIncompatible')
        }
        if (
          !motionPropertySet ||
          !modulator.properties.every((property) => motionPropertySet.has(property))
        ) {
          return t('editor.animatePresets.incompatibleProperty')
        }
      }
      return null
    },
    [motionPropertySets, selectedItems, t],
  )

  const filteredMotionPresetsByCategory = useMemo(
    () =>
      MOTION_PRESET_CATEGORIES.reduce(
        (map, category) => {
          map[category] = filterAnimationPresetCandidates(
            presetsByCategory[category].map((preset) => ({
              item: preset,
              label: t(`editor.motionPresets.items.${preset.labelKey}`),
              compatible: motionReason(preset) === null,
            })),
            deferredSearchQuery,
            compatibleOnly,
          )
          return map
        },
        {} as Record<MotionPresetCategory, MotionPreset[]>,
      ),
    [compatibleOnly, deferredSearchQuery, motionReason, t],
  )
  const filteredModulators = useMemo(
    () =>
      filterAnimationPresetCandidates(
        MOTION_MODULATORS.map((modulator) => ({
          item: modulator,
          label: t(`editor.motionGenerator.modulators.${modulator.labelKey}`),
          compatible: modulatorReason(modulator) === null,
        })),
        deferredSearchQuery,
        compatibleOnly,
      ),
    [compatibleOnly, deferredSearchQuery, modulatorReason, t],
  )

  const handleApplyMotion = useCallback(
    (preset: MotionPreset) => {
      if (selectedItems.length === 0) {
        toast.warning(t('editor.animatePresets.selectClipFirst'))
        return
      }
      const replace = applyMode === 'replace'
      const additiveLayer = applyMode === 'layer'
      const clearSet = new Set<AnimatableProperty>(MOTION_PRESET_PROPERTIES)
      const payloads: Array<
        { itemId: string; source?: AnimationKeyframeSource } & ReturnType<
          typeof applyMotionGeneratorSettings
        >[number]
      > = []
      const clears: MotionPresetClear[] = []
      const vectorApplies: MotionPresetVectorApply[] = []
      const layerAssignments: Parameters<typeof applyMotionLayersToItems>[0] = []

      selectedItems.forEach((item, index) => {
        const itemKeyframes = keyframesByItemId[item.id]
        // In Replace mode the preset defines this clip's animation, so anchor the
        // resting pose off the BASE transform, ignoring existing keyframes on any
        // preset-owned property (they're about to be cleared in this region).
        const anchorKeyframes =
          replace && itemKeyframes
            ? {
                ...itemKeyframes,
                properties: itemKeyframes.properties.filter(
                  (entry) => !clearSet.has(entry.property),
                ),
                vectorProperties: itemKeyframes.vectorProperties?.filter(
                  (entry) => entry.property !== 'position' && entry.property !== 'scale',
                ),
              }
            : itemKeyframes
        const base = resolveTransform(item, canvas, getSourceDimensions(item))
        const anchorFrame = getMotionPresetAnchorFrame(
          preset.category,
          item.durationInFrames,
          canvas.fps,
        )
        const anchor = resolveAnimatedTransform(base, anchorKeyframes, anchorFrame)
        const ctx = {
          anchor,
          durationInFrames: item.durationInFrames,
          fps: canvas.fps,
          frameWidth: canvas.width,
          frameHeight: canvas.height,
        }
        const built = applyMotionGeneratorSettings(
          preset,
          preset.build(ctx),
          ctx,
          motionGeneratorSettingsRef.current,
          index,
        )
        if (built.length === 0) return
        if (additiveLayer) {
          const layer = createMotionAnimationLayer({
            name: t(`editor.motionPresets.items.${preset.labelKey}`),
            source: 'built-in-preset',
            sourcePresetId: preset.id,
            anchor,
            payloads: built,
          })
          layerAssignments.push({ itemId: item.id, layer })
          return
        }
        const source = {
          applicationId: crypto.randomUUID(),
          kind: 'built-in-preset' as const,
          presetId: preset.id,
          presetName: t(`editor.motionPresets.items.${preset.labelKey}`),
        }
        const existingVectorProperties = new Set(
          itemKeyframes?.vectorProperties
            ?.filter((property) => property.keyframes.length > 0)
            .map((property) => property.property) ?? [],
        )
        const vectorEvaluationKeyframes = replace ? anchorKeyframes : itemKeyframes
        const vectorControlledScalars = new Set<AnimatableProperty>()

        if (existingVectorProperties.has('position')) {
          const positionPayloads = built.filter(
            (keyframe) => keyframe.property === 'x' || keyframe.property === 'y',
          )
          if (positionPayloads.length > 0) {
            const frames = [...new Set(positionPayloads.map((keyframe) => keyframe.frame))]
            const fromFrame = Math.min(...frames)
            const toFrame = Math.max(...frames)
            vectorApplies.push({
              itemId: item.id,
              property: 'position',
              keyframes: frames.map((frame) => {
                const pose = resolveAnimatedTransform(base, vectorEvaluationKeyframes, frame)
                const x = positionPayloads.find(
                  (keyframe) => keyframe.frame === frame && keyframe.property === 'x',
                )
                const y = positionPayloads.find(
                  (keyframe) => keyframe.frame === frame && keyframe.property === 'y',
                )
                const style = x ?? y!
                return {
                  frame,
                  value: { x: x?.value ?? pose.x, y: y?.value ?? pose.y },
                  easing: style.easing,
                  easingConfig: style.easingConfig,
                  source,
                }
              }),
              ...(replace && { replaceRange: { fromFrame, toFrame } }),
            })
            vectorControlledScalars.add('x')
            vectorControlledScalars.add('y')
          }
        }

        if (existingVectorProperties.has('scale')) {
          const scalePayloads = built.filter(
            (keyframe) => keyframe.property === 'width' || keyframe.property === 'height',
          )
          if (scalePayloads.length > 0) {
            const frames = [...new Set(scalePayloads.map((keyframe) => keyframe.frame))]
            const fromFrame = Math.min(...frames)
            const toFrame = Math.max(...frames)
            vectorApplies.push({
              itemId: item.id,
              property: 'scale',
              keyframes: frames.map((frame) => {
                const pose = resolveAnimatedTransform(base, vectorEvaluationKeyframes, frame)
                const width = scalePayloads.find(
                  (keyframe) => keyframe.frame === frame && keyframe.property === 'width',
                )
                const height = scalePayloads.find(
                  (keyframe) => keyframe.frame === frame && keyframe.property === 'height',
                )
                const style = width ?? height!
                const resolvedWidth = width?.value ?? pose.width
                const resolvedHeight = height?.value ?? pose.height
                return {
                  frame,
                  value: {
                    x: base.width === 0 ? 100 : (resolvedWidth / base.width) * 100,
                    y: base.height === 0 ? 100 : (resolvedHeight / base.height) * 100,
                  },
                  easing: style.easing,
                  easingConfig: style.easingConfig,
                  source,
                }
              }),
              ...(replace && { replaceRange: { fromFrame, toFrame } }),
            })
            vectorControlledScalars.add('width')
            vectorControlledScalars.add('height')
          }
        }

        for (const keyframe of built) {
          if (!vectorControlledScalars.has(keyframe.property)) {
            payloads.push({ itemId: item.id, ...keyframe, source })
          }
        }

        if (replace) {
          // Clear every preset-owned property within THIS preset's frame window,
          // so a new entrance wipes a previous entrance (whatever properties it
          // used) while an exit at the other end of the clip is left intact.
          const frames = built.map((keyframe) => keyframe.frame)
          const fromFrame = Math.min(...frames)
          const toFrame = Math.max(...frames)
          for (const property of MOTION_PRESET_PROPERTIES) {
            clears.push({ itemId: item.id, property, fromFrame, toFrame })
          }
        }
      })

      if (additiveLayer) {
        const applied = applyMotionLayersToItems(layerAssignments)
        if (applied === 0) {
          toast.warning(t('editor.animatePresets.applyFailed'))
          return
        }
        toast.success(
          t('editor.animatePresets.appliedToast', {
            name: t(`editor.motionPresets.items.${preset.labelKey}`),
          }),
        )
        return
      }
      if (payloads.length === 0 && vectorApplies.length === 0) {
        toast.warning(t('editor.animatePresets.applyFailed'))
        return
      }
      // The action drops keyframes that land inside a transition region; if every
      // keyframe was dropped nothing was applied, so don't claim success.
      const mergePayloads = replace
        ? payloads
        : payloads.filter((payload) => {
            const itemKeyframes = keyframesByItemId[payload.itemId]
            const lane = itemKeyframes?.properties.find(
              (candidate) => candidate.property === payload.property,
            )
            return !lane?.keyframes.some((keyframe) => keyframe.frame === payload.frame)
          })
      const appliedIds = applyMotionPresetKeyframes(
        mergePayloads,
        replace ? clears : [],
        vectorApplies,
      )
      if (appliedIds.length === 0) {
        toast.warning(t('editor.animatePresets.transitionBlocked'))
        return
      }
      toast.success(
        t('editor.animatePresets.appliedToast', {
          name: t(`editor.motionPresets.items.${preset.labelKey}`),
        }),
      )
    },
    [applyMode, canvas, keyframesByItemId, selectedItems, t],
  )

  // A modulator is "active" when every selected clip already carries it — used
  // to drive the toggle-off behavior and the button's pressed state.
  const activeModulatorIds = useMemo(() => {
    const active = new Set<string>()
    if (selectedItems.length === 0) return active
    for (const modulator of MOTION_MODULATORS) {
      const onEvery = selectedItems.every((item) =>
        item.motionModifiers?.some((entry) => entry.type === modulator.id && entry.enabled),
      )
      if (onEvery) active.add(modulator.id)
    }
    return active
  }, [selectedItems])

  // Apply-on-click: attach a parametric modifier with sensible defaults. It runs
  // live at render time (non-destructive); the per-row flyout tunes it afterward.
  // Per-item index staggers phase/seed across a multi-clip selection.
  const handleApplyModulator = useCallback(
    (modulator: MotionModulator) => {
      const reason = modulatorReason(modulator)
      if (reason) {
        toast.warning(reason)
        return
      }
      const assignments = selectedItems.map((item, index) => ({
        itemId: item.id,
        modifier: createMotionModifier(modulator.id, DEFAULT_MOTION_GENERATOR_SETTINGS, index),
      }))
      const applied = applyMotionModifierToItems(assignments)
      if (applied === 0) {
        toast.warning(t('editor.motionGenerator.modulatorApplyFailed'))
        return
      }
      toast.success(
        t('editor.motionGenerator.modulatorApplied', {
          name: t(`editor.motionGenerator.modulators.${modulator.labelKey}`),
          count: applied,
        }),
      )
    },
    [modulatorReason, selectedItems, t],
  )

  const handleRemoveModulator = useCallback(
    (modulator: MotionModulator) => {
      if (selectedItems.length === 0) return
      removeMotionModifierFromItems(
        selectedItems.map((item) => item.id),
        modulator.id,
      )
      toast.success(
        t('editor.motionGenerator.modulatorRemoved', {
          name: t(`editor.motionGenerator.modulators.${modulator.labelKey}`),
        }),
      )
    },
    [selectedItems, t],
  )

  // Live settings of each applied modulator on the first selected clip — seeds
  // the flyout sliders so they open showing the modifier's current values.
  const modulatorSettingsByType = useMemo(() => {
    const map = new Map<MotionModifierType, ReturnType<typeof getMotionModifierSettings>>()
    for (const modifier of selectedItem?.motionModifiers ?? []) {
      if (modifier.enabled) map.set(modifier.type, getMotionModifierSettings(modifier))
    }
    return map
  }, [selectedItem])

  // One coalesced undo per flyout drag: snapshot on the first live change, commit
  // on release. A plain click (no drag) commits directly. Only one flyout opens
  // at a time, so a single ref tracks the active gesture.
  const modifierEditRef = useRef<ReturnType<typeof beginMotionModifierEdit> | null>(null)
  const buildModifierEditAssignments = useCallback(
    (type: MotionModifierType, settings: ModifierEditSettings) =>
      selectedItems.flatMap((item) => {
        const existing = item.motionModifiers?.find((m) => m.type === type && m.enabled)
        return existing
          ? [{ itemId: item.id, modifier: updateMotionModifierSettings(existing, settings) }]
          : []
      }),
    [selectedItems],
  )
  const handleModulatorLiveEdit = useCallback(
    (type: MotionModifierType, settings: ModifierEditSettings) => {
      const assignments = buildModifierEditAssignments(type, settings)
      if (assignments.length === 0) return
      if (!modifierEditRef.current) modifierEditRef.current = beginMotionModifierEdit()
      updateMotionModifiersLive(assignments)
    },
    [buildModifierEditAssignments],
  )
  const handleModulatorCommitEdit = useCallback(
    (type: MotionModifierType, settings: ModifierEditSettings) => {
      const assignments = buildModifierEditAssignments(type, settings)
      if (assignments.length === 0) return
      if (modifierEditRef.current) {
        updateMotionModifiersLive(assignments)
        commitMotionModifierEdit(modifierEditRef.current, {
          type,
          itemIds: assignments.map((assignment) => assignment.itemId),
        })
        modifierEditRef.current = null
      } else {
        applyMotionModifierToItems(assignments)
      }
    },
    [buildModifierEditAssignments],
  )

  // Bake bridge: any selected clip carrying procedural motion can be flattened
  // to editable keyframes (drift/breath/shake transforms + audio-pulse effects).
  const hasBakeableMotion = useMemo(
    () =>
      selectedItems.some(
        (item) =>
          item.motionModifiers?.some((modifier) => modifier.enabled) ||
          item.motionLayers?.some((layer) => layer.enabled) ||
          item.effects?.some((effect) => effect.audioPulse?.enabled),
      ),
    [selectedItems],
  )

  const handleBakeMotion = useCallback(() => {
    const plan = buildBakeMotionPlan({
      items: selectedItems,
      keyframesByItemId,
      fps: canvas.fps,
      frameWidth: canvas.width,
      frameHeight: canvas.height,
      resolveBase: (item) => resolveTransform(item, canvas, getSourceDimensions(item)),
    })

    if (plan.length === 0) {
      toast.warning(t('editor.motionGenerator.bakeNoMotion'))
      return
    }

    const baked = bakeMotionToKeyframes(plan)
    setBakeDialogOpen(false)
    toast.success(t('editor.motionGenerator.motionBaked', { count: baked }))
  }, [canvas, keyframesByItemId, selectedItems, t])

  const handleDelete = useCallback(
    async (preset: AnimationPreset) => {
      if (!projectId) return
      const next = presets.filter((candidate) => candidate.id !== preset.id)
      try {
        await saveAnimationPresets(projectId, next)
        setPresets(next)
      } catch {
        toast.warning(t('editor.animatePresets.saveFailed'))
      }
    },
    [presets, projectId, t],
  )

  // Compatibility depends only on the presets and the target item, so compute
  // it once per change rather than per preset on every render (the component
  // also re-renders on keyframe-selection changes for the easing section).
  const compatibilityByPresetId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getPresetCompatibility>>()
    if (!selectedItem) return map
    for (const preset of presets) {
      map.set(preset.id, getPresetCompatibility(preset, selectedItem))
    }
    return map
  }, [presets, selectedItem])

  const incompatibilityReason = useCallback(
    (preset: AnimationPreset): string | null => {
      if (!selectedItem) return t('editor.animatePresets.selectClipFirst')
      if (applyMode === 'layer') return t('editor.animateStages.savedLayerUnsupported')
      const compatibility = compatibilityByPresetId.get(preset.id)
      if (!compatibility || compatibility.compatible) return null
      return compatibility.reason === 'type-mismatch'
        ? t('editor.animatePresets.incompatibleType', { type: preset.sourceItemType })
        : t('editor.animatePresets.incompatibleProperty')
    },
    [applyMode, compatibilityByPresetId, selectedItem, t],
  )
  const filteredSavedPresets = useMemo(
    () =>
      filterAnimationPresetCandidates(
        presets.map((preset) => ({
          item: preset,
          label: preset.name,
          compatible: incompatibilityReason(preset) === null,
        })),
        deferredSearchQuery,
        compatibleOnly,
      ),
    [compatibleOnly, deferredSearchQuery, incompatibilityReason, presets],
  )
  const visibleMotionPresetCount = useMemo(
    () =>
      MOTION_PRESET_CATEGORIES.reduce(
        (count, category) => count + filteredMotionPresetsByCategory[category].length,
        0,
      ),
    [filteredMotionPresetsByCategory],
  )
  const filtersActive = deferredSearchQuery.trim().length > 0 || compatibleOnly
  const hasVisiblePresetResults =
    visibleMotionPresetCount > 0 ||
    filteredModulators.length > 0 ||
    filteredSavedPresets.length > 0 ||
    selectedTextItems.length > 0

  // --- "Applied to this clip" summary (state the panel otherwise hides) ---
  const keyframeApplications = useMemo(() => {
    const applications = new Map<
      string,
      {
        source: NonNullable<import('@/types/keyframe').Keyframe['source']>
        properties: Set<string>
        keyframeCount: number
        firstFrame: number
      }
    >()
    const add = (
      propertyLabel: string,
      frame: number,
      source: import('@/types/keyframe').Keyframe['source'],
    ) => {
      if (!source) return
      const current = applications.get(source.applicationId) ?? {
        source,
        properties: new Set<string>(),
        keyframeCount: 0,
        firstFrame: frame,
      }
      current.properties.add(propertyLabel)
      current.keyframeCount += 1
      current.firstFrame = Math.min(current.firstFrame, frame)
      applications.set(source.applicationId, current)
    }
    for (const property of selectedItemKeyframes?.properties ?? []) {
      const label = getKeyframePropertyLabel(t, property.property)
      for (const keyframe of property.keyframes) add(label, keyframe.frame, keyframe.source)
    }
    for (const property of selectedItemKeyframes?.vectorProperties ?? []) {
      const label = t(`editor.animateStages.vectorProperties.${property.property}`)
      for (const keyframe of property.keyframes) add(label, keyframe.frame, keyframe.source)
    }
    return [...applications.values()]
  }, [selectedItemKeyframes, t])
  const manualKeyframeSummary = useMemo(() => {
    const properties = new Set<string>()
    let keyframeCount = 0
    let firstFrame = Number.POSITIVE_INFINITY
    for (const property of selectedItemKeyframes?.properties ?? []) {
      const manualKeyframes = property.keyframes.filter((keyframe) => !keyframe.source)
      const count = manualKeyframes.length
      if (count === 0) continue
      properties.add(getKeyframePropertyLabel(t, property.property))
      keyframeCount += count
      for (const keyframe of manualKeyframes) firstFrame = Math.min(firstFrame, keyframe.frame)
    }
    for (const property of selectedItemKeyframes?.vectorProperties ?? []) {
      const manualKeyframes = property.keyframes.filter((keyframe) => !keyframe.source)
      const count = manualKeyframes.length
      if (count === 0) continue
      properties.add(t(`editor.animateStages.vectorProperties.${property.property}`))
      keyframeCount += count
      for (const keyframe of manualKeyframes) firstFrame = Math.min(firstFrame, keyframe.frame)
    }
    return {
      properties: [...properties],
      keyframeCount,
      firstFrame: Number.isFinite(firstFrame) ? firstFrame : null,
    }
  }, [selectedItemKeyframes, t])
  const trimmedKeyframeCount = useMemo(
    () =>
      selectedItem
        ? countTrimmedKeyframes(selectedItemKeyframes, selectedItem.durationInFrames)
        : 0,
    [selectedItem, selectedItemKeyframes],
  )
  const activeModulators = useMemo(
    () => MOTION_MODULATORS.filter((modulator) => activeModulatorIds.has(modulator.id)),
    [activeModulatorIds],
  )
  const activeMotionLayers = useMemo(
    () => selectedItem?.motionLayers?.filter((layer) => layer.enabled) ?? [],
    [selectedItem],
  )
  const hasAudioPulse = useMemo(
    () => !!selectedItem?.effects?.some((effect) => effect.audioPulse?.enabled),
    [selectedItem],
  )
  const activeTextMotion = useMemo(() => {
    if (!selectedItem || selectedItem.type !== 'text' || !selectedItem.textMotion) return []
    return (['in', 'out', 'loop'] as const).flatMap((slot) => {
      const effect = selectedItem.textMotion?.[slot]
      return effect ? [{ slot, effect }] : []
    })
  }, [selectedItem])
  const hasAnyAnimation =
    manualKeyframeSummary.keyframeCount > 0 ||
    keyframeApplications.length > 0 ||
    activeMotionLayers.length > 0 ||
    activeModulators.length > 0 ||
    activeTextMotion.length > 0 ||
    hasAudioPulse

  const navigateToAbsoluteFrame = useCallback((frame: number) => {
    const playback = usePlaybackStore.getState()
    playback.pause()
    playback.finishScrub(Math.max(0, Math.round(frame)))
  }, [])
  const navigateToItemFrame = useCallback(
    (frame: number) => {
      if (!selectedItem) return
      const localFrame = Math.min(
        Math.max(0, Math.round(frame)),
        Math.max(0, selectedItem.durationInFrames - 1),
      )
      navigateToAbsoluteFrame(selectedItem.from + localFrame)
    },
    [navigateToAbsoluteFrame, selectedItem],
  )
  const navigateToTextMotion = useCallback(
    (slot: TextMotionSlot) => {
      if (!selectedItem) return
      const band = getTextMotionTimelineBands(selectedItem).find(
        (candidate) => candidate.slot === slot,
      )
      if (band) navigateToAbsoluteFrame(band.fromFrame)
    },
    [navigateToAbsoluteFrame, selectedItem],
  )

  const handleRemoveManualKeyframes = useCallback(() => {
    if (!selectedItem) return
    removeManualKeyframes(selectedItem.id)
  }, [selectedItem])

  const handleTrimAnimation = useCallback(() => {
    if (!selectedItem) return
    const itemId = selectedItem.id
    const removedCount = trimAnimationToItemBounds(itemId)
    if (removedCount === 0) return
    toast.success(
      t('timeline.keyframeEditor.trimAnimationToast', {
        count: removedCount,
      }),
      {
        action: {
          label: t('timeline.header.undo'),
          onClick: () => {
            const commandStore = useTimelineCommandStore.getState()
            const latest = commandStore.undoStack.at(-1)
            if (
              latest?.command.type === 'TRIM_ANIMATION_TO_BOUNDS' &&
              latest.command.payload?.itemId === itemId
            ) {
              commandStore.undo()
            }
          },
        },
      },
    )
  }, [selectedItem, t])

  const handleRemovePresetApplication = useCallback(
    (applicationId: string) => {
      if (!selectedItem) return
      removePresetKeyframeApplication(selectedItem.id, applicationId)
    },
    [selectedItem],
  )

  const handleRemoveTextMotion = useCallback(
    (slot: TextMotionSlot) => {
      removeTextMotionEffect(selectedItemIds, slot)
    },
    [selectedItemIds],
  )

  const handleMotionGeneratorSettingsChange = useCallback((settings: MotionGeneratorSettings) => {
    motionGeneratorSettingsRef.current = settings
  }, [])

  const editQuickPresets = useMemo(
    () => MOTION_PRESETS.filter((preset) => EDIT_QUICK_PRESET_IDS.has(preset.id)),
    [],
  )
  const selectedCompositionKind = useCompositionsStore((state) =>
    selectedItem?.type === 'composition'
      ? state.compositionById[selectedItem.compositionId]?.editorKind
      : undefined,
  )
  const isMotionClip =
    selectedItems.length === 1 &&
    selectedItem?.type === 'composition' &&
    selectedCompositionKind === 'composite-2d'
  const handleMotionClip = useCallback(() => {
    if (isMotionClip && selectedItem?.type === 'composition') {
      openComposition(selectedItem.compositionId, selectedItem.label, selectedItem.id)
      return
    }
    if (selectedItems.length === 0) return
    const baseName = selectedItem?.label?.trim() || t('editor.editAnimation.untitledClip')
    createMotionClip(
      `${baseName} Motion`,
      selectedItems.map((item) => item.id),
    )
  }, [isMotionClip, selectedItem, selectedItems, t])

  if (variant === 'edit') {
    return (
      <TooltipProvider delayDuration={300}>
        <div className="flex flex-col gap-4" data-testid="edit-animation-panel">
          <section className="flex flex-col gap-2">
            <div>
              <h3 className="text-xs font-medium">{t('editor.editAnimation.quickTitle')}</h3>
              <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                {t('editor.editAnimation.quickHint')}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {editQuickPresets.map((preset) => {
                const disabledReason = motionReason(preset)
                const label = t(`editor.motionPresets.items.${preset.labelKey}`)
                return (
                  <Tooltip key={preset.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        disabled={disabledReason !== null}
                        onClick={() => handleApplyMotion(preset)}
                        className={cn(
                          'group flex min-h-14 flex-col items-center gap-1 rounded-md border border-border/60 p-1.5 text-[10px]',
                          disabledReason
                            ? 'cursor-not-allowed text-muted-foreground/40'
                            : 'text-muted-foreground hover:border-border hover:bg-secondary/40 hover:text-foreground',
                        )}
                      >
                        <MotionPresetThumbnail thumbnail={preset.thumbnail} />
                        <span className="w-full truncate text-center">{label}</span>
                      </button>
                    </TooltipTrigger>
                    {disabledReason ? <TooltipContent>{disabledReason}</TooltipContent> : null}
                  </Tooltip>
                )
              })}
            </div>
          </section>

          {hasAnyAnimation ? (
            <>
              <Separator />
              <AppliedMotionSummary
            variant="edit"
            manualKeyframeSummary={manualKeyframeSummary}
            trimmedKeyframeCount={trimmedKeyframeCount}
            keyframeApplications={keyframeApplications}
            activeTextMotion={activeTextMotion}
            selectedItems={selectedItems}
            canvas={canvas}
            onRemoveManualKeyframes={handleRemoveManualKeyframes}
            onTrimAnimation={handleTrimAnimation}
            onRemovePresetApplication={handleRemovePresetApplication}
            onNavigateToItemFrame={navigateToItemFrame}
            onRemoveTextMotion={handleRemoveTextMotion}
            onNavigateToTextMotion={navigateToTextMotion}
            t={t}
              />
            </>
          ) : null}

          {selectedTextItems.length > 0 ? (
            <>
              <Separator />
              <section className="flex flex-col gap-2">
                <div>
                  <h3 className="text-xs font-medium">{t('textMotion.sectionTitle')}</h3>
                  <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                    {t('editor.editAnimation.textHint')}
                  </p>
                </div>
                <TextMotionSlotRows items={selectedTextItems} />
              </section>
            </>
          ) : null}

          <Separator />

          <section className="rounded-md border border-border/60 bg-secondary/20 p-2.5">
            <div className="flex items-start gap-2">
              <Layers3 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <h3 className="text-xs font-medium">{t('editor.editAnimation.motionClipTitle')}</h3>
                <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                  {isMotionClip
                    ? t('editor.editAnimation.motionClipOpenHint')
                    : t('editor.editAnimation.motionClipCreateHint')}
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-2 h-7 gap-1.5 px-2 text-[10px]"
                  onClick={handleMotionClip}
                >
                  {isMotionClip ? (
                    <ExternalLink className="h-3 w-3" />
                  ) : (
                    <Layers3 className="h-3 w-3" />
                  )}
                  {isMotionClip
                    ? t('editor.editAnimation.openInMotion')
                    : t('editor.editAnimation.createMotionClip')}
                </Button>
              </div>
            </div>
          </section>
        </div>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'flex h-full min-w-0 flex-col bg-background',
          embedded ? 'w-full' : 'w-72 border-l border-border',
        )}
        data-testid="motion-library"
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            {t('editor.animatePresets.title')}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-[11px]"
                  disabled={!canCapture}
                  onClick={() => setDialogOpen(true)}
                >
                  <Plus className="h-3 w-3" />
                  {t('editor.animatePresets.saveButtonLong')}
                </Button>
              </span>
            </TooltipTrigger>
            {!canCapture && (
              <TooltipContent>{t('editor.animatePresets.noAnimationToSave')}</TooltipContent>
            )}
          </Tooltip>
        </div>

        <div className="flex items-center gap-1.5 border-b border-border/70 p-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              name="animation-preset-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('editor.animatePresets.searchPlaceholder')}
              aria-label={t('editor.animatePresets.searchPlaceholder')}
              autoComplete="off"
              className="h-7 pl-7 pr-7 text-[11px]"
            />
            {searchQuery.length > 0 ? (
              <button
                type="button"
                aria-label={t('editor.animatePresets.clearSearch')}
                className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => setSearchQuery('')}
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>
          <Button
            type="button"
            variant={compatibleOnly ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 shrink-0 gap-1 px-2 text-[10px]"
            aria-pressed={compatibleOnly}
            title={t('editor.animatePresets.compatibleOnlyHint')}
            onClick={() => setCompatibleOnly((current) => !current)}
          >
            <ListFilter className="h-3 w-3" />
            {t('editor.animatePresets.compatibleOnly')}
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {/* Extra right padding clears the overlay scrollbar so values aren't clipped. */}
          <div className="flex flex-col gap-4 p-3 pr-4">
            {/* ── Applied state for the selected clip — keyframes, live
                modulators, audio pulse. Each removable thing carries an ✕. ── */}
            {hasAnyAnimation && (
              <AppliedMotionSummary
              variant="panel"
              manualKeyframeSummary={manualKeyframeSummary}
              trimmedKeyframeCount={trimmedKeyframeCount}
              keyframeApplications={keyframeApplications}
              activeTextMotion={activeTextMotion}
              selectedItems={selectedItems}
              canvas={canvas}
              onRemoveManualKeyframes={handleRemoveManualKeyframes}
              onTrimAnimation={handleTrimAnimation}
              onRemovePresetApplication={handleRemovePresetApplication}
              onNavigateToItemFrame={navigateToItemFrame}
              onRemoveTextMotion={handleRemoveTextMotion}
              onNavigateToTextMotion={navigateToTextMotion}
              t={t}
              />
            )}

            {/* ── Start: presets (declarative). Picking one fills the dopesheet
                with editable keyframes — the cue points users at the graph. ── */}
            <p className="rounded-md bg-secondary/30 px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
              {t('editor.animateStages.presetsHint')}
            </p>

            {/* Keyframe presets can replace a region, merge diamonds into the
                base lanes, or remain independent as a named additive layer. */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground">
                {t('editor.animateStages.onApply')}
              </span>
              <div className="inline-flex overflow-hidden rounded-md border border-border/60">
                {(['replace', 'merge', 'layer'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={applyMode === mode}
                    onClick={() => setApplyMode(mode)}
                    className={cn(
                      'px-2 py-0.5 text-[10px] font-medium',
                      applyMode === mode
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:bg-secondary/40',
                    )}
                  >
                    {t(`editor.animateStages.applyMode.${mode}`)}
                  </button>
                ))}
              </div>
            </div>

            <MotionPresetControls onSettingsChange={handleMotionGeneratorSettingsChange} t={t} />

            {MOTION_PRESET_CATEGORIES.map((category) => {
              const textSlot = TEXT_SLOT_BY_MOTION_CATEGORY[category]
              const layerPresets = filteredMotionPresetsByCategory[category]
              const showTextScope = selectedTextItems.length > 0 && textSlot
              if (layerPresets.length === 0 && !showTextScope) return null
              return (
                <StageSection
                  key={category}
                  title={t(`editor.motionPresets.categories.${category}`)}
                >
                  {layerPresets.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-medium text-muted-foreground">
                        {t('editor.animateStages.scopeLayer')}
                      </span>
                      <MotionPresetSection
                        category={category}
                        presets={layerPresets}
                        reasonFor={motionReason}
                        onApply={handleApplyMotion}
                        showHeading={false}
                        t={t}
                      />
                    </div>
                  ) : null}
                  {showTextScope ? (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-medium text-muted-foreground">
                        {t('editor.animateStages.scopeText')}
                      </span>
                      <TextMotionSlotRows
                        items={selectedTextItems}
                        query={deferredSearchQuery}
                        slots={[textSlot]}
                        showSlotHeading={false}
                        showEmptyState={false}
                      />
                    </div>
                  ) : null}
                </StageSection>
              )
            })}

            {/* Layer behaviours and text loops share the same user intent even
                though only the layer behaviours can be baked to keyframes. */}
            {filteredModulators.length > 0 || selectedTextItems.length > 0 ? (
              <StageSection
                title={t('editor.animateStages.continuousTitle')}
                hint={t('editor.animateStages.continuousHint')}
                defaultOpen={false}
              >
                {filteredModulators.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {t('editor.animateStages.scopeLayer')}
                    </span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {filteredModulators.map((modulator) => (
                        <ContinuousMotionRow
                          key={modulator.id}
                          modulator={modulator}
                          active={activeModulatorIds.has(modulator.id)}
                          reason={modulatorReason(modulator)}
                          settings={modulatorSettingsByType.get(modulator.id) ?? null}
                          onApply={() => handleApplyModulator(modulator)}
                          onRemove={() => handleRemoveModulator(modulator)}
                          onLiveEdit={(settings) => handleModulatorLiveEdit(modulator.id, settings)}
                          onCommitEdit={(settings) =>
                            handleModulatorCommitEdit(modulator.id, settings)
                          }
                          t={t}
                        />
                      ))}
                    </div>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-full justify-start gap-1.5 px-2 text-[11px]"
                            disabled={!hasBakeableMotion}
                            onClick={() => setBakeDialogOpen(true)}
                          >
                            <WandSparkles className="h-3.5 w-3.5" />
                            {t('editor.motionGenerator.bakeToKeyframes')}
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t('editor.motionGenerator.bakeToKeyframesHint')}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                ) : null}
                {selectedTextItems.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {t('editor.animateStages.scopeText')}
                    </span>
                    <TextMotionSlotRows
                      items={selectedTextItems}
                      query={deferredSearchQuery}
                      slots={['loop']}
                      showSlotHeading={false}
                      showEmptyState={false}
                    />
                  </div>
                ) : null}
              </StageSection>
            ) : null}

            {!hasVisiblePresetResults && filtersActive ? (
              <div
                className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground"
                role="status"
              >
                {t('editor.animatePresets.noMatches')}
              </div>
            ) : null}

            {!filtersActive || filteredSavedPresets.length > 0 ? <Separator /> : null}

            {/* ── Saved animations — user-captured presets, also declarative ── */}
            {!filtersActive || filteredSavedPresets.length > 0 ? (
              <section className="flex flex-col gap-1">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {t('editor.animatePresets.animationsHeading')}
                </h3>
                {presets.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t('editor.animatePresets.empty')}
                  </p>
                ) : (
                  filteredSavedPresets.map((preset) => {
                    const reason = incompatibilityReason(preset)
                    const disabled = reason !== null
                    const row = (
                      <div
                        key={preset.id}
                        className="group flex items-center gap-1 rounded-md border border-border/60"
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-disabled={disabled}
                              onClick={() => {
                                if (!disabled) handleApply(preset)
                              }}
                              className={cn(
                                'min-w-0 flex-1 truncate px-2 py-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
                                disabled
                                  ? 'cursor-not-allowed text-muted-foreground/60'
                                  : 'hover:bg-secondary/40',
                              )}
                            >
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="min-w-0 flex-1 truncate">{preset.name}</span>
                                {preset.motionModifiers?.length || preset.textMotion ? (
                                  <span
                                    className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[9px] font-medium text-primary"
                                    title={t('editor.animateStages.liveBadge')}
                                  >
                                    ƒx
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          </TooltipTrigger>
                          {reason ? <TooltipContent>{reason}</TooltipContent> : null}
                        </Tooltip>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                          aria-label={t('editor.animatePresets.deleteLabel')}
                          onClick={() => void handleDelete(preset)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )

                    return row
                  })
                )}
              </section>
            ) : null}
          </div>
        </ScrollArea>

        <SaveAnimationPresetDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          existingNames={presets.map((preset) => preset.name)}
          onSave={handleSave}
        />
        <MotionBakeConfirmationDialog
          open={bakeDialogOpen}
          onOpenChange={setBakeDialogOpen}
          onConfirm={handleBakeMotion}
        />
      </div>
    </TooltipProvider>
  )
})
