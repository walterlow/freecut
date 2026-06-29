import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, WandSparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import type { CanvasSettings } from '@/types/transform'
import type { AnimatableProperty } from '@/types/keyframe'
import type { AudioItem, TimelineItem } from '@/types/timeline'
import { cn } from '@/shared/ui/cn'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Slider } from '@/components/ui/slider'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ColorPicker } from '@/shared/ui/property-controls'
import { useSelectionStore } from '@/shared/state/selection'
import { useProjectStore } from '@/features/editor/deps/projects'
import {
  applyAnimationPreset,
  applyMotionModifierToItems,
  removeMotionModifierFromItems,
  setEffectAudioPulse,
  bakeMotionToKeyframes,
  captureAnimationFromItem,
  getPresetCompatibility,
  useItemsStore,
  useKeyframesStore,
  useTimelineStore,
} from '@/features/editor/deps/timeline-store'
import { getSourceDimensions, resolveTransform } from '@/features/editor/deps/composition-runtime'
import {
  getAnimatablePropertiesForItem,
  getMotionPresetAnchorFrame,
  MOTION_MODULATORS,
  MOTION_PRESET_CATEGORIES,
  MOTION_PRESETS,
  motionPresetScalesBox,
  DEFAULT_MOTION_GENERATOR_SETTINGS,
  TRIGGER_WAVE_MOTION_LAYER_LABEL,
  applyMotionGeneratorSettings,
  createMotionModifier,
  createAudioPulseModulation,
  bakeMotionModifiersToKeyframes,
  bakeAudioPulseToKeyframes,
  buildTriggerWaveMotionLayerKeyframes,
  createTriggerWaveMotionLayerEffects,
  detectAudioReactiveBeats,
  resolveAnimatedTransform,
  type MotionPreset,
  type MotionPresetCategory,
  type MotionGeneratorSettings,
  type MotionModulator,
} from '@/features/editor/deps/keyframes'
import { addAdjustmentLayer } from '@/features/editor/utils/add-adjustment-layer'
import {
  readAnimationPresets,
  saveAnimationPresets,
  type AnimationPreset,
} from '@/infrastructure/storage'
import { MotionPresetThumbnail } from './motion-preset-thumbnail'
import { SaveAnimationPresetDialog } from './save-animation-preset-dialog'

const presetsByCategory = MOTION_PRESET_CATEGORIES.reduce(
  (map, category) => {
    map[category] = MOTION_PRESETS.filter((preset) => preset.category === category)
    return map
  },
  {} as Record<MotionPresetCategory, MotionPreset[]>,
)

function isTimelineItem(item: TimelineItem | undefined): item is TimelineItem {
  return Boolean(item)
}

function hasWaveformData(item: TimelineItem): item is AudioItem & { waveformData: number[] } {
  return item.type === 'audio' && Array.isArray(item.waveformData) && item.waveformData.length > 0
}

interface GeneratorControlProps {
  label: string
  value: number
  displayValue: string
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

const GeneratorControl = memo(function GeneratorControl({
  label,
  value,
  displayValue,
  min,
  max,
  step,
  onChange,
}: GeneratorControlProps) {
  return (
    <label className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{displayValue}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(next) => onChange(next[0] ?? value)}
        className="h-4"
      />
    </label>
  )
})

interface MotionPresetSectionProps {
  category: MotionPresetCategory
  presets: MotionPreset[]
  reasonFor: (preset: MotionPreset) => string | null
  onApply: (preset: MotionPreset) => void
  t: (key: string, options?: Record<string, unknown>) => string
}

