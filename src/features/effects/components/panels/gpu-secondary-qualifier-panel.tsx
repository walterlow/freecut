import { memo, useCallback, useState } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { KeyframeToggle } from '@/features/effects/deps/keyframes-contract'
import { getEffectDefinitionName, getEffectParamLabel } from '@/features/effects/utils/effect-i18n'
import { PropertyRow, SliderInput } from '@/shared/ui/property-controls'
import { cn } from '@/shared/ui/cn'
import { EffectPanelHeaderRow } from './effect-panel-header-actions'
import type { GpuKeyframePanelProps } from './panel-props'

const HUE_KEYS = ['hueCenter', 'hueWidth', 'hueSoftness'] as const
const MATTE_KEYS = [
  'satLow',
  'satHigh',
  'satSoftness',
  'lumaLow',
  'lumaHigh',
  'lumaSoftness',
] as const
const CORRECTION_KEYS = ['exposure', 'saturation', 'temperature', 'tint', 'strength'] as const

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function getNumberParam(
  params: Record<string, number | boolean | string>,
  key: string,
  fallback: number,
): number {
  const value = params[key]
  return typeof value === 'number' ? value : fallback
}

function hueToPercent(hue: number): number {
  return (clamp(hue, 0, 360) / 360) * 100
}

interface HueBandControlProps {
  center: number
  width: number
  softness: number
  disabled: boolean
  onLiveChange: (value: number) => void
  onCommit: (value: number) => void
}

const HueBandControl = memo(function HueBandControl({
  center,
  width,
  softness,
  disabled,
  onLiveChange,
  onCommit,
}: HueBandControlProps) {
  const { t } = useTranslation()
  const [dragging, setDragging] = useState(false)

  const getHueFromClient = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      if (rect.width <= 0) return center
      return clamp(((event.clientX - rect.left) / rect.width) * 360, 0, 360)
    },
    [center],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled) return
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragging(true)
      onLiveChange(getHueFromClient(event))
    },
    [disabled, getHueFromClient, onLiveChange],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled || !dragging) return
      onLiveChange(getHueFromClient(event))
    },
    [disabled, dragging, getHueFromClient, onLiveChange],
  )

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled) return
      onCommit(getHueFromClient(event))
      setDragging(false)
    },
    [disabled, getHueFromClient, onCommit],
  )

  const handlePointerCancel = useCallback(() => {
    setDragging(false)
    onCommit(center)
  }, [center, onCommit])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return
      let next: number | null = null
      if (event.key === 'ArrowLeft') next = center - (event.shiftKey ? 10 : 1)
      if (event.key === 'ArrowRight') next = center + (event.shiftKey ? 10 : 1)
      if (event.key === 'Home') next = 0
      if (event.key === 'End') next = 360
      if (next === null) return
      event.preventDefault()
      const clamped = clamp(next, 0, 360)
      onLiveChange(clamped)
      onCommit(clamped)
    },
    [center, disabled, onCommit, onLiveChange],
  )

  const centerPct = hueToPercent(center)
  const corePct = (clamp(width, 0, 180) / 360) * 100
  const featherPct = (clamp(softness, 0, 120) / 360) * 100

  return (
    <button
      type="button"
      disabled={disabled}
      role="slider"
      aria-label={t('effects.qualifier.hueBand')}
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(center)}
      aria-valuetext={`${Math.round(center)} degrees`}
      className={cn(
        'relative h-8 w-full overflow-hidden rounded-sm border border-border/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-crosshair',
      )}
      style={{
        touchAction: 'none',
        backgroundImage:
          'linear-gradient(90deg, #ef4444, #f97316, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
    >
      <span
        className="absolute inset-y-0 border-x border-white/60 bg-white/20 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
        style={{
          left: `${clamp(centerPct - corePct, 0, 100)}%`,
          right: `${clamp(100 - centerPct - corePct, 0, 100)}%`,
        }}
      />
      <span
        className="absolute inset-y-0 border-x border-white/35 bg-white/10"
        style={{
          left: `${clamp(centerPct - corePct - featherPct, 0, 100)}%`,
          right: `${clamp(100 - centerPct - corePct - featherPct, 0, 100)}%`,
        }}
      />
      <span
        className="absolute top-0 h-full w-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.65)]"
        style={{ left: `${centerPct}%` }}
      />
    </button>
  )
})

