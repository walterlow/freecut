import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { Pipette, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import { KeyframeToggle } from '@/features/effects/deps/keyframes-contract'
import { PropertyRow, SliderInput } from '@/shared/ui/property-controls'
import { cn } from '@/shared/ui/cn'
import { getEffectDefinitionName, getEffectParamLabel } from '@/features/effects/utils/effect-i18n'
import {
  hueAmountFromWheelChannels,
  wheelChannelsFromHueAmount,
  type WheelChannels,
} from '@/features/effects/utils/wheel-channels'
import {
  autoBalanceFromFrame,
  blackPointFromPick,
  hexToRgb01,
  luma601,
  whiteBalanceFromPick,
  whitePointFromPick,
} from '@/features/effects/utils/wheel-pickers'
import { EffectPanelHeaderRow } from './effect-panel-header-actions'
import type { GpuKeyframePanelProps, GpuParamUpdates } from './panel-props'
import type { GpuEffectDefinition } from '@/infrastructure/gpu-effects'

interface GpuWheelsPanelProps extends GpuKeyframePanelProps {
  layout?: 'sidebar' | 'dock'
  onParamsBatchChange: (effectId: string, updates: GpuParamUpdates) => void
  onParamsBatchLiveChange: (effectId: string, updates: GpuParamUpdates) => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// Chrome's EyeDropper API (no lib.dom types yet) — used by the white
// balance and black/white point pickers to sample the graded preview.
interface EyeDropperApi {
  open: () => Promise<{ sRGBHex: string }>
}

function getEyeDropperCtor(): (new () => EyeDropperApi) | null {
  if (typeof window === 'undefined' || !('EyeDropper' in window)) return null
  return (window as unknown as { EyeDropper: new () => EyeDropperApi }).EyeDropper
}

async function pickScreenColor(): Promise<{ r: number; g: number; b: number } | null> {
  const EyeDropperCtor = getEyeDropperCtor()
  if (!EyeDropperCtor) return null
  try {
    const { sRGBHex } = await new EyeDropperCtor().open()
    return hexToRgb01(sRGBHex)
  } catch {
    return null // user cancelled the picker
  }
}

const MAX_WHEEL_SIZE = 100
const MAX_DOCK_WHEEL_SIZE = 200
const MIN_WHEEL_SIZE = 64
const MIN_DOCK_WHEEL_SIZE = 48
const GRID_GAP_PX = 4
const DOCK_WHEEL_GRID_GAP_PX = 28
// Vertical space each dock wheel column needs besides the wheel itself:
// header (20) + column gaps (2x8) + value chips with accents (24) + thumb wheel (16)
const DOCK_WHEEL_EXTRAS_PX = 76
const PUCK_RADIUS_PX = 4
// Outer master ring (dock): a fill gauge like Resolve's. A bright metallic
// ring sits under a pure-black cover that is revealed clockwise from 12
// o'clock proportionally to the master value — fully black at the range
// minimum, the full ring at the maximum.
const DOCK_RING_THICKNESS = 5
const DOCK_RING_GAP = 3
const DOCK_RING_INSET = DOCK_RING_THICKNESS + DOCK_RING_GAP
const DOCK_RING_COVER_COLOR = '#060607'
const DOCK_RING_METAL_GRADIENT = 'linear-gradient(180deg, #8b8b92 0%, #e4e4e9 55%, #f8f8fa 100%)'

// Hue 0 sits on the +x axis to match getHueAmountFromClient's atan2 mapping.
const WHEEL_HUE_CONIC =
  'conic-gradient(from 90deg, #ff3b30, #ff9500, #ffcc00, #34c759, #00c7be, #007aff, #5856d6, #ff2d55, #ff3b30)'
// Resolve-style disc: heavily dimmed hue field inside, saturated rim band.
const DOCK_DISC_BACKGROUND = `radial-gradient(circle closest-side, rgba(19,19,22,0.94) 0%, rgba(19,19,22,0.9) 62%, rgba(19,19,22,0.72) 80%, rgba(19,19,22,0.25) 88%, transparent 94%), ${WHEEL_HUE_CONIC}`
const SIDEBAR_DISC_BACKGROUND = `radial-gradient(circle at center, hsl(0 0% 18%) 0%, hsl(0 0% 10%) 26%, transparent 28%), ${WHEEL_HUE_CONIC}`

function getHueAmountFromClient(clientX: number, clientY: number, element: HTMLButtonElement) {
  const rect = element.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const dx = clientX - cx
  const dy = clientY - cy
  const dist = Math.sqrt(dx * dx + dy * dy)
  const trackRadius = Math.max(1, rect.width / 2 - PUCK_RADIUS_PX - 1)
  const amount = clamp(dist / trackRadius, 0, 1)
  const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
  return { hue, amount }
}

interface WheelControlProps {
  label: string
  hue: number
  amount: number
  size: number
  disabled: boolean
  compact?: boolean
  dock?: boolean
  dockFields?: React.ReactNode
  /** Master ring fill 0..1 — fraction of the bright ring revealed (dock only). */
  masterRingFill?: number
  /** Anchor angle (deg from 12 o'clock) where the ring reveal starts. */
  masterRingFromDeg?: number
  onLiveChange: (hue: number, amount: number) => void
  onCommit: (hue: number, amount: number) => void
  onReset: () => void
}

function wrapHue(hue: number): number {
  return ((hue % 360) + 360) % 360
}

const KEYBOARD_WHEEL_ACTIONS = {
  ArrowLeft: (hue: number, amount: number) => [hue - 1, amount],
  ArrowRight: (hue: number, amount: number) => [hue + 1, amount],
  ArrowDown: (hue: number, amount: number) => [hue, amount - 0.01],
  ArrowUp: (hue: number, amount: number) => [hue, amount + 0.01],
  Home: (hue: number) => [hue, 0],
  End: (hue: number) => [hue, 1],
} satisfies Record<string, (hue: number, amount: number) => [number, number]>

function getKeyboardWheelTarget(key: string, hue: number, amount: number): [number, number] | null {
  return KEYBOARD_WHEEL_ACTIONS[key as keyof typeof KEYBOARD_WHEEL_ACTIONS]?.(hue, amount) ?? null
}

function readNumberParam(
  definition: GpuEffectDefinition,
  params: Record<string, number | boolean | string>,
  key: string,
  fallback = 0,
) {
  const value = params[key]
  const defaultValue = definition.params[key]?.default
  if (typeof value === 'number') return value
  if (typeof defaultValue === 'number') return defaultValue
  return fallback
}

function clampParamValue(param: GpuEffectDefinition['params'][string] | undefined, value: number) {
  const min = typeof param?.min === 'number' ? param.min : value
  const max = typeof param?.max === 'number' ? param.max : value
  return clamp(value, min, max)
}

function DockWheelHeader({
  dock,
  label,
  resetLabel,
  disabled,
  onReset,
}: {
  dock: boolean
  label: string
  resetLabel: string
  disabled: boolean
  onReset: () => void
}) {
  if (!dock) return null
  return (
    <div className="flex h-5 w-full items-center justify-center gap-1">
      <span className="truncate text-[11px] font-semibold text-foreground">{label}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 text-muted-foreground"
        onClick={onReset}
        disabled={disabled}
        title={resetLabel}
        aria-label={resetLabel}
      >
        <RotateCcw className="h-3 w-3" />
      </Button>
    </div>
  )
}

function DockWheelCrosshair({ dock }: { dock: boolean }) {
  if (!dock) return null
  return (
    <>
      <span className="absolute left-1/2 top-[3%] h-[94%] w-px -translate-x-1/2 bg-white/15" />
      <span className="absolute left-[3%] top-1/2 h-px w-[94%] -translate-y-1/2 bg-white/15" />
    </>
  )
}

function SidebarWheelReadout({
  dock,
  label,
  hue,
  amount,
}: {
  dock: boolean
  label: string
  hue: number
  amount: number
}) {
  if (dock) return null
  return (
    <>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-[10px] font-mono text-muted-foreground">
        {Math.round(hue)} deg | {Math.round(amount * 100)}%
      </div>
    </>
  )
}

function SidebarResetButton({
  compact,
  dock,
  resetLabel,
  disabled,
  onReset,
}: {
  compact: boolean
  dock: boolean
  resetLabel: string
  disabled: boolean
  onReset: () => void
}) {
  if (compact || dock) return null
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-5 w-5"
      onClick={onReset}
      disabled={disabled}
      title={resetLabel}
      aria-label={resetLabel}
    >
      <RotateCcw className="w-3 h-3" />
    </Button>
  )
}

const WheelControl = memo(function WheelControl({
  label,
  hue,
  amount,
  size,
  disabled,
  compact = false,
  dock = false,
  dockFields,
  masterRingFill = 0,
  masterRingFromDeg = 0,
  onLiveChange,
  onCommit,
  onReset,
}: WheelControlProps) {
  const { t } = useTranslation()
  const wheelRef = useRef<HTMLButtonElement>(null)
  const [dragging, setDragging] = useState(false)
  const [localHue, setLocalHue] = useState(hue)
  const [localAmount, setLocalAmount] = useState(clamp(amount, 0, 1))

  useEffect(() => {
    if (!dragging) {
      setLocalHue(hue)
      setLocalAmount(clamp(amount, 0, 1))
    }
  }, [amount, dragging, hue])

  const updateFromPointer = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const el = wheelRef.current
      if (!el) return null
      const next = getHueAmountFromClient(event.clientX, event.clientY, el)
      setLocalHue(next.hue)
      setLocalAmount(next.amount)
      onLiveChange(next.hue, next.amount)
      return next
    },
    [onLiveChange],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled) return
      const el = wheelRef.current
      if (!el) return
      el.setPointerCapture(event.pointerId)
      setDragging(true)
      updateFromPointer(event)
    },
    [disabled, updateFromPointer],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled || !dragging) return
      updateFromPointer(event)
    },
    [disabled, dragging, updateFromPointer],
  )

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled || !dragging) return
      const next = updateFromPointer(event)
      if (next) {
        onCommit(next.hue, next.amount)
      } else {
        onCommit(localHue, localAmount)
      }
      setDragging(false)
    },
    [disabled, dragging, localAmount, localHue, onCommit, updateFromPointer],
  )

  const handlePointerCancel = useCallback(() => {
    if (!dragging) return
    onCommit(localHue, localAmount)
    setDragging(false)
  }, [dragging, localAmount, localHue, onCommit])

  const commitKeyboardChange = useCallback(
    (nextHue: number, nextAmount: number) => {
      const normalizedHue = wrapHue(nextHue)
      const normalizedAmount = clamp(nextAmount, 0, 1)
      setLocalHue(normalizedHue)
      setLocalAmount(normalizedAmount)
      onLiveChange(normalizedHue, normalizedAmount)
      onCommit(normalizedHue, normalizedAmount)
    },
    [onCommit, onLiveChange],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return
      const target = getKeyboardWheelTarget(event.key, localHue, localAmount)
      if (!target) return
      event.preventDefault()
      commitKeyboardChange(target[0], target[1])
    },
    [commitKeyboardChange, disabled, localAmount, localHue],
  )

  // In the dock the disc sits inside the master ring, so the interactive
  // wheel shrinks by the ring inset on each side.
  const discSize = dock ? size - DOCK_RING_INSET * 2 : size
  const displayTrackRadius = discSize / 2 - PUCK_RADIUS_PX - 1
  const puckX = Math.cos((localHue * Math.PI) / 180) * (displayTrackRadius * localAmount)
  const puckY = Math.sin((localHue * Math.PI) / 180) * (displayTrackRadius * localAmount)
  const resetLabel = t('effects.wheels.resetWheel', { name: label })

  const wheelButton = (
    <button
      ref={wheelRef}
      type="button"
      disabled={disabled}
      aria-disabled={disabled}
      aria-label={t('effects.wheels.adjustWheel', {
        name: label,
        defaultValue: `Adjust ${label} wheel`,
      })}
      className={`relative rounded-full border border-border/70 ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-crosshair'}`}
      style={{
        width: `${discSize}px`,
        height: `${discSize}px`,
        touchAction: 'none',
        boxShadow: dock ? 'inset 0 0 0 1px rgba(255,255,255,0.07)' : undefined,
        backgroundImage: dock ? DOCK_DISC_BACKGROUND : SIDEBAR_DISC_BACKGROUND,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
    >
      <DockWheelCrosshair dock={dock} />
      <div
        className="absolute rounded-full border border-black/60 shadow-sm"
        style={{
          width: `${PUCK_RADIUS_PX * 2}px`,
          height: `${PUCK_RADIUS_PX * 2}px`,
          background: '#f8fafc',
          left: '50%',
          top: '50%',
          transform: `translate(-50%, -50%) translate(${puckX}px, ${puckY}px)`,
        }}
      />
    </button>
  )

  // Donut mask leaves only the outer ring band visible. The black cover
  // (top conic layer) shrinks as the fill grows, revealing the metallic
  // ring clockwise from 12 o'clock.
  const ringMask = `radial-gradient(closest-side, transparent calc(100% - ${DOCK_RING_THICKNESS}px), #000 calc(100% - ${DOCK_RING_THICKNESS - 1}px))`
  const revealDeg = clamp(masterRingFill, 0, 1) * 360

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col items-center',
        dock ? 'gap-2' : 'gap-1',
        compact && 'gap-0.5',
      )}
    >
      <DockWheelHeader
        dock={dock}
        label={label}
        resetLabel={resetLabel}
        disabled={disabled}
        onReset={onReset}
      />
      {dock ? (
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <div
            aria-hidden="true"
            className="absolute inset-0 rounded-full"
            style={{
              background: `conic-gradient(from ${masterRingFromDeg}deg, transparent 0deg ${Math.max(0, revealDeg - 2)}deg, ${DOCK_RING_COVER_COLOR} ${revealDeg}deg 360deg), ${DOCK_RING_METAL_GRADIENT}`,
              WebkitMask: ringMask,
              mask: ringMask,
            }}
          />
          <div className="absolute" style={{ left: DOCK_RING_INSET, top: DOCK_RING_INSET }}>
            {wheelButton}
          </div>
        </div>
      ) : (
        wheelButton
      )}
      <SidebarWheelReadout dock={dock} label={label} hue={localHue} amount={localAmount} />
      {dock && dockFields}
      <SidebarResetButton
        compact={compact}
        dock={dock}
        resetLabel={resetLabel}
        disabled={disabled}
        onReset={onReset}
      />
    </div>
  )
})

