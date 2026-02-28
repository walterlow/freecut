import { memo } from 'react';
import { Eye, EyeOff, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ItemEffect, HalftoneEffect, HalftonePatternType, HalftoneBlendMode } from '@/types/effects';
import {
  CANVAS_EFFECT_CONFIGS,
  HALFTONE_CONFIG,
  HALFTONE_PATTERN_LABELS,
  HALFTONE_BLEND_MODE_LABELS,
} from '@/types/effects';
import {
  PropertyRow,
  NumberInput,
  ColorPicker,
} from '@/shared/ui/property-controls';

interface HalftonePanelProps {
  effect: ItemEffect;
  halftone: HalftoneEffect;
  onPropertyChange: (effectId: string, property: keyof HalftoneEffect, value: number | string | boolean) => void;
  onPropertyLiveChange: (effectId: string, property: keyof HalftoneEffect, value: number | string | boolean) => void;
  onIntensityChange: (effectId: string, percentValue: number) => void;
  onIntensityLiveChange: (effectId: string, percentValue: number) => void;
  onReset: (effectId: string, property: keyof HalftoneEffect) => void;
  onToggle: (effectId: string) => void;
  onRemove: (effectId: string) => void;
}

/**
 * Panel for halftone effect with pattern type, size, spacing, angle, intensity,
 * softness, blend mode, inverted toggle, dot color, and fade controls.
 */
