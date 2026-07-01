import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { KeyframeToggle } from '@/features/effects/deps/keyframes-contract'
import { ColorPicker, PropertyRow, SliderInput } from '@/shared/ui/property-controls'
import {
  getEffectDefinitionName,
  getEffectOptionLabel,
  getEffectParamLabel,
} from '@/features/effects/utils/effect-i18n'
import { getGpuEffectKeyframeValue } from '@/features/effects/utils/effect-keyframes'
import { EffectPanelHeaderActions } from './effect-panel-header-actions'
import type { GpuKeyframePanelProps, GpuParamValue } from './panel-props'

type GpuEffectPanelProps = GpuKeyframePanelProps

interface TextParamRowProps {
  effectId: string
  paramKey: string
  label: string
  value: string
  disabled: boolean
  className?: string
  onParamChange: (effectId: string, paramKey: string, value: GpuParamValue) => void
  onParamLiveChange: (effectId: string, paramKey: string, value: GpuParamValue) => void
}

/**
 * Text param row. Mirrors the number/color rows' live-then-commit pattern: the
 * input drives a local draft + live preview on each keystroke and only commits
 * to history on blur, instead of committing on every keystroke.
 */
const TextParamRow = memo(function TextParamRow({
  effectId,
  paramKey,
  label,
  value,
  disabled,
  className,
  onParamChange,
  onParamLiveChange,
}: TextParamRowProps) {
  const [draft, setDraft] = useState(value)
  const isEditingRef = useRef(false)

  // Keep the draft in sync with external updates (undo/redo, keyframes, reset)
  // while the field isn't being actively edited.
  useEffect(() => {
    if (!isEditingRef.current) setDraft(value)
  }, [value])

  return (
    <PropertyRow label={label} className={className}>
      <Input
        value={draft}
        onFocus={() => {
          isEditingRef.current = true
        }}
        onChange={(e) => {
          setDraft(e.target.value)
          onParamLiveChange(effectId, paramKey, e.target.value)
        }}
        onBlur={() => {
          isEditingRef.current = false
          if (draft !== value) onParamChange(effectId, paramKey, draft)
        }}
        disabled={disabled}
        className="h-6 text-xs flex-1 min-w-0"
        spellCheck={false}
      />
    </PropertyRow>
  )
})

