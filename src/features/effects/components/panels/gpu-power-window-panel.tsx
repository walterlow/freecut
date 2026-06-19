import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Circle, Eye, EyeOff, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { KeyframeToggle } from '@/features/effects/deps/keyframes-contract'
import { getEffectDefinitionName, getEffectParamLabel } from '@/features/effects/utils/effect-i18n'
import { PropertyRow, SliderInput } from '@/shared/ui/property-controls'
import { EffectPanelHeaderRow } from './effect-panel-header-actions'
import type { GpuKeyframePanelProps } from './panel-props'

const WINDOW_KEYS = ['centerX', 'centerY', 'sizeX', 'sizeY', 'rotation', 'feather'] as const
const CORRECTION_KEYS = ['exposure', 'saturation', 'temperature', 'tint', 'strength'] as const

function getNumberParam(
  params: Record<string, number | boolean | string>,
  key: string,
  fallback: number,
): number {
  const value = params[key]
  return typeof value === 'number' ? value : fallback
}

export const GpuPowerWindowPanel = memo(function GpuPowerWindowPanel({
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
  const activeShape =
    typeof gpuEffect.params.shape === 'string' ? gpuEffect.params.shape : 'ellipse'

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

  const renderShapeButton = (shape: 'ellipse' | 'rectangle') => {
    const isActive = activeShape === shape
    const label = t(`effects.powerWindow.${shape}`)
    const Icon = shape === 'ellipse' ? Circle : Square
    return (
      <Button
        key={shape}
        variant={isActive ? 'default' : 'outline'}
        size="sm"
        className="h-7 flex-1 gap-1.5 px-2 text-xs"
        onClick={() => onParamChange(effect.id, 'shape', shape)}
        disabled={!enabled}
        aria-pressed={isActive}
      >
        <Icon className="h-3 w-3" />
        {label}
      </Button>
    )
  }

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
        {t('effects.powerWindow.window')}
      </div>
      <div className="px-2 pb-1 flex gap-1">
        {renderShapeButton('ellipse')}
        {renderShapeButton('rectangle')}
      </div>
      {WINDOW_KEYS.map(renderNumberRow)}

      <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('effects.powerWindow.matte')}
      </div>
      <div className="px-2 pb-1 flex gap-1">
        {renderBooleanToggle('showMask')}
        {renderBooleanToggle('invertMask')}
      </div>

      <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('effects.powerWindow.correction')}
      </div>
      {CORRECTION_KEYS.map(renderNumberRow)}
    </div>
  )
})