const WHEEL_DESCRIPTORS = [
  { labelKey: 'effects.wheels.shadows', hueKey: 'shadowsHue', amountKey: 'shadowsAmount' },
  { labelKey: 'effects.wheels.midtones', hueKey: 'midtonesHue', amountKey: 'midtonesAmount' },
  { labelKey: 'effects.wheels.highlights', hueKey: 'highlightsHue', amountKey: 'highlightsAmount' },
] as const

/**
 * Affine mapping between the stored shader param and the Resolve-style
 * display units shown in the dock fields: display = param * scale + bias.
 * Lift/gain read in native units, gamma reads 0-centered (param - 1), and
 * offset reads as Resolve's 25-anchored scale (-175..225 for param ±2).
 */
interface WheelDisplay {
  scale: number
  bias: number
  step: number
  /** Display precision override; defaults to the step's decimals. */
  decimals?: number
}

function toWheelDisplay(display: WheelDisplay, value: number): number {
  return value * display.scale + display.bias
}

function fromWheelDisplay(display: WheelDisplay, value: number): number {
  return (value - display.bias) / display.scale
}

function formatWheelDisplayValue(display: WheelDisplay, value: number): string {
  return value.toFixed(display.decimals ?? getParamDecimals(display.step))
}

// Resolve-style scales and precision for the dock parameter rows: Temp reads
// in the +/-4000 scale, Contrast/Pivot at 3 decimals, Saturation 0..100
// anchored at 50 (param is -100..100).
const DOCK_PARAM_DISPLAY: Record<string, WheelDisplay> = {
  temperature: { scale: 40, bias: 0, step: 10, decimals: 1 },
  tint: { scale: 1, bias: 0, step: 0.1, decimals: 2 },
  contrast: { scale: 1, bias: 0, step: 0.005, decimals: 3 },
  pivot: { scale: 1, bias: 0, step: 0.005, decimals: 3 },
  midDetail: { scale: 1, bias: 0, step: 0.5, decimals: 2 },
  colorBoost: { scale: 1, bias: 0, step: 0.5, decimals: 2 },
  shadows: { scale: 1, bias: 0, step: 0.5, decimals: 2 },
  highlights: { scale: 1, bias: 0, step: 0.5, decimals: 2 },
  saturation: { scale: 0.5, bias: 50, step: 0.5, decimals: 2 },
  hue: { scale: 1, bias: 0, step: 0.5, decimals: 2 },
  lumMix: { scale: 1, bias: 0, step: 0.5, decimals: 2 },
}

