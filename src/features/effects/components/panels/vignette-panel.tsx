import { memo } from 'react';
import { Eye, EyeOff, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ItemEffect, VignetteEffect } from '@/types/effects';
import { OVERLAY_EFFECT_CONFIGS, VIGNETTE_CONFIG } from '@/types/effects';
import {
  PropertyRow,
  NumberInput,
  ColorPicker,
} from '@/shared/ui/property-controls';

interface VignettePanelProps {
  effect: ItemEffect;
  vignette: VignetteEffect;
  onPercentChange: (effectId: string, property: 'intensity' | 'size' | 'softness', percentValue: number) => void;
  onPercentLiveChange: (effectId: string, property: 'intensity' | 'size' | 'softness', percentValue: number) => void;
  onColorChange: (effectId: string, property: 'color', value: string) => void;
  onColorLiveChange: (effectId: string, property: 'color', value: string) => void;
  onReset: (effectId: string, property: keyof VignetteEffect) => void;
  onToggle: (effectId: string) => void;
  onRemove: (effectId: string) => void;
}

/**
 * Panel for vignette effect with intensity, size, softness, and color controls.
 */
export const VignettePanel = memo(function VignettePanel({
  effect,
  vignette,
  onPercentChange,
  onPercentLiveChange,
  onColorChange,
  onColorLiveChange,
  onReset,
  onToggle,
  onRemove,
}: VignettePanelProps) {
  return (
    <div className="border-b border-border/50 pb-2 mb-2">
      {/* Header row with toggle and delete */}
      <PropertyRow label={OVERLAY_EFFECT_CONFIGS.vignette.label}>
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

      {/* Intensity */}
      <PropertyRow label={VIGNETTE_CONFIG.intensity.label}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <NumberInput
            value={Math.round(vignette.intensity * 100)}
            onChange={(v) => onPercentChange(effect.id, 'intensity', v)}
            onLiveChange={(v) => onPercentLiveChange(effect.id, 'intensity', v)}
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
            className={`h-6 w-6 flex-shrink-0 ${vignette.intensity === VIGNETTE_CONFIG.intensity.default ? 'opacity-30' : ''}`}
            onClick={() => onReset(effect.id, 'intensity')}
            title="Reset to default"
            disabled={vignette.intensity === VIGNETTE_CONFIG.intensity.default}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </PropertyRow>

      {/* Size */}
      <PropertyRow label={VIGNETTE_CONFIG.size.label}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <NumberInput
            value={Math.round(vignette.size * 100)}
            onChange={(v) => onPercentChange(effect.id, 'size', v)}
            onLiveChange={(v) => onPercentLiveChange(effect.id, 'size', v)}
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
            className={`h-6 w-6 flex-shrink-0 ${vignette.size === VIGNETTE_CONFIG.size.default ? 'opacity-30' : ''}`}
            onClick={() => onReset(effect.id, 'size')}
            title="Reset to default"
            disabled={vignette.size === VIGNETTE_CONFIG.size.default}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </PropertyRow>

      {/* Softness */}
      <PropertyRow label={VIGNETTE_CONFIG.softness.label}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <NumberInput
            value={Math.round(vignette.softness * 100)}
            onChange={(v) => onPercentChange(effect.id, 'softness', v)}
            onLiveChange={(v) => onPercentLiveChange(effect.id, 'softness', v)}
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
            className={`h-6 w-6 flex-shrink-0 ${vignette.softness === VIGNETTE_CONFIG.softness.default ? 'opacity-30' : ''}`}
            onClick={() => onReset(effect.id, 'softness')}
            title="Reset to default"
            disabled={vignette.softness === VIGNETTE_CONFIG.softness.default}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </PropertyRow>

      {/* Color */}
      <ColorPicker
        label="Color"
        color={vignette.color}
        onChange={(c) => onColorChange(effect.id, 'color', c)}
        onLiveChange={(c) => onColorLiveChange(effect.id, 'color', c)}
        onReset={() => onReset(effect.id, 'color')}
        defaultColor="#000000"
        disabled={!effect.enabled}
      />
    </div>
  );
});
