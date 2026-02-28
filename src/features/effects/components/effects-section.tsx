import { useCallback, useMemo, memo, useRef } from 'react';
import { Sparkles, Plus, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  VignetteEffect,
} from '@/types/effects';
import {
  CSS_FILTER_CONFIGS,
  GLITCH_CONFIGS,
  EFFECT_PRESETS,
  HALFTONE_CONFIG,
  CANVAS_EFFECT_CONFIGS,
  VIGNETTE_CONFIG,
  OVERLAY_EFFECT_CONFIGS,
} from '@/types/effects';
import { useTimelineStore } from '@/features/effects/deps/timeline-contract';
import { useGizmoStore } from '@/features/effects/deps/preview-contract';
import { PropertySection } from '@/shared/ui/property-controls';
import { CSSFilterPanel, GlitchPanel, HalftonePanel, VignettePanel } from './panels';

interface EffectsSectionProps {
  /** Visual items (already filtered to exclude audio) */
  items: TimelineItem[];
}

/**
 * Effects section - CSS filters and glitch effects for visual items.
 * Only shown when selection includes video, image, text, or shape clips.
 * Memoized to prevent re-renders when items prop hasn't changed.
 */
export const EffectsSection = memo(function EffectsSection({ items }: EffectsSectionProps) {
  const addEffect = useTimelineStore((s) => s.addEffect);
  const addEffects = useTimelineStore((s) => s.addEffects);
  const updateEffect = useTimelineStore((s) => s.updateEffect);
  const removeEffect = useTimelineStore((s) => s.removeEffect);
  const toggleEffect = useTimelineStore((s) => s.toggleEffect);

  // Gizmo store for live effect preview
  const setEffectsPreviewNew = useGizmoStore((s) => s.setEffectsPreviewNew);
  const clearPreview = useGizmoStore((s) => s.clearPreview);

  // Items are already filtered by parent - use directly
  const visualItems = items;

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
        patternType: HALFTONE_CONFIG.patternType.default,
        dotSize: HALFTONE_CONFIG.dotSize.default,
        spacing: HALFTONE_CONFIG.spacing.default,
        angle: HALFTONE_CONFIG.angle.default,
        intensity: HALFTONE_CONFIG.intensity.default,
        softness: HALFTONE_CONFIG.softness.default,
        blendMode: HALFTONE_CONFIG.blendMode.default,
        inverted: HALFTONE_CONFIG.inverted.default,
        fadeAngle: HALFTONE_CONFIG.fadeAngle.default,
        fadeAmount: HALFTONE_CONFIG.fadeAmount.default,
        dotColor: '#000000',
      } as HalftoneEffect);
    });
  }, [itemIds, addEffect]);

  // Add a vignette effect
  const handleAddVignette = useCallback(() => {
    itemIds.forEach((id) => {
      addEffect(id, {
        type: 'overlay-effect',
        variant: 'vignette',
        intensity: VIGNETTE_CONFIG.intensity.default,
        size: VIGNETTE_CONFIG.size.default,
        softness: VIGNETTE_CONFIG.softness.default,
        color: '#000000',
        shape: 'elliptical',
      } as VignetteEffect);
    });
  }, [itemIds, addEffect]);

  // Apply a preset (adds multiple effects as single undo/redo action)
  const handleApplyPreset = useCallback(
    (presetId: string) => {
      const preset = EFFECT_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;

      // Batch all effects for all items into a single store update
      const updates = itemIds.map((id) => ({
        itemId: id,
        effects: preset.effects,
      }));
      addEffects(updates);
    },
    [itemIds, addEffects]
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
      queueMicrotask(() => clearPreview());
    },
    [effects, itemIds, updateEffect, clearPreview]
  );

  // Update halftone effect property
  const handleHalftoneChange = useCallback(
    (effectId: string, property: keyof HalftoneEffect, newValue: number | string | boolean) => {
      const effect = effects.find((e) => e.id === effectId);
      if (!effect || effect.effect.type !== 'canvas-effect') return;

      itemIds.forEach((id) => {
        updateEffect(id, effectId, {
          effect: { ...effect.effect, [property]: newValue } as HalftoneEffect,
        });
      });
      queueMicrotask(() => clearPreview());
    },
    [effects, itemIds, updateEffect, clearPreview]
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
      setEffectsPreviewNew(previews);
    },
    [effects, itemIds, visualItems, setEffectsPreviewNew]
  );

  // Live preview for halftone properties
  const handleHalftoneLiveChange = useCallback(
    (effectId: string, property: keyof HalftoneEffect, newValue: number | string | boolean) => {
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
      setEffectsPreviewNew(previews);
    },
    [effects, itemIds, visualItems, setEffectsPreviewNew]
  );

  // Glitch intensity handlers (convert from percentage 0-100 to internal 0-1)
  const handleGlitchIntensityChange = useCallback(
    (effectId: string, percentValue: number) => {
      const normalizedValue = percentValue / 100;
      handleEffectChange(effectId, normalizedValue);
    },
    [handleEffectChange]
  );

  const handleGlitchIntensityLiveChange = useCallback(
    (effectId: string, percentValue: number) => {
      const normalizedValue = percentValue / 100;
      handleEffectLiveChange(effectId, normalizedValue);
    },
    [handleEffectLiveChange]
  );

  // Halftone intensity handlers (convert from percentage 0-100 to internal 0-1)
  const handleHalftoneIntensityChange = useCallback(
    (effectId: string, percentValue: number) => {
      const normalizedValue = percentValue / 100;
      handleHalftoneChange(effectId, 'intensity', normalizedValue);
    },
    [handleHalftoneChange]
  );

  const handleHalftoneIntensityLiveChange = useCallback(
    (effectId: string, percentValue: number) => {
      const normalizedValue = percentValue / 100;
      handleHalftoneLiveChange(effectId, 'intensity', normalizedValue);
    },
    [handleHalftoneLiveChange]
  );

  // Update vignette effect property
  const handleVignetteChange = useCallback(
    (effectId: string, property: keyof VignetteEffect, newValue: number | string) => {
      const effect = effects.find((e) => e.id === effectId);
      if (!effect || effect.effect.type !== 'overlay-effect') return;

      itemIds.forEach((id) => {
        updateEffect(id, effectId, {
          effect: { ...effect.effect, [property]: newValue } as VignetteEffect,
        });
      });
      queueMicrotask(() => clearPreview());
    },
    [effects, itemIds, updateEffect, clearPreview]
  );

  // Live preview for vignette properties
  const handleVignetteLiveChange = useCallback(
    (effectId: string, property: keyof VignetteEffect, newValue: number | string) => {
      const effect = effects.find((e) => e.id === effectId);
      if (!effect || effect.effect.type !== 'overlay-effect') return;

      const previews: Record<string, ItemEffect[]> = {};
      itemIds.forEach((id) => {
        const item = visualItems.find((i) => i.id === id);
        if (item) {
          previews[id] = (item.effects ?? []).map((e) => {
            if (e.id !== effectId) return e;
            if (e.effect.type === 'overlay-effect') {
              return { ...e, effect: { ...e.effect, [property]: newValue } as VignetteEffect };
            }
            return e;
          });
        }
      });
      setEffectsPreviewNew(previews);
    },
    [effects, itemIds, visualItems, setEffectsPreviewNew]
  );

  // Vignette property handlers (convert from percentage 0-100 to internal 0-1)
  const handleVignettePercentChange = useCallback(
    (effectId: string, property: 'intensity' | 'size' | 'softness', percentValue: number) => {
      const normalizedValue = percentValue / 100;
      handleVignetteChange(effectId, property, normalizedValue);
    },
    [handleVignetteChange]
  );

  const handleVignettePercentLiveChange = useCallback(
    (effectId: string, property: 'intensity' | 'size' | 'softness', percentValue: number) => {
      const normalizedValue = percentValue / 100;
      handleVignetteLiveChange(effectId, property, normalizedValue);
    },
    [handleVignetteLiveChange]
  );

  // Reset CSS filter effect to default value
  const handleResetCSSFilter = useCallback(
    (effectId: string, filterType: CSSFilterType) => {
      const config = CSS_FILTER_CONFIGS[filterType];
      itemIds.forEach((id) => {
        updateEffect(id, effectId, {
          effect: { type: 'css-filter', filter: filterType, value: config.default } as CSSFilterEffect,
        });
      });
    },
    [itemIds, updateEffect]
  );

  // Reset glitch effect to default intensity
  const handleResetGlitch = useCallback(
    (effectId: string) => {
      const effect = effects.find((e) => e.id === effectId);
      if (!effect || effect.effect.type !== 'glitch') return;

      itemIds.forEach((id) => {
        updateEffect(id, effectId, {
          effect: { ...effect.effect, intensity: 0.5 } as GlitchEffect,
        });
      });
    },
    [effects, itemIds, updateEffect]
  );

  // Reset halftone property to default
  const handleResetHalftone = useCallback(
    (effectId: string, property: keyof HalftoneEffect) => {
      const effect = effects.find((e) => e.id === effectId);
      if (!effect || effect.effect.type !== 'canvas-effect') return;

      let defaultValue: number | string | boolean;
      switch (property) {
        case 'patternType':
          defaultValue = HALFTONE_CONFIG.patternType.default;
          break;
        case 'dotSize':
          defaultValue = HALFTONE_CONFIG.dotSize.default;
          break;
        case 'spacing':
          defaultValue = HALFTONE_CONFIG.spacing.default;
          break;
        case 'angle':
          defaultValue = HALFTONE_CONFIG.angle.default;
          break;
        case 'intensity':
          defaultValue = HALFTONE_CONFIG.intensity.default;
          break;
        case 'softness':
          defaultValue = HALFTONE_CONFIG.softness.default;
          break;
        case 'blendMode':
          defaultValue = HALFTONE_CONFIG.blendMode.default;
          break;
        case 'inverted':
          defaultValue = HALFTONE_CONFIG.inverted.default;
          break;
        case 'fadeAngle':
          defaultValue = HALFTONE_CONFIG.fadeAngle.default;
          break;
        case 'fadeAmount':
          defaultValue = HALFTONE_CONFIG.fadeAmount.default;
          break;
        case 'dotColor':
          defaultValue = '#000000';
          break;
        default:
          return;
      }

      itemIds.forEach((id) => {
        updateEffect(id, effectId, {
          effect: { ...effect.effect, [property]: defaultValue } as HalftoneEffect,
        });
      });
    },
    [effects, itemIds, updateEffect]
  );

  // Reset vignette property to default
  const handleResetVignette = useCallback(
    (effectId: string, property: keyof VignetteEffect) => {
      const effect = effects.find((e) => e.id === effectId);
      if (!effect || effect.effect.type !== 'overlay-effect') return;

      let defaultValue: number | string;
      switch (property) {
        case 'intensity':
          defaultValue = VIGNETTE_CONFIG.intensity.default;
          break;
        case 'size':
          defaultValue = VIGNETTE_CONFIG.size.default;
          break;
        case 'softness':
          defaultValue = VIGNETTE_CONFIG.softness.default;
          break;
        case 'color':
          defaultValue = '#000000';
          break;
        default:
          return;
      }

      itemIds.forEach((id) => {
        updateEffect(id, effectId, {
          effect: { ...effect.effect, [property]: defaultValue } as VignetteEffect,
        });
      });
    },
    [effects, itemIds, updateEffect]
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

  // Ref to blur trigger button when dropdown closes (prevents space key from reopening)
  const dropdownTriggerRef = useRef<HTMLButtonElement>(null);

  const handleDropdownOpenChange = useCallback((open: boolean) => {
    if (!open) {
      // Blur the trigger button when menu closes so space key triggers play/pause instead
      dropdownTriggerRef.current?.blur();
    }
  }, []);

  if (visualItems.length === 0) return null;

  return (
    <PropertySection title="Effects" icon={Sparkles} defaultOpen={true}>
      {/* Add Effect Dropdown + Toggle All */}
      <div className="px-2 pb-2 flex gap-1">
        <DropdownMenu onOpenChange={handleDropdownOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button ref={dropdownTriggerRef} variant="outline" size="sm" className="flex-1 h-7 text-xs">
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
                onSelect={() => handleAddFilter(key as CSSFilterType)}
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
                onSelect={() => handleAddGlitch(key as GlitchVariant)}
              >
                {config.label}
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />

            {/* Stylized Effects */}
            <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
              Stylized Effects
            </div>
            <DropdownMenuItem onSelect={handleAddHalftone}>
              {CANVAS_EFFECT_CONFIGS.halftone.label}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleAddVignette}>
              {OVERLAY_EFFECT_CONFIGS.vignette.label}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Presets */}
            <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
              Presets
            </div>
            {EFFECT_PRESETS.map((preset) => (
              <DropdownMenuItem
                key={preset.id}
                onSelect={() => handleApplyPreset(preset.id)}
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

      {/* Active Effects List - wrapped to prevent space-y-3 from PropertySection */}
      <div className="space-y-0">
      {effects.map((effect) => {
        if (effect.effect.type === 'css-filter') {
          return (
            <CSSFilterPanel
              key={effect.id}
              effect={effect}
              cssEffect={effect.effect as CSSFilterEffect}
              onEffectChange={handleEffectChange}
              onEffectLiveChange={handleEffectLiveChange}
              onReset={handleResetCSSFilter}
              onToggle={handleToggle}
              onRemove={handleRemove}
            />
          );
        }

        if (effect.effect.type === 'glitch') {
          return (
            <GlitchPanel
              key={effect.id}
              effect={effect}
              glitchEffect={effect.effect as GlitchEffect}
              onIntensityChange={handleGlitchIntensityChange}
              onIntensityLiveChange={handleGlitchIntensityLiveChange}
              onReset={handleResetGlitch}
              onToggle={handleToggle}
              onRemove={handleRemove}
            />
          );
        }

        if (effect.effect.type === 'canvas-effect' && effect.effect.variant === 'halftone') {
          return (
            <HalftonePanel
              key={effect.id}
              effect={effect}
              halftone={effect.effect as HalftoneEffect}
              onPropertyChange={handleHalftoneChange}
              onPropertyLiveChange={handleHalftoneLiveChange}
              onIntensityChange={handleHalftoneIntensityChange}
              onIntensityLiveChange={handleHalftoneIntensityLiveChange}
              onReset={handleResetHalftone}
              onToggle={handleToggle}
              onRemove={handleRemove}
            />
          );
        }

        if (effect.effect.type === 'overlay-effect' && effect.effect.variant === 'vignette') {
          return (
            <VignettePanel
              key={effect.id}
              effect={effect}
              vignette={effect.effect as VignetteEffect}
              onPercentChange={handleVignettePercentChange}
              onPercentLiveChange={handleVignettePercentLiveChange}
              onColorChange={handleVignetteChange}
              onColorLiveChange={handleVignetteLiveChange}
              onReset={handleResetVignette}
              onToggle={handleToggle}
              onRemove={handleRemove}
            />
          );
        }

        return null;
      })}
      </div>

      {/* Empty state */}
      {effects.length === 0 && (
        <div className="px-2 py-3 text-xs text-muted-foreground text-center">
          No effects applied. Click "Add Effect" to get started.
        </div>
      )}
    </PropertySection>
  );
});
