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
import type { ItemEffect, GpuEffect } from '@/types/effects';
import { EFFECT_PRESETS } from '@/types/effects';
import { useTimelineStore } from '@/features/effects/deps/timeline-contract';
import { useGizmoStore } from '@/features/effects/deps/preview-contract';
import { PropertySection } from '@/shared/ui/property-controls';
import { GpuEffectPanel, GpuWheelsPanel, GpuCurvesPanel } from './panels';
import { getGpuCategoriesWithEffects, getGpuEffect, getGpuEffectDefaultParams } from '@/lib/gpu-effects';
import { useEffectPreviews } from '../hooks/use-effect-previews';

interface EffectsSectionProps {
  /** Visual items (already filtered to exclude audio) */
  items: TimelineItem[];
}

/**
 * Effects section - GPU shader effects for visual items.
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

  // Add a GPU shader effect
  const handleAddGpuEffect = useCallback(
    (gpuEffectId: string) => {
      const defaults = getGpuEffectDefaultParams(gpuEffectId);
      itemIds.forEach((id) => {
        addEffect(id, {
          type: 'gpu-effect',
          gpuEffectType: gpuEffectId,
          params: defaults,
        } as GpuEffect);
      });
    },
    [itemIds, addEffect]
  );

  // GPU effect categories for dropdown menu
  const gpuCategories = useMemo(() => getGpuCategoriesWithEffects(), []);

  // Effect preview thumbnails — lazily GPU-rendered on first dropdown open
  const allEffectEntries = useMemo(
    () => gpuCategories.flatMap(({ effects: catEffects }) =>
      catEffects.map((def) => ({ id: def.id, def }))
    ),
    [gpuCategories],
  );
  const presetIds = useMemo(() => EFFECT_PRESETS.map((p) => p.id), []);
  const { previews: effectPreviews, trigger: triggerPreviews } = useEffectPreviews(allEffectEntries, presetIds);

  // Update GPU effect parameter(s)
  const handleGpuParamChange = useCallback(
    (effectId: string, paramKey: string, value: number | boolean | string) => {
      const effect = effects.find((e) => e.id === effectId);
      if (!effect || effect.effect.type !== 'gpu-effect') return;

      const gpuEff = effect.effect as GpuEffect;
      itemIds.forEach((id) => {
        updateEffect(id, effectId, {
          effect: {
            ...gpuEff,
            params: { ...gpuEff.params, [paramKey]: value },
          },
        });
      });
      queueMicrotask(() => clearPreview());
    },
    [effects, itemIds, updateEffect, clearPreview]
  );

  // Batch update multiple GPU effect params atomically
  const handleGpuParamsBatchChange = useCallback(
    (effectId: string, updates: Record<string, number | boolean | string>) => {
      const effect = effects.find((e) => e.id === effectId);
      if (!effect || effect.effect.type !== 'gpu-effect') return;

      const gpuEff = effect.effect as GpuEffect;
      itemIds.forEach((id) => {
        updateEffect(id, effectId, {
          effect: {
            ...gpuEff,
            params: { ...gpuEff.params, ...updates },
          },
        });
      });
      queueMicrotask(() => clearPreview());
    },
    [effects, itemIds, updateEffect, clearPreview]
  );

  // Live preview for GPU effect parameter
  const handleGpuParamLiveChange = useCallback(
    (effectId: string, paramKey: string, value: number | boolean | string) => {
      const effect = effects.find((e) => e.id === effectId);
      if (!effect || effect.effect.type !== 'gpu-effect') return;

      const previews: Record<string, ItemEffect[]> = {};
      itemIds.forEach((id) => {
        const item = visualItems.find((i) => i.id === id);
        if (!item) return;
        previews[id] = (item.effects ?? []).map((entry) => {
          if (entry.id !== effectId || entry.effect.type !== 'gpu-effect') return entry;
          const entryGpu = entry.effect as GpuEffect;
          return {
            ...entry,
            effect: {
              ...entryGpu,
              params: { ...entryGpu.params, [paramKey]: value },
            },
          };
        });
      });
      setEffectsPreviewNew(previews);
    },
    [effects, itemIds, visualItems, setEffectsPreviewNew]
  );

  // Batch live preview for multiple GPU effect params atomically
  const handleGpuParamsBatchLiveChange = useCallback(
    (effectId: string, updates: Record<string, number | boolean | string>) => {
      const effect = effects.find((e) => e.id === effectId);
      if (!effect || effect.effect.type !== 'gpu-effect') return;

      const previews: Record<string, ItemEffect[]> = {};
      itemIds.forEach((id) => {
        const item = visualItems.find((i) => i.id === id);
        if (!item) return;
        previews[id] = (item.effects ?? []).map((entry) => {
          if (entry.id !== effectId || entry.effect.type !== 'gpu-effect') return entry;
          const entryGpu = entry.effect as GpuEffect;
          return {
            ...entry,
            effect: {
              ...entryGpu,
              params: { ...entryGpu.params, ...updates },
            },
          };
        });
      });
      setEffectsPreviewNew(previews);
    },
    [effects, itemIds, visualItems, setEffectsPreviewNew]
  );

  // Reset GPU effect to defaults
  const handleResetGpuEffect = useCallback(
    (effectId: string) => {
      const effect = effects.find((e) => e.id === effectId);
      if (!effect || effect.effect.type !== 'gpu-effect') return;

      const gpuEff = effect.effect as GpuEffect;
      const defaults = getGpuEffectDefaultParams(gpuEff.gpuEffectType);
      itemIds.forEach((id) => {
        updateEffect(id, effectId, {
          effect: { ...gpuEff, params: defaults },
        });
      });
    },
    [effects, itemIds, updateEffect]
  );

  // Apply a preset (adds multiple GPU effects as single undo/redo action)
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
    if (open) {
      // Start generating GPU previews on first open
      triggerPreviews();
    } else {
      // Blur the trigger button when menu closes so space key triggers play/pause instead
      dropdownTriggerRef.current?.blur();
    }
  }, [triggerPreviews]);

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
          <DropdownMenuContent align="start" className="w-56">
            {/* GPU Shader Effects */}
            {gpuCategories.map(({ category, effects: catEffects }, index) => (
              <div key={category}>
                {index > 0 && <DropdownMenuSeparator />}
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  {category.charAt(0).toUpperCase() + category.slice(1)}
                </div>
                {catEffects.map((def) => (
                  <DropdownMenuItem
                    key={def.id}
                    onSelect={() => handleAddGpuEffect(def.id)}
                    className="flex items-center gap-2"
                  >
                    {effectPreviews.has(def.id) ? (
                      <img
                        src={effectPreviews.get(def.id)}
                        alt=""
                        className="w-8 h-[18px] rounded-sm object-cover flex-shrink-0"
                      />
                    ) : (
                      <span className="w-8 h-[18px] rounded-sm bg-muted flex-shrink-0" />
                    )}
                    {def.name}
                  </DropdownMenuItem>
                ))}
              </div>
            ))}

            {EFFECT_PRESETS.length > 0 && (
              <>
                <DropdownMenuSeparator />

                {/* Presets */}
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  Presets
                </div>
                {EFFECT_PRESETS.map((preset) => (
                  <DropdownMenuItem
                    key={preset.id}
                    onSelect={() => handleApplyPreset(preset.id)}
                    className="flex items-center gap-2"
                  >
                    {effectPreviews.has(`preset:${preset.id}`) ? (
                      <img
                        src={effectPreviews.get(`preset:${preset.id}`)}
                        alt=""
                        className="w-8 h-[18px] rounded-sm object-cover flex-shrink-0"
                      />
                    ) : (
                      <span className="w-8 h-[18px] rounded-sm bg-muted flex-shrink-0" />
                    )}
                    {preset.name}
                  </DropdownMenuItem>
                ))}
              </>
            )}
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
        if (effect.effect.type === 'gpu-effect') {
          const gpuEff = effect.effect as GpuEffect;
          const def = getGpuEffect(gpuEff.gpuEffectType);
          if (!def) return null;

          if (gpuEff.gpuEffectType === 'gpu-curves') {
            return (
              <GpuCurvesPanel
                key={effect.id}
                effect={effect}
                gpuEffect={gpuEff}
                definition={def}
                onParamChange={handleGpuParamChange}
                onParamLiveChange={handleGpuParamLiveChange}
                onReset={handleResetGpuEffect}
                onToggle={handleToggle}
                onRemove={handleRemove}
              />
            );
          }

          if (gpuEff.gpuEffectType === 'gpu-color-wheels') {
            return (
              <GpuWheelsPanel
                key={effect.id}
                effect={effect}
                gpuEffect={gpuEff}
                definition={def}
                onParamChange={handleGpuParamChange}
                onParamLiveChange={handleGpuParamLiveChange}
                onParamsBatchChange={handleGpuParamsBatchChange}
                onParamsBatchLiveChange={handleGpuParamsBatchLiveChange}
                onReset={handleResetGpuEffect}
                onToggle={handleToggle}
                onRemove={handleRemove}
              />
            );
          }

          return (
            <GpuEffectPanel
              key={effect.id}
              effect={effect}
              gpuEffect={gpuEff}
              definition={def}
              onParamChange={handleGpuParamChange}
              onParamLiveChange={handleGpuParamLiveChange}
              onReset={handleResetGpuEffect}
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
