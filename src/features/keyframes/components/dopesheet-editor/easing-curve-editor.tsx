import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { applyEasingConfig } from '@/shared/utils/easing'
import type { BezierControlPoints } from '@/types/keyframe'

/**
 * The cubic-bezier curve editor, copied from easings.dev: a curve canvas on the
 * left, and `x1 / y1 / x2 / y2` slider+number rows plus a `Duration` row and a
 * moving-dot Position Preview on the right. `Duration` drives only the preview
 * playback (it is not stored on the keyframe — a segment's real duration is the
 * gap between its two keyframes).
 */

type BezierKey = keyof BezierControlPoints

// Canvas geometry (px). Vertical headroom shows overshoot/anticipation.
const SIZE = 176
const PAD = 16
const PLOT = SIZE - PAD * 2
const Y_MIN = -0.7
const Y_MAX = 1.7

const xToPx = (x: number) => PAD + x * PLOT
const yToPx = (y: number) => PAD + ((Y_MAX - y) / (Y_MAX - Y_MIN)) * PLOT

const FIELD_RANGE: Record<BezierKey, { min: number; max: number }> = {
  x1: { min: 0, max: 1 },
  y1: { min: -1, max: 2 },
  x2: { min: 0, max: 1 },
  y2: { min: -1, max: 2 },
}

function clampField(key: BezierKey, value: number): number {
  const { min, max } = FIELD_RANGE[key]
  return Math.max(min, Math.min(max, value))
}

function curvePath(points: BezierControlPoints): string {
  const { x1, y1, x2, y2 } = points
  const steps = 48
  let d = `M ${xToPx(0)} ${yToPx(0)}`
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const mt = 1 - t
    const x = 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t
    const y = 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t
    d += ` L ${xToPx(x)} ${yToPx(y)}`
  }
  return d
}

interface EasingCurveEditorProps {
  value: BezierControlPoints
  /** `commit` is false for live slider drag, true for discrete edits. */
  onChange: (bezier: BezierControlPoints, commit: boolean) => void
  onDragStart?: () => void
  onDragEnd?: () => void
}

export function EasingCurveEditor({
  value,
  onChange,
  onDragStart,
  onDragEnd,
}: EasingCurveEditorProps) {
  const { t } = useTranslation()
  const [duration, setDuration] = useState(1)

  const setField = useCallback(
    (key: BezierKey, raw: number, commit: boolean) => {
      onChange({ ...value, [key]: clampField(key, raw) }, commit)
    },
    [onChange, value],
  )

  return (
    <div className="flex gap-3">
      <CurveCanvas value={value} />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {(['x1', 'y1', 'x2', 'y2'] as const).map((key) => (
          <SliderRow
            key={key}
            label={key}
            value={value[key]}
            min={FIELD_RANGE[key].min}
            max={FIELD_RANGE[key].max}
            step={0.01}
            onLive={(v) => setField(key, v, false)}
            onCommit={(v) => setField(key, v, true)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        ))}
        <SliderRow
          label={t('timeline.keyframeEditor.duration', { defaultValue: 'Duration' })}
          value={duration}
          min={0.2}
          max={3}
          step={0.1}
          onLive={setDuration}
          onCommit={setDuration}
        />

        <PositionPreview bezier={value} duration={duration} />
      </div>
    </div>
  )
}

function CurveCanvas({ value }: { value: BezierControlPoints }) {
  const dots: string[] = []
  for (let gx = 0; gx <= 8; gx++) {
    for (let gy = 0; gy <= 8; gy++) {
      dots.push(`${PAD + (gx / 8) * PLOT},${PAD + (gy / 8) * PLOT}`)
    }
  }
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="shrink-0 rounded-md border border-border/60 bg-black/40"
      aria-hidden
    >
      {dots.map((d) => {
        const [cx, cy] = d.split(',')
        return <circle key={d} cx={cx} cy={cy} r={0.7} className="fill-white/15" />
      })}
      <line
        x1={xToPx(0)}
        y1={yToPx(0)}
        x2={xToPx(1)}
        y2={yToPx(1)}
        className="stroke-white/10"
        strokeWidth={1}
      />
      <path d={curvePath(value)} className="fill-none stroke-white" strokeWidth={2} />
      <circle cx={xToPx(0)} cy={yToPx(0)} r={2.5} className="fill-white/70" />
      <circle cx={xToPx(1)} cy={yToPx(1)} r={2.5} className="fill-white/70" />
    </svg>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onLive,
  onCommit,
  onDragStart,
  onDragEnd,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onLive: (value: number) => void
  onCommit: (value: number) => void
  onDragStart?: () => void
  onDragEnd?: () => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  const commitDraft = useCallback(() => {
    if (draft === null) return
    const parsed = Number(draft)
    setDraft(null)
    if (Number.isFinite(parsed)) onCommit(parsed)
  }, [draft, onCommit])

  return (
    <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span className="w-14 shrink-0 lowercase">{label}</span>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onPointerDown={onDragStart}
        onValueChange={(values) => onLive(values[0] ?? value)}
        onValueCommit={() => onDragEnd?.()}
        className="min-w-0 flex-1"
        aria-label={label}
      />
      <Input
        value={draft ?? value.toFixed(2)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitDraft()
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            setDraft(null)
            event.currentTarget.blur()
          }
        }}
        className="h-6 w-14 shrink-0 px-1.5 text-center text-[11px] tabular-nums"
        inputMode="decimal"
      />
    </label>
  )
}

function PositionPreview({
  bezier,
  duration,
}: {
  bezier: BezierControlPoints
  duration: number
}) {
  const { t } = useTranslation()
  const [playing, setPlaying] = useState(true)
  const [pos, setPos] = useState(0)
  const bezierRef = useRef(bezier)
  bezierRef.current = bezier
  const durationRef = useRef(duration)
  durationRef.current = duration

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let start = performance.now()
    const tick = (now: number) => {
      const tau = ((now - start) / 1000 / durationRef.current) % 1
      if (tau < 0) start = now
      setPos(applyEasingConfig(tau, { type: 'cubic-bezier', bezier: bezierRef.current }))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  return (
    <div className="mt-1 flex flex-col gap-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{t('timeline.keyframeEditor.positionPreview', { defaultValue: 'Position Preview' })}</span>
        <button
          type="button"
          className="rounded px-1 hover:text-foreground"
          onClick={() => setPlaying((p) => !p)}
        >
          {playing
            ? t('timeline.keyframeEditor.pause', { defaultValue: 'Pause' })
            : t('timeline.keyframeEditor.play', { defaultValue: 'Play' })}
        </button>
      </div>
      <div className="relative h-9 overflow-hidden rounded-md border border-border/60 bg-black/40">
        <div className="absolute inset-x-3 top-1/2 border-t border-dashed border-white/20" />
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-blue-500"
          style={{ left: `calc(12px + (100% - 24px) * ${Math.max(0, Math.min(1, pos))} - 7px)` }}
        />
      </div>
    </div>
  )
}
