import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/shared/ui/cn'
import { updateItem } from '@/features/editor/deps/timeline-store'
import { useGizmoStore } from '@/features/editor/deps/preview'
import { type TimelineItem } from '@/types/timeline'
import { NumberInput } from '../components'
import { RotaryKnob } from '@/shared/ui/property-controls/rotary-knob'
import { demixValue } from '../utils/mixed-value'
import { AudioEqCurveEditor, type AudioEqPatch } from './audio-eq-curve-editor'
import { getAudioSectionItems } from './audio-section-utils'
import {
  formatFrequencyRangeLabel,
  formatOutputGainDb,
  getEffectiveGainBandControlRangeId,
  getEqControlsDisabled,
  getEqPresetPlaceholder,
  hasMixedEqDisplayValues,
  resolveEqDisplayValues,
  roundOutputGainDb,
} from './audio-eq-panel-values'
import {
  AUDIO_EQ_BAND1_FILTER_OPTIONS,
  AUDIO_EQ_BAND6_FILTER_OPTIONS,
  AUDIO_EQ_CONTROL_RANGES,
  AUDIO_EQ_FILTER_TYPE_LABELS,
  AUDIO_EQ_FILTER_TYPE_PATHS,
  AUDIO_EQ_INNER_FILTER_OPTIONS,
  AUDIO_EQ_SLOPE_OPTIONS,
  DEFAULT_GAIN_BAND_CONTROL_RANGES,
  buildTimelineEqPatchFromResolvedSettings,
  clampFrequencyToAudioEqControlRange,
  getAudioEqControlRangeById,
  normalizeUiEqPatch,
  toTimelineEqPatch,
  type AudioEqControlRangeId,
  type AudioEqFilterType,
  type AudioEqGainBandControlKey,
  type AudioEqGainBandControlRanges,
} from './audio-eq-ui'
import {
  AUDIO_EQ_GAIN_DB_MAX,
  AUDIO_EQ_GAIN_DB_MIN,
  AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_Q,
  AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_Q,
  AUDIO_EQ_PRESETS,
  AUDIO_EQ_Q_MAX,
  AUDIO_EQ_Q_MIN,
  type AudioEqPresetId,
  findAudioEqPresetId,
  getAudioEqPresetById,
  resolveAudioEqSettings,
} from '@/shared/utils/audio-eq'

interface AudioEqPanelContentProps {
  targetLabel: string
  items?: TimelineItem[]
  trackEq?: import('@/types/audio').AudioEqSettings
  enabled?: boolean
  onTrackEqChange?: (patch: AudioEqPatch) => void
  onEnabledChange?: (enabled: boolean) => void
  portalContainer?: HTMLElement | null
  layoutMode?: 'floating' | 'detached' | 'compact'
}

type FilterType = AudioEqFilterType

