import { memo } from 'react';
import { Eye, EyeOff, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ItemEffect, LUTEffect, LUTPresetId } from '@/types/effects';
import { LUT_PRESET_CONFIGS } from '@/types/effects';
import { PropertyRow, NumberInput } from '@/shared/ui/property-controls';

interface LUTPanelProps {
  effect: ItemEffect;
  lut: LUTEffect;
  onPresetChange: (effectId: string, preset: LUTPresetId) => void;
  onIntensityChange: (effectId: string, percentValue: number) => void;
  onIntensityLiveChange: (effectId: string, percentValue: number) => void;
  onResetPreset: (effectId: string) => void;
  onResetIntensity: (effectId: string) => void;
  onToggle: (effectId: string) => void;
  onRemove: (effectId: string) => void;
}

const DEFAULT_LUT: LUTPresetId = 'cinematic';
const DEFAULT_INTENSITY = 1;

export const LUTPanel = memo(function LUTPanel({
  effect,
  lut,
  onPresetChange,
  onIntensityChange,
  onIntensityLiveChange,
  onResetPreset,
  onResetIntensity,
  onToggle,
  onRemove,
}: LUTPanelProps) {
  const presetMeta = LUT_PRESET_CONFIGS[lut.preset];

  return (
    <div className="border-b border-border/50 pb-2 mb-2">
      <PropertyRow label="LUT">
        <div className="flex items-center gap-1 flex-1 justify-end">
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

      <PropertyRow label="Preset">
        <div className="flex items-center gap-1 min-w-0 w-full">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 flex-1 min-w-0 justify-between text-xs"
                disabled={!effect.enabled}
                title={presetMeta.description}
              >
                <span className="truncate">{presetMeta.label}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {(Object.keys(LUT_PRESET_CONFIGS) as LUTPresetId[]).map((presetId) => (
                <DropdownMenuItem
                  key={presetId}
                  onClick={() => onPresetChange(effect.id, presetId)}
                >
                  {LUT_PRESET_CONFIGS[presetId].label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 flex-shrink-0 ${lut.preset === DEFAULT_LUT ? 'opacity-30' : ''}`}
            onClick={() => onResetPreset(effect.id)}
            title="Reset to default"
            disabled={lut.preset === DEFAULT_LUT}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </PropertyRow>

      <PropertyRow label="Amount">
        <div className="flex items-center gap-1 min-w-0 w-full">
          <NumberInput
            value={Math.round(lut.intensity * 100)}
            onChange={(v) => onIntensityChange(effect.id, v)}
            onLiveChange={(v) => onIntensityLiveChange(effect.id, v)}
            min={0}
            max={100}
            step={1}
            unit="%"
            disabled={!effect.enabled}
            className="flex-1 min-w-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 flex-shrink-0 ${Math.abs(lut.intensity - DEFAULT_INTENSITY) < 0.001 ? 'opacity-30' : ''}`}
            onClick={() => onResetIntensity(effect.id)}
            title="Reset to default"
            disabled={Math.abs(lut.intensity - DEFAULT_INTENSITY) < 0.001}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </PropertyRow>
    </div>
  );
});