export const GpuSecondaryQualifierPanel = memo(function GpuSecondaryQualifierPanel({
  itemIds,
  effect,
  gpuEffect,
  definition,
  getKeyframeProperty,
  onParamChange,
  onParamLiveChange,
  onReset,
  onToggle,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
}: GpuKeyframePanelProps) {
  const { t } = useTranslation()
  const paramEntries = Object.entries(definition.params)
  const isDefault = paramEntries.every(([key, param]) => gpuEffect.params[key] === param.default)
  const enabled = effect.enabled

  const renderNumberRow = (key: string) => {
    const param = definition.params[key]
    if (!param || param.type !== 'number') return null
    const value = getNumberParam(gpuEffect.params, key, param.default as number)
    const keyframeProperty = getKeyframeProperty(effect.id, key)
    const min = param.min ?? 0
    const max = param.max ?? 1
    const step = param.step ?? 0.01
    const commitValue = (nextValue: number) => onParamChange(effect.id, key, nextValue)
    const previewValue = (nextValue: number) => onParamLiveChange(effect.id, key, nextValue)
    return (
      <PropertyRow
        key={key}
        label={getEffectParamLabel(t, definition, key)}
        className={!enabled ? 'opacity-50' : undefined}
      >
        <div className="flex items-center gap-1 min-w-0 w-full">
          <SliderInput
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={commitValue}
            onLiveChange={previewValue}
            disabled={!enabled}
            className="flex-1 min-w-0"
          />
          {keyframeProperty ? (
            <KeyframeToggle
              itemIds={itemIds}
              property={keyframeProperty}
              currentValue={value}
              disabled={!enabled}
            />
          ) : null}
        </div>
      </PropertyRow>
    )
  }

  const renderBooleanToggle = (key: 'showMask' | 'invertMask') => {
    const param = definition.params[key]
    const active = Boolean(gpuEffect.params[key] ?? param?.default)
    const label = getEffectParamLabel(t, definition, key)
    return (
      <Button
        key={key}
        variant={active ? 'default' : 'outline'}
        size="sm"
        className="h-7 flex-1 gap-1.5 px-2 text-xs"
        onClick={() => onParamChange(effect.id, key, !active)}
        disabled={!enabled}
        aria-pressed={active}
      >
        {key === 'showMask' ? (
          active ? (
            <Eye className="h-3 w-3" />
          ) : (
            <EyeOff className="h-3 w-3" />
          )
        ) : null}
        {label}
      </Button>
    )
  }

  const hueCenter = getNumberParam(gpuEffect.params, 'hueCenter', 0)
  const hueWidth = getNumberParam(gpuEffect.params, 'hueWidth', 35)
  const hueSoftness = getNumberParam(gpuEffect.params, 'hueSoftness', 20)

  return (
    <div className="space-y-0">
      <EffectPanelHeaderRow
        label={getEffectDefinitionName(definition)}
        effectId={effect.id}
        enabled={enabled}
        isDefault={isDefault}
        onReset={onReset}
        onToggle={onToggle}
        onRemove={onRemove}
        onMove={onMove}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
      />

      <div className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('effects.qualifier.key')}
      </div>
      <div className={cn('px-2 pb-1', !enabled && 'opacity-50')}>
        <HueBandControl
          center={hueCenter}
          width={hueWidth}
          softness={hueSoftness}
          disabled={!enabled}
          onLiveChange={(value) => onParamLiveChange(effect.id, 'hueCenter', value)}
          onCommit={(value) => onParamChange(effect.id, 'hueCenter', value)}
        />
      </div>
      {HUE_KEYS.map(renderNumberRow)}

      <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('effects.qualifier.matte')}
      </div>
      <div className="px-2 pb-1 flex gap-1">
        {renderBooleanToggle('showMask')}
        {renderBooleanToggle('invertMask')}
      </div>
      {MATTE_KEYS.map(renderNumberRow)}

      <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('effects.qualifier.correction')}
      </div>
      {CORRECTION_KEYS.map(renderNumberRow)}
    </div>
  )
})