export const GpuEffectPanel = memo(function GpuEffectPanel({
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
}: GpuEffectPanelProps) {
  const { t } = useTranslation()
  const paramEntries = Object.entries(definition.params)
  const isDefault = paramEntries.every(([key, param]) => gpuEffect.params[key] === param.default)
  const effectName = getEffectDefinitionName(definition)

  // Single number param: compact single-row layout matching CSS filter panels
  if (paramEntries.length === 1 && paramEntries[0]![1].type === 'number') {
    const [key, param] = paramEntries[0]!
    const currentValue = (gpuEffect.params[key] ?? param.default) as number
    const keyframeProperty = getKeyframeProperty(effect.id, key)
    return (
      <PropertyRow label={effectName}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <SliderInput
            value={currentValue}
            onChange={(v) => onParamChange(effect.id, key, v)}
            onLiveChange={(v) => onParamLiveChange(effect.id, key, v)}
            min={param.min ?? 0}
            max={param.max ?? 1}
            step={param.step ?? 0.01}
            disabled={!effect.enabled}
            className="flex-1 min-w-0"
          />
          {keyframeProperty ? (
            <KeyframeToggle
              itemIds={itemIds}
              property={keyframeProperty}
              currentValue={currentValue}
              disabled={!effect.enabled}
            />
          ) : null}
          <EffectPanelHeaderActions
            effectId={effect.id}
            enabled={effect.enabled}
            isDefault={isDefault}
            onReset={onReset}
            onToggle={onToggle}
            onRemove={onRemove}
            onMove={onMove}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
          />
        </div>
      </PropertyRow>
    )
  }

  // Zero params: header-only row with action buttons
  if (paramEntries.length === 0) {
    return (
      <PropertyRow label={effectName}>
        <div className="flex items-center gap-1 min-w-0 w-full justify-end">
          <EffectPanelHeaderActions
            effectId={effect.id}
            enabled={effect.enabled}
            isDefault={isDefault}
            onReset={onReset}
            onToggle={onToggle}
            onRemove={onRemove}
            onMove={onMove}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
          />
        </div>
      </PropertyRow>
    )
  }

  // Multi-param: header row with buttons, then one row per param
  return (
    <div className="space-y-0">
      <PropertyRow label={effectName}>
        <div className="flex items-center gap-1 min-w-0 w-full justify-end">
          <EffectPanelHeaderActions
            effectId={effect.id}
            enabled={effect.enabled}
            isDefault={isDefault}
            onReset={onReset}
            onToggle={onToggle}
            onRemove={onRemove}
            onMove={onMove}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
          />
        </div>
      </PropertyRow>

      {paramEntries.map(([key, param]) => {
        const currentValue = gpuEffect.params[key] ?? param.default
        const paramVisible = param.visibleWhen?.(gpuEffect.params) ?? true
        if (!paramVisible) return null
        const paramEnabled = effect.enabled

        if (param.type === 'number') {
          const keyframeProperty = getKeyframeProperty(effect.id, key)
          return (
            <PropertyRow
              key={key}
              label={getEffectParamLabel(t, definition, key)}
              className={!paramEnabled ? 'opacity-50' : undefined}
            >
              <SliderInput
                value={currentValue as number}
                onChange={(v) => onParamChange(effect.id, key, v)}
                onLiveChange={(v) => onParamLiveChange(effect.id, key, v)}
                min={param.min ?? 0}
                max={param.max ?? 1}
                step={param.step ?? 0.01}
                disabled={!paramEnabled}
                className="flex-1 min-w-0"
              />
              {keyframeProperty ? (
                <KeyframeToggle
                  itemIds={itemIds}
                  property={keyframeProperty}
                  currentValue={currentValue as number}
                  disabled={!paramEnabled}
                />
              ) : null}
            </PropertyRow>
          )
        }

        if (param.type === 'boolean') {
          return (
            <PropertyRow
              key={key}
              label={getEffectParamLabel(t, definition, key)}
              className={!paramEnabled ? 'opacity-50' : undefined}
            >
              <Button
                variant={currentValue ? 'default' : 'outline'}
                size="sm"
                className="h-6 text-xs"
                onClick={() => onParamChange(effect.id, key, !currentValue)}
                disabled={!paramEnabled}
              >
                {currentValue ? t('effects.panel.on') : t('effects.panel.off')}
              </Button>
            </PropertyRow>
          )
        }

        if (param.type === 'select' && param.options) {
          return (
            <PropertyRow
              key={key}
              label={getEffectParamLabel(t, definition, key)}
              className={!paramEnabled ? 'opacity-50' : undefined}
            >
              <Select
                value={currentValue as string}
                onValueChange={(v) => onParamChange(effect.id, key, v)}
                disabled={!paramEnabled}
              >
                <SelectTrigger className="h-6 text-xs flex-1 min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {param.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {getEffectOptionLabel(t, definition, key, opt)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropertyRow>
          )
        }

        if (param.type === 'color') {
          const keyframeProperty = getKeyframeProperty(effect.id, key)
          const keyframeValue = getGpuEffectKeyframeValue(effect, key, currentValue)
          return (
            <PropertyRow
              key={key}
              label={getEffectParamLabel(t, definition, key)}
              className={!paramEnabled ? 'opacity-50' : undefined}
            >
              <ColorPicker
                color={currentValue as string}
                onChange={(v) => onParamChange(effect.id, key, v)}
                onLiveChange={(v) => onParamLiveChange(effect.id, key, v)}
                disabled={!paramEnabled}
              />
              {keyframeProperty && keyframeValue !== null ? (
                <KeyframeToggle
                  itemIds={itemIds}
                  property={keyframeProperty}
                  currentValue={keyframeValue}
                  disabled={!paramEnabled}
                />
              ) : null}
            </PropertyRow>
          )
        }

        if (param.type === 'text') {
          return (
            <TextParamRow
              key={key}
              effectId={effect.id}
              paramKey={key}
              label={getEffectParamLabel(t, definition, key)}
              value={currentValue as string}
              disabled={!paramEnabled}
              className={!paramEnabled ? 'opacity-50' : undefined}
              onParamChange={onParamChange}
              onParamLiveChange={onParamLiveChange}
            />
          )
        }

        return null
      })}
    </div>
  )
})