/** One category of built-in motion presets, rendered as an animated icon grid. */
const MotionPresetSection = memo(function MotionPresetSection({
  category,
  presets,
  reasonFor,
  onApply,
  t,
}: MotionPresetSectionProps) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {t(`editor.motionPresets.categories.${category}`)}
      </h3>
      <div className="grid grid-cols-3 gap-1.5">
        {presets.map((preset) => {
          const reason = reasonFor(preset)
          const disabled = reason !== null
          const label = t(`editor.motionPresets.items.${preset.labelKey}`)

          const tile = (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onApply(preset)}
              className={cn(
                'group flex flex-col items-center gap-1 rounded-md border border-border/60 p-1.5 text-[10px]',
                disabled
                  ? 'cursor-not-allowed text-muted-foreground/50'
                  : 'text-muted-foreground hover:border-border hover:bg-secondary/40 hover:text-foreground',
              )}
            >
              <MotionPresetThumbnail thumbnail={preset.thumbnail} />
              <span className="w-full truncate text-center leading-tight">{label}</span>
            </button>
          )

          if (!reason) return <div key={preset.id}>{tile}</div>
          return (
            <Tooltip key={preset.id}>
              <TooltipTrigger asChild>
                <div>{tile}</div>
              </TooltipTrigger>
              <TooltipContent>{reason}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </section>
  )
})

/**
 * Animation preset library (U7, R16): browse and save/apply the project's saved
 * animation presets from the Animate workspace. Presentational shell over the
 * storage layer (U5) and apply path (U6); presets incompatible with the current
 * selection render disabled with a reason tooltip. (Per-keyframe easing curves
 * live in the dopesheet's interpolation icon row, not here.)
 */
export const AnimationPresetLibrary = memo(function AnimationPresetLibrary({
  canvas,
}: {
  canvas: CanvasSettings
}) {
  const { t } = useTranslation()
  const projectId = useProjectStore((s) => s.currentProject?.id ?? null)
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const selectedItems = useItemsStore(
    useShallow(
      useCallback(
        (s) => {
          const orderByTrack = new Map(s.tracks.map((track) => [track.id, track.order ?? 0]))
          return selectedItemIds
            .map((id) => s.itemById[id])
            .filter(isTimelineItem)
            .sort((left, right) => {
              const frameDelta = left.from - right.from
              if (frameDelta !== 0) return frameDelta
              return (orderByTrack.get(left.trackId) ?? 0) - (orderByTrack.get(right.trackId) ?? 0)
            })
        },
        [selectedItemIds],
      ),
    ),
  )
  const selectedItem = selectedItems[0] ?? null
  const selectedItemKeyframes = useKeyframesStore(
    useCallback(
      (s) => (selectedItem ? (s.keyframesByItemId[selectedItem.id] ?? null) : null),
      [selectedItem],
    ),
  )
  const keyframesByItemId = useKeyframesStore((s) => s.keyframesByItemId)

  const [presets, setPresets] = useState<AnimationPreset[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [generatorSettings, setGeneratorSettings] = useState<MotionGeneratorSettings>(
    DEFAULT_MOTION_GENERATOR_SETTINGS,
  )

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

  const canCapture =
    !!selectedItem &&
    !!selectedItemKeyframes &&
    selectedItemKeyframes.properties.some((property) => property.keyframes.length > 0)

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
      const result = applyAnimationPreset(selectedItem.id, preset, 0)
      // Report failure only when nothing was committed. An effect can be added
      // even if every keyframe clamped out — that still mutated the clip.
      if (result.incompatible || (result.applied === 0 && result.addedEffects === 0)) {
        toast.warning(t('editor.animatePresets.applyFailed'))
        return
      }
      toast.success(t('editor.animatePresets.appliedToast', { name: preset.name }))
    },
    [selectedItem, t],
  )

  // Built-in motion presets resolve the clip's resting transform, build their
  // keyframes against it, then commit through the same undo-integrated path as
  // the text-animation presets.
  const addKeyframes = useTimelineStore((s) => s.addKeyframes)

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

  const handleApplyMotion = useCallback(
    (preset: MotionPreset) => {
      if (selectedItems.length === 0) {
        toast.warning(t('editor.animatePresets.selectClipFirst'))
        return
      }
      const payloads = selectedItems.flatMap((item, index) => {
        const itemKeyframes = keyframesByItemId[item.id]
        const base = resolveTransform(item, canvas, getSourceDimensions(item))
        const anchorFrame = getMotionPresetAnchorFrame(
          preset.category,
          item.durationInFrames,
          canvas.fps,
        )
        const anchor = resolveAnimatedTransform(base, itemKeyframes, anchorFrame)
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
          generatorSettings,
          index,
        )
        return built.map((keyframe) => ({ itemId: item.id, ...keyframe }))
      })

      if (payloads.length === 0) {
        toast.warning(t('editor.animatePresets.applyFailed'))
        return
      }
      addKeyframes(payloads)
      toast.success(
        t('editor.animatePresets.appliedToast', {
          name: t(`editor.motionPresets.items.${preset.labelKey}`),
        }),
      )
    },
    [addKeyframes, canvas, generatorSettings, keyframesByItemId, selectedItems, t],
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

  const handleApplyModulator = useCallback(
    (modulator: MotionModulator) => {
      const reason = modulatorReason(modulator)
      if (reason) {
        toast.warning(reason)
        return
      }

      // Toggle off when already present on the whole selection.
      if (activeModulatorIds.has(modulator.id)) {
        removeMotionModifierFromItems(
          selectedItems.map((item) => item.id),
          modulator.id,
        )
        toast.success(
          t('editor.motionGenerator.modulatorRemoved', {
            name: t(`editor.motionGenerator.modulators.${modulator.labelKey}`),
          }),
        )
        return
      }

      // Procedural: attach a parametric modifier evaluated at render time rather
      // than baking a wall of keyframes. Per-item index staggers phase/seed.
      const assignments = selectedItems.map((item, index) => ({
        itemId: item.id,
        modifier: createMotionModifier(modulator.id, generatorSettings, index),
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
    [activeModulatorIds, generatorSettings, modulatorReason, selectedItems, t],
  )

  // Bake bridge: any selected clip carrying procedural motion can be flattened
  // to editable keyframes (drift/breath/shake transforms + audio-pulse effects).
  const hasBakeableMotion = useMemo(
    () =>
      selectedItems.some(
        (item) =>
          item.motionModifiers?.some((modifier) => modifier.enabled) ||
          item.effects?.some((effect) => effect.audioPulse?.enabled),
      ),
    [selectedItems],
  )

  const handleBakeMotion = useCallback(() => {
    const plan = selectedItems.flatMap((item) => {
      const enabledModifiers = item.motionModifiers?.filter((modifier) => modifier.enabled) ?? []
      const audioEffects = item.effects?.filter((effect) => effect.audioPulse?.enabled) ?? []
      if (enabledModifiers.length === 0 && audioEffects.length === 0) return []

      const itemKeyframes = keyframesByItemId[item.id]
      const keyframes: Array<{
        itemId: string
        property: AnimatableProperty
        frame: number
        value: number
        easing: 'linear'
      }> = []
      const clearProperties = new Set<AnimatableProperty>()

      if (enabledModifiers.length > 0) {
        const baseTransform = resolveTransform(item, canvas, getSourceDimensions(item))
        const baked = bakeMotionModifiersToKeyframes({
          baseTransform,
          keyframes: itemKeyframes,
          modifiers: enabledModifiers,
          durationInFrames: item.durationInFrames,
          fps: canvas.fps,
          frameWidth: canvas.width,
          frameHeight: canvas.height,
        })
        for (const property of baked.properties) clearProperties.add(property)
        for (const keyframe of baked.keyframes) {
          keyframes.push({ itemId: item.id, ...keyframe, easing: 'linear' })
        }
      }

      for (const effect of audioEffects) {
        const baked = bakeAudioPulseToKeyframes({
          effectId: effect.id,
          modulation: effect.audioPulse!,
          durationInFrames: item.durationInFrames,
        })
        for (const keyframe of baked) {
          clearProperties.add(keyframe.property)
          keyframes.push({ itemId: item.id, ...keyframe, easing: 'linear' })
        }
      }

      return [
        {
          itemId: item.id,
          keyframes,
          clearProperties: [...clearProperties],
          clearMotionModifiers: enabledModifiers.length > 0,
          clearAudioPulseEffectIds: audioEffects.map((effect) => effect.id),
        },
      ]
    })

    if (plan.length === 0) {
      toast.warning(t('editor.motionGenerator.bakeNoMotion'))
      return
    }

    const baked = bakeMotionToKeyframes(plan)
    toast.success(t('editor.motionGenerator.motionBaked', { count: baked }))
  }, [canvas, keyframesByItemId, selectedItems, t])

  const handleCreateTriggerWaveLayer = useCallback(() => {
    const effects = createTriggerWaveMotionLayerEffects(generatorSettings)
    const created = addAdjustmentLayer(effects, TRIGGER_WAVE_MOTION_LAYER_LABEL)
    if (!created) {
      toast.warning(t('editor.motionGenerator.triggerWaveFailed'))
      return
    }

    const createdItemId = useSelectionStore.getState().selectedItemIds[0]
    const createdItem = createdItemId ? useItemsStore.getState().itemById[createdItemId] : null
    if (!createdItem || createdItem.type !== 'adjustment') {
      toast.warning(t('editor.motionGenerator.triggerWaveFailed'))
      return
    }

    const triggerWaveEffect = createdItem.effects?.find(
      (entry) =>
        entry.effect.type === 'gpu-effect' && entry.effect.gpuEffectType === 'gpu-trigger-wave',
    )
    if (!triggerWaveEffect) {
      toast.warning(t('editor.motionGenerator.triggerWaveFailed'))
      return
    }

    const payloads = buildTriggerWaveMotionLayerKeyframes({
      itemId: createdItem.id,
      effectId: triggerWaveEffect.id,
      durationInFrames: createdItem.durationInFrames,
      fps: canvas.fps,
      settings: generatorSettings,
    })
    addKeyframes(payloads)
    toast.success(t('editor.motionGenerator.triggerWaveCreated'))
  }, [addKeyframes, canvas.fps, generatorSettings, t])

  const handleCreateAudioTriggerWaveLayer = useCallback(() => {
    const audioItem = selectedItems.find(hasWaveformData)
    if (!audioItem) {
      toast.warning(t('editor.motionGenerator.audioTriggerWaveNoWaveform'))
      return
    }

    const beats = detectAudioReactiveBeats({
      waveformData: audioItem.waveformData,
      durationInFrames: audioItem.durationInFrames,
      fps: canvas.fps,
      sensitivity: generatorSettings.intensityScale,
    })
    if (beats.length === 0) {
      toast.warning(t('editor.motionGenerator.audioTriggerWaveNoBeats'))
      return
    }

    const effects = createTriggerWaveMotionLayerEffects(generatorSettings)
    const created = addAdjustmentLayer(effects, TRIGGER_WAVE_MOTION_LAYER_LABEL, {
      from: audioItem.from,
      durationInFrames: audioItem.durationInFrames,
    })
    if (!created) {
      toast.warning(t('editor.motionGenerator.triggerWaveFailed'))
      return
    }

    const createdItemId = useSelectionStore.getState().selectedItemIds[0]
    const createdItem = createdItemId ? useItemsStore.getState().itemById[createdItemId] : null
    if (!createdItem || createdItem.type !== 'adjustment') {
      toast.warning(t('editor.motionGenerator.triggerWaveFailed'))
      return
    }

    const triggerWaveEffect = createdItem.effects?.find(
      (entry) =>
        entry.effect.type === 'gpu-effect' && entry.effect.gpuEffectType === 'gpu-trigger-wave',
    )
    if (!triggerWaveEffect) {
      toast.warning(t('editor.motionGenerator.triggerWaveFailed'))
      return
    }

    // Procedural: store the sparse beats + envelope as an audio-pulse modulation
    // on the effect, evaluated at render time — no baked per-beat keyframes.
    const modulation = createAudioPulseModulation({
      beats,
      durationInFrames: createdItem.durationInFrames,
      fps: canvas.fps,
      settings: generatorSettings,
    })
    setEffectAudioPulse(createdItem.id, triggerWaveEffect.id, modulation)
    toast.success(t('editor.motionGenerator.audioTriggerWaveCreated', { count: beats.length }))
  }, [canvas.fps, generatorSettings, selectedItems, t])

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
      const compatibility = compatibilityByPresetId.get(preset.id)
      if (!compatibility || compatibility.compatible) return null
      return compatibility.reason === 'type-mismatch'
        ? t('editor.animatePresets.incompatibleType', { type: preset.sourceItemType })
        : t('editor.animatePresets.incompatibleProperty')
    },
    [compatibilityByPresetId, selectedItem, t],
  )

  const updateGeneratorSetting = useCallback(
    (key: keyof MotionGeneratorSettings, value: number | string) => {
      setGeneratorSettings((current) => ({ ...current, [key]: value }))
    },
    [],
  )

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full w-60 min-w-0 flex-col border-l border-border bg-background">
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
                  {t('editor.animatePresets.saveButton')}
                </Button>
              </span>
            </TooltipTrigger>
            {!canCapture && (
              <TooltipContent>{t('editor.animatePresets.noAnimationToSave')}</TooltipContent>
            )}
          </Tooltip>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-4 p-3">
            <section className="flex flex-col gap-2 rounded-md border border-border/60 p-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {t('editor.motionGenerator.title')}
              </h3>
              <GeneratorControl
                label={t('editor.motionGenerator.intensity')}
                value={generatorSettings.intensityScale}
                displayValue={`${Math.round(generatorSettings.intensityScale * 100)}%`}
                min={0}
                max={2}
                step={0.05}
                onChange={(value) => updateGeneratorSetting('intensityScale', value)}
              />
              <GeneratorControl
                label={t('editor.motionGenerator.duration')}
                value={generatorSettings.durationScale}
                displayValue={`${Math.round(generatorSettings.durationScale * 100)}%`}
                min={0.25}
                max={3}
                step={0.05}
                onChange={(value) => updateGeneratorSetting('durationScale', value)}
              />
              <GeneratorControl
                label={t('editor.motionGenerator.stagger')}
                value={generatorSettings.staggerFrames}
                displayValue={`${Math.round(generatorSettings.staggerFrames)}f`}
                min={0}
                max={30}
                step={1}
                onChange={(value) => updateGeneratorSetting('staggerFrames', value)}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {t('editor.motionGenerator.triggerWaveColor')}
                </span>
                <ColorPicker
                  color={generatorSettings.triggerWaveColor ?? '#2e6b8c'}
                  onChange={(value) => updateGeneratorSetting('triggerWaveColor', value)}
                  onLiveChange={(value) => updateGeneratorSetting('triggerWaveColor', value)}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-1 h-7 justify-start gap-1.5 px-2 text-[11px]"
                onClick={handleCreateTriggerWaveLayer}
              >
                <WandSparkles className="h-3.5 w-3.5" />
                {t('editor.motionGenerator.triggerWaveLayer')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 justify-start gap-1.5 px-2 text-[11px]"
                onClick={handleCreateAudioTriggerWaveLayer}
              >
                <WandSparkles className="h-3.5 w-3.5" />
                {t('editor.motionGenerator.audioTriggerWaveLayer')}
              </Button>
              <div className="flex flex-col gap-1 pt-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {t('editor.motionGenerator.modulatorsTitle')}
                </span>
                <div className="grid grid-cols-1 gap-1">
                  {MOTION_MODULATORS.map((modulator) => {
                    const reason = modulatorReason(modulator)
                    const active = activeModulatorIds.has(modulator.id)
                    const button = (
                      <Button
                        key={modulator.id}
                        type="button"
                        variant={active ? 'secondary' : 'outline'}
                        size="sm"
                        aria-pressed={active}
                        className={cn(
                          'h-7 justify-start gap-1.5 px-2 text-[11px]',
                          active && 'border-primary/60 text-foreground',
                        )}
                        disabled={reason !== null}
                        onClick={() => handleApplyModulator(modulator)}
                      >
                        <WandSparkles className="h-3.5 w-3.5" />
                        {t(`editor.motionGenerator.modulators.${modulator.labelKey}`)}
                      </Button>
                    )
                    if (!reason) return button
                    return (
                      <Tooltip key={modulator.id}>
                        <TooltipTrigger asChild>
                          <span>{button}</span>
                        </TooltipTrigger>
                        <TooltipContent>{reason}</TooltipContent>
                      </Tooltip>
                    )
                  })}
                </div>
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
                      onClick={handleBakeMotion}
                    >
                      <WandSparkles className="h-3.5 w-3.5" />
                      {t('editor.motionGenerator.bakeToKeyframes')}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t('editor.motionGenerator.bakeToKeyframesHint')}</TooltipContent>
              </Tooltip>
            </section>

            {MOTION_PRESET_CATEGORIES.map((category) => (
              <MotionPresetSection
                key={category}
                category={category}
                presets={presetsByCategory[category]}
                reasonFor={motionReason}
                onApply={handleApplyMotion}
                t={t}
              />
            ))}

            <Separator />

            <section className="flex flex-col gap-1">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {t('editor.animatePresets.animationsHeading')}
              </h3>
              {presets.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('editor.animatePresets.empty')}</p>
              ) : (
                presets.map((preset) => {
                  const reason = incompatibilityReason(preset)
                  const disabled = reason !== null
                  const row = (
                    <div
                      key={preset.id}
                      className="group flex items-center gap-1 rounded-md border border-border/60"
                    >
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => handleApply(preset)}
                        className={cn(
                          'min-w-0 flex-1 truncate px-2 py-1.5 text-left text-xs',
                          disabled
                            ? 'cursor-not-allowed text-muted-foreground/60'
                            : 'hover:bg-secondary/40',
                        )}
                      >
                        {preset.name}
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                        aria-label={t('editor.animatePresets.deleteLabel')}
                        onClick={() => void handleDelete(preset)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )

                  if (!disabled) return row
                  return (
                    <Tooltip key={preset.id}>
                      <TooltipTrigger asChild>{row}</TooltipTrigger>
                      <TooltipContent>{reason}</TooltipContent>
                    </Tooltip>
                  )
                })
              )}
            </section>
          </div>
        </ScrollArea>

        <SaveAnimationPresetDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          existingNames={presets.map((preset) => preset.name)}
          onSave={handleSave}
        />
      </div>
    </TooltipProvider>
  )
})