const DOCK_WHEEL_DESCRIPTORS = [
  {
    labelKey: 'effects.params.lift',
    hueKey: 'shadowsHue',
    amountKey: 'shadowsAmount',
    levelKey: 'lift',
    masterChip: true,
    display: { scale: 1, bias: 0, step: 0.01 },
    ring: { min: -2, max: 2, fromDeg: 0 },
  },
  {
    labelKey: 'effects.params.gamma',
    hueKey: 'midtonesHue',
    amountKey: 'midtonesAmount',
    levelKey: 'gamma',
    masterChip: true,
    display: { scale: 1, bias: -1, step: 0.01 },
    ring: { min: 0, max: 2, fromDeg: 0 },
  },
  {
    labelKey: 'effects.params.gain',
    hueKey: 'highlightsHue',
    amountKey: 'highlightsAmount',
    levelKey: 'gain',
    masterChip: true,
    display: { scale: 1, bias: 0, step: 0.01 },
    // Resolve renders gain's gauge phase-flipped 180° relative to the
    // other wheels — same half-ring at default, on the opposite side.
    ring: { min: 0, max: 2, fromDeg: 180 },
  },
  // Resolve's Offset wheel shows only R/G/B chips — the master scalar is
  // still driven by the thumb wheel below.
  {
    labelKey: 'effects.params.offset',
    hueKey: 'offsetHue',
    amountKey: 'offsetAmount',
    levelKey: 'offset',
    masterChip: false,
    display: { scale: 100, bias: 25, step: 0.25 },
    ring: { min: -2, max: 2, fromDeg: 0 },
  },
] as const