export const HalftonePanel = memo(function HalftonePanel({
  effect,
  halftone,
  onPropertyChange,
  onPropertyLiveChange,
  onIntensityChange,
  onIntensityLiveChange,
  onReset,
  onToggle,
  onRemove,
}: HalftonePanelProps) {
  const patternType = halftone.patternType ?? 'dots';
  const softness = halftone.softness ?? HALFTONE_CONFIG.softness.default;
  const blendMode = halftone.blendMode ?? 'multiply';
  const inverted = halftone.inverted ?? false;
  const fadeAngle = halftone.fadeAngle ?? HALFTONE_CONFIG.fadeAngle.default;
  const fadeAmount = halftone.fadeAmount ?? HALFTONE_CONFIG.fadeAmount.default;

  return (
    <div className="border-b border-border/50 pb-2 mb-2">
      {/* Header row with toggle and delete */}
      <PropertyRow label={CANVAS_EFFECT_CONFIGS.halftone.label}>
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

      {/* Pattern Type */}
      <PropertyRow label={HALFTONE_CONFIG.patternType.label}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 flex-1 min-w-0 justify-between text-xs"
                disabled={!effect.enabled}
              >
                <span className="truncate">{HALFTONE_PATTERN_LABELS[patternType]}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32">
              {(Object.keys(HALFTONE_PATTERN_LABELS) as HalftonePatternType[]).map((type) => (
                <DropdownMenuItem
                  key={type}
                  onClick={() => onPropertyChange(effect.id, 'patternType', type)}
                >
                  {HALFTONE_PATTERN_LABELS[type]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 flex-shrink-0 ${patternType === HALFTONE_CONFIG.patternType.default ? 'opacity-30' : ''}`}
            onClick={() => onReset(effect.id, 'patternType')}
            title="Reset to default"
            disabled={patternType === HALFTONE_CONFIG.patternType.default}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </PropertyRow>

      {/* Size */}
      <PropertyRow label={HALFTONE_CONFIG.dotSize.label}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <NumberInput
            value={halftone.dotSize}
            onChange={(v) => onPropertyChange(effect.id, 'dotSize', v)}
            onLiveChange={(v) => onPropertyLiveChange(effect.id, 'dotSize', v)}
            min={HALFTONE_CONFIG.dotSize.min}
            max={HALFTONE_CONFIG.dotSize.max}
            step={HALFTONE_CONFIG.dotSize.step}
            unit={HALFTONE_CONFIG.dotSize.unit}
            disabled={!effect.enabled}
            className="flex-1 min-w-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 flex-shrink-0 ${halftone.dotSize === HALFTONE_CONFIG.dotSize.default ? 'opacity-30' : ''}`}
            onClick={() => onReset(effect.id, 'dotSize')}
            title="Reset to default"
            disabled={halftone.dotSize === HALFTONE_CONFIG.dotSize.default}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </PropertyRow>

      {/* Spacing */}
      <PropertyRow label={HALFTONE_CONFIG.spacing.label}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <NumberInput
            value={halftone.spacing}
            onChange={(v) => onPropertyChange(effect.id, 'spacing', v)}
            onLiveChange={(v) => onPropertyLiveChange(effect.id, 'spacing', v)}
            min={HALFTONE_CONFIG.spacing.min}
            max={HALFTONE_CONFIG.spacing.max}
            step={HALFTONE_CONFIG.spacing.step}
            unit={HALFTONE_CONFIG.spacing.unit}
            disabled={!effect.enabled}
            className="flex-1 min-w-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 flex-shrink-0 ${halftone.spacing === HALFTONE_CONFIG.spacing.default ? 'opacity-30' : ''}`}
            onClick={() => onReset(effect.id, 'spacing')}
            title="Reset to default"
            disabled={halftone.spacing === HALFTONE_CONFIG.spacing.default}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </PropertyRow>

      {/* Angle */}
      <PropertyRow label={HALFTONE_CONFIG.angle.label}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <NumberInput
            value={halftone.angle}
            onChange={(v) => onPropertyChange(effect.id, 'angle', v)}
            onLiveChange={(v) => onPropertyLiveChange(effect.id, 'angle', v)}
            min={HALFTONE_CONFIG.angle.min}
            max={HALFTONE_CONFIG.angle.max}
            step={HALFTONE_CONFIG.angle.step}
            unit={HALFTONE_CONFIG.angle.unit}
            disabled={!effect.enabled}
            className="flex-1 min-w-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 flex-shrink-0 ${halftone.angle === HALFTONE_CONFIG.angle.default ? 'opacity-30' : ''}`}
            onClick={() => onReset(effect.id, 'angle')}
            title="Reset to default"
            disabled={halftone.angle === HALFTONE_CONFIG.angle.default}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </PropertyRow>

      {/* Intensity */}
      <PropertyRow label={HALFTONE_CONFIG.intensity.label}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <NumberInput
            value={Math.round(halftone.intensity * 100)}
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
            className={`h-6 w-6 flex-shrink-0 ${halftone.intensity === HALFTONE_CONFIG.intensity.default ? 'opacity-30' : ''}`}
            onClick={() => onReset(effect.id, 'intensity')}
            title="Reset to default"
            disabled={halftone.intensity === HALFTONE_CONFIG.intensity.default}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </PropertyRow>

      {/* Softness */}
      <PropertyRow label={HALFTONE_CONFIG.softness.label}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <NumberInput
            value={Math.round(softness * 100)}
            onChange={(v) => onPropertyChange(effect.id, 'softness', v / 100)}
            onLiveChange={(v) => onPropertyLiveChange(effect.id, 'softness', v / 100)}
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
            className={`h-6 w-6 flex-shrink-0 ${softness === HALFTONE_CONFIG.softness.default ? 'opacity-30' : ''}`}
            onClick={() => onReset(effect.id, 'softness')}
            title="Reset to default"
            disabled={softness === HALFTONE_CONFIG.softness.default}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </PropertyRow>

      {/* Blend Mode */}
      <PropertyRow label={HALFTONE_CONFIG.blendMode.label}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 flex-1 min-w-0 justify-between text-xs"
                disabled={!effect.enabled}
              >
                <span className="truncate">{HALFTONE_BLEND_MODE_LABELS[blendMode]}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32">
              {(Object.keys(HALFTONE_BLEND_MODE_LABELS) as HalftoneBlendMode[]).map((mode) => (
                <DropdownMenuItem
                  key={mode}
                  onClick={() => onPropertyChange(effect.id, 'blendMode', mode)}
                >
                  {HALFTONE_BLEND_MODE_LABELS[mode]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 flex-shrink-0 ${blendMode === HALFTONE_CONFIG.blendMode.default ? 'opacity-30' : ''}`}
            onClick={() => onReset(effect.id, 'blendMode')}
            title="Reset to default"
            disabled={blendMode === HALFTONE_CONFIG.blendMode.default}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </PropertyRow>

      {/* Inverted toggle */}
      <PropertyRow label={HALFTONE_CONFIG.inverted.label}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <Button
            variant={inverted ? 'default' : 'outline'}
            size="sm"
            className="h-7 flex-1 min-w-0 text-xs"
            onClick={() => onPropertyChange(effect.id, 'inverted', !inverted)}
            disabled={!effect.enabled}
          >
            {inverted ? 'On' : 'Off'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 flex-shrink-0 ${inverted === HALFTONE_CONFIG.inverted.default ? 'opacity-30' : ''}`}
            onClick={() => onReset(effect.id, 'inverted')}
            title="Reset to default"
            disabled={inverted === HALFTONE_CONFIG.inverted.default}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </PropertyRow>

      {/* Dot Color */}
      <ColorPicker
        label="Color"
        color={halftone.dotColor}
        onChange={(c) => onPropertyChange(effect.id, 'dotColor', c)}
        onLiveChange={(c) => onPropertyLiveChange(effect.id, 'dotColor', c)}
        onReset={() => onReset(effect.id, 'dotColor')}
        defaultColor="#000000"
        disabled={!effect.enabled}
      />

      {/* Fade Angle (-1 = off, 0-360 = direction) */}
      <PropertyRow label={HALFTONE_CONFIG.fadeAngle.label}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <NumberInput
            value={fadeAngle}
            onChange={(v) => onPropertyChange(effect.id, 'fadeAngle', v)}
            onLiveChange={(v) => onPropertyLiveChange(effect.id, 'fadeAngle', v)}
            min={HALFTONE_CONFIG.fadeAngle.min}
            max={HALFTONE_CONFIG.fadeAngle.max}
            step={HALFTONE_CONFIG.fadeAngle.step}
            unit={fadeAngle >= 0 ? HALFTONE_CONFIG.fadeAngle.unit : ''}
            disabled={!effect.enabled}
            className="flex-1 min-w-0"
            placeholder={fadeAngle < 0 ? 'Off' : undefined}
          />
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 flex-shrink-0 ${fadeAngle === HALFTONE_CONFIG.fadeAngle.default ? 'opacity-30' : ''}`}
            onClick={() => onReset(effect.id, 'fadeAngle')}
            title="Reset to default"
            disabled={fadeAngle === HALFTONE_CONFIG.fadeAngle.default}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </PropertyRow>

      {/* Fade Amount - only show when fade is enabled */}
      {fadeAngle >= 0 && (
        <PropertyRow label={HALFTONE_CONFIG.fadeAmount.label}>
          <div className="flex items-center gap-1 min-w-0 w-full">
            <NumberInput
              value={Math.round(fadeAmount * 100)}
              onChange={(v) => onPropertyChange(effect.id, 'fadeAmount', v / 100)}
              onLiveChange={(v) => onPropertyLiveChange(effect.id, 'fadeAmount', v / 100)}
              min={5}
              max={100}
              step={1}
              unit="%"
              disabled={!effect.enabled}
              className="flex-1 min-w-0"
            />
            <Button
              variant="ghost"
              size="icon"
              className={`h-6 w-6 flex-shrink-0 ${fadeAmount === HALFTONE_CONFIG.fadeAmount.default ? 'opacity-30' : ''}`}
              onClick={() => onReset(effect.id, 'fadeAmount')}
              title="Reset to default"
              disabled={fadeAmount === HALFTONE_CONFIG.fadeAmount.default}
            >
              <RotateCcw className="w-3 h-3" />
            </Button>
          </div>
        </PropertyRow>
      )}
    </div>
  );
});
