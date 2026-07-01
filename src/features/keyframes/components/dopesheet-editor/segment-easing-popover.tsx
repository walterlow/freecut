import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, SlidersHorizontal } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/shared/ui/cn'
import { applyEasingConfig } from '@/shared/utils/easing'
import type { BezierControlPoints, EasingConfig, EasingType, KeyframeRef } from '@/types/keyframe'

import {
  EASING_PRESETS,
  SPRING_PRESETS,
  type EasingDirection,
  type EasingPreset,
  effectiveBezier,
  findMatchingPreset,
  presetDirection,
  presetToEasing,
} from './easings-dev-presets'
import { EasingCurveEditor } from './easing-curve-editor'

type PresetType = 'Easing' | 'Spring'
type DirectionFilter = 'all' | EasingDirection

const DIRECTION_FILTERS: Array<{ value: DirectionFilter; labelKey: string; defaultValue: string }> = [
  { value: 'all', labelKey: 'timeline.keyframeEditor.filterAll', defaultValue: 'All' },
  { value: 'in', labelKey: 'timeline.keyframeEditor.filterIn', defaultValue: 'In' },
  { value: 'out', labelKey: 'timeline.keyframeEditor.filterOut', defaultValue: 'Out' },
  { value: 'inout', labelKey: 'timeline.keyframeEditor.filterInOut', defaultValue: 'In-Out' },
]

/** Easing updates applied to a segment's originating keyframe(s). */
export interface SegmentEasingUpdate {
  easing: EasingType
  easingConfig?: EasingConfig
}

export type SegmentEasingChange = (
  refs: KeyframeRef[],
  updates: SegmentEasingUpdate,
  options?: { commit?: boolean },
) => void

interface SegmentEasingPopoverProps {
  /** Left offset of the connector band, in px within the timeline cell. */
  left: number
  /** Width of the connector band, in px. */
  width: number
  /** Keyframe(s) that begin this segment (one per property for group rows). */
  refs: KeyframeRef[]
  /** Representative easing (first ref). */
  easing: EasingType
  /** Representative easing config (first ref). */
  easingConfig?: EasingConfig
  /** True when a group segment's properties don't all share the same easing. */
  mixed?: boolean
  /** Held segments render dashed; used only for the band's resting style. */
  held?: boolean
  onChange: SegmentEasingChange
  onDragStart?: () => void
  onDragEnd?: () => void
}

