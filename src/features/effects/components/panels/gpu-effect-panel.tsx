import { memo } from 'react';
import { Eye, EyeOff, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ItemEffect, GpuEffect } from '@/types/effects';
import type { GpuEffectDefinition } from '@/lib/gpu-effects/types';
import { PropertyRow, NumberInput } from '@/shared/ui/property-controls';

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

  return (
    <div className="space-y-0">
      {/* Header row with effect name and action buttons */}
      <PropertyRow label={definition.name}>
        <div className="flex items-center gap-1 min-w-0 w-full justify-end">
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 flex-shrink-0 ${isDefault ? 'opacity-30' : ''}`}
            onClick={() => onReset(effect.id)}
            title="Reset to defaults"
            disabled={isDefault}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0"
            onClick={() => onToggle(effect.id)}
            title={effect.enabled ? 'Disable effect' : 'Enable effect'}
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
            title="Remove effect"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </PropertyRow>

      {/* Parameter rows */}
      {paramEntries.map(([key, param]) => {
        const currentValue = gpuEffect.params[key] ?? param.default;

        if (param.type === 'number') {
          return (
            <PropertyRow key={key} label={param.label}>
              <NumberInput
                value={currentValue as number}
                onChange={(v) => onParamChange(effect.id, key, v)}
                onLiveChange={(v) => onParamLiveChange(effect.id, key, v)}
                min={param.min ?? 0}
                max={param.max ?? 1}
                step={param.step ?? 0.01}
                disabled={!effect.enabled}
                className="flex-1 min-w-0"
              />
            </PropertyRow>
          );
        }

        if (param.type === 'boolean') {
          return (
            <PropertyRow key={key} label={param.label}>
              <Button
                variant={currentValue ? 'default' : 'outline'}
                size="sm"
                className="h-6 text-xs"
                onClick={() => onParamChange(effect.id, key, !currentValue)}
                disabled={!effect.enabled}
              >
                {currentValue ? 'On' : 'Off'}
              </Button>
            </PropertyRow>
          );
        }

        if (param.type === 'select' && param.options) {
          return (
            <PropertyRow key={key} label={param.label}>
              <Select
                value={currentValue as string}
                onValueChange={(v) => onParamChange(effect.id, key, v)}
                disabled={!effect.enabled}
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

        return null;
      })}
    </div>
  );
});
