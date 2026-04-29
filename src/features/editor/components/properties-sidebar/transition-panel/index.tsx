import { useMemo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  Trash2,
  Zap,
  RotateCcw,
  ChevronDown,
} from 'lucide-react'
import { HexColorPicker } from 'react-colorful'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { useSelectionStore } from '@/shared/state/selection'
import { PropertySection, PropertyRow, SliderInput } from '../components'
import type { TimelineState, TimelineActions } from '@/features/editor/deps/timeline-store'
import type { SelectionState, SelectionActions } from '@/shared/state/selection'
import {
  TRANSITION_CONFIGS,
  type Transition,
  type TransitionPresentation,
  type TransitionTiming,
  type WipeDirection,
  type SlideDirection,
  type FlipDirection,
  type PresentationConfig,
  type TransitionDefinition,
  type TransitionParameterDefinition,
} from '@/types/transition'
import { cn } from '@/shared/ui/cn'
import { transitionRegistry } from '@/core/timeline/transitions'
import {
  TRANSITION_CATEGORY_INFO,
  getTransitionConfigsByCategory,
} from '@/features/editor/utils/transition-ui-config'
import { getMaxTransitionDurationForHandles } from '@/features/editor/deps/timeline-utils'

function rgbArrayToHex(value: unknown): string {
  if (!Array.isArray(value)) return '#000000'
  const [r = 0, g = 0, b = 0] = value
  const toHex = (channel: unknown) => {
    const numeric = typeof channel === 'number' && Number.isFinite(channel) ? channel : 0
    return Math.round(Math.max(0, Math.min(1, numeric)) * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function hexToRgbArray(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.slice(1) : '000000'
  return [
    parseInt(normalized.slice(0, 2), 16) / 255,
    parseInt(normalized.slice(2, 4), 16) / 255,
    parseInt(normalized.slice(4, 6), 16) / 255,
  ]
}

function TransitionColorPicker({
  label,
  initialColor,
  onColorChange,
}: {
  label: string
  initialColor: string
  onColorChange: (color: string) => void
}) {
  const [color, setColor] = useState(initialColor)
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setColor(initialColor)
  }, [initialColor])

  const handleColorChange = useCallback(
    (newColor: string) => {
      setColor(newColor)
      onColorChange(newColor)
    },
    [onColorChange],
  )

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div ref={containerRef} className="relative flex-1">
      <button
        type="button"
        aria-label={`${label} color`}
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-center gap-2"
      >
        <div
          className="h-6 w-6 flex-shrink-0 rounded border border-border"
          style={{ backgroundColor: color }}
        />
        <span className="text-xs font-mono uppercase text-muted-foreground">{color}</span>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-8 z-50 rounded-lg border border-border bg-popover p-2 shadow-lg">
          <HexColorPicker color={color} onChange={handleColorChange} />
        </div>
      )}
    </div>
  )
}

function getDefaultTransitionProperties(
  definition: TransitionDefinition | undefined,
): Record<string, unknown> | undefined {
  if (!definition?.parameters?.length) return undefined
  return Object.fromEntries(
    definition.parameters.map((parameter) => [parameter.key, parameter.defaultValue]),
  )
}

function getNumberParameterValue(
  properties: Record<string, unknown> | undefined,
  parameter: TransitionParameterDefinition,
): number {
  const value = properties?.[parameter.key]
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : Number(parameter.defaultValue)
}

function getColorParameterValue(
  properties: Record<string, unknown> | undefined,
  parameter: TransitionParameterDefinition,
): string {
  return rgbArrayToHex(properties?.[parameter.key] ?? parameter.defaultValue)
}

function formatParameterValue(parameter: TransitionParameterDefinition, value: number): string {
  const step = parameter.step ?? 1
  const [, decimalPart = ''] = step.toString().split('.')
  const decimals = decimalPart.length
  const fixed = value.toFixed(Math.min(3, decimals))
  return parameter.unit ? `${fixed}${parameter.unit}` : fixed
}

