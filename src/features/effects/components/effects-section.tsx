import { useCallback, useMemo, useState, useRef, useEffect, memo } from 'react';
import { Sparkles, Plus, Eye, EyeOff, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HexColorPicker } from 'react-colorful';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { TimelineItem } from '@/types/timeline';
import type {
  ItemEffect,
  CSSFilterType,
  CSSFilterEffect,
  GlitchEffect,
  GlitchVariant,
  HalftoneEffect,
} from '@/types/effects';
import { CSS_FILTER_CONFIGS, GLITCH_CONFIGS, EFFECT_PRESETS, HALFTONE_CONFIG, CANVAS_EFFECT_CONFIGS } from '@/types/effects';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import {
  PropertySection,
  PropertyRow,
  SliderInput,
} from '@/features/editor/components/properties-sidebar/components';

/**
 * Color picker for effect colors (halftone dot/background color).
 */
const EffectColorPicker = memo(function EffectColorPicker({
  label,
  color,
  onChange,
  onLiveChange,
  disabled,
}: {
  label: string;
  color: string;
  onChange: (color: string) => void;
  onLiveChange?: (color: string) => void;
  disabled?: boolean;
}) {
  const [localColor, setLocalColor] = useState(color);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalColor(color);
  }, [color]);

  const handleColorChange = useCallback((newColor: string) => {
    setLocalColor(newColor);
    onLiveChange?.(newColor);
  }, [onLiveChange]);

  const handleCommit = useCallback(() => {
    onChange(localColor);
    setIsOpen(false);
  }, [localColor, onChange]);

  // Close picker when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleCommit();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, handleCommit]);

  return (
    <div ref={containerRef} className="relative flex items-center gap-2">
      <span className="text-xs text-muted-foreground min-w-[24px]">{label}</span>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className="w-6 h-6 rounded border border-input flex-shrink-0"
        style={{ backgroundColor: localColor }}
        disabled={disabled}
        aria-label={`Select ${label.toLowerCase()} color`}
      />
      {isOpen && (
        <div className="absolute left-0 top-8 z-50 bg-popover border rounded-md shadow-lg p-2">
          <HexColorPicker color={localColor} onChange={handleColorChange} />
          <Button
            size="sm"
            className="w-full mt-2"
            onClick={handleCommit}
          >
            Apply
          </Button>
        </div>
      )}
    </div>
  );
});

interface EffectsSectionProps {
  items: TimelineItem[];
}

/**
 * Effects section - CSS filters and glitch effects for visual items.
 * Only shown when selection includes video, image, text, or shape clips.
 */
