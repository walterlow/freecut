import { memo } from 'react';
import { Eye, EyeOff, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ItemEffect, GlitchEffect } from '@/types/effects';
import { GLITCH_CONFIGS } from '@/types/effects';
import { PropertyRow, NumberInput } from '@/shared/ui/property-controls';

interface GlitchPanelProps {
  effect: ItemEffect;
  glitchEffect: GlitchEffect;
  onIntensityChange: (effectId: string, percentValue: number) => void;
  onIntensityLiveChange: (effectId: string, percentValue: number) => void;
  onReset: (effectId: string) => void;
  onToggle: (effectId: string) => void;
  onRemove: (effectId: string) => void;
}

/**
 * Panel for glitch effects (RGB Shift, Pixelate, Scanlines, etc.)
 * Single row with intensity slider (0-100%) and action buttons.
 */
export const GlitchPanel = memo(function GlitchPanel({
  effect,
  glitchEffect,
  onIntensityChange,
  onIntensityLiveChange,
  onReset,
  onToggle,
  onRemove,
}: GlitchPanelProps) {
  const config = GLITCH_CONFIGS[glitchEffect.variant];
  const isDefault = glitchEffect.intensity === 0.5;

  return (
    <PropertyRow label={config.label}>
      <div className="flex items-center gap-1 min-w-0 w-full">
        <NumberInput
          value={Math.round(glitchEffect.intensity * 100)}
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
          className={`h-6 w-6 flex-shrink-0 ${isDefault ? 'opacity-30' : ''}`}
          onClick={() => onReset(effect.id)}
          title="Reset to default"
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
  );
});