type DockWheelDescriptor = (typeof DOCK_WHEEL_DESCRIPTORS)[number]

const DOCK_TOP_PARAMS = ['temperature', 'tint', 'contrast', 'pivot', 'midDetail'] as const
const DOCK_BOTTOM_PARAMS = [
  'colorBoost',
  'shadows',
  'highlights',
  'saturation',
  'hue',
  'lumMix',
] as const

const PRIMARY_PARAMS = [
  'exposure',
  'contrast',
  'pivot',
  'lift',
  'gamma',
  'gain',
  'offset',
  'blackPoint',
  'whitePoint',
] as const

const TONAL_PARAMS = ['temperature', 'tint', 'saturation'] as const

function getParamDecimals(step: unknown): number {
  if (typeof step !== 'number') return 2
  if (step >= 1) return 0
  if (step >= 0.01) return 2
  return 3
}

function formatParamValue(value: number, step: unknown): string {
  return value.toFixed(getParamDecimals(step))
}

function getDockParamAccent(key: string): string {
  if (key === 'temperature' || key === 'contrast' || key === 'pivot' || key === 'lumMix') {
    return 'from-zinc-200 via-zinc-500 to-zinc-900'
  }
  if (key === 'tint' || key === 'hue') return 'from-cyan-400 via-fuchsia-500 to-amber-300'
  if (key === 'saturation' || key === 'colorBoost') {
    return 'from-red-500 via-green-500 to-blue-500'
  }
  return 'from-zinc-300 via-red-500 to-blue-500'
}

// Resolve-style chip order under each wheel: white (master) then R, G, B.
const WHEEL_CHANNEL_INDICES = [0, 1, 2] as const
const WHEEL_CHANNEL_LABELS = ['Red', 'Green', 'Blue'] as const
const WHEEL_CHANNEL_ACCENTS = ['bg-red-500', 'bg-green-500', 'bg-blue-500'] as const

const THUMB_WHEEL_CLASS =
  'mt-1 h-3 w-full cursor-ew-resize appearance-none rounded-full border border-black/80 bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.22)_0_1px,rgba(0,0,0,0.65)_1px_5px)] shadow-inner disabled:cursor-not-allowed disabled:opacity-60 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-black/80 [&::-moz-range-thumb]:bg-zinc-200 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-black/80 [&::-webkit-slider-thumb]:bg-zinc-200'

/**
 * Range slider that previews live while dragging and commits once on release.
 * React fires `onChange` for range inputs on every input event, so committing
 * there would push a timeline mutation (and undo entry) per dragged pixel —
 * local drag state keeps the thumb responsive without re-rendering the panel.
 */
const DockThumbWheel = memo(function DockThumbWheel({
  ariaLabel,
  name,
  value,
  min,
  max,
  step,
  disabled,
  onLive,
  onCommit,
}: {
  ariaLabel: string
  name: string
  value: number
  min?: number
  max?: number
  step?: number
  disabled: boolean
  onLive: (value: string) => void
  onCommit: (value: string) => void
}) {
  const [dragValue, setDragValue] = useState<string | null>(null)

  const commit = (raw: string) => {
    setDragValue(null)
    onCommit(raw)
  }

  return (
    <input
      aria-label={ariaLabel}
      type="range"
      name={name}
      value={dragValue ?? value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(event) => {
        const raw = event.currentTarget.value
        setDragValue(raw)
        onLive(raw)
      }}
      onPointerUp={(event) => commit(event.currentTarget.value)}
      onPointerCancel={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => {
        if (dragValue !== null) commit(event.currentTarget.value)
      }}
      onBlur={(event) => {
        if (dragValue !== null) commit(event.currentTarget.value)
      }}
      className={THUMB_WHEEL_CLASS}
    />
  )
})

const SCRUB_THRESHOLD_PX = 3

/**
 * Horizontal-scrub numeric field (After Effects style): dragging anywhere on
 * the field slides the value by one step per pixel (Shift = 0.1x fine), a
 * plain click opens text editing. While interacting only the cheap live
 * preview path runs; the timeline commit (undo entry + auto-keyframe scan)
 * lands once per gesture — on release, Enter, blur, or arrow-key release.
 */