function FilterTypeGlyph({ type }: { type: FilterType }) {
  return (
    <svg viewBox="0 0 20 12" className="h-3 w-5 text-current">
      <path
        d={AUDIO_EQ_FILTER_TYPE_PATHS[type]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function FilterTypeSelect({
  value,
  options,
  onChange,
  portalContainer,
}: {
  value: FilterType
  options: ReadonlyArray<FilterType>
  onChange: (value: FilterType) => void
  portalContainer?: HTMLElement | null
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-6 w-11 items-center justify-center gap-0.5 rounded-[4px] border border-border bg-background px-1 text-muted-foreground transition-colors hover:text-zinc-200"
          title={AUDIO_EQ_FILTER_TYPE_LABELS[value]}
        >
          <FilterTypeGlyph type={value} />
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={4}
        container={portalContainer ?? undefined}
        className="z-[80] w-14 min-w-14 rounded-[4px] border-border bg-background p-1"
      >
        {options.map((option) => (
          <DropdownMenuItem
            key={option}
            className={cn(
              'my-0.5 flex h-7 items-center justify-center rounded-[4px] px-2 text-zinc-300 focus:bg-white/10 focus:text-white',
              option === value && 'bg-white/10 text-white',
            )}
            title={AUDIO_EQ_FILTER_TYPE_LABELS[option]}
            onSelect={() => onChange(option)}
          >
            <FilterTypeGlyph type={option} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SlopeButtons({
  value,
  onChange,
}: {
  value: number | 'mixed'
  onChange: (v: 6 | 12 | 18 | 24) => void
}) {
  return (
    <div className="flex overflow-hidden rounded-[4px] border border-border/70">
      {AUDIO_EQ_SLOPE_OPTIONS.map((slope) => (
        <button
          key={slope}
          type="button"
          className={cn(
            'flex-1 border-r border-border/70 py-1 text-[10px] font-medium transition-colors last:border-r-0',
            value === slope
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary/30 text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
          )}
          onClick={() => onChange(slope)}
        >
          {slope}
        </button>
      ))}
    </div>
  )
}

function RangeButtons({
  value,
  onChange,
}: {
  value: AudioEqControlRangeId
  onChange: (value: AudioEqControlRangeId) => void
}) {
  return (
    <div className="flex overflow-hidden rounded-[4px] border border-border/70">
      {AUDIO_EQ_CONTROL_RANGES.map((range) => (
        <button
          key={range.id}
          type="button"
          className={cn(
            'flex-1 border-r border-border/70 py-1 text-[10px] font-medium transition-colors last:border-r-0',
            value === range.id
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary/30 text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
          )}
          onClick={() => onChange(range.id)}
        >
          {range.label}
        </button>
      ))}
    </div>
  )
}

function QFactorControl({
  value,
  onChange,
  onLiveChange,
}: {
  value: number | 'mixed'
  onChange: (value: number) => void
  onLiveChange: (value: number) => void
}) {
  return (
    <>
      <div className="text-[10px] text-zinc-500">Q Factor</div>
      <div className="flex items-center gap-1.5">
        <NumberInput
          value={value}
          onChange={onChange}
          onLiveChange={onLiveChange}
          min={AUDIO_EQ_Q_MIN}
          max={AUDIO_EQ_Q_MAX}
          step={0.05}
          className="flex-1"
        />
        <RotaryKnob
          value={value}
          onChange={onChange}
          onLiveChange={onLiveChange}
          min={AUDIO_EQ_Q_MIN}
          max={AUDIO_EQ_Q_MAX}
          step={0.05}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600">
        <span>{AUDIO_EQ_Q_MIN.toFixed(1)}</span>
        <span>{AUDIO_EQ_Q_MAX.toFixed(1)}</span>
      </div>
    </>
  )
}

interface EqOutputGainControlProps {
  value: number | 'mixed'
  onChange: (value: number) => void
  onLiveChange: (value: number) => void
  disabled?: boolean
  compact?: boolean
}

function EqOutputGainControl({
  value,
  onChange,
  onLiveChange,
  disabled = false,
  compact = false,
}: EqOutputGainControlProps) {
  const [draftValue, setDraftValue] = useState<number | null>(null)
  const resolvedValue = demixValue(value, 0)
  const displayValue = draftValue ?? resolvedValue
  const range = AUDIO_EQ_GAIN_DB_MAX - AUDIO_EQ_GAIN_DB_MIN
  const thumbPercent = (1 - (displayValue - AUDIO_EQ_GAIN_DB_MIN) / Math.max(range, 1)) * 100

  const valueFromClientY = useCallback(
    (clientY: number, rect: DOMRect) => {
      const normalized = 1 - (clientY - rect.top) / Math.max(rect.height, 1)
      return roundOutputGainDb(AUDIO_EQ_GAIN_DB_MIN + Math.max(0, Math.min(1, normalized)) * range)
    },
    [range],
  )

  const commitValue = useCallback(
    (nextValue: number) => {
      setDraftValue(null)
      onChange(roundOutputGainDb(nextValue))
    },
    [onChange],
  )

  return (
    <div
      className={cn(
        'flex shrink-0 flex-col px-1 pb-1 pt-1',
        compact ? 'w-[68px] h-[220px]' : 'w-[76px] h-[clamp(288px,33vh,344px)]',
        disabled && 'opacity-50',
      )}
    >
      <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 text-center">Gain</div>
      <div
        className={cn(
          'relative mt-1 min-h-0 flex-1 w-full touch-none select-none',
          disabled ? 'pointer-events-none' : 'cursor-ns-resize',
        )}
        onDoubleClick={() => {
          if (disabled) return
          setDraftValue(null)
          onLiveChange(0)
          onChange(0)
        }}
        onPointerDown={(event) => {
          if (disabled) return
          event.preventDefault()
          const target = event.currentTarget
          const rect = target.getBoundingClientRect()
          const startValue = valueFromClientY(event.clientY, rect)
          target.setPointerCapture?.(event.pointerId)
          setDraftValue(startValue)
          onLiveChange(startValue)

          const handlePointerMove = (moveEvent: PointerEvent) => {
            const nextValue = valueFromClientY(moveEvent.clientY, rect)
            setDraftValue(nextValue)
            onLiveChange(nextValue)
          }

          const handlePointerEnd = (endEvent: PointerEvent) => {
            target.releasePointerCapture?.(event.pointerId)
            const nextValue = valueFromClientY(endEvent.clientY, rect)
            target.removeEventListener('pointermove', handlePointerMove)
            target.removeEventListener('pointerup', handlePointerEnd)
            target.removeEventListener('pointercancel', handlePointerEnd)
            commitValue(nextValue)
          }

          target.addEventListener('pointermove', handlePointerMove)
          target.addEventListener('pointerup', handlePointerEnd)
          target.addEventListener('pointercancel', handlePointerEnd)
        }}
      >
        <div className="absolute inset-x-0 top-0 bottom-7">
          {[20, 10, 0, -10, -20].map((tick) => {
            const tickPercent = (1 - (tick - AUDIO_EQ_GAIN_DB_MIN) / Math.max(range, 1)) * 100
            return (
              <div
                key={tick}
                className="pointer-events-none absolute inset-x-0"
                style={{ top: `${tickPercent}%` }}
              >
                <div className="absolute left-2 right-7 h-px -translate-y-1/2 bg-[#34363d]" />
                <span className="absolute right-1 -translate-y-1/2 text-[9px] font-mono text-zinc-500 text-right">
                  {tick > 0 ? `+${tick}` : tick}
                </span>
              </div>
            )
          })}
          <div className="absolute bottom-0 left-[16px] top-0 w-px bg-[#2f3138]" />
          <div
            className="absolute left-[7px] h-7 w-[18px] -translate-y-1/2 rounded-[2px] border border-[#666a73] bg-[#b9bbc2] shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
            style={{ top: `${thumbPercent}%` }}
          />
        </div>
      </div>
      <div className="mt-0.5 min-h-[18px] w-full text-center text-sm font-medium tabular-nums text-[#16d9ff]">
        {formatOutputGainDb(displayValue)}
      </div>
    </div>
  )
}

interface BandCardProps {
  title: string
  filterType: FilterType
  filterOptions?: ReadonlyArray<FilterType>
  onFilterTypeChange?: (value: FilterType) => void
  portalContainer?: HTMLElement | null
  compact?: boolean
  active?: boolean
  onToggle?: () => void
  onReset: () => void
  children: ReactNode
}

function BandCard({
  title,
  filterType,
  filterOptions,
  onFilterTypeChange,
  portalContainer,
  compact = false,
  active = true,
  onToggle,
  onReset,
  children,
}: BandCardProps) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col rounded-[6px] border border-border bg-secondary/50 transition-opacity',
        !active && onToggle && 'opacity-50',
      )}
    >
      <div
        className={cn(
          'grid grid-cols-[minmax(0,1fr)_auto] items-center border-b border-border',
          compact ? 'gap-1 px-1.5 py-1.5' : 'gap-1.5 px-2 py-2',
        )}
      >
        <div
          className={cn('flex min-w-0 items-center overflow-hidden', compact ? 'gap-1' : 'gap-1.5')}
        >
          {onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              className={cn(
                'inline-flex h-5 shrink-0 items-center justify-center whitespace-nowrap rounded-full py-0.5 text-[9px] font-semibold leading-none transition-colors',
                compact ? 'min-w-[3.05rem] px-1' : 'min-w-[3.55rem] px-1.5',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary/40 text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
              )}
            >
              {title}
            </button>
          ) : (
            <span
              className={cn(
                'inline-flex h-5 shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-primary py-0.5 text-[9px] font-semibold leading-none text-primary-foreground',
                compact ? 'min-w-[3.05rem] px-1' : 'min-w-[3.55rem] px-1.5',
              )}
            >
              {title}
            </span>
          )}
          <div className="shrink-0">
            {filterOptions && onFilterTypeChange ? (
              <FilterTypeSelect
                value={filterType}
                options={filterOptions}
                onChange={onFilterTypeChange}
                portalContainer={portalContainer}
              />
            ) : (
              <div className="flex h-6 items-center rounded-[4px] border border-border bg-background px-1.5 text-muted-foreground">
                <FilterTypeGlyph type={filterType} />
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-[3px] text-zinc-600 transition-colors hover:bg-white/5 hover:text-zinc-300',
            compact ? 'h-4 w-4' : 'h-5 w-5',
          )}
          onClick={onReset}
          aria-label={`Reset ${title}`}
          title={`Reset ${title}`}
        >
          <RotateCcw className={cn(compact ? 'h-2.5 w-2.5' : 'h-3 w-3')} />
        </button>
      </div>
      <div className={cn('flex flex-1 flex-col', compact ? 'gap-1.5 p-1.5' : 'gap-2 p-2')}>
        {children}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Compact row-based band controls (Davinci-style)
// ---------------------------------------------------------------------------

type CompactBandRowsProps = {
  eqBand1Type: FilterType | 'mixed'
  eqBand1Enabled: boolean | 'mixed'
  eqBand1FrequencyHz: number | 'mixed'
  eqBand1GainDb: number | 'mixed'
  eqBand1Q: number | 'mixed'
  eqLowType: FilterType | 'mixed'
  eqLowEnabled: boolean | 'mixed'
  eqLowFrequencyHz: number | 'mixed'
  eqLow: number | 'mixed'
  eqLowQ: number | 'mixed'
  lowRange: { minFrequencyHz: number; maxFrequencyHz: number }
  eqLowMidType: FilterType | 'mixed'
  eqLowMidEnabled: boolean | 'mixed'
  eqLowMidFrequencyHz: number | 'mixed'
  eqLowMid: number | 'mixed'
  eqLowMidQ: number | 'mixed'
  lowMidRange: { minFrequencyHz: number; maxFrequencyHz: number }
  eqHighMidType: FilterType | 'mixed'
  eqHighMidEnabled: boolean | 'mixed'
  eqHighMidFrequencyHz: number | 'mixed'
  eqHighMid: number | 'mixed'
  eqHighMidQ: number | 'mixed'
  highMidRange: { minFrequencyHz: number; maxFrequencyHz: number }
  eqHighType: FilterType | 'mixed'
  eqHighEnabled: boolean | 'mixed'
  eqHighFrequencyHz: number | 'mixed'
  eqHigh: number | 'mixed'
  eqHighQ: number | 'mixed'
  highRange: { minFrequencyHz: number; maxFrequencyHz: number }
  eqBand6Type: FilterType | 'mixed'
  eqBand6Enabled: boolean | 'mixed'
  eqBand6FrequencyHz: number | 'mixed'
  eqBand6GainDb: number | 'mixed'
  eqBand6Q: number | 'mixed'
  onFieldChange: <K extends keyof AudioEqPatch>(
    field: K,
    value: NonNullable<AudioEqPatch[K]>,
  ) => void
  onLiveChange: (patch: AudioEqPatch) => void
  portalContainer?: HTMLElement | null
}

function CompactBandRows(props: CompactBandRowsProps) {
  const { onFieldChange, onLiveChange, portalContainer } = props
  const b1Type = demixValue(props.eqBand1Type, 'high-pass') as FilterType
  const b2Type = demixValue(props.eqLowType, 'low-shelf') as FilterType
  const b3Type = demixValue(props.eqLowMidType, 'peaking') as FilterType
  const b4Type = demixValue(props.eqHighMidType, 'peaking') as FilterType
  const b5Type = demixValue(props.eqHighType, 'high-shelf') as FilterType
  const b6Type = demixValue(props.eqBand6Type, 'low-pass') as FilterType
  const showGain = (t: FilterType) => t !== 'high-pass' && t !== 'low-pass' && t !== 'notch'
  const showQ = (t: FilterType) => t === 'peaking'
  const bandTypes = [b1Type, b2Type, b3Type, b4Type, b5Type, b6Type]
  const anyGain = bandTypes.some(showGain)
  const anyQ = bandTypes.some(showQ)

  return (
    <div className="space-y-1 px-2 pb-2">
      {/* Band toggle buttons */}
      <div className="grid grid-cols-6 gap-1">
        {(
          [
            {
              label: 'B 1',
              active: demixValue(props.eqBand1Enabled, false),
              field: 'audioEqBand1Enabled' as const,
              current: props.eqBand1Enabled,
            },
            {
              label: 'B 2',
              active: demixValue(props.eqLowEnabled, false),
              field: 'audioEqLowEnabled' as const,
              current: props.eqLowEnabled,
            },
            {
              label: 'B 3',
              active: demixValue(props.eqLowMidEnabled, false),
              field: 'audioEqLowMidEnabled' as const,
              current: props.eqLowMidEnabled,
            },
            {
              label: 'B 4',
              active: demixValue(props.eqHighMidEnabled, false),
              field: 'audioEqHighMidEnabled' as const,
              current: props.eqHighMidEnabled,
            },
            {
              label: 'B 5',
              active: demixValue(props.eqHighEnabled, false),
              field: 'audioEqHighEnabled' as const,
              current: props.eqHighEnabled,
            },
            {
              label: 'B 6',
              active: demixValue(props.eqBand6Enabled, false),
              field: 'audioEqBand6Enabled' as const,
              current: props.eqBand6Enabled,
            },
          ] as const
        ).map((band) => (
          <button
            key={band.label}
            type="button"
            onClick={() => onFieldChange(band.field, !demixValue(band.current, false))}
            className={cn(
              'h-7 rounded-[4px] border text-[11px] font-semibold transition-colors',
              band.active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-secondary/50 text-muted-foreground hover:bg-secondary',
            )}
          >
            {band.label}
          </button>
        ))}
      </div>
      {/* Filter type selectors */}
      <div className="grid grid-cols-6 gap-1">
        <FilterTypeSelect
          value={b1Type}
          options={AUDIO_EQ_BAND1_FILTER_OPTIONS}
          onChange={(v) =>
            onFieldChange('audioEqBand1Type', v as (typeof AUDIO_EQ_BAND1_FILTER_OPTIONS)[number])
          }
          portalContainer={portalContainer}
        />
        <FilterTypeSelect
          value={b2Type}
          options={AUDIO_EQ_INNER_FILTER_OPTIONS}
          onChange={(v) =>
            onFieldChange('audioEqLowType', v === 'low-pass' || v === 'high-pass' ? 'low-shelf' : v)
          }
          portalContainer={portalContainer}
        />
        <FilterTypeSelect
          value={b3Type}
          options={AUDIO_EQ_INNER_FILTER_OPTIONS}
          onChange={(v) =>
            onFieldChange(
              'audioEqLowMidType',
              v === 'low-pass' || v === 'high-pass' ? 'peaking' : v,
            )
          }
          portalContainer={portalContainer}
        />
        <FilterTypeSelect
          value={b4Type}
          options={AUDIO_EQ_INNER_FILTER_OPTIONS}
          onChange={(v) =>
            onFieldChange(
              'audioEqHighMidType',
              v === 'low-pass' || v === 'high-pass' ? 'peaking' : v,
            )
          }
          portalContainer={portalContainer}
        />
        <FilterTypeSelect
          value={b5Type}
          options={AUDIO_EQ_INNER_FILTER_OPTIONS}
          onChange={(v) =>
            onFieldChange(
              'audioEqHighType',
              v === 'low-pass' || v === 'high-pass' ? 'high-shelf' : v,
            )
          }
          portalContainer={portalContainer}
        />
        <FilterTypeSelect
          value={b6Type}
          options={AUDIO_EQ_BAND6_FILTER_OPTIONS}
          onChange={(v) =>
            onFieldChange('audioEqBand6Type', v === 'high-pass' || v === 'notch' ? 'low-pass' : v)
          }
          portalContainer={portalContainer}
        />
      </div>
      {/* Frequency row */}
      <div className="grid grid-cols-6 gap-1">
        <NumberInput
          value={props.eqBand1FrequencyHz}
          onChange={(v) => onFieldChange('audioEqBand1FrequencyHz', v)}
          onLiveChange={(v) => onLiveChange({ audioEqBand1FrequencyHz: v })}
          unit="Hz"
          min={AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ}
          max={AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ}
          step={1}
        />
        <NumberInput
          value={props.eqLowFrequencyHz}
          onChange={(v) => onFieldChange('audioEqLowFrequencyHz', v)}
          onLiveChange={(v) => onLiveChange({ audioEqLowFrequencyHz: v })}
          unit="Hz"
          min={props.lowRange.minFrequencyHz}
          max={props.lowRange.maxFrequencyHz}
          step={1}
        />
        <NumberInput
          value={props.eqLowMidFrequencyHz}
          onChange={(v) => onFieldChange('audioEqLowMidFrequencyHz', v)}
          onLiveChange={(v) => onLiveChange({ audioEqLowMidFrequencyHz: v })}
          unit="Hz"
          min={props.lowMidRange.minFrequencyHz}
          max={props.lowMidRange.maxFrequencyHz}
          step={1}
        />
        <NumberInput
          value={props.eqHighMidFrequencyHz}
          onChange={(v) => onFieldChange('audioEqHighMidFrequencyHz', v)}
          onLiveChange={(v) => onLiveChange({ audioEqHighMidFrequencyHz: v })}
          unit="Hz"
          min={props.highMidRange.minFrequencyHz}
          max={props.highMidRange.maxFrequencyHz}
          step={1}
        />
        <NumberInput
          value={props.eqHighFrequencyHz}
          onChange={(v) => onFieldChange('audioEqHighFrequencyHz', v)}
          onLiveChange={(v) => onLiveChange({ audioEqHighFrequencyHz: v })}
          unit="Hz"
          min={props.highRange.minFrequencyHz}
          max={props.highRange.maxFrequencyHz}
          step={1}
        />
        <NumberInput
          value={props.eqBand6FrequencyHz}
          onChange={(v) => onFieldChange('audioEqBand6FrequencyHz', v)}
          onLiveChange={(v) => onLiveChange({ audioEqBand6FrequencyHz: v })}
          unit="Hz"
          min={AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ}
          max={AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ}
          step={1}
        />
      </div>
      {/* Gain row */}
      {anyGain ? (
        <div className="grid grid-cols-6 gap-1">
          {showGain(b1Type) ? (
            <NumberInput
              value={props.eqBand1GainDb}
              onChange={(v) => onFieldChange('audioEqBand1GainDb', v)}
              onLiveChange={(v) => onLiveChange({ audioEqBand1GainDb: v })}
              unit="dB"
              min={AUDIO_EQ_GAIN_DB_MIN}
              max={AUDIO_EQ_GAIN_DB_MAX}
              step={0.1}
            />
          ) : (
            <div />
          )}
          {showGain(b2Type) ? (
            <NumberInput
              value={props.eqLow}
              onChange={(v) => onFieldChange('audioEqLowGainDb', v)}
              onLiveChange={(v) => onLiveChange({ audioEqLowGainDb: v })}
              unit="dB"
              min={AUDIO_EQ_GAIN_DB_MIN}
              max={AUDIO_EQ_GAIN_DB_MAX}
              step={0.1}
            />
          ) : (
            <div />
          )}
          {showGain(b3Type) ? (
            <NumberInput
              value={props.eqLowMid}
              onChange={(v) => onFieldChange('audioEqLowMidGainDb', v)}
              onLiveChange={(v) => onLiveChange({ audioEqLowMidGainDb: v })}
              unit="dB"
              min={AUDIO_EQ_GAIN_DB_MIN}
              max={AUDIO_EQ_GAIN_DB_MAX}
              step={0.1}
            />
          ) : (
            <div />
          )}
          {showGain(b4Type) ? (
            <NumberInput
              value={props.eqHighMid}
              onChange={(v) => onFieldChange('audioEqHighMidGainDb', v)}
              onLiveChange={(v) => onLiveChange({ audioEqHighMidGainDb: v })}
              unit="dB"
              min={AUDIO_EQ_GAIN_DB_MIN}
              max={AUDIO_EQ_GAIN_DB_MAX}
              step={0.1}
            />
          ) : (
            <div />
          )}
          {showGain(b5Type) ? (
            <NumberInput
              value={props.eqHigh}
              onChange={(v) => onFieldChange('audioEqHighGainDb', v)}
              onLiveChange={(v) => onLiveChange({ audioEqHighGainDb: v })}
              unit="dB"
              min={AUDIO_EQ_GAIN_DB_MIN}
              max={AUDIO_EQ_GAIN_DB_MAX}
              step={0.1}
            />
          ) : (
            <div />
          )}
          {showGain(b6Type) ? (
            <NumberInput
              value={props.eqBand6GainDb}
              onChange={(v) => onFieldChange('audioEqBand6GainDb', v)}
              onLiveChange={(v) => onLiveChange({ audioEqBand6GainDb: v })}
              unit="dB"
              min={AUDIO_EQ_GAIN_DB_MIN}
              max={AUDIO_EQ_GAIN_DB_MAX}
              step={0.1}
            />
          ) : (
            <div />
          )}
        </div>
      ) : null}
      {/* Q factor row */}
      {anyQ ? (
        <div className="grid grid-cols-6 gap-1">
          {showQ(b1Type) ? (
            <NumberInput
              value={props.eqBand1Q}
              onChange={(v) => onFieldChange('audioEqBand1Q', v)}
              onLiveChange={(v) => onLiveChange({ audioEqBand1Q: v })}
              unit="Q"
              min={AUDIO_EQ_Q_MIN}
              max={AUDIO_EQ_Q_MAX}
              step={0.05}
            />
          ) : (
            <div />
          )}
          {showQ(b2Type) ? (
            <NumberInput
              value={props.eqLowQ}
              onChange={(v) => onFieldChange('audioEqLowQ', v)}
              onLiveChange={(v) => onLiveChange({ audioEqLowQ: v })}
              unit="Q"
              min={AUDIO_EQ_Q_MIN}
              max={AUDIO_EQ_Q_MAX}
              step={0.05}
            />
          ) : (
            <div />
          )}
          {showQ(b3Type) ? (
            <NumberInput
              value={props.eqLowMidQ}
              onChange={(v) => onFieldChange('audioEqLowMidQ', v)}
              onLiveChange={(v) => onLiveChange({ audioEqLowMidQ: v })}
              unit="Q"
              min={AUDIO_EQ_Q_MIN}
              max={AUDIO_EQ_Q_MAX}
              step={0.05}
            />
          ) : (
            <div />
          )}
          {showQ(b4Type) ? (
            <NumberInput
              value={props.eqHighMidQ}
              onChange={(v) => onFieldChange('audioEqHighMidQ', v)}
              onLiveChange={(v) => onLiveChange({ audioEqHighMidQ: v })}
              unit="Q"
              min={AUDIO_EQ_Q_MIN}
              max={AUDIO_EQ_Q_MAX}
              step={0.05}
            />
          ) : (
            <div />
          )}
          {showQ(b5Type) ? (
            <NumberInput
              value={props.eqHighQ}
              onChange={(v) => onFieldChange('audioEqHighQ', v)}
              onLiveChange={(v) => onLiveChange({ audioEqHighQ: v })}
              unit="Q"
              min={AUDIO_EQ_Q_MIN}
              max={AUDIO_EQ_Q_MAX}
              step={0.05}
            />
          ) : (
            <div />
          )}
          {showQ(b6Type) ? (
            <NumberInput
              value={props.eqBand6Q}
              onChange={(v) => onFieldChange('audioEqBand6Q', v)}
              onLiveChange={(v) => onLiveChange({ audioEqBand6Q: v })}
              unit="Q"
              min={AUDIO_EQ_Q_MIN}
              max={AUDIO_EQ_Q_MAX}
              step={0.05}
            />
          ) : (
            <div />
          )}
        </div>
      ) : null}
    </div>
  )
}

export function AudioEqPanelContent({
  items,
  targetLabel,
  trackEq,
  enabled = true,
  onTrackEqChange,
  onEnabledChange,
  portalContainer,
  layoutMode = 'floating',
}: AudioEqPanelContentProps) {
  const isTrackMode = onTrackEqChange !== undefined
  const isDetachedLayout = layoutMode === 'detached'
  const isCompactLayout = layoutMode === 'compact'
  const eqEnabled = enabled !== false
  const setPropertiesPreviewNew = useGizmoStore((s) => s.setPropertiesPreviewNew)
  const clearPreviewForItems = useGizmoStore((s) => s.clearPreviewForItems)

  const audioItems = useMemo(
    () => (isTrackMode ? [] : getAudioSectionItems(items ?? [])),
    [isTrackMode, items],
  )
  const itemIds = useMemo(() => audioItems.map((item) => item.id), [audioItems])

  const clipEqEnabled = useMemo(() => {
    if (isTrackMode || audioItems.length === 0) return true
    return audioItems.every((item) => item.audioEqEnabled === true)
  }, [audioItems, isTrackMode])

  const handleClipEqEnabledChange = useCallback(
    (checked: boolean) => {
      itemIds.forEach((id) => updateItem(id, { audioEqEnabled: checked }))
    },
    [itemIds],
  )

  const resolvedTrackEq = useMemo(
    () => (isTrackMode ? resolveAudioEqSettings(trackEq ?? {}) : null),
    [isTrackMode, trackEq],
  )
  const resolvedItemEqSettings = useMemo(
    () => audioItems.map((item) => resolveAudioEqSettings(item)),
    [audioItems],
  )

  const [livePatch, setLivePatch] = useState<AudioEqPatch | null>(null)
  const [gainBandControlRanges, setGainBandControlRanges] = useState<AudioEqGainBandControlRanges>(
    DEFAULT_GAIN_BAND_CONTROL_RANGES,
  )

  useEffect(() => {
    setLivePatch(null)
    setGainBandControlRanges(DEFAULT_GAIN_BAND_CONTROL_RANGES)
  }, [targetLabel])

  const eqValues = useMemo(
    () => resolveEqDisplayValues(livePatch, resolvedTrackEq, resolvedItemEqSettings),
    [livePatch, resolvedTrackEq, resolvedItemEqSettings],
  )
  const {
    outputGainDb: eqOutputGainDb,
    band1Enabled: eqBand1Enabled,
    band1Type: eqBand1Type,
    band1FrequencyHz: eqBand1FrequencyHz,
    band1GainDb: eqBand1GainDb,
    band1Q: eqBand1Q,
    band1SlopeDbPerOct: eqBand1SlopeDbPerOct,
    lowEnabled: eqLowEnabled,
    lowType: eqLowType,
    lowGainDb: eqLow,
    lowFrequencyHz: eqLowFrequencyHz,
    lowQ: eqLowQ,
    lowMidEnabled: eqLowMidEnabled,
    lowMidType: eqLowMidType,
    lowMidGainDb: eqLowMid,
    lowMidFrequencyHz: eqLowMidFrequencyHz,
    lowMidQ: eqLowMidQ,
    highMidEnabled: eqHighMidEnabled,
    highMidType: eqHighMidType,
    highMidGainDb: eqHighMid,
    highMidFrequencyHz: eqHighMidFrequencyHz,
    highMidQ: eqHighMidQ,
    highEnabled: eqHighEnabled,
    highType: eqHighType,
    highGainDb: eqHigh,
    highFrequencyHz: eqHighFrequencyHz,
    highQ: eqHighQ,
    band6Enabled: eqBand6Enabled,
    band6Type: eqBand6Type,
    band6FrequencyHz: eqBand6FrequencyHz,
    band6GainDb: eqBand6GainDb,
    band6Q: eqBand6Q,
    band6SlopeDbPerOct: eqBand6SlopeDbPerOct,
  } = eqValues
  // Pre-resolved band type/enabled states shared by the band cards below, so
  // the per-card JSX does not re-derive the same 'mixed' fallbacks.
  const eqBand1TypeOrDefault = demixValue(eqBand1Type, 'high-pass')
  const eqBand1EnabledOrDefault = demixValue(eqBand1Enabled, false)
  const eqLowTypeOrDefault = demixValue(eqLowType, 'low-shelf')
  const eqLowEnabledOrDefault = demixValue(eqLowEnabled, false)
  const eqLowMidTypeOrDefault = demixValue(eqLowMidType, 'peaking')
  const eqLowMidEnabledOrDefault = demixValue(eqLowMidEnabled, false)
  const eqHighMidTypeOrDefault = demixValue(eqHighMidType, 'peaking')
  const eqHighMidEnabledOrDefault = demixValue(eqHighMidEnabled, false)
  const eqHighTypeOrDefault = demixValue(eqHighType, 'high-shelf')
  const eqHighEnabledOrDefault = demixValue(eqHighEnabled, false)
  const eqBand6TypeOrDefault = demixValue(eqBand6Type, 'low-pass')
  const eqBand6EnabledOrDefault = demixValue(eqBand6Enabled, false)

  const lowRangeId = getEffectiveGainBandControlRangeId(
    gainBandControlRanges.low,
    eqLowFrequencyHz,
    DEFAULT_GAIN_BAND_CONTROL_RANGES.low,
  )
  const lowMidRangeId = getEffectiveGainBandControlRangeId(
    gainBandControlRanges.lowMid,
    eqLowMidFrequencyHz,
    DEFAULT_GAIN_BAND_CONTROL_RANGES.lowMid,
  )
  const highMidRangeId = getEffectiveGainBandControlRangeId(
    gainBandControlRanges.highMid,
    eqHighMidFrequencyHz,
    DEFAULT_GAIN_BAND_CONTROL_RANGES.highMid,
  )
  const highRangeId = getEffectiveGainBandControlRangeId(
    gainBandControlRanges.high,
    eqHighFrequencyHz,
    DEFAULT_GAIN_BAND_CONTROL_RANGES.high,
  )

  const lowRange = getAudioEqControlRangeById(lowRangeId)
  const lowMidRange = getAudioEqControlRangeById(lowMidRangeId)
  const highMidRange = getAudioEqControlRangeById(highMidRangeId)
  const highRange = getAudioEqControlRangeById(highRangeId)

  const hasMixedEqValues = hasMixedEqDisplayValues(eqValues)

  const eqControlsDisabled = getEqControlsDisabled(
    hasMixedEqValues,
    isCompactLayout,
    eqEnabled,
    clipEqEnabled,
  )

  const eqCurveSettings = useMemo(
    () =>
      resolveAudioEqSettings({
        outputGainDb: demixValue(eqOutputGainDb, 0),
        band1Enabled: demixValue(eqBand1Enabled, false),
        band1Type: demixValue(eqBand1Type, 'high-pass'),
        band1FrequencyHz: demixValue(eqBand1FrequencyHz, AUDIO_EQ_LOW_CUT_FREQUENCY_HZ),
        band1GainDb: demixValue(eqBand1GainDb, 0),
        band1Q: demixValue(eqBand1Q, AUDIO_EQ_LOW_MID_Q),
        band1SlopeDbPerOct: demixValue(eqBand1SlopeDbPerOct, 12),
        lowEnabled: demixValue(eqLowEnabled, true),
        lowType: demixValue(eqLowType, 'low-shelf'),
        lowGainDb: demixValue(eqLow, 0),
        lowFrequencyHz: demixValue(eqLowFrequencyHz, AUDIO_EQ_LOW_FREQUENCY_HZ),
        lowQ: demixValue(eqLowQ, AUDIO_EQ_LOW_MID_Q),
        lowMidEnabled: demixValue(eqLowMidEnabled, true),
        lowMidType: demixValue(eqLowMidType, 'peaking'),
        lowMidGainDb: demixValue(eqLowMid, 0),
        lowMidFrequencyHz: demixValue(eqLowMidFrequencyHz, AUDIO_EQ_LOW_MID_FREQUENCY_HZ),
        lowMidQ: demixValue(eqLowMidQ, AUDIO_EQ_LOW_MID_Q),
        midGainDb: 0,
        highMidEnabled: demixValue(eqHighMidEnabled, true),
        highMidType: demixValue(eqHighMidType, 'peaking'),
        highMidGainDb: demixValue(eqHighMid, 0),
        highMidFrequencyHz: demixValue(eqHighMidFrequencyHz, AUDIO_EQ_HIGH_MID_FREQUENCY_HZ),
        highMidQ: demixValue(eqHighMidQ, AUDIO_EQ_HIGH_MID_Q),
        highEnabled: demixValue(eqHighEnabled, true),
        highType: demixValue(eqHighType, 'high-shelf'),
        highGainDb: demixValue(eqHigh, 0),
        highFrequencyHz: demixValue(eqHighFrequencyHz, AUDIO_EQ_HIGH_FREQUENCY_HZ),
        highQ: demixValue(eqHighQ, AUDIO_EQ_HIGH_MID_Q),
        band6Enabled: demixValue(eqBand6Enabled, false),
        band6Type: demixValue(eqBand6Type, 'low-pass'),
        band6FrequencyHz: demixValue(eqBand6FrequencyHz, AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ),
        band6GainDb: demixValue(eqBand6GainDb, 0),
        band6Q: demixValue(eqBand6Q, AUDIO_EQ_HIGH_MID_Q),
        band6SlopeDbPerOct: demixValue(eqBand6SlopeDbPerOct, 12),
      }),
    [
      eqOutputGainDb,
      eqBand1Enabled,
      eqBand1Type,
      eqBand1FrequencyHz,
      eqBand1GainDb,
      eqBand1Q,
      eqBand1SlopeDbPerOct,
      eqLowEnabled,
      eqLowType,
      eqHigh,
      eqHighFrequencyHz,
      eqHighQ,
      eqHighType,
      eqHighEnabled,
      eqHighMid,
      eqHighMidFrequencyHz,
      eqHighMidQ,
      eqHighMidType,
      eqHighMidEnabled,
      eqLow,
      eqLowFrequencyHz,
      eqLowQ,
      eqLowMid,
      eqLowMidFrequencyHz,
      eqLowMidQ,
      eqLowMidType,
      eqLowMidEnabled,
      eqBand6Enabled,
      eqBand6Type,
      eqBand6FrequencyHz,
      eqBand6GainDb,
      eqBand6Q,
      eqBand6SlopeDbPerOct,
    ],
  )
  const selectedEqPresetId = useMemo(
    () => (hasMixedEqValues ? null : findAudioEqPresetId(eqCurveSettings)),
    [eqCurveSettings, hasMixedEqValues],
  )

  const eqPresetPlaceholder = getEqPresetPlaceholder(hasMixedEqValues, selectedEqPresetId)

  const previewThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPreviewRef = useRef<AudioEqPatch | null>(null)

  const clearClipEqPreview = useCallback(() => {
    if (isTrackMode || itemIds.length === 0) {
      return
    }
    clearPreviewForItems(itemIds)
  }, [clearPreviewForItems, isTrackMode, itemIds])

  useEffect(() => {
    if (isTrackMode) {
      return
    }

    return () => {
      if (previewThrottleRef.current) {
        clearTimeout(previewThrottleRef.current)
        previewThrottleRef.current = null
      }
      pendingPreviewRef.current = null
      clearClipEqPreview()
    }
  }, [clearClipEqPreview, isTrackMode])

  const handleEqPatchLiveChange = useCallback(
    (patch: AudioEqPatch) => {
      const normalizedPatch = normalizeUiEqPatch(patch)
      setLivePatch(normalizedPatch)
      if (!isTrackMode) {
        if (isCompactLayout) {
          // Throttle audio preview for clip EQ to avoid audio jitter during drag
          pendingPreviewRef.current = normalizedPatch
          if (!previewThrottleRef.current) {
            previewThrottleRef.current = setTimeout(() => {
              previewThrottleRef.current = null
              const pending = pendingPreviewRef.current
              if (pending) {
                pendingPreviewRef.current = null
                const previews: Record<string, AudioEqPatch> = {}
                itemIds.forEach((id) => {
                  previews[id] = pending
                })
                setPropertiesPreviewNew(previews)
              }
            }, 80)
          }
        } else {
          const previews: Record<string, AudioEqPatch> = {}
          itemIds.forEach((id) => {
            previews[id] = normalizedPatch
          })
          setPropertiesPreviewNew(previews)
        }
      }
    },
    [isCompactLayout, isTrackMode, itemIds, setPropertiesPreviewNew],
  )

  const handleEqPatchChange = useCallback(
    (patch: AudioEqPatch) => {
      // Flush any pending throttled preview
      if (previewThrottleRef.current) {
        clearTimeout(previewThrottleRef.current)
        previewThrottleRef.current = null
      }
      pendingPreviewRef.current = null

      setLivePatch(null)
      if (isTrackMode && onTrackEqChange) {
        onTrackEqChange(patch)
      } else {
        const normalizedPatch = toTimelineEqPatch(patch)
        itemIds.forEach((id) => updateItem(id, normalizedPatch))
        queueMicrotask(() => clearClipEqPreview())
      }
    },
    [clearClipEqPreview, isTrackMode, itemIds, onTrackEqChange],
  )

  const handleEqPresetChange = useCallback(
    (presetId: string) => {
      const preset = getAudioEqPresetById(presetId as AudioEqPresetId)
      if (!preset) return

      if (previewThrottleRef.current) {
        clearTimeout(previewThrottleRef.current)
        previewThrottleRef.current = null
      }
      pendingPreviewRef.current = null
      setLivePatch(null)
      if (isTrackMode && onTrackEqChange) {
        onTrackEqChange(buildTimelineEqPatchFromResolvedSettings(preset.settings))
      } else {
        const patch = buildTimelineEqPatchFromResolvedSettings(preset.settings)
        itemIds.forEach((id) => updateItem(id, patch))
        queueMicrotask(() => clearClipEqPreview())
      }
    },
    [clearClipEqPreview, isTrackMode, itemIds, onTrackEqChange],
  )

  const handleEqFieldChange = useCallback(
    <K extends keyof AudioEqPatch>(field: K, value: NonNullable<AudioEqPatch[K]>) => {
      handleEqPatchChange({ [field]: value } as AudioEqPatch)
    },
    [handleEqPatchChange],
  )

  const handleGainBandControlRangeChange = useCallback(
    (
      band: AudioEqGainBandControlKey,
      rangeId: AudioEqControlRangeId,
      field:
        | 'audioEqLowFrequencyHz'
        | 'audioEqLowMidFrequencyHz'
        | 'audioEqHighMidFrequencyHz'
        | 'audioEqHighFrequencyHz',
      value: number | 'mixed',
    ) => {
      setGainBandControlRanges((current) => ({ ...current, [band]: rangeId }))
      if (value === 'mixed') return
      const nextFrequencyHz = clampFrequencyToAudioEqControlRange(value, rangeId)
      if (nextFrequencyHz !== value) {
        handleEqFieldChange(field, nextFrequencyHz)
      }
    },
    [handleEqFieldChange],
  )

  if (!isTrackMode && audioItems.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-zinc-500">
        No audio clips on {targetLabel}.
      </div>
    )
  }

  return (
    <div className="flex flex-col bg-background text-foreground">
      {!isCompactLayout ? (
        <div className="flex items-center gap-3 border-b border-border px-3 py-2">
          {onEnabledChange ? (
            <Switch
              checked={eqEnabled}
              onCheckedChange={onEnabledChange}
              className="h-5 w-9 shrink-0 shadow-none ring-offset-0"
              aria-label={`Turn ${targetLabel} EQ ${eqEnabled ? 'off' : 'on'}`}
            />
          ) : (
            <div className="h-2.5 w-2.5 rounded-full bg-primary" />
          )}
          <div className="text-sm font-medium text-foreground">
            Equalizer{targetLabel ? ` - ${targetLabel}` : ''}
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Preset</div>
            <Select
              value={selectedEqPresetId ?? undefined}
              onValueChange={handleEqPresetChange}
              disabled={!eqEnabled}
            >
              <SelectTrigger
                className={cn(
                  'h-8 w-[220px] border-border bg-secondary/30 text-xs text-foreground',
                  !eqEnabled && 'opacity-40',
                )}
              >
                <SelectValue placeholder={eqPresetPlaceholder} />
              </SelectTrigger>
              <SelectContent container={portalContainer ?? undefined}>
                {AUDIO_EQ_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id} className="text-xs">
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-8 shrink-0 px-3 text-muted-foreground hover:text-foreground',
                !eqEnabled && 'opacity-40',
              )}
              onClick={() => handleEqPresetChange('flat')}
              disabled={!eqEnabled}
            >
              Reset EQ
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex-1 overflow-auto">
        {isCompactLayout ? (
          <div className="flex items-center gap-1.5 px-2 pt-2 pb-1">
            <Switch
              checked={clipEqEnabled}
              onCheckedChange={handleClipEqEnabledChange}
              className="shrink-0"
              aria-label={`Turn clip EQ ${clipEqEnabled ? 'off' : 'on'}`}
            />
            <Select
              value={selectedEqPresetId ?? undefined}
              onValueChange={handleEqPresetChange}
              disabled={!clipEqEnabled}
            >
              <SelectTrigger
                className={cn('h-7 flex-1 min-w-0 text-xs', !clipEqEnabled && 'opacity-40')}
              >
                <SelectValue placeholder={eqPresetPlaceholder} />
              </SelectTrigger>
              <SelectContent container={portalContainer ?? undefined}>
                {AUDIO_EQ_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id} className="text-xs">
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground',
                !clipEqEnabled && 'opacity-40',
              )}
              onClick={() => handleEqPresetChange('flat')}
              disabled={!clipEqEnabled}
              aria-label="Reset EQ"
            >
              <RotateCcw className="h-3 w-3" />
            </Button>
          </div>
        ) : null}
        <div className={cn('relative', !isCompactLayout && 'border-b border-border')}>
          {!isTrackMode && !isCompactLayout ? (
            <div className="pointer-events-none absolute right-3 top-1 z-10 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              {audioItems.length} {audioItems.length === 1 ? 'clip' : 'clips'}
            </div>
          ) : null}
          <div className="flex items-stretch gap-3 px-3 pb-3 pt-2">
            <div className="min-w-0 flex-1">
              <AudioEqCurveEditor
                settings={eqCurveSettings}
                disabled={eqControlsDisabled}
                className="text-zinc-300"
                graphClassName={cn(
                  'bg-background',
                  isDetachedLayout ? 'h-[clamp(288px,33vh,344px)]' : 'h-[220px]',
                )}
                onLiveChange={handleEqPatchLiveChange}
                onChange={handleEqPatchChange}
              />
            </div>
            {!isCompactLayout ? (
              <EqOutputGainControl
                value={eqOutputGainDb}
                disabled={eqControlsDisabled}
                compact={!isDetachedLayout}
                onLiveChange={(value) => handleEqPatchLiveChange({ audioEqOutputGainDb: value })}
                onChange={(value) => handleEqFieldChange('audioEqOutputGainDb', value)}
              />
            ) : null}
          </div>
        </div>

        {isCompactLayout ? (
          <div className={cn(eqControlsDisabled && 'pointer-events-none opacity-40')}>
            <CompactBandRows
              eqBand1Type={eqBand1Type}
              eqBand1Enabled={eqBand1Enabled}
              eqBand1FrequencyHz={eqBand1FrequencyHz}
              eqBand1GainDb={eqBand1GainDb}
              eqBand1Q={eqBand1Q}
              eqLowType={eqLowType}
              eqLowEnabled={eqLowEnabled}
              eqLowFrequencyHz={eqLowFrequencyHz}
              eqLow={eqLow}
              eqLowQ={eqLowQ}
              lowRange={lowRange}
              eqLowMidType={eqLowMidType}
              eqLowMidEnabled={eqLowMidEnabled}
              eqLowMidFrequencyHz={eqLowMidFrequencyHz}
              eqLowMid={eqLowMid}
              eqLowMidQ={eqLowMidQ}
              lowMidRange={lowMidRange}
              eqHighMidType={eqHighMidType}
              eqHighMidEnabled={eqHighMidEnabled}
              eqHighMidFrequencyHz={eqHighMidFrequencyHz}
              eqHighMid={eqHighMid}
              eqHighMidQ={eqHighMidQ}
              highMidRange={highMidRange}
              eqHighType={eqHighType}
              eqHighEnabled={eqHighEnabled}
              eqHighFrequencyHz={eqHighFrequencyHz}
              eqHigh={eqHigh}
              eqHighQ={eqHighQ}
              highRange={highRange}
              eqBand6Type={eqBand6Type}
              eqBand6Enabled={eqBand6Enabled}
              eqBand6FrequencyHz={eqBand6FrequencyHz}
              eqBand6GainDb={eqBand6GainDb}
              eqBand6Q={eqBand6Q}
              onFieldChange={handleEqFieldChange}
              onLiveChange={handleEqPatchLiveChange}
              portalContainer={portalContainer}
            />
          </div>
        ) : (
          <div
            className={cn(
              isDetachedLayout ? 'space-y-3 p-3' : 'space-y-2 p-2',
              eqControlsDisabled && 'pointer-events-none opacity-40',
            )}
          >
            <div className={cn(isDetachedLayout && 'overflow-x-auto pb-1')}>
              <div
                className={cn(
                  'grid',
                  isDetachedLayout ? 'min-w-[1120px] grid-cols-6 gap-2' : 'grid-cols-6 gap-1',
                )}
              >
                <BandCard
                  title="Band 1"
                  filterType={eqBand1TypeOrDefault}
                  filterOptions={AUDIO_EQ_BAND1_FILTER_OPTIONS}
                  onFilterTypeChange={(value) =>
                    handleEqFieldChange(
                      'audioEqBand1Type',
                      value as (typeof AUDIO_EQ_BAND1_FILTER_OPTIONS)[number],
                    )
                  }
                  portalContainer={portalContainer}
                  compact={!isDetachedLayout}
                  active={eqBand1EnabledOrDefault}
                  onToggle={() =>
                    handleEqFieldChange('audioEqBand1Enabled', !eqBand1EnabledOrDefault)
                  }
                  onReset={() =>
                    handleEqPatchChange({
                      audioEqBand1Enabled: false,
                      audioEqBand1Type: 'high-pass',
                      audioEqBand1FrequencyHz: AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
                      audioEqBand1GainDb: 0,
                      audioEqBand1Q: AUDIO_EQ_LOW_MID_Q,
                      audioEqBand1SlopeDbPerOct: 12,
                    })
                  }
                >
                  <div className="text-[10px] text-zinc-500">Frequency</div>
                  <div className="flex items-center gap-1.5">
                    <NumberInput
                      value={eqBand1FrequencyHz}
                      onChange={(v) => handleEqFieldChange('audioEqBand1FrequencyHz', v)}
                      onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand1FrequencyHz: v })}
                      unit="Hz"
                      min={AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ}
                      max={AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ}
                      step={1}
                      className="flex-1"
                    />
                    <RotaryKnob
                      value={eqBand1FrequencyHz}
                      onChange={(v) => handleEqFieldChange('audioEqBand1FrequencyHz', v)}
                      onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand1FrequencyHz: v })}
                      min={AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ}
                      max={AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ}
                      step={1}
                    />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600">
                    <span>{AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ}</span>
                    <span>{AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ}</span>
                  </div>
                  {eqBand1TypeOrDefault === 'high-pass' ? (
                    <SlopeButtons
                      value={eqBand1SlopeDbPerOct}
                      onChange={(v) => handleEqFieldChange('audioEqBand1SlopeDbPerOct', v)}
                    />
                  ) : (
                    <>
                      <div className="text-[10px] text-zinc-500">Gain</div>
                      <div className="flex items-center gap-1.5">
                        <NumberInput
                          value={eqBand1GainDb}
                          onChange={(v) => handleEqFieldChange('audioEqBand1GainDb', v)}
                          onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand1GainDb: v })}
                          unit="dB"
                          min={AUDIO_EQ_GAIN_DB_MIN}
                          max={AUDIO_EQ_GAIN_DB_MAX}
                          step={0.1}
                          className="flex-1"
                        />
                        <RotaryKnob
                          value={eqBand1GainDb}
                          onChange={(v) => handleEqFieldChange('audioEqBand1GainDb', v)}
                          onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand1GainDb: v })}
                          min={AUDIO_EQ_GAIN_DB_MIN}
                          max={AUDIO_EQ_GAIN_DB_MAX}
                          step={0.1}
                        />
                      </div>
                      <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600">
                        <span>{AUDIO_EQ_GAIN_DB_MIN} dB</span>
                        <span>
                          {AUDIO_EQ_GAIN_DB_MAX > 0
                            ? `+${AUDIO_EQ_GAIN_DB_MAX}`
                            : AUDIO_EQ_GAIN_DB_MAX}
                        </span>
                      </div>
                      {eqBand1TypeOrDefault === 'peaking' ? (
                        <>
                          <div className="text-[10px] text-zinc-500">Q Factor</div>
                          <div className="flex items-center gap-1.5">
                            <NumberInput
                              value={eqBand1Q}
                              onChange={(v) => handleEqFieldChange('audioEqBand1Q', v)}
                              onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand1Q: v })}
                              min={AUDIO_EQ_Q_MIN}
                              max={AUDIO_EQ_Q_MAX}
                              step={0.05}
                              className="flex-1"
                            />
                            <RotaryKnob
                              value={eqBand1Q}
                              onChange={(v) => handleEqFieldChange('audioEqBand1Q', v)}
                              onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand1Q: v })}
                              min={AUDIO_EQ_Q_MIN}
                              max={AUDIO_EQ_Q_MAX}
                              step={0.05}
                            />
                          </div>
                          <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600">
                            <span>{AUDIO_EQ_Q_MIN.toFixed(1)}</span>
                            <span>{AUDIO_EQ_Q_MAX.toFixed(1)}</span>
                          </div>
                        </>
                      ) : null}
                    </>
                  )}
                </BandCard>

                <BandCard
                  title="Band 2"
                  filterType={eqLowTypeOrDefault}
                  filterOptions={AUDIO_EQ_INNER_FILTER_OPTIONS}
                  onFilterTypeChange={(value) =>
                    handleEqFieldChange(
                      'audioEqLowType',
                      value === 'low-pass' || value === 'high-pass' ? 'low-shelf' : value,
                    )
                  }
                  portalContainer={portalContainer}
                  compact={!isDetachedLayout}
                  active={eqLowEnabledOrDefault}
                  onToggle={() => handleEqFieldChange('audioEqLowEnabled', !eqLowEnabledOrDefault)}
                  onReset={() =>
                    handleEqPatchChange({
                      audioEqLowEnabled: true,
                      audioEqLowType: 'low-shelf',
                      audioEqLowFrequencyHz: AUDIO_EQ_LOW_FREQUENCY_HZ,
                      audioEqLowGainDb: 0,
                      audioEqLowQ: AUDIO_EQ_LOW_MID_Q,
                    })
                  }
                >
                  <div className="text-[10px] text-zinc-500">Frequency</div>
                  <div className="flex items-center gap-1.5">
                    <NumberInput
                      value={eqLowFrequencyHz}
                      onChange={(v) => handleEqFieldChange('audioEqLowFrequencyHz', v)}
                      onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowFrequencyHz: v })}
                      unit="Hz"
                      min={lowRange.minFrequencyHz}
                      max={lowRange.maxFrequencyHz}
                      step={1}
                      className="flex-1"
                    />
                    <RotaryKnob
                      value={eqLowFrequencyHz}
                      onChange={(v) => handleEqFieldChange('audioEqLowFrequencyHz', v)}
                      onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowFrequencyHz: v })}
                      min={lowRange.minFrequencyHz}
                      max={lowRange.maxFrequencyHz}
                      step={1}
                    />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600">
                    <span>{formatFrequencyRangeLabel(lowRange.minFrequencyHz)}</span>
                    <span>{formatFrequencyRangeLabel(lowRange.maxFrequencyHz)}</span>
                  </div>
                  {eqLowTypeOrDefault !== 'notch' ? (
                    <>
                      <RangeButtons
                        value={lowRangeId}
                        onChange={(rangeId) =>
                          handleGainBandControlRangeChange(
                            'low',
                            rangeId,
                            'audioEqLowFrequencyHz',
                            eqLowFrequencyHz,
                          )
                        }
                      />
                      <div className="text-[10px] text-zinc-500">Gain</div>
                      <div className="flex items-center gap-1.5">
                        <NumberInput
                          value={eqLow}
                          onChange={(v) => handleEqFieldChange('audioEqLowGainDb', v)}
                          onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowGainDb: v })}
                          unit="dB"
                          min={AUDIO_EQ_GAIN_DB_MIN}
                          max={AUDIO_EQ_GAIN_DB_MAX}
                          step={0.1}
                          className="flex-1"
                        />
                        <RotaryKnob
                          value={eqLow}
                          onChange={(v) => handleEqFieldChange('audioEqLowGainDb', v)}
                          onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowGainDb: v })}
                          min={AUDIO_EQ_GAIN_DB_MIN}
                          max={AUDIO_EQ_GAIN_DB_MAX}
                          step={0.1}
                        />
                      </div>
                      <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600">
                        <span>{AUDIO_EQ_GAIN_DB_MIN} dB</span>
                        <span>
                          {AUDIO_EQ_GAIN_DB_MAX > 0
                            ? `+${AUDIO_EQ_GAIN_DB_MAX}`
                            : AUDIO_EQ_GAIN_DB_MAX}
                        </span>
                      </div>
                      {eqLowTypeOrDefault === 'peaking' ? (
                        <QFactorControl
                          value={eqLowQ}
                          onChange={(v) => handleEqFieldChange('audioEqLowQ', v)}
                          onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowQ: v })}
                        />
                      ) : null}
                    </>
                  ) : null}
                </BandCard>

                <BandCard
                  title="Band 3"
                  filterType={eqLowMidTypeOrDefault}
                  filterOptions={AUDIO_EQ_INNER_FILTER_OPTIONS}
                  onFilterTypeChange={(value) =>
                    handleEqFieldChange(
                      'audioEqLowMidType',
                      value === 'low-pass' || value === 'high-pass' ? 'peaking' : value,
                    )
                  }
                  portalContainer={portalContainer}
                  compact={!isDetachedLayout}
                  active={eqLowMidEnabledOrDefault}
                  onToggle={() =>
                    handleEqFieldChange('audioEqLowMidEnabled', !eqLowMidEnabledOrDefault)
                  }
                  onReset={() =>
                    handleEqPatchChange({
                      audioEqLowMidEnabled: true,
                      audioEqLowMidType: 'peaking',
                      audioEqLowMidFrequencyHz: AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
                      audioEqLowMidGainDb: 0,
                      audioEqLowMidQ: AUDIO_EQ_LOW_MID_Q,
                    })
                  }
                >
                  <div className="text-[10px] text-zinc-500">Frequency</div>
                  <div className="flex items-center gap-1.5">
                    <NumberInput
                      value={eqLowMidFrequencyHz}
                      onChange={(v) => handleEqFieldChange('audioEqLowMidFrequencyHz', v)}
                      onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowMidFrequencyHz: v })}
                      unit="Hz"
                      min={lowMidRange.minFrequencyHz}
                      max={lowMidRange.maxFrequencyHz}
                      step={1}
                      className="flex-1"
                    />
                    <RotaryKnob
                      value={eqLowMidFrequencyHz}
                      onChange={(v) => handleEqFieldChange('audioEqLowMidFrequencyHz', v)}
                      onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowMidFrequencyHz: v })}
                      min={lowMidRange.minFrequencyHz}
                      max={lowMidRange.maxFrequencyHz}
                      step={1}
                    />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600">
                    <span>{formatFrequencyRangeLabel(lowMidRange.minFrequencyHz)}</span>
                    <span>{formatFrequencyRangeLabel(lowMidRange.maxFrequencyHz)}</span>
                  </div>
                  {eqLowMidTypeOrDefault !== 'notch' ? (
                    <>
                      <RangeButtons
                        value={lowMidRangeId}
                        onChange={(rangeId) =>
                          handleGainBandControlRangeChange(
                            'lowMid',
                            rangeId,
                            'audioEqLowMidFrequencyHz',
                            eqLowMidFrequencyHz,
                          )
                        }
                      />
                      <div className="text-[10px] text-zinc-500">Gain</div>
                      <div className="flex items-center gap-1.5">
                        <NumberInput
                          value={eqLowMid}
                          onChange={(v) => handleEqFieldChange('audioEqLowMidGainDb', v)}
                          onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowMidGainDb: v })}
                          unit="dB"
                          min={AUDIO_EQ_GAIN_DB_MIN}
                          max={AUDIO_EQ_GAIN_DB_MAX}
                          step={0.1}
                          className="flex-1"
                        />
                        <RotaryKnob
                          value={eqLowMid}
                          onChange={(v) => handleEqFieldChange('audioEqLowMidGainDb', v)}
                          onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowMidGainDb: v })}
                          min={AUDIO_EQ_GAIN_DB_MIN}
                          max={AUDIO_EQ_GAIN_DB_MAX}
                          step={0.1}
                        />
                      </div>
                      <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600">
                        <span>{AUDIO_EQ_GAIN_DB_MIN} dB</span>
                        <span>
                          {AUDIO_EQ_GAIN_DB_MAX > 0
                            ? `+${AUDIO_EQ_GAIN_DB_MAX}`
                            : AUDIO_EQ_GAIN_DB_MAX}
                        </span>
                      </div>
                      {eqLowMidTypeOrDefault === 'peaking' ? (
                        <QFactorControl
                          value={eqLowMidQ}
                          onChange={(v) => handleEqFieldChange('audioEqLowMidQ', v)}
                          onLiveChange={(v) => handleEqPatchLiveChange({ audioEqLowMidQ: v })}
                        />
                      ) : null}
                    </>
                  ) : null}
                </BandCard>

                <BandCard
                  title="Band 4"
                  filterType={eqHighMidTypeOrDefault}
                  filterOptions={AUDIO_EQ_INNER_FILTER_OPTIONS}
                  onFilterTypeChange={(value) =>
                    handleEqFieldChange(
                      'audioEqHighMidType',
                      value === 'low-pass' || value === 'high-pass' ? 'peaking' : value,
                    )
                  }
                  portalContainer={portalContainer}
                  compact={!isDetachedLayout}
                  active={eqHighMidEnabledOrDefault}
                  onToggle={() =>
                    handleEqFieldChange('audioEqHighMidEnabled', !eqHighMidEnabledOrDefault)
                  }
                  onReset={() =>
                    handleEqPatchChange({
                      audioEqHighMidEnabled: true,
                      audioEqHighMidType: 'peaking',
                      audioEqHighMidFrequencyHz: AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
                      audioEqHighMidGainDb: 0,
                      audioEqHighMidQ: AUDIO_EQ_HIGH_MID_Q,
                    })
                  }
                >
                  <div className="text-[10px] text-zinc-500">Frequency</div>
                  <div className="flex items-center gap-1.5">
                    <NumberInput
                      value={eqHighMidFrequencyHz}
                      onChange={(v) => handleEqFieldChange('audioEqHighMidFrequencyHz', v)}
                      onLiveChange={(v) =>
                        handleEqPatchLiveChange({ audioEqHighMidFrequencyHz: v })
                      }
                      unit="Hz"
                      min={highMidRange.minFrequencyHz}
                      max={highMidRange.maxFrequencyHz}
                      step={1}
                      className="flex-1"
                    />
                    <RotaryKnob
                      value={eqHighMidFrequencyHz}
                      onChange={(v) => handleEqFieldChange('audioEqHighMidFrequencyHz', v)}
                      onLiveChange={(v) =>
                        handleEqPatchLiveChange({ audioEqHighMidFrequencyHz: v })
                      }
                      min={highMidRange.minFrequencyHz}
                      max={highMidRange.maxFrequencyHz}
                      step={1}
                    />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600">
                    <span>{formatFrequencyRangeLabel(highMidRange.minFrequencyHz)}</span>
                    <span>{formatFrequencyRangeLabel(highMidRange.maxFrequencyHz)}</span>
                  </div>
                  {eqHighMidTypeOrDefault !== 'notch' ? (
                    <>
                      <RangeButtons
                        value={highMidRangeId}
                        onChange={(rangeId) =>
                          handleGainBandControlRangeChange(
                            'highMid',
                            rangeId,
                            'audioEqHighMidFrequencyHz',
                            eqHighMidFrequencyHz,
                          )
                        }
                      />
                      <div className="text-[10px] text-zinc-500">Gain</div>
                      <div className="flex items-center gap-1.5">
                        <NumberInput
                          value={eqHighMid}
                          onChange={(v) => handleEqFieldChange('audioEqHighMidGainDb', v)}
                          onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighMidGainDb: v })}
                          unit="dB"
                          min={AUDIO_EQ_GAIN_DB_MIN}
                          max={AUDIO_EQ_GAIN_DB_MAX}
                          step={0.1}
                          className="flex-1"
                        />
                        <RotaryKnob
                          value={eqHighMid}
                          onChange={(v) => handleEqFieldChange('audioEqHighMidGainDb', v)}
                          onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighMidGainDb: v })}
                          min={AUDIO_EQ_GAIN_DB_MIN}
                          max={AUDIO_EQ_GAIN_DB_MAX}
                          step={0.1}
                        />
                      </div>
                      <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600">
                        <span>{AUDIO_EQ_GAIN_DB_MIN} dB</span>
                        <span>
                          {AUDIO_EQ_GAIN_DB_MAX > 0
                            ? `+${AUDIO_EQ_GAIN_DB_MAX}`
                            : AUDIO_EQ_GAIN_DB_MAX}
                        </span>
                      </div>
                      {eqHighMidTypeOrDefault === 'peaking' ? (
                        <QFactorControl
                          value={eqHighMidQ}
                          onChange={(v) => handleEqFieldChange('audioEqHighMidQ', v)}
                          onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighMidQ: v })}
                        />
                      ) : null}
                    </>
                  ) : null}
                </BandCard>

                <BandCard
                  title="Band 5"
                  filterType={eqHighTypeOrDefault}
                  filterOptions={AUDIO_EQ_INNER_FILTER_OPTIONS}
                  onFilterTypeChange={(value) =>
                    handleEqFieldChange(
                      'audioEqHighType',
                      value === 'low-pass' || value === 'high-pass' ? 'high-shelf' : value,
                    )
                  }
                  portalContainer={portalContainer}
                  compact={!isDetachedLayout}
                  active={eqHighEnabledOrDefault}
                  onToggle={() =>
                    handleEqFieldChange('audioEqHighEnabled', !eqHighEnabledOrDefault)
                  }
                  onReset={() =>
                    handleEqPatchChange({
                      audioEqHighEnabled: true,
                      audioEqHighType: 'high-shelf',
                      audioEqHighFrequencyHz: AUDIO_EQ_HIGH_FREQUENCY_HZ,
                      audioEqHighGainDb: 0,
                      audioEqHighQ: AUDIO_EQ_HIGH_MID_Q,
                    })
                  }
                >
                  <div className="text-[10px] text-zinc-500">Frequency</div>
                  <div className="flex items-center gap-1.5">
                    <NumberInput
                      value={eqHighFrequencyHz}
                      onChange={(v) => handleEqFieldChange('audioEqHighFrequencyHz', v)}
                      onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighFrequencyHz: v })}
                      unit="Hz"
                      min={highRange.minFrequencyHz}
                      max={highRange.maxFrequencyHz}
                      step={1}
                      className="flex-1"
                    />
                    <RotaryKnob
                      value={eqHighFrequencyHz}
                      onChange={(v) => handleEqFieldChange('audioEqHighFrequencyHz', v)}
                      onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighFrequencyHz: v })}
                      min={highRange.minFrequencyHz}
                      max={highRange.maxFrequencyHz}
                      step={1}
                    />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600">
                    <span>{formatFrequencyRangeLabel(highRange.minFrequencyHz)}</span>
                    <span>{formatFrequencyRangeLabel(highRange.maxFrequencyHz)}</span>
                  </div>
                  {eqHighTypeOrDefault !== 'notch' ? (
                    <>
                      <RangeButtons
                        value={highRangeId}
                        onChange={(rangeId) =>
                          handleGainBandControlRangeChange(
                            'high',
                            rangeId,
                            'audioEqHighFrequencyHz',
                            eqHighFrequencyHz,
                          )
                        }
                      />
                      <div className="text-[10px] text-zinc-500">Gain</div>
                      <div className="flex items-center gap-1.5">
                        <NumberInput
                          value={eqHigh}
                          onChange={(v) => handleEqFieldChange('audioEqHighGainDb', v)}
                          onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighGainDb: v })}
                          unit="dB"
                          min={AUDIO_EQ_GAIN_DB_MIN}
                          max={AUDIO_EQ_GAIN_DB_MAX}
                          step={0.1}
                          className="flex-1"
                        />
                        <RotaryKnob
                          value={eqHigh}
                          onChange={(v) => handleEqFieldChange('audioEqHighGainDb', v)}
                          onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighGainDb: v })}
                          min={AUDIO_EQ_GAIN_DB_MIN}
                          max={AUDIO_EQ_GAIN_DB_MAX}
                          step={0.1}
                        />
                      </div>
                      <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600">
                        <span>{AUDIO_EQ_GAIN_DB_MIN} dB</span>
                        <span>
                          {AUDIO_EQ_GAIN_DB_MAX > 0
                            ? `+${AUDIO_EQ_GAIN_DB_MAX}`
                            : AUDIO_EQ_GAIN_DB_MAX}
                        </span>
                      </div>
                      {eqHighTypeOrDefault === 'peaking' ? (
                        <QFactorControl
                          value={eqHighQ}
                          onChange={(v) => handleEqFieldChange('audioEqHighQ', v)}
                          onLiveChange={(v) => handleEqPatchLiveChange({ audioEqHighQ: v })}
                        />
                      ) : null}
                    </>
                  ) : null}
                </BandCard>

                <BandCard
                  title="Band 6"
                  filterType={eqBand6TypeOrDefault}
                  filterOptions={AUDIO_EQ_BAND6_FILTER_OPTIONS}
                  onFilterTypeChange={(value) =>
                    handleEqFieldChange(
                      'audioEqBand6Type',
                      value === 'high-pass' || value === 'notch' ? 'low-pass' : value,
                    )
                  }
                  portalContainer={portalContainer}
                  compact={!isDetachedLayout}
                  active={eqBand6EnabledOrDefault}
                  onToggle={() =>
                    handleEqFieldChange('audioEqBand6Enabled', !eqBand6EnabledOrDefault)
                  }
                  onReset={() =>
                    handleEqPatchChange({
                      audioEqBand6Enabled: false,
                      audioEqBand6Type: 'low-pass',
                      audioEqBand6FrequencyHz: AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
                      audioEqBand6GainDb: 0,
                      audioEqBand6Q: AUDIO_EQ_HIGH_MID_Q,
                      audioEqBand6SlopeDbPerOct: 12,
                    })
                  }
                >
                  <div className="text-[10px] text-zinc-500">Frequency</div>
                  <div className="flex items-center gap-1.5">
                    <NumberInput
                      value={eqBand6FrequencyHz}
                      onChange={(v) => handleEqFieldChange('audioEqBand6FrequencyHz', v)}
                      onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand6FrequencyHz: v })}
                      unit="Hz"
                      min={AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ}
                      max={AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ}
                      step={1}
                      className="flex-1"
                    />
                    <RotaryKnob
                      value={eqBand6FrequencyHz}
                      onChange={(v) => handleEqFieldChange('audioEqBand6FrequencyHz', v)}
                      onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand6FrequencyHz: v })}
                      min={AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ}
                      max={AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ}
                      step={1}
                    />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600">
                    <span>1.4K</span>
                    <span>22.0K</span>
                  </div>
                  {eqBand6TypeOrDefault === 'low-pass' ? (
                    <SlopeButtons
                      value={eqBand6SlopeDbPerOct}
                      onChange={(v) => handleEqFieldChange('audioEqBand6SlopeDbPerOct', v)}
                    />
                  ) : (
                    <>
                      <div className="text-[10px] text-zinc-500">Gain</div>
                      <div className="flex items-center gap-1.5">
                        <NumberInput
                          value={eqBand6GainDb}
                          onChange={(v) => handleEqFieldChange('audioEqBand6GainDb', v)}
                          onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand6GainDb: v })}
                          unit="dB"
                          min={AUDIO_EQ_GAIN_DB_MIN}
                          max={AUDIO_EQ_GAIN_DB_MAX}
                          step={0.1}
                          className="flex-1"
                        />
                        <RotaryKnob
                          value={eqBand6GainDb}
                          onChange={(v) => handleEqFieldChange('audioEqBand6GainDb', v)}
                          onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand6GainDb: v })}
                          min={AUDIO_EQ_GAIN_DB_MIN}
                          max={AUDIO_EQ_GAIN_DB_MAX}
                          step={0.1}
                        />
                      </div>
                      <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600">
                        <span>{AUDIO_EQ_GAIN_DB_MIN} dB</span>
                        <span>
                          {AUDIO_EQ_GAIN_DB_MAX > 0
                            ? `+${AUDIO_EQ_GAIN_DB_MAX}`
                            : AUDIO_EQ_GAIN_DB_MAX}
                        </span>
                      </div>
                      {eqBand6TypeOrDefault === 'peaking' ? (
                        <>
                          <div className="text-[10px] text-zinc-500">Q Factor</div>
                          <div className="flex items-center gap-1.5">
                            <NumberInput
                              value={eqBand6Q}
                              onChange={(v) => handleEqFieldChange('audioEqBand6Q', v)}
                              onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand6Q: v })}
                              min={AUDIO_EQ_Q_MIN}
                              max={AUDIO_EQ_Q_MAX}
                              step={0.05}
                              className="flex-1"
                            />
                            <RotaryKnob
                              value={eqBand6Q}
                              onChange={(v) => handleEqFieldChange('audioEqBand6Q', v)}
                              onLiveChange={(v) => handleEqPatchLiveChange({ audioEqBand6Q: v })}
                              min={AUDIO_EQ_Q_MIN}
                              max={AUDIO_EQ_Q_MAX}
                              step={0.05}
                            />
                          </div>
                          <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600">
                            <span>{AUDIO_EQ_Q_MIN.toFixed(1)}</span>
                            <span>{AUDIO_EQ_Q_MAX.toFixed(1)}</span>
                          </div>
                        </>
                      ) : null}
                    </>
                  )}
                </BandCard>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