export function SegmentEasingPopover({
  left,
  width,
  refs,
  easing,
  easingConfig,
  mixed = false,
  held = false,
  onChange,
  onDragStart,
  onDragEnd,
}: SegmentEasingPopoverProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(false)
  const [presetType, setPresetType] = useState<PresetType>('Easing')
  const [direction, setDirection] = useState<DirectionFilter>('all')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // The timeline stops `pointerdown` propagation, which swallows Radix's own
  // outside-click dismissal. Listen in the capture phase (runs top-down, before
  // the timeline handlers) so an outside click reliably closes the popover.
  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (contentRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [open])

  // Center a padded band on the connector so it never covers the diamond hit
  // targets at either end; fall back to the full span for very short segments.
  const inset = width > 22 ? 8 : 0
  const bandLeft = left + inset
  const bandWidth = Math.max(2, width - inset * 2)

  const activePreset = mixed ? null : findMatchingPreset(easing, easingConfig)
  const isHold = easing === 'hold'

  const filteredPresets =
    presetType === 'Spring'
      ? SPRING_PRESETS
      : EASING_PRESETS.filter(
          (preset) => direction === 'all' || presetDirection(preset.name) === direction,
        )

  const applyPreset = (preset: EasingPreset) => {
    onChange(refs, presetToEasing(preset))
  }

  const applyBezier = (bezier: BezierControlPoints, commit: boolean) => {
    onChange(
      refs,
      { easing: 'cubic-bezier', easingConfig: { type: 'cubic-bezier', bezier } },
      { commit },
    )
  }

  const setHold = () => {
    onChange(refs, { easing: 'hold', easingConfig: undefined })
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setEditing(false)
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          data-testid={`segment-easing-${refs[0]?.property}-${refs[0]?.keyframeId}`}
          className={cn(
            'absolute z-[6] h-2 -translate-y-1/2 rounded-full',
            'bg-transparent hover:bg-blue-400/25 focus-visible:bg-blue-400/30',
            'cursor-pointer outline-none transition-colors',
          )}
          style={{ left: bandLeft, width: bandWidth, top: '50%' }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          title={t('timeline.keyframeEditor.editCurve', { defaultValue: 'Easing' })}
          aria-label={t('timeline.keyframeEditor.editCurve', { defaultValue: 'Easing' })}
        >
          <span className="sr-only">{held ? 'hold' : easing}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="center"
        side="top"
        className="w-[480px] max-w-[calc(100vw-24px)] p-0"
        onPointerDown={(event) => event.stopPropagation()}
        // Disable Radix's automatic dismissal (focus-out, internal focus shifts,
        // its own outside detection). The popover closes ONLY via our explicit
        // capture-phase outside-click listener above, so interacting with the
        // sliders / inputs / preset grid never auto-closes it.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        {/* Header: current selection + Edit / back toggle. */}
        <div className="flex h-9 items-center justify-between border-b border-border/60 px-3">
          {editing ? (
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setEditing(false)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              {t('timeline.keyframeEditor.presets', { defaultValue: 'Presets' })}
            </button>
          ) : (
            <span className="truncate text-xs font-medium text-foreground">
              {mixed
                ? t('timeline.keyframeEditor.mixedCurves')
                : (activePreset?.name ??
                  (isHold
                    ? t('timeline.keyframeEditor.easing.hold')
                    : t('timeline.keyframeEditor.custom')))}
            </span>
          )}
          {!editing && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px]"
              onClick={() => setEditing(true)}
            >
              <SlidersHorizontal className="h-3 w-3" />
              {t('timeline.keyframeEditor.edit', { defaultValue: 'Edit' })}
            </Button>
          )}
        </div>

        {editing ? (
          <div className="p-3">
            <EasingCurveEditor
              value={effectiveBezier(easing, easingConfig)}
              onChange={applyBezier}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          </div>
        ) : (
          <>
            {/* Filter bar: type (Cubic Easing / Spring) + direction. */}
            <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5">
              <div className="flex items-center gap-3 text-xs">
                {(['Easing', 'Spring'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setPresetType(type)}
                    className={cn(
                      'transition-colors',
                      presetType === type
                        ? 'font-medium text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {type === 'Easing'
                      ? t('timeline.keyframeEditor.cubicEasing', { defaultValue: 'Cubic Easing' })
                      : t('timeline.keyframeEditor.spring')}
                  </button>
                ))}
              </div>
              {presetType === 'Easing' && (
                <div className="flex items-center gap-2 text-[11px]">
                  {DIRECTION_FILTERS.map((filter) => (
                    <button
                      key={filter.value}
                      type="button"
                      onClick={() => setDirection(filter.value)}
                      className={cn(
                        'transition-colors',
                        direction === filter.value
                          ? 'text-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {t(filter.labelKey, { defaultValue: filter.defaultValue })}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="max-h-[300px] overflow-y-auto p-2">
              {presetType === 'Easing' && (
                <PresetChip
                  label={t('timeline.keyframeEditor.easing.hold')}
                  active={isHold}
                  onClick={setHold}
                  thumb={<HoldThumb />}
                  wide
                />
              )}
              <div className="mt-1 grid grid-cols-4 gap-1">
                {filteredPresets.map((preset) => (
                  <PresetChip
                    key={preset.name}
                    label={preset.name}
                    active={preset.name === activePreset?.name}
                    onClick={() => applyPreset(preset)}
                    thumb={<PresetThumb preset={preset} />}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

function PresetChip({
  label,
  active,
  onClick,
  thumb,
  wide = false,
}: {
  label: string
  active: boolean
  onClick: () => void
  thumb: ReactNode
  wide?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        'flex flex-col items-center gap-1 rounded-md border p-1.5 transition-colors',
        wide && 'w-full flex-row justify-start gap-2',
        active
          ? 'border-blue-500/70 bg-blue-500/10'
          : 'border-transparent hover:border-border hover:bg-muted/50',
      )}
    >
      {thumb}
      <span className="w-full truncate text-center text-[10px] leading-tight text-foreground">
        {label}
      </span>
    </button>
  )
}

// Thumbnail geometry. Y range shows anticipation (<0) and overshoot (>1).
const T_W = 44
const T_H = 30
const T_PAD = 4
const T_YMIN = -0.3
const T_YMAX = 1.3

function PresetThumb({ preset }: { preset: EasingPreset }) {
  const { easingConfig } = presetToEasing(preset)
  const steps = 24
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const v = applyEasingConfig(t, easingConfig)
    const px = T_PAD + t * (T_W - T_PAD * 2)
    const py = T_PAD + ((T_YMAX - v) / (T_YMAX - T_YMIN)) * (T_H - T_PAD * 2)
    d += `${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)} `
  }
  return (
    <svg width={T_W} height={T_H} viewBox={`0 0 ${T_W} ${T_H}`} className="shrink-0" aria-hidden>
      <path d={d} className="fill-none stroke-blue-400" strokeWidth={1.5} />
    </svg>
  )
}

function HoldThumb() {
  // A step: flat, then a vertical jump at the end.
  const midY = T_PAD + ((T_YMAX - 0) / (T_YMAX - T_YMIN)) * (T_H - T_PAD * 2)
  const topY = T_PAD + ((T_YMAX - 1) / (T_YMAX - T_YMIN)) * (T_H - T_PAD * 2)
  const right = T_W - T_PAD
  return (
    <svg width={T_W} height={T_H} viewBox={`0 0 ${T_W} ${T_H}`} className="shrink-0" aria-hidden>
      <path
        d={`M ${T_PAD} ${midY} L ${right} ${midY} L ${right} ${topY}`}
        className="fill-none stroke-blue-400"
        strokeWidth={1.5}
      />
    </svg>
  )
}