export function EffectsSection({ items }: EffectsSectionProps) {
  const addEffect = useTimelineStore((s) => s.addEffect);
  const updateEffect = useTimelineStore((s) => s.updateEffect);
  const removeEffect = useTimelineStore((s) => s.removeEffect);
  const toggleEffect = useTimelineStore((s) => s.toggleEffect);

  // Gizmo store for live effect preview
  const setEffectsPreview = useGizmoStore((s) => s.setEffectsPreview);
  const clearEffectsPreview = useGizmoStore((s) => s.clearEffectsPreview);

  // Filter to visual items only (exclude audio)
  const visualItems = useMemo(
    () => items.filter((item) => item.type !== 'audio'),
    [items]
  );

  // Memoize item IDs for stable callback dependencies
  const itemIds = useMemo(() => visualItems.map((item) => item.id), [visualItems]);

  // Get effects from first selected item (for display)
  // Multi-select shows first item's effects
  const effects: ItemEffect[] = visualItems[0]?.effects ?? [];

  // Add a CSS filter effect
  const handleAddFilter = useCallback(
    (filterType: CSSFilterType) => {
      const config = CSS_FILTER_CONFIGS[filterType];
      itemIds.forEach((id) => {
        addEffect(id, {
          type: 'css-filter',
          filter: filterType,
          value: config.default,
        } as CSSFilterEffect);
      });
    },
    [itemIds, addEffect]
  );

  // Add a glitch effect
  const handleAddGlitch = useCallback(
    (variant: GlitchVariant) => {
      itemIds.forEach((id) => {
        addEffect(id, {
          type: 'glitch',
          variant,
          intensity: 0.5,
          speed: 1,
          seed: Math.floor(Math.random() * 10000),
        } as GlitchEffect);
      });
    },
    [itemIds, addEffect]
  );

  // Add a halftone effect
  const handleAddHalftone = useCallback(() => {
    itemIds.forEach((id) => {
      addEffect(id, {
        type: 'canvas-effect',
        variant: 'halftone',
        dotSize: HALFTONE_CONFIG.dotSize.default,
        spacing: HALFTONE_CONFIG.spacing.default,
        angle: HALFTONE_CONFIG.angle.default,
        intensity: HALFTONE_CONFIG.intensity.default,
        backgroundColor: '#ffffff',
        dotColor: '#000000',
      } as HalftoneEffect);
    });
  }, [itemIds, addEffect]);

  // Apply a preset (adds multiple effects)
  const handleApplyPreset = useCallback(
    (presetId: string) => {
      const preset = EFFECT_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;

      itemIds.forEach((id) => {
        preset.effects.forEach((effect) => {
          addEffect(id, effect);
        });
      });
    },
    [itemIds, addEffect]
  );

  // Update effect value with live preview
  const handleEffectChange = useCallback(
    (effectId: string, newValue: number) => {
      const effect = effects.find((e) => e.id === effectId);
      if (!effect) return;

      itemIds.forEach((id) => {
        if (effect.effect.type === 'css-filter') {
          updateEffect(id, effectId, {
            effect: { ...effect.effect, value: newValue } as CSSFilterEffect,
          });
        } else if (effect.effect.type === 'glitch') {
          updateEffect(id, effectId, {
            effect: { ...effect.effect, intensity: newValue } as GlitchEffect,
          });
        }
      });
      queueMicrotask(() => clearEffectsPreview());
    },
    [effects, itemIds, updateEffect, clearEffectsPreview]
  );

  // Update halftone effect property
  const handleHalftoneChange = useCallback(
    (effectId: string, property: keyof HalftoneEffect, newValue: number | string) => {
      const effect = effects.find((e) => e.id === effectId);
      if (!effect || effect.effect.type !== 'canvas-effect') return;

      itemIds.forEach((id) => {
        updateEffect(id, effectId, {
          effect: { ...effect.effect, [property]: newValue } as HalftoneEffect,
        });
      });
      queueMicrotask(() => clearEffectsPreview());
    },
    [effects, itemIds, updateEffect, clearEffectsPreview]
  );

  // Live preview during drag
  const handleEffectLiveChange = useCallback(
    (effectId: string, newValue: number) => {
      const effect = effects.find((e) => e.id === effectId);
      if (!effect) return;

      const previews: Record<string, ItemEffect[]> = {};
      itemIds.forEach((id) => {
        const item = visualItems.find((i) => i.id === id);
        if (item) {
          previews[id] = (item.effects ?? []).map((e) => {
            if (e.id !== effectId) return e;
            if (e.effect.type === 'css-filter') {
              return { ...e, effect: { ...e.effect, value: newValue } as CSSFilterEffect };
            } else if (e.effect.type === 'glitch') {
              return { ...e, effect: { ...e.effect, intensity: newValue } as GlitchEffect };
            }
            return e;
          });
        }
      });
      setEffectsPreview(previews);
    },
    [effects, itemIds, visualItems, setEffectsPreview]
  );

  // Live preview for halftone properties
  const handleHalftoneLiveChange = useCallback(
    (effectId: string, property: keyof HalftoneEffect, newValue: number | string) => {
      const effect = effects.find((e) => e.id === effectId);
      if (!effect || effect.effect.type !== 'canvas-effect') return;

      const previews: Record<string, ItemEffect[]> = {};
      itemIds.forEach((id) => {
        const item = visualItems.find((i) => i.id === id);
        if (item) {
          previews[id] = (item.effects ?? []).map((e) => {
            if (e.id !== effectId) return e;
            if (e.effect.type === 'canvas-effect') {
              return { ...e, effect: { ...e.effect, [property]: newValue } as HalftoneEffect };
            }
            return e;
          });
        }
      });
      setEffectsPreview(previews);
    },
    [effects, itemIds, visualItems, setEffectsPreview]
  );

  // Toggle effect visibility
  const handleToggle = useCallback(
    (effectId: string) => {
      itemIds.forEach((id) => toggleEffect(id, effectId));
    },
    [itemIds, toggleEffect]
  );

  // Check if all effects are enabled
  const allEffectsEnabled = useMemo(
    () => effects.length > 0 && effects.every((e) => e.enabled),
    [effects]
  );

  // Toggle all effects on/off
  const handleToggleAll = useCallback(() => {
    const newEnabled = !allEffectsEnabled;
    itemIds.forEach((id) => {
      effects.forEach((effect) => {
        // Only toggle if current state differs from target
        if (effect.enabled !== newEnabled) {
          toggleEffect(id, effect.id);
        }
      });
    });
  }, [itemIds, effects, allEffectsEnabled, toggleEffect]);

  // Remove effect
  const handleRemove = useCallback(
    (effectId: string) => {
      itemIds.forEach((id) => removeEffect(id, effectId));
    },
    [itemIds, removeEffect]
  );

  if (visualItems.length === 0) return null;

  return (
    <PropertySection title="Effects" icon={Sparkles} defaultOpen={true}>
      {/* Add Effect Dropdown + Toggle All */}
      <div className="px-2 pb-2 flex gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="flex-1 h-7 text-xs">
              <Plus className="w-3 h-3 mr-1" />
              Add Effect
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {/* Color Adjustments */}
            <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
              Color Adjustments
            </div>
            {Object.entries(CSS_FILTER_CONFIGS).map(([key, config]) => (
              <DropdownMenuItem
                key={key}
                onClick={() => handleAddFilter(key as CSSFilterType)}
              >
                {config.label}
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />

            {/* Glitch Effects */}
            <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
              Glitch Effects
            </div>
            {Object.entries(GLITCH_CONFIGS).map(([key, config]) => (
              <DropdownMenuItem
                key={key}
                onClick={() => handleAddGlitch(key as GlitchVariant)}
              >
                {config.label}
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />

            {/* Stylized Effects */}
            <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
              Stylized Effects
            </div>
            <DropdownMenuItem onClick={handleAddHalftone}>
              {CANVAS_EFFECT_CONFIGS.halftone.label}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Presets */}
            <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
              Presets
            </div>
            {EFFECT_PRESETS.map((preset) => (
              <DropdownMenuItem
                key={preset.id}
                onClick={() => handleApplyPreset(preset.id)}
              >
                {preset.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {effects.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            onClick={handleToggleAll}
            title={allEffectsEnabled ? 'Disable all effects' : 'Enable all effects'}
          >
            {allEffectsEnabled ? (
              <EyeOff className="w-3.5 h-3.5" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            )}
          </Button>
        )}
      </div>

      {/* Active Effects List */}
      {effects.map((effect) => {
        if (effect.effect.type === 'css-filter') {
          const config = CSS_FILTER_CONFIGS[effect.effect.filter];
          return (
            <PropertyRow key={effect.id} label={config.label}>
              <div className="flex items-center gap-1 flex-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex-shrink-0"
                  onClick={() => handleToggle(effect.id)}
                  title={effect.enabled ? 'Disable effect' : 'Enable effect'}
                >
                  {effect.enabled ? (
                    <Eye className="w-3 h-3" />
                  ) : (
                    <EyeOff className="w-3 h-3 text-muted-foreground" />
                  )}
                </Button>
                <SliderInput
                  value={effect.effect.value}
                  onChange={(v) => handleEffectChange(effect.id, v)}
                  onLiveChange={(v) => handleEffectLiveChange(effect.id, v)}
                  min={config.min}
                  max={config.max}
                  step={config.step}
                  unit={config.unit}
                  disabled={!effect.enabled}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex-shrink-0"
                  onClick={() => handleRemove(effect.id)}
                  title="Remove effect"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </PropertyRow>
          );
        }

        if (effect.effect.type === 'glitch') {
          const config = GLITCH_CONFIGS[effect.effect.variant];
          return (
            <PropertyRow key={effect.id} label={config.label}>
              <div className="flex items-center gap-1 flex-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex-shrink-0"
                  onClick={() => handleToggle(effect.id)}
                  title={effect.enabled ? 'Disable effect' : 'Enable effect'}
                >
                  {effect.enabled ? (
                    <Eye className="w-3 h-3" />
                  ) : (
                    <EyeOff className="w-3 h-3 text-muted-foreground" />
                  )}
                </Button>
                <SliderInput
                  value={effect.effect.intensity}
                  onChange={(v) => handleEffectChange(effect.id, v)}
                  onLiveChange={(v) => handleEffectLiveChange(effect.id, v)}
                  min={0}
                  max={1}
                  step={0.01}
                  formatValue={(v) => `${Math.round(v * 100)}%`}
                  disabled={!effect.enabled}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex-shrink-0"
                  onClick={() => handleRemove(effect.id)}
                  title="Remove effect"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </PropertyRow>
          );
        }

        if (effect.effect.type === 'canvas-effect' && effect.effect.variant === 'halftone') {
          const halftone = effect.effect as HalftoneEffect;
          return (
            <div key={effect.id} className="border-b border-border/50 pb-2 mb-2">
              {/* Header row with toggle and delete */}
              <PropertyRow label={CANVAS_EFFECT_CONFIGS.halftone.label}>
                <div className="flex items-center gap-1 flex-1 justify-end">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 flex-shrink-0"
                    onClick={() => handleToggle(effect.id)}
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
                    onClick={() => handleRemove(effect.id)}
                    title="Remove effect"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </PropertyRow>

              {/* Dot Size */}
              <PropertyRow label={HALFTONE_CONFIG.dotSize.label}>
                <SliderInput
                  value={halftone.dotSize}
                  onChange={(v) => handleHalftoneChange(effect.id, 'dotSize', v)}
                  onLiveChange={(v) => handleHalftoneLiveChange(effect.id, 'dotSize', v)}
                  min={HALFTONE_CONFIG.dotSize.min}
                  max={HALFTONE_CONFIG.dotSize.max}
                  step={HALFTONE_CONFIG.dotSize.step}
                  unit={HALFTONE_CONFIG.dotSize.unit}
                  disabled={!effect.enabled}
                />
              </PropertyRow>

              {/* Spacing */}
              <PropertyRow label={HALFTONE_CONFIG.spacing.label}>
                <SliderInput
                  value={halftone.spacing}
                  onChange={(v) => handleHalftoneChange(effect.id, 'spacing', v)}
                  onLiveChange={(v) => handleHalftoneLiveChange(effect.id, 'spacing', v)}
                  min={HALFTONE_CONFIG.spacing.min}
                  max={HALFTONE_CONFIG.spacing.max}
                  step={HALFTONE_CONFIG.spacing.step}
                  unit={HALFTONE_CONFIG.spacing.unit}
                  disabled={!effect.enabled}
                />
              </PropertyRow>

              {/* Angle */}
              <PropertyRow label={HALFTONE_CONFIG.angle.label}>
                <SliderInput
                  value={halftone.angle}
                  onChange={(v) => handleHalftoneChange(effect.id, 'angle', v)}
                  onLiveChange={(v) => handleHalftoneLiveChange(effect.id, 'angle', v)}
                  min={HALFTONE_CONFIG.angle.min}
                  max={HALFTONE_CONFIG.angle.max}
                  step={HALFTONE_CONFIG.angle.step}
                  unit={HALFTONE_CONFIG.angle.unit}
                  disabled={!effect.enabled}
                />
              </PropertyRow>

              {/* Intensity */}
              <PropertyRow label={HALFTONE_CONFIG.intensity.label}>
                <SliderInput
                  value={halftone.intensity}
                  onChange={(v) => handleHalftoneChange(effect.id, 'intensity', v)}
                  onLiveChange={(v) => handleHalftoneLiveChange(effect.id, 'intensity', v)}
                  min={HALFTONE_CONFIG.intensity.min}
                  max={HALFTONE_CONFIG.intensity.max}
                  step={HALFTONE_CONFIG.intensity.step}
                  formatValue={(v) => `${Math.round(v * 100)}%`}
                  disabled={!effect.enabled}
                />
              </PropertyRow>

              {/* Colors */}
              <PropertyRow label="Colors">
                <div className="flex items-center gap-3">
                  <EffectColorPicker
                    label="Dot"
                    color={halftone.dotColor}
                    onChange={(c) => handleHalftoneChange(effect.id, 'dotColor', c)}
                    onLiveChange={(c) => handleHalftoneLiveChange(effect.id, 'dotColor', c)}
                    disabled={!effect.enabled}
                  />
                  <EffectColorPicker
                    label="Bg"
                    color={halftone.backgroundColor}
                    onChange={(c) => handleHalftoneChange(effect.id, 'backgroundColor', c)}
                    onLiveChange={(c) => handleHalftoneLiveChange(effect.id, 'backgroundColor', c)}
                    disabled={!effect.enabled}
                  />
                </div>
              </PropertyRow>
            </div>
          );
        }

        return null;
      })}

      {/* Empty state */}
      {effects.length === 0 && (
        <div className="px-2 py-3 text-xs text-muted-foreground text-center">
          No effects applied. Click "Add Effect" to get started.
        </div>
      )}
    </PropertySection>
  );
}
