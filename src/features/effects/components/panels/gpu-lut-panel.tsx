import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, FileUp, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ItemEffect, GpuEffect } from '@/types/effects'
import type { GpuEffectDefinition } from '@/infrastructure/gpu-effects'
import {
  parseCubeLut,
  resampleCubeLut,
  encodeLutData,
} from '@/infrastructure/gpu-effects/lut/cube-lut'
import type { AnimatableProperty } from '@/types/keyframe'
import { KeyframeToggle } from '@/features/effects/deps/keyframes-contract'
import { PropertyRow, SliderInput } from '@/shared/ui/property-controls'
import { createLogger } from '@/shared/logging/logger'
import { getEffectDefinitionName } from '@/features/effects/utils/effect-i18n'
import { EffectMoveButtons, type EffectMoveProps } from './effect-move-buttons'

const logger = createLogger('GpuLutPanel')

/** Imported LUTs are resampled down to this grid to bound param/project size (~143KB rgba8). */
const MAX_EMBEDDED_LUT_SIZE = 33

interface GpuLutPanelProps extends EffectMoveProps {
  itemIds: string[]
  effect: ItemEffect
  gpuEffect: GpuEffect
  definition: GpuEffectDefinition
  getKeyframeProperty: (effectId: string, paramKey: string) => AnimatableProperty | null
  onParamChange: (effectId: string, paramKey: string, value: number | boolean | string) => void
  onParamLiveChange: (effectId: string, paramKey: string, value: number | boolean | string) => void
  onParamsBatchChange: (
    effectId: string,
    updates: Record<string, number | boolean | string>,
  ) => void
  onReset: (effectId: string) => void
  onToggle: (effectId: string) => void
  onRemove: (effectId: string) => void
}

/**
 * Panel for the gpu-lut effect: imports a .cube file, embeds the (resampled)
 * LUT into the effect params, and exposes an intensity slider.
 */
export const GpuLutPanel = memo(function GpuLutPanel({
  itemIds,
  effect,
  gpuEffect,
  definition,
  getKeyframeProperty,
  onParamChange,
  onParamLiveChange,
  onParamsBatchChange,
  onReset,
  onToggle,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
}: GpuLutPanelProps) {
  const { t } = useTranslation()
  const [importError, setImportError] = useState<string | null>(null)

  const lutName = typeof gpuEffect.params.lutName === 'string' ? gpuEffect.params.lutName : ''
  const hasLut = typeof gpuEffect.params.lutData === 'string' && gpuEffect.params.lutData.length > 0
  const intensity = typeof gpuEffect.params.intensity === 'number' ? gpuEffect.params.intensity : 1
  const isDefault = !hasLut && intensity === 1

  const handleImport = useCallback(async () => {
    if (typeof window.showOpenFilePicker !== 'function') {
      setImportError(t('effects.lut.unsupportedBrowser'))
      return
    }

    let handles: FileSystemFileHandle[]
    try {
      handles = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: '3D LUT',
            accept: { 'application/octet-stream': ['.cube'] },
          },
        ],
      })
    } catch {
      return // user cancelled the picker
    }

    const handle = handles[0]
    if (!handle) return

    try {
      const file = await handle.getFile()
      const parsed = resampleCubeLut(parseCubeLut(await file.text()), MAX_EMBEDDED_LUT_SIZE)
      onParamsBatchChange(effect.id, {
        lutName: parsed.title ?? file.name.replace(/\.cube$/i, ''),
        lutSize: String(parsed.size),
        lutData: encodeLutData(parsed.data),
      })
      setImportError(null)
    } catch (error) {
      logger.warn('Failed to import .cube LUT:', error)
      setImportError(t('effects.lut.importFailed'))
    }
  }, [effect.id, onParamsBatchChange, t])

  const keyframeProperty = getKeyframeProperty(effect.id, 'intensity')

  return (
    <div className="space-y-0">
      <PropertyRow label={getEffectDefinitionName(definition)}>
        <div className="flex items-center gap-1 min-w-0 w-full justify-end">
          <EffectMoveButtons
            effectId={effect.id}
            onMove={onMove}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
          />
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 flex-shrink-0 ${isDefault ? 'opacity-30' : ''}`}
            onClick={() => onReset(effect.id)}
            title={t('effects.panel.resetToDefaults')}
            disabled={isDefault}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0"
            onClick={() => onToggle(effect.id)}
            title={
              effect.enabled ? t('effects.panel.disableEffect') : t('effects.panel.enableEffect')
            }
          >
            {effect.enabled ? (
              <Eye className="w-3 h-3" />
            ) : (
              <EyeOff className="w-3 h-3 text-muted-foreground" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0"
            onClick={() => onRemove(effect.id)}
            title={t('effects.panel.removeEffect')}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </PropertyRow>

      <PropertyRow
        label={t('effects.lut.file')}
        className={!effect.enabled ? 'opacity-50' : undefined}
      >
        <div className="flex items-center gap-1 min-w-0 w-full">
          <Button
            variant="outline"
            size="sm"
            className="h-6 flex-1 min-w-0 justify-start gap-1.5 text-xs"
            onClick={() => void handleImport()}
            disabled={!effect.enabled}
            title={t('effects.lut.importTooltip')}
          >
            <FileUp className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">
              {hasLut && lutName ? lutName : t('effects.lut.import')}
            </span>
          </Button>
        </div>
      </PropertyRow>
      {importError && <div className="px-2 pb-1 text-[11px] text-destructive">{importError}</div>}

      <PropertyRow
        label={t('effects.lut.intensity')}
        className={!effect.enabled ? 'opacity-50' : undefined}
      >
        <SliderInput
          value={intensity}
          onChange={(v) => onParamChange(effect.id, 'intensity', v)}
          onLiveChange={(v) => onParamLiveChange(effect.id, 'intensity', v)}
          min={0}
          max={1}
          step={0.01}
          disabled={!effect.enabled}
          className="flex-1 min-w-0"
        />
        {keyframeProperty ? (
          <KeyframeToggle
            itemIds={itemIds}
            property={keyframeProperty}
            currentValue={intensity}
            disabled={!effect.enabled}
          />
        ) : null}
      </PropertyRow>
    </div>
  )
})
