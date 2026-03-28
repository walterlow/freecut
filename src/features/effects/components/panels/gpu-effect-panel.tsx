import { memo } from 'react';
import { Eye, EyeOff, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ItemEffect, GpuEffect } from '@/types/effects';
import type { GpuEffectDefinition } from '@/infrastructure/gpu/effects';
import { ColorPicker, PropertyRow, SliderInput } from '@/shared/ui/property-controls';

interface GpuEffectPanelProps {
  effect: ItemEffect;
  gpuEffect: GpuEffect;
  definition: GpuEffectDefinition;
  onParamChange: (effectId: string, paramKey: string, value: number | boolean | string) => void;
  onParamLiveChange: (effectId: string, paramKey: string, value: number | boolean | string) => void;
  onReset: (effectId: string) => void;
  onToggle: (effectId: string) => void;
  onRemove: (effectId: string) => void;
}

/**
 * Action buttons shared across single-row and multi-row layouts.
 */
function ActionButtons({
  effectId,
  enabled,
  isDefault,
  onReset,
  onToggle,
  onRemove,
}: {
  effectId: string;
  enabled: boolean;
  isDefault: boolean;
  onReset: (id: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={`h-6 w-6 flex-shrink-0 ${isDefault ? 'opacity-30' : ''}`}
        onClick={() => onReset(effectId)}
        title="Reset to defaults"
        disabled={isDefault}
      >
        <RotateCcw className="w-3 h-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 flex-shrink-0"
        onClick={() => onToggle(effectId)}
        title={enabled ? 'Disable effect' : 'Enable effect'}
      >
        {enabled ? (
          <Eye className="w-3 h-3" />
        ) : (
          <EyeOff className="w-3 h-3 text-muted-foreground" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 flex-shrink-0"
        onClick={() => onRemove(effectId)}
        title="Remove effect"
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </>
  );
}

export const GpuEffectPanel = memo(function GpuEffectPanel({
  effect,
  gpuEffect,
  definition,
  onParamChange,
  onParamLiveChange,
  onReset,
  onToggle,
  onRemove,
}: GpuEffectPanelProps) {
  const paramEntries = Object.entries(definition.params);
  const isDefault = paramEntries.every(
    ([key, param]) => gpuEffect.params[key] === param.default
  );

  // Single number param: compact single-row layout matching CSS filter panels
  if (paramEntries.length === 1 && paramEntries[0]![1].type === 'number') {
    const [key, param] = paramEntries[0]!;
    const currentValue = (gpuEffect.params[key] ?? param.default) as number;
    return (
      <PropertyRow label={definition.name}>
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
          <ActionButtons
            effectId={effect.id}
            enabled={effect.enabled}
            isDefault={isDefault}
            onReset={onReset}
            onToggle={onToggle}
            onRemove={onRemove}
          />
        </div>
      </PropertyRow>
    );
  }

  // Zero params: header-only row with action buttons
  if (paramEntries.length === 0) {
    return (
      <PropertyRow label={definition.name}>
        <div className="flex items-center gap-1 min-w-0 w-full justify-end">
          <ActionButtons
            effectId={effect.id}
            enabled={effect.enabled}
            isDefault={isDefault}
            onReset={onReset}
            onToggle={onToggle}
            onRemove={onRemove}
          />
        </div>
      </PropertyRow>
    );
  }

  // Multi-param: header row with buttons, then one row per param
  return (
    <div className="space-y-0">
      <PropertyRow label={definition.name}>
        <div className="flex items-center gap-1 min-w-0 w-full justify-end">
          <ActionButtons
            effectId={effect.id}
            enabled={effect.enabled}
            isDefault={isDefault}
            onReset={onReset}
            onToggle={onToggle}
            onRemove={onRemove}
          />
        </div>
      </PropertyRow>

      {paramEntries.map(([key, param]) => {
        const currentValue = gpuEffect.params[key] ?? param.default;
        const paramVisible = param.visibleWhen?.(gpuEffect.params) ?? true;
        if (!paramVisible) return null;
        const paramEnabled = effect.enabled;

        if (param.type === 'number') {
          return (
            <PropertyRow
              key={key}
              label={param.label}
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
            </PropertyRow>
          );
        }

        if (param.type === 'boolean') {
          return (
            <PropertyRow
              key={key}
              label={param.label}
              className={!paramEnabled ? 'opacity-50' : undefined}
            >
              <Button
                variant={currentValue ? 'default' : 'outline'}
                size="sm"
                className="h-6 text-xs"
                onClick={() => onParamChange(effect.id, key, !currentValue)}
                disabled={!paramEnabled}
              >
                {currentValue ? 'On' : 'Off'}
              </Button>
            </PropertyRow>
          );
        }

        if (param.type === 'select' && param.options) {
          return (
            <PropertyRow
              key={key}
              label={param.label}
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
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropertyRow>
          );
        }

        if (param.type === 'color') {
          return (
            <PropertyRow
              key={key}
              label={param.label}
              className={!paramEnabled ? 'opacity-50' : undefined}
            >
              <ColorPicker
                color={currentValue as string}
                onChange={(v) => onParamChange(effect.id, key, v)}
                onLiveChange={(v) => onParamLiveChange(effect.id, key, v)}
                disabled={!paramEnabled}
              />
            </PropertyRow>
          );
        }

        return null;
      })}
    </div>
  );
});