const DockNumberInput = memo(function DockNumberInput({
  ariaLabel,
  name,
  value,
  min,
  max,
  step = 1,
  decimals: decimalsProp,
  disabled,
  className,
  onLive,
  onCommit,
}: {
  ariaLabel?: string
  name: string
  value: string
  min?: number
  max?: number
  step?: number
  decimals?: number
  disabled: boolean
  className: string
  onLive: (raw: string) => void
  onCommit: (raw: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<string | null>(null)
  // Ref mirror of draft — blur fires synchronously after Enter/Escape, before
  // React applies the state update, so guards must not read stale state.
  const draftRef = useRef<string | null>(null)
  const dragRef = useRef<{ startX: number; startValue: number; scrubbed: boolean } | null>(null)

  const updateDraft = (raw: string | null) => {
    draftRef.current = raw
    setDraft(raw)
  }

  const decimals = decimalsProp ?? getParamDecimals(step)

  const clampValue = (next: number) => {
    let result = next
    if (min !== undefined) result = Math.max(min, result)
    if (max !== undefined) result = Math.min(max, result)
    return result
  }

  const commit = (raw: string) => {
    updateDraft(null)
    onCommit(raw)
  }

  const revert = () => {
    updateDraft(null)
    onLive(value)
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLInputElement>) => {
    if (disabled || event.button !== 0) return
    // Already editing — let the caret/selection behave normally.
    if (document.activeElement === inputRef.current) return
    // Keep focus off until release decides between scrub and click-to-edit.
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const parsed = Number(value)
    dragRef.current = {
      startX: event.clientX,
      startValue: Number.isFinite(parsed) ? parsed : 0,
      scrubbed: false,
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLInputElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    if (!drag.scrubbed && Math.abs(dx) < SCRUB_THRESHOLD_PX) return
    drag.scrubbed = true
    const sensitivity = event.shiftKey ? 0.1 : 1
    const raw = clampValue(drag.startValue + dx * sensitivity * step).toFixed(decimals)
    updateDraft(raw)
    onLive(raw)
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLInputElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (drag.scrubbed) {
      commit(draftRef.current ?? value)
    } else {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }

  const handlePointerCancel = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag?.scrubbed) revert()
  }

  const stepByKey = (direction: number, fine: boolean) => {
    const parsed = Number(draftRef.current ?? value)
    const current = Number.isFinite(parsed) ? parsed : 0
    const raw = clampValue(current + direction * step * (fine ? 10 : 1)).toFixed(decimals)
    updateDraft(raw)
    onLive(raw)
  }

  return (
    <input
      ref={inputRef}
      aria-label={ariaLabel}
      type="text"
      name={name}
      autoComplete="off"
      inputMode="decimal"
      value={draft ?? value}
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onChange={(event) => {
        const raw = event.currentTarget.value
        updateDraft(raw)
        onLive(raw)
      }}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          if (draftRef.current !== null) commit(event.currentTarget.value)
          event.currentTarget.blur()
        } else if (event.key === 'Escape') {
          if (draftRef.current !== null) revert()
          event.currentTarget.blur()
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          stepByKey(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey)
        }
      }}
      onKeyUp={(event) => {
        if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && draftRef.current !== null) {
          commit(event.currentTarget.value)
        }
      }}
      onBlur={(event) => {
        if (draftRef.current !== null) commit(event.currentTarget.value)
      }}
      style={{ touchAction: 'none' }}
      className={cn('cursor-ew-resize select-none focus:cursor-text focus:select-auto', className)}
    />
  )
})

