import { memo } from 'react';
import { Eye, EyeOff, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ItemEffect, CSSFilterEffect } from '@/types/effects';
import { CSS_FILTER_CONFIGS } from '@/types/effects';
import { PropertyRow, NumberInput } from '@/shared/ui/property-controls';

interface CSSFilterPanelProps {
  effect: ItemEffect;
  cssEffect: CSSFilterEffect;
  onEffectChange: (effectId: string, value: number) => void;
  onEffectLiveChange: (effectId: string, value: number) => void;
  onReset: (effectId: string, filterType: CSSFilterEffect['filter']) => void;
  onToggle: (effectId: string) => void;
  onRemove: (effectId: string) => void;
}

/**
 * Panel for CSS filter effects (brightness, contrast, saturation, etc.)
 * Single row with value input and action buttons.
 */
export const CSSFilterPanel = memo(function CSSFilterPanel({
  effect,
  cssEffect,
  onEffectChange,
  onEffectLiveChange,
  onReset,
  onToggle,
  onRemove,
}: CSSFilterPanelProps) {
  const config = CSS_FILTER_CONFIGS[cssEffect.filter];
  const isDefault = cssEffect.value === config.default;

  return (
    <PropertyRow label={config.label}>
      <div className="flex items-center gap-1 min-w-0 w-full">
        <NumberInput
          value={cssEffect.value}
          onChange={(v) => onEffectChange(effect.id, v)}
          onLiveChange={(v) => onEffectLiveChange(effect.id, v)}
          min={config.min}
          max={config.max}
          step={config.step}
          unit={config.unit}
          disabled={!effect.enabled}
          className="flex-1 min-w-0"
        />
        <Button
          variant="ghost"
          size="icon"
          className={`h-6 w-6 flex-shrink-0 ${isDefault ? 'opacity-30' : ''}`}
          onClick={() => onReset(effect.id, cssEffect.filter)}
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