function getPresentationOptionValue(config: Pick<PresentationConfig, 'id' | 'direction'>): string {
  return config.direction ? `${config.id}:${config.direction}` : config.id
}

function getPresentationOptionLabel(
  config: Pick<PresentationConfig, 'label' | 'description' | 'direction'>,
): string {
  return config.direction ? config.description : config.label
}

const DIRECTION_OPTIONS = [
  { value: 'from-left', label: 'Left' },
  { value: 'from-right', label: 'Right' },
  { value: 'from-top', label: 'Top' },
  { value: 'from-bottom', label: 'Bottom' },
] as const satisfies ReadonlyArray<{
  value: WipeDirection | SlideDirection | FlipDirection
  label: string
}>

const EASE_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'In' },
  { value: 'ease-out', label: 'Out' },
  { value: 'ease-in-out', label: 'In & Out' },
] as const satisfies ReadonlyArray<{ value: TransitionTiming; label: string }>

const PLACEMENT_OPTIONS = [
  {
    value: 1,
    label: 'Left',
    title: 'Place transition before the cut',
    Icon: AlignHorizontalJustifyStart,
  },
  {
    value: 0.5,
    label: 'Center',
    title: 'Center transition on the cut',
    Icon: AlignHorizontalJustifyCenter,
  },
  {
    value: 0,
    label: 'Right',
    title: 'Place transition after the cut',
    Icon: AlignHorizontalJustifyEnd,
  },
] as const

function getSupportedEaseOptions(
  supportedTimings: readonly TransitionTiming[],
): ReadonlyArray<(typeof EASE_OPTIONS)[number]> {
  return EASE_OPTIONS.filter((option) => supportedTimings.includes(option.value))
}

/**
 * Transition properties panel - shown when a transition is selected.
 * Allows editing presentation style, duration, timing, and direction.
 */