export const GpuWheelsPanel = memo(function GpuWheelsPanel({
  itemIds,
  effect,
  gpuEffect,
  definition,
  layout = 'sidebar',
  collapsible = false,
  onEditInColor,
  getKeyframeProperty,
  onParamChange,
  onParamLiveChange,
  onParamsBatchChange,
  onParamsBatchLiveChange,
  onReset,
  onToggle,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
}: GpuWheelsPanelProps) {
  const { t } = useTranslation()
  const wheelGridRef = useRef<HTMLDivElement>(null)
  const [wheelSize, setWheelSize] = useState(MAX_WHEEL_SIZE)
  const isDock = layout === 'dock'
  // Collapse only in the sidebar — the dock is the dedicated grading surface.
  const allowCollapse = collapsible && !isDock
  const [collapsed, setCollapsed] = useState(allowCollapse)
  const showBody = !(allowCollapse && collapsed)

  const paramEntries = Object.entries(definition.params)
  const isDefault = paramEntries.every(([key, param]) => gpuEffect.params[key] === param.default)

  // Live param overlay: drags emit preview-only changes that don't touch the
  // committed effect until release. Readouts (wheels, chips, fields) render
  // from committed params merged with the in-flight values, so every control
  // tracks the gesture in realtime instead of jumping on commit.
  const [liveOverlay, setLiveOverlay] = useState<GpuParamUpdates | null>(null)
  useEffect(() => setLiveOverlay(null), [effect.id])
  const displayParams = liveOverlay ? { ...gpuEffect.params, ...liveOverlay } : gpuEffect.params

  const emitLiveParam = (key: string, value: number | boolean | string) => {
    setLiveOverlay((current) => ({ ...current, [key]: value }))
    onParamLiveChange(effect.id, key, value)
  }
  const emitCommitParam = (key: string, value: number | boolean | string) => {
    setLiveOverlay(null)
    onParamChange(effect.id, key, value)
  }
  const emitLiveBatch = (updates: GpuParamUpdates) => {
    setLiveOverlay((current) => ({ ...current, ...updates }))
    onParamsBatchLiveChange(effect.id, updates)
  }
  const emitCommitBatch = (updates: GpuParamUpdates) => {
    setLiveOverlay(null)
    onParamsBatchChange(effect.id, updates)
  }

  useEffect(() => {
    const el = wheelGridRef.current
    if (!el) return

    const updateSize = () => {
      const styles = getComputedStyle(el)
      const paddingX =
        (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0)
      const paddingY =
        (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0)
      const width = el.clientWidth - paddingX
      const wheelCount = isDock ? DOCK_WHEEL_DESCRIPTORS.length : WHEEL_DESCRIPTORS.length
      const maxSize = isDock ? MAX_DOCK_WHEEL_SIZE : MAX_WHEEL_SIZE
      const minSize = isDock ? MIN_DOCK_WHEEL_SIZE : MIN_WHEEL_SIZE
      const gridGap = isDock ? DOCK_WHEEL_GRID_GAP_PX : GRID_GAP_PX
      const slotWidth = (width - gridGap * (wheelCount - 1)) / wheelCount
      // In the dock the wheel column also stacks a header, value chips and a thumb
      // wheel — cap the wheel diameter by the available height so the column never
      // spills over the bottom parameter row.
      const slotHeight = isDock
        ? el.clientHeight - paddingY - DOCK_WHEEL_EXTRAS_PX
        : Number.POSITIVE_INFINITY
      setWheelSize(clamp(Math.floor(Math.min(slotWidth, slotHeight)), minSize, maxSize))
    }

    updateSize()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => updateSize())
    observer.observe(el)
    return () => observer.disconnect()
  }, [isDock])

  // Ring gauge over the wheel's practical working span (param space) —
  // Resolve's rings reflect a per-wheel range, not the full field range,
  // which is why lift/gamma/offset read half at default while gain reads
  // ~2/3. Values past the span peg the ring full/empty.
  const getMasterRingFill = (desc: DockWheelDescriptor) => {
    const level = readNumberParam(definition, displayParams, desc.levelKey)
    const range = desc.ring.max - desc.ring.min
    return range > 0 ? clamp((level - desc.ring.min) / range, 0, 1) : 0
  }

  // Resolve-style primaries pickers. The eyedropper ones sample the graded
  // preview straight off the screen; auto balance reads frame statistics
  // from the preview capture bridge.
  const eyeDropperSupported = getEyeDropperCtor() !== null
  const readCurrent = (key: string) => readNumberParam(definition, displayParams, key)

  const handlePickWhiteBalance = async () => {
    const picked = await pickScreenColor()
    if (!picked) return
    const wb = whiteBalanceFromPick(picked, readCurrent('temperature'), readCurrent('tint'))
    emitCommitBatch({ temperature: wb.temperature, tint: wb.tint })
  }

  const handlePickBlackPoint = async () => {
    const picked = await pickScreenColor()
    if (!picked) return
    emitCommitParam('lift', blackPointFromPick(luma601(picked), readCurrent('lift')))
  }

  const handlePickWhitePoint = async () => {
    const picked = await pickScreenColor()
    if (!picked) return
    emitCommitParam('gain', whitePointFromPick(luma601(picked), readCurrent('gain')))
  }

  const handleAutoBalance = async () => {
    const capture = usePreviewBridgeStore.getState().captureFrameImageData
    if (!capture) return
    const imageData = await capture({ width: 96, height: 54 })
    if (!imageData) return
    const updates = autoBalanceFromFrame(imageData, {
      lift: readCurrent('lift'),
      gain: readCurrent('gain'),
      temperature: readCurrent('temperature'),
      tint: readCurrent('tint'),
    })
    emitCommitBatch({ ...updates })
  }

  const updateParamFromDisplay = (
    key: string,
    display: WheelDisplay,
    rawValue: string,
    mode: 'live' | 'commit',
  ) => {
    const param = definition.params[key]
    if (!param || param.type !== 'number') return
    const next = Number(rawValue)
    if (!Number.isFinite(next)) return
    const clamped = clampParamValue(param, fromWheelDisplay(display, next))
    if (mode === 'live') emitLiveParam(key, clamped)
    else emitCommitParam(key, clamped)
  }

  const renderDockNumberControl = (key: string) => {
    const param = definition.params[key]
    if (!param || param.type !== 'number') return null
    const display = DOCK_PARAM_DISPLAY[key] ?? { scale: 1, bias: 0, step: param.step ?? 1 }
    const value = (displayParams[key] as number) ?? param.default
    const label = getEffectParamLabel(t, definition, key)

    return (
      <label
        key={key}
        className="grid min-w-0 grid-cols-[minmax(0,1fr)_4.75rem] items-center gap-2"
      >
        <span className="min-w-0 truncate text-right text-[11px] text-muted-foreground">
          {label}
        </span>
        <span className="flex min-w-0 flex-col items-center">
          <DockNumberInput
            ariaLabel={label}
            name={`dock-${key}`}
            value={formatWheelDisplayValue(display, toWheelDisplay(display, value))}
            min={typeof param.min === 'number' ? toWheelDisplay(display, param.min) : undefined}
            max={typeof param.max === 'number' ? toWheelDisplay(display, param.max) : undefined}
            step={display.step}
            decimals={display.decimals}
            disabled={!effect.enabled}
            onLive={(raw) => updateParamFromDisplay(key, display, raw, 'live')}
            onCommit={(raw) => updateParamFromDisplay(key, display, raw, 'commit')}
            className="h-6 w-full rounded-[2px] border border-black/80 bg-black/75 px-1 text-center font-mono text-[11px] tabular-nums text-foreground shadow-inner focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <span
            aria-hidden="true"
            className={cn(
              'mt-0.5 h-0.5 w-8 rounded-full bg-gradient-to-r',
              getDockParamAccent(key),
            )}
          />
        </span>
      </label>
    )
  }

  const renderDockWheelFields = (desc: DockWheelDescriptor, wheelLabel: string) => {
    const { levelKey, hueKey, amountKey, masterChip, display } = desc
    const levelParam = definition.params[levelKey]
    const amountParam = definition.params[amountKey]
    const levelValue = readNumberParam(definition, displayParams, levelKey)
    const hue = readNumberParam(definition, displayParams, hueKey)
    const amount = readNumberParam(definition, displayParams, amountKey)
    const deviations = wheelChannelsFromHueAmount(hue, amount)
    // Resolve-style readout: channel chips include the master, so rolling the
    // thumb wheel moves all three together (Gain at 1.07 reads 1.07 1.07 1.07).
    const levelDisplay = toWheelDisplay(display, levelValue)
    const channels = deviations.map(
      (deviation) => levelDisplay + deviation * display.scale,
    ) as WheelChannels
    const displayMin = toWheelDisplay(display, levelParam?.min ?? 0)
    const displayMax = toWheelDisplay(display, levelParam?.max ?? 0)
    const chipMin = displayMin - display.scale
    const chipMax = displayMax + display.scale
    const chipClass =
      'h-5 w-full rounded-[2px] border border-black/80 bg-black/75 px-1 text-center font-mono text-[10px] leading-5 tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

    const updateLevelFromDisplay = (rawValue: string, mode: 'live' | 'commit') => {
      const next = Number(rawValue)
      if (!Number.isFinite(next)) return
      const clamped = clampParamValue(levelParam, fromWheelDisplay(display, next))
      if (mode === 'live') emitLiveParam(levelKey, clamped)
      else emitCommitParam(levelKey, clamped)
    }

    // Editing an R/G/B chip decomposes the channel triple back into the
    // master (the mean) plus a wheel push (hue + amount), so chips read back
    // exactly what was typed.
    const updateChannel = (index: 0 | 1 | 2, rawValue: string, mode: 'live' | 'commit') => {
      const next = Number(rawValue)
      if (!Number.isFinite(next)) return
      const edited: WheelChannels = [channels[0], channels[1], channels[2]]
      edited[index] = clamp(next, chipMin, chipMax)
      const mean = (edited[0] + edited[1] + edited[2]) / 3
      const wheel = hueAmountFromWheelChannels([
        (edited[0] - mean) / display.scale,
        (edited[1] - mean) / display.scale,
        (edited[2] - mean) / display.scale,
      ])
      const meanParam = fromWheelDisplay(display, mean)
      const updates = {
        [levelKey]: clampParamValue(levelParam, Math.round(meanParam * 10000) / 10000),
        [hueKey]: Math.round(wheel.hue * 10) / 10,
        [amountKey]: clampParamValue(amountParam, Math.round(wheel.amount * 1000) / 1000),
      }
      if (mode === 'live') emitLiveBatch(updates)
      else emitCommitBatch(updates)
    }

    return (
      <div className="w-full max-w-[13rem] px-1">
        <div className={cn('grid gap-1', masterChip ? 'grid-cols-4' : 'grid-cols-3')}>
          {masterChip && (
            <span className="flex min-w-0 flex-col items-center">
              <DockNumberInput
                ariaLabel={wheelLabel}
                name={`dock-${levelKey}`}
                value={formatParamValue(levelDisplay, display.step)}
                min={displayMin}
                max={displayMax}
                step={display.step}
                disabled={!effect.enabled}
                onLive={(raw) => updateLevelFromDisplay(raw, 'live')}
                onCommit={(raw) => updateLevelFromDisplay(raw, 'commit')}
                className={chipClass}
              />
              <span aria-hidden="true" className="mt-0.5 h-0.5 w-7 rounded-full bg-zinc-200" />
            </span>
          )}
          {WHEEL_CHANNEL_INDICES.map((index) => (
            <span key={WHEEL_CHANNEL_LABELS[index]} className="flex min-w-0 flex-col items-center">
              <DockNumberInput
                ariaLabel={`${wheelLabel} ${WHEEL_CHANNEL_LABELS[index]}`}
                name={`dock-${levelKey}-${WHEEL_CHANNEL_LABELS[index].toLowerCase()}`}
                value={formatParamValue(channels[index], display.step)}
                min={chipMin}
                max={chipMax}
                step={display.step}
                disabled={!effect.enabled}
                onLive={(raw) => updateChannel(index, raw, 'live')}
                onCommit={(raw) => updateChannel(index, raw, 'commit')}
                className={chipClass}
              />
              <span
                aria-hidden="true"
                className={cn('mt-0.5 h-0.5 w-7 rounded-full', WHEEL_CHANNEL_ACCENTS[index])}
              />
            </span>
          ))}
        </div>
        <DockThumbWheel
          ariaLabel={`${wheelLabel} thumb wheel`}
          name={`dock-${levelKey}-thumb`}
          value={levelDisplay}
          min={displayMin}
          max={displayMax}
          step={display.step}
          disabled={!effect.enabled}
          onLive={(raw) => updateLevelFromDisplay(raw, 'live')}
          onCommit={(raw) => updateLevelFromDisplay(raw, 'commit')}
        />
      </div>
    )
  }

  const tonalRowClass = '[&>span]:w-[84px] [&>span]:min-w-[84px]'

  const renderParamRows = (keys: readonly string[]) =>
    keys.map((key) => {
      const param = definition.params[key]
      if (!param) return null
      const value = (displayParams[key] as number) ?? param.default
      const keyframeProperty = getKeyframeProperty(effect.id, key)
      return (
        <PropertyRow
          key={key}
          label={getEffectParamLabel(t, definition, key)}
          className={tonalRowClass}
        >
          <div className="flex items-center gap-1 min-w-0 w-full">
            <SliderInput
              value={value}
              onChange={(v) => emitCommitParam(key, v)}
              onLiveChange={(v) => emitLiveParam(key, v)}
              min={param.min ?? -100}
              max={param.max ?? 100}
              step={param.step ?? 1}
              disabled={!effect.enabled}
              className="flex-1 min-w-0"
            />
            {keyframeProperty ? (
              <KeyframeToggle
                itemIds={itemIds}
                property={keyframeProperty}
                currentValue={value}
                disabled={!effect.enabled}
              />
            ) : null}
          </div>
        </PropertyRow>
      )
    })

  return (
    <div className={cn('space-y-0', isDock && 'flex h-full min-h-0 flex-col overflow-hidden')}>
      <EffectPanelHeaderRow
        label={
          isDock ? t('effects.wheels.primariesColorWheels') : getEffectDefinitionName(definition)
        }
        effectId={effect.id}
        enabled={effect.enabled}
        isDefault={isDefault}
        onReset={onReset}
        onToggle={onToggle}
        onRemove={onRemove}
        onMove={onMove}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        collapsed={allowCollapse ? collapsed : undefined}
        onToggleCollapsed={allowCollapse ? () => setCollapsed((value) => !value) : undefined}
        onEditInColor={onEditInColor}
      />

      {showBody &&
        (isDock ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              className="grid shrink-0 items-center gap-x-3 border-b border-border/70 px-4 py-1.5"
              style={{
                gridTemplateColumns: `auto repeat(${DOCK_TOP_PARAMS.length}, minmax(0, 1fr))`,
              }}
            >
              <div className="flex items-center gap-0.5 pr-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  disabled={!effect.enabled}
                  onClick={() => void handleAutoBalance()}
                  title={t('effects.wheels.autoBalance')}
                  aria-label={t('effects.wheels.autoBalance')}
                >
                  <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[8px] font-semibold leading-none">
                    A
                  </span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  disabled={!effect.enabled || !eyeDropperSupported}
                  onClick={() => void handlePickWhiteBalance()}
                  title={t('effects.wheels.pickWhiteBalance')}
                  aria-label={t('effects.wheels.pickWhiteBalance')}
                >
                  <Pipette className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  disabled={!effect.enabled || !eyeDropperSupported}
                  onClick={() => void handlePickBlackPoint()}
                  title={t('effects.wheels.pickBlackPoint')}
                  aria-label={t('effects.wheels.pickBlackPoint')}
                >
                  <span className="relative">
                    <Pipette className="h-3.5 w-3.5" />
                    <span
                      aria-hidden="true"
                      className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full border border-zinc-500 bg-black"
                    />
                  </span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  disabled={!effect.enabled || !eyeDropperSupported}
                  onClick={() => void handlePickWhitePoint()}
                  title={t('effects.wheels.pickWhitePoint')}
                  aria-label={t('effects.wheels.pickWhitePoint')}
                >
                  <span className="relative">
                    <Pipette className="h-3.5 w-3.5" />
                    <span
                      aria-hidden="true"
                      className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full border border-zinc-600 bg-white"
                    />
                  </span>
                </Button>
              </div>
              {DOCK_TOP_PARAMS.map(renderDockNumberControl)}
            </div>
            <div ref={wheelGridRef} className="min-h-0 flex-1 overflow-hidden px-6 py-3">
              <div className="grid min-h-full grid-cols-[repeat(4,minmax(3rem,1fr))] items-center gap-7">
                {DOCK_WHEEL_DESCRIPTORS.map((desc) => (
                  <WheelControl
                    key={desc.labelKey}
                    label={t(desc.labelKey)}
                    hue={(displayParams[desc.hueKey] as number) ?? 0}
                    amount={(displayParams[desc.amountKey] as number) ?? 0}
                    size={wheelSize}
                    disabled={!effect.enabled}
                    dock
                    masterRingFill={getMasterRingFill(desc)}
                    masterRingFromDeg={desc.ring.fromDeg}
                    dockFields={renderDockWheelFields(desc, t(desc.labelKey))}
                    onLiveChange={(hue, amount) => {
                      emitLiveBatch({
                        [desc.hueKey]: hue,
                        [desc.amountKey]: amount,
                      })
                    }}
                    onCommit={(hue, amount) => {
                      emitCommitBatch({
                        [desc.hueKey]: hue,
                        [desc.amountKey]: amount,
                      })
                    }}
                    onReset={() => {
                      // Reset the whole wheel: color push and its master level.
                      emitCommitBatch({
                        [desc.hueKey]: 0,
                        [desc.amountKey]: 0,
                        [desc.levelKey]: (definition.params[desc.levelKey]?.default as number) ?? 0,
                      })
                    }}
                  />
                ))}
              </div>
            </div>
            <div
              className="grid shrink-0 items-center gap-x-3 border-t border-border/70 px-4 py-1.5"
              style={{
                gridTemplateColumns: `repeat(${DOCK_BOTTOM_PARAMS.length}, minmax(0, 1fr))`,
              }}
            >
              {DOCK_BOTTOM_PARAMS.map(renderDockNumberControl)}
            </div>
          </div>
        ) : (
          <div className="px-2 pb-2">
            <div ref={wheelGridRef} className="grid grid-cols-3 gap-1">
              {WHEEL_DESCRIPTORS.map((desc) => (
                <WheelControl
                  key={desc.labelKey}
                  label={t(desc.labelKey)}
                  hue={(displayParams[desc.hueKey] as number) ?? 0}
                  amount={(displayParams[desc.amountKey] as number) ?? 0}
                  size={wheelSize}
                  disabled={!effect.enabled}
                  onLiveChange={(hue, amount) => {
                    emitLiveBatch({
                      [desc.hueKey]: hue,
                      [desc.amountKey]: amount,
                    })
                  }}
                  onCommit={(hue, amount) => {
                    emitCommitBatch({
                      [desc.hueKey]: hue,
                      [desc.amountKey]: amount,
                    })
                  }}
                  onReset={() => {
                    emitCommitBatch({
                      [desc.hueKey]: 0,
                      [desc.amountKey]: 0,
                    })
                  }}
                />
              ))}
            </div>
          </div>
        ))}

      {showBody && !isDock && (
        <>
          <div className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('effects.wheels.primaries', { defaultValue: 'Primaries' })}
          </div>
          {renderParamRows(PRIMARY_PARAMS)}

          <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('effects.wheels.balance', { defaultValue: 'Balance' })}
          </div>
          {renderParamRows(TONAL_PARAMS)}
        </>
      )}
    </div>
  )
})
