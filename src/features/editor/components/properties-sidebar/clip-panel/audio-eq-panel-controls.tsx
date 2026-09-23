import { useCallback, useState, type ReactNode } from 'react'
import { ChevronDown, RotateCcw } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/shared/ui/cn'
import {
  AUDIO_EQ_GAIN_DB_MAX,
  AUDIO_EQ_GAIN_DB_MIN,
  AUDIO_EQ_Q_MAX,
  AUDIO_EQ_Q_MIN,
} from '@/shared/utils/audio-eq'
import { NumberInput } from '../components'
import { RotaryKnob } from '@/shared/ui/property-controls/rotary-knob'
import { demixValue } from '../utils/mixed-value'
import { formatOutputGainDb, roundOutputGainDb } from './audio-eq-panel-values'
import {
  AUDIO_EQ_CONTROL_RANGES,
  AUDIO_EQ_FILTER_TYPE_LABELS,
  AUDIO_EQ_FILTER_TYPE_PATHS,
  AUDIO_EQ_SLOPE_OPTIONS,
  type AudioEqControlRangeId,
  type AudioEqFilterType,
} from './audio-eq-ui'

export type FilterType = AudioEqFilterType

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

export function FilterTypeSelect({
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

export function SlopeButtons({
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

export function RangeButtons({
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

export function QFactorControl({
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

export function EqOutputGainControl({
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

const BAND_CARD_CHROME = {
  full: {
    header: 'gap-1.5 px-2 py-2',
    titleRow: 'gap-1.5',
    titleMinWidth: 'min-w-[3.55rem] px-1.5',
    resetButton: 'h-5 w-5',
    resetIcon: 'h-3 w-3',
    body: 'gap-2 p-2',
  },
  compact: {
    header: 'gap-1 px-1.5 py-1.5',
    titleRow: 'gap-1',
    titleMinWidth: 'min-w-[3.05rem] px-1',
    resetButton: 'h-4 w-4',
    resetIcon: 'h-2.5 w-2.5',
    body: 'gap-1.5 p-1.5',
  },
} as const

/**
 * Band name pill: a toggle while the band can be switched off, otherwise a
 * static active label.
 */
function BandTitlePill({
  title,
  active,
  onToggle,
  compact,
}: {
  title: string
  active: boolean
  onToggle?: () => void
  compact: boolean
}) {
  const chrome = compact ? BAND_CARD_CHROME.compact : BAND_CARD_CHROME.full
  if (onToggle) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'inline-flex h-5 shrink-0 items-center justify-center whitespace-nowrap rounded-full py-0.5 text-[9px] font-semibold leading-none transition-colors',
          chrome.titleMinWidth,
          active
            ? 'bg-primary text-primary-foreground'
            : 'bg-secondary/40 text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
        )}
      >
        {title}
      </button>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-primary py-0.5 text-[9px] font-semibold leading-none text-primary-foreground',
        chrome.titleMinWidth,
      )}
    >
      {title}
    </span>
  )
}

/** Band filter-type cell: a dropdown when the band's type is editable. */
function BandFilterCell({
  filterType,
  filterOptions,
  onFilterTypeChange,
  portalContainer,
}: {
  filterType: FilterType
  filterOptions?: ReadonlyArray<FilterType>
  onFilterTypeChange?: (value: FilterType) => void
  portalContainer?: HTMLElement | null
}) {
  if (filterOptions && onFilterTypeChange) {
    return (
      <FilterTypeSelect
        value={filterType}
        options={filterOptions}
        onChange={onFilterTypeChange}
        portalContainer={portalContainer}
      />
    )
  }
  return (
    <div className="flex h-6 items-center rounded-[4px] border border-border bg-background px-1.5 text-muted-foreground">
      <FilterTypeGlyph type={filterType} />
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

export function BandCard({
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
  const chrome = compact ? BAND_CARD_CHROME.compact : BAND_CARD_CHROME.full
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
          chrome.header,
        )}
      >
        <div className={cn('flex min-w-0 items-center overflow-hidden', chrome.titleRow)}>
          <BandTitlePill title={title} active={active} onToggle={onToggle} compact={compact} />
          <div className="shrink-0">
            <BandFilterCell
              filterType={filterType}
              filterOptions={filterOptions}
              onFilterTypeChange={onFilterTypeChange}
              portalContainer={portalContainer}
            />
          </div>
        </div>
        <button
          type="button"
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-[3px] text-zinc-600 transition-colors hover:bg-white/5 hover:text-zinc-300',
            chrome.resetButton,
          )}
          onClick={onReset}
          aria-label={`Reset ${title}`}
          title={`Reset ${title}`}
        >
          <RotateCcw className={chrome.resetIcon} />
        </button>
      </div>
      <div className={cn('flex flex-1 flex-col', chrome.body)}>{children}</div>
    </section>
  )
}