export function TransitionPanel() {
  // Granular selectors (Zustand v5 best practice)
  const selectedTransitionId = useSelectionStore((s: SelectionState) => s.selectedTransitionId)
  const clearSelection = useSelectionStore((s: SelectionActions) => s.clearSelection)
  const transitions = useTimelineStore((s: TimelineState) => s.transitions)
  const updateTransition = useTimelineStore((s: TimelineActions) => s.updateTransition)
  const removeTransition = useTimelineStore((s: TimelineActions) => s.removeTransition)
  const fps = useTimelineStore((s: TimelineState) => s.fps)
  const items = useTimelineStore((s: TimelineState) => s.items)

  // Derive selected transition
  const selectedTransition = useMemo<Transition | undefined>(
    () => transitions.find((t: Transition) => t.id === selectedTransitionId),
    [transitions, selectedTransitionId],
  )

  // Get config for current transition type
  const transitionConfig =
    selectedTransition && selectedTransition.type in TRANSITION_CONFIGS
      ? TRANSITION_CONFIGS[selectedTransition.type]
      : null
  const leftClip = useMemo(
    () =>
      selectedTransition ? items.find((item) => item.id === selectedTransition.leftClipId) : null,
    [items, selectedTransition],
  )
  const rightClip = useMemo(
    () =>
      selectedTransition ? items.find((item) => item.id === selectedTransition.rightClipId) : null,
    [items, selectedTransition],
  )
  const presentationConfigGroups = useMemo(
    () =>
      Object.entries(getTransitionConfigsByCategory()).filter(([, configs]) => configs.length > 0),
    [],
  )
  const presentationConfigs = useMemo(
    () => presentationConfigGroups.flatMap(([, configs]) => configs),
    [presentationConfigGroups],
  )
  const currentPresentationConfig = useMemo(
    () => presentationConfigs.find((config) => config.id === selectedTransition?.presentation),
    [presentationConfigs, selectedTransition?.presentation],
  )
  const currentPresentationLabel = currentPresentationConfig
    ? getPresentationOptionLabel(currentPresentationConfig)
    : 'Select preset'
  const transitionDefinition = useMemo(
    () =>
      selectedTransition
        ? transitionRegistry.getDefinition(selectedTransition.presentation)
        : undefined,
    [selectedTransition],
  )
  const easeOptions = useMemo(
    () => getSupportedEaseOptions(transitionDefinition?.supportedTimings ?? []),
    [transitionDefinition],
  )

  const minDuration = 1
  const maxDuration = useMemo(() => {
    if (!transitionConfig || !selectedTransition || !leftClip || !rightClip) {
      return fps * 3
    }

    const leftEnd = leftClip.from + leftClip.durationInFrames
    const isAdjacent = Math.abs(leftEnd - rightClip.from) <= 1
    if (!isAdjacent) {
      const legacyMax = Math.floor(
        Math.min(leftClip.durationInFrames, rightClip.durationInFrames) - 1,
      )
      return Math.max(
        minDuration,
        Math.max(selectedTransition.durationInFrames, Math.min(fps * 3, legacyMax)),
      )
    }

    const handleMax = getMaxTransitionDurationForHandles(
      leftClip,
      rightClip,
      selectedTransition.alignment,
    )
    return Math.max(
      minDuration,
      Math.max(selectedTransition.durationInFrames, Math.min(fps * 3, handleMax)),
    )
  }, [transitionConfig, selectedTransition, leftClip, rightClip, fps])

  // Handle presentation change
  const handlePresentationChange = useCallback(
    (
      presentation: TransitionPresentation,
      direction?: WipeDirection | SlideDirection | FlipDirection,
    ) => {
      if (selectedTransitionId) {
        const nextDefinition = transitionRegistry.getDefinition(presentation)
        const currentDirection = selectedTransition?.direction
        const nextDirections = nextDefinition?.directions ?? []
        const nextDirection =
          direction ??
          (currentDirection && nextDirections.includes(currentDirection)
            ? currentDirection
            : undefined) ??
          nextDirections[0]
        const updates: Partial<Transition> = {
          presentation,
          direction: nextDefinition?.hasDirection ? nextDirection : undefined,
        }
        if (selectedTransition?.presentation !== presentation) {
          updates.properties = getDefaultTransitionProperties(nextDefinition)
        }
        const nextEaseOptions = getSupportedEaseOptions(nextDefinition?.supportedTimings ?? [])
        const fallbackEase = nextEaseOptions[0]
        const currentTiming = selectedTransition?.timing
        if (
          fallbackEase &&
          nextDefinition &&
          currentTiming &&
          !nextDefinition.supportedTimings.includes(currentTiming)
        ) {
          updates.timing = fallbackEase.value
        }
        updateTransition(selectedTransitionId, updates)
      }
    },
    [
      selectedTransitionId,
      selectedTransition?.direction,
      selectedTransition?.presentation,
      selectedTransition?.timing,
      updateTransition,
    ],
  )

  const handlePresentationPresetChange = useCallback(
    (value: string) => {
      const config = presentationConfigs.find(
        (entry) => getPresentationOptionValue(entry) === value,
      )
      if (!config) return
      handlePresentationChange(config.id, config.direction)
    },
    [handlePresentationChange, presentationConfigs],
  )

  const [presetPickerOpen, setPresetPickerOpen] = useState(false)
  const [presetSearchQuery, setPresetSearchQuery] = useState('')
  const presetTriggerRef = useRef<HTMLButtonElement>(null)
  const presetPanelRef = useRef<HTMLDivElement>(null)
  const [presetPanelStyle, setPresetPanelStyle] = useState<CSSProperties>({})
  const filteredPresentationConfigGroups = useMemo(() => {
    const query = presetSearchQuery.trim().toLowerCase()
    if (!query) return presentationConfigGroups

    return presentationConfigGroups
      .map(([category, configs]) => {
        const categoryTitle = TRANSITION_CATEGORY_INFO[category]?.title ?? category
        const filtered = configs.filter((config) =>
          [config.id, config.label, config.description, config.direction, category, categoryTitle]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query)),
        )
        return [category, filtered] as const
      })
      .filter(([, configs]) => configs.length > 0)
  }, [presentationConfigGroups, presetSearchQuery])

  const openPresetPicker = useCallback(() => {
    if (presetTriggerRef.current) {
      const rect = presetTriggerRef.current.getBoundingClientRect()
      setPresetPanelStyle({
        position: 'fixed',
        top: `${rect.bottom + 4}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
      })
    }
    setPresetPickerOpen(true)
  }, [])

  const closePresetPicker = useCallback(() => {
    setPresetPickerOpen(false)
    setPresetSearchQuery('')
    presetTriggerRef.current?.blur()
  }, [])

  const selectPresentationPreset = useCallback(
    (value: string) => {
      handlePresentationPresetChange(value)
      closePresetPicker()
    },
    [closePresetPicker, handlePresentationPresetChange],
  )

  useEffect(() => {
    if (!presetPickerOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (
        presetPanelRef.current?.contains(event.target as Node) ||
        presetTriggerRef.current?.contains(event.target as Node)
      ) {
        return
      }
      closePresetPicker()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePresetPicker()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closePresetPicker, presetPickerOpen])

  // Handle duration change (in frames)
  const handleDurationChange = useCallback(
    (durationInFrames: number) => {
      if (selectedTransitionId && transitionConfig) {
        const clamped = Math.max(minDuration, Math.min(maxDuration, Math.round(durationInFrames)))
        updateTransition(selectedTransitionId, { durationInFrames: clamped })
      }
    },
    [selectedTransitionId, transitionConfig, updateTransition, minDuration, maxDuration],
  )

  // Default duration is 1 second (fps frames)
  const defaultDuration = Math.min(fps, maxDuration)

  // Handle reset duration to default (1 second)
  const handleResetDuration = useCallback(() => {
    if (selectedTransitionId && transitionConfig) {
      const clamped = Math.max(minDuration, Math.min(maxDuration, defaultDuration))
      updateTransition(selectedTransitionId, { durationInFrames: clamped })
    }
  }, [
    selectedTransitionId,
    transitionConfig,
    updateTransition,
    defaultDuration,
    minDuration,
    maxDuration,
  ])

  const selectedAlignment = selectedTransition?.alignment ?? 0.5
  const handlePlacementChange = useCallback(
    (alignment: number) => {
      if (!selectedTransitionId || !selectedTransition || !leftClip || !rightClip) return

      const maxForPlacement = getMaxTransitionDurationForHandles(leftClip, rightClip, alignment)
      if (maxForPlacement < minDuration) return

      updateTransition(selectedTransitionId, {
        alignment,
        durationInFrames: Math.min(selectedTransition.durationInFrames, maxForPlacement),
      })
    },
    [leftClip, rightClip, selectedTransition, selectedTransitionId, updateTransition],
  )

  // Handle timing change
  const handleTimingChange = useCallback(
    (timing: TransitionTiming) => {
      if (selectedTransitionId) {
        updateTransition(selectedTransitionId, { timing })
      }
    },
    [selectedTransitionId, updateTransition],
  )

  const directionOptions = useMemo(() => {
    const directions = transitionDefinition?.directions ?? []
    return DIRECTION_OPTIONS.filter((option) => directions.includes(option.value))
  }, [transitionDefinition])

  const selectedDirection = selectedTransition?.direction ?? transitionDefinition?.directions?.[0]

  const handleDirectionChange = useCallback(
    (direction: WipeDirection | SlideDirection | FlipDirection) => {
      if (selectedTransitionId) {
        updateTransition(selectedTransitionId, { direction })
      }
    },
    [selectedTransitionId, updateTransition],
  )

  const handleParameterChange = useCallback(
    (parameter: TransitionParameterDefinition, value: unknown) => {
      if (!selectedTransitionId || !selectedTransition) return
      updateTransition(selectedTransitionId, {
        properties: {
          ...(selectedTransition.properties ?? {}),
          [parameter.key]:
            parameter.type === 'color' && parameter.valueFormat === 'rgb-array'
              ? hexToRgbArray(String(value))
              : value,
        },
      })
    },
    [selectedTransition, selectedTransitionId, updateTransition],
  )

  // Handle delete
  const handleDelete = useCallback(() => {
    if (selectedTransitionId) {
      removeTransition(selectedTransitionId)
      clearSelection()
    }
  }, [selectedTransitionId, removeTransition, clearSelection])

  // Format duration for display
  const formatDuration = useCallback(
    (frames: number): string => {
      const seconds = frames / fps
      return `${seconds.toFixed(2)}s`
    },
    [fps],
  )

  const formatDurationInput = useCallback(
    (frames: number): string => (frames / fps).toFixed(2),
    [fps],
  )

  const parseDurationInput = useCallback(
    (rawValue: string): number => {
      const normalized = rawValue.trim().replace(/s$/i, '')
      const seconds = parseFloat(normalized)
      return Number.isFinite(seconds) ? seconds * fps : Number.NaN
    },
    [fps],
  )

  if (!selectedTransition || !transitionConfig) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Zap className="w-8 h-8 text-muted-foreground/50 mb-2" />
        <p className="text-xs text-muted-foreground">Transition not found</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PropertySection title="Transition" icon={Zap} defaultOpen={true}>
        <PropertyRow label="Preset" tooltip="Transition style preset">
          <div className="w-full">
            <Button
              ref={presetTriggerRef}
              variant="outline"
              size="sm"
              role="combobox"
              aria-expanded={presetPickerOpen}
              className="h-7 w-full justify-between px-2 text-xs font-normal"
              onClick={() => (presetPickerOpen ? closePresetPicker() : openPresetPicker())}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  openPresetPicker()
                }
              }}
            >
              <span className="truncate">{currentPresentationLabel}</span>
              <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
            </Button>
            {presetPickerOpen &&
              createPortal(
                <div
                  ref={presetPanelRef}
                  style={presetPanelStyle}
                  className="z-50 rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 slide-in-from-top-2"
                >
                  <div className="border-b border-border p-1.5">
                    <input
                      type="search"
                      aria-label="Search transitions"
                      value={presetSearchQuery}
                      onChange={(event) => setPresetSearchQuery(event.currentTarget.value)}
                      placeholder="Search transitions"
                      className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-[460px] overflow-y-auto overflow-x-hidden p-1">
                    {filteredPresentationConfigGroups.map(([category, configs], index) => (
                      <div key={category}>
                        {index > 0 && <div className="-mx-1 my-1 h-px bg-muted" />}
                        <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                          {TRANSITION_CATEGORY_INFO[category]?.title ?? category}
                        </div>
                        {configs.map((config) => {
                          const value = getPresentationOptionValue(config)
                          const selected =
                            currentPresentationConfig &&
                            getPresentationOptionValue(currentPresentationConfig) === value

                          return (
                            <button
                              key={value}
                              type="button"
                              aria-selected={selected}
                              className={cn(
                                'relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none hover:bg-accent hover:text-accent-foreground',
                                selected && 'bg-accent text-accent-foreground',
                              )}
                              onClick={() => selectPresentationPreset(value)}
                            >
                              <span className="truncate">{getPresentationOptionLabel(config)}</span>
                            </button>
                          )
                        })}
                      </div>
                    ))}
                    {filteredPresentationConfigGroups.length === 0 && (
                      <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                        No transitions found
                      </div>
                    )}
                  </div>
                </div>,
                document.body,
              )}
          </div>
        </PropertyRow>

        {/* Duration slider */}
        <PropertyRow label="Duration" tooltip="Transition duration">
          <div className="flex items-center gap-1 w-full">
            <SliderInput
              value={selectedTransition.durationInFrames}
              onChange={handleDurationChange}
              min={minDuration}
              max={maxDuration}
              step={1}
              formatValue={formatDuration}
              formatInputValue={formatDurationInput}
              parseInputValue={parseDurationInput}
              className="flex-1 min-w-0"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={handleResetDuration}
              title="Reset to 1s"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>

        <PropertyRow
          label="Placement"
          tooltip="Position the transition before, across, or after the cut"
        >
          <div className="flex items-center gap-0.5 p-0.5 bg-secondary rounded-md">
            {PLACEMENT_OPTIONS.map(({ value, label, title, Icon }) => {
              const maxForPlacement =
                leftClip && rightClip
                  ? getMaxTransitionDurationForHandles(leftClip, rightClip, value)
                  : 0
              const disabled = maxForPlacement < minDuration
              const selected = selectedAlignment === value

              return (
                <button
                  key={label}
                  type="button"
                  aria-label={`${label} placement`}
                  title={disabled ? `${title} (not enough source handle)` : title}
                  disabled={disabled}
                  onClick={() => handlePlacementChange(value)}
                  className={cn(
                    'inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded px-2 text-xs transition-colors',
                    selected
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                    disabled && 'cursor-not-allowed opacity-40 hover:text-muted-foreground',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              )
            })}
          </div>
        </PropertyRow>

        {easeOptions.length > 0 && (
          <PropertyRow label="Ease" tooltip="Easing curve for the transition">
            <div className="flex items-center gap-0.5 p-0.5 bg-secondary rounded-md">
              {easeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleTimingChange(option.value)}
                  className={cn(
                    'px-3 py-1 text-xs rounded transition-colors',
                    selectedTransition.timing === option.value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </PropertyRow>
        )}

        {transitionDefinition?.hasDirection && directionOptions.length > 0 && (
          <PropertyRow label="Direction" tooltip="Direction for the transition motion">
            <div className="flex items-center gap-0.5 p-0.5 bg-secondary rounded-md">
              {directionOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-label={option.label}
                  onClick={() => handleDirectionChange(option.value)}
                  className={cn(
                    'px-3 py-1 text-xs rounded transition-colors',
                    selectedDirection === option.value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </PropertyRow>
        )}

        {transitionDefinition?.parameters?.map((parameter) => (
          <PropertyRow key={parameter.key} label={parameter.label} tooltip={parameter.description}>
            {parameter.type === 'number' ? (
              <SliderInput
                value={getNumberParameterValue(selectedTransition.properties, parameter)}
                onChange={(value) => handleParameterChange(parameter, value)}
                onLiveChange={(value) => handleParameterChange(parameter, value)}
                min={parameter.min ?? 0}
                max={parameter.max ?? 1}
                step={parameter.step ?? 1}
                unit={parameter.unit}
                formatValue={(value) => formatParameterValue(parameter, value)}
                className="flex-1 min-w-0"
              />
            ) : (
              <TransitionColorPicker
                label={parameter.label}
                initialColor={getColorParameterValue(selectedTransition.properties, parameter)}
                onColorChange={(color) => handleParameterChange(parameter, color)}
              />
            )}
          </PropertyRow>
        ))}

        {/* Action buttons */}
        <div className="pt-2">
          {/* Delete button */}
          <Button
            variant="destructive"
            size="sm"
            className="w-full h-7 text-xs"
            onClick={handleDelete}
          >
            <Trash2 className="w-3 h-3 mr-1.5" />
            Delete
          </Button>
        </div>
      </PropertySection>
    </div>
  )
}
