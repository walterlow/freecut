import { memo, useCallback, useRef } from 'react';
import type { ChangeEvent } from 'react';
import { Eye, EyeOff, Trash2, RotateCcw, FileUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ItemEffect, LUTEffect, LUTPresetId } from '@/types/effects';
import { LUT_PRESET_CONFIGS } from '@/types/effects';
import { PropertyRow, NumberInput } from '@/shared/ui/property-controls';
import type { SavedCubeLut } from '@/features/effects/utils/lut-library';

interface LUTPanelProps {
  effect: ItemEffect;
  lut: LUTEffect;
  onPresetChange: (effectId: string, preset: LUTPresetId) => void;
  onIntensityChange: (effectId: string, percentValue: number) => void;
  onIntensityLiveChange: (effectId: string, percentValue: number) => void;
  onCubeImport: (effectId: string, cubeName: string, cubeData: string) => void | Promise<void>;
  savedCubeLuts: SavedCubeLut[];
  onSavedCubeSelect: (effectId: string, lutId: string) => void;
  onSavedCubeDelete: (lutId: string) => void | Promise<void>;
  onCubeClear: (effectId: string) => void;
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
  onCubeImport,
  savedCubeLuts,
  onSavedCubeSelect,
  onSavedCubeDelete,
  onCubeClear,
  onResetPreset,
  onResetIntensity,
  onToggle,
  onRemove,
}: LUTPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const presetMeta = LUT_PRESET_CONFIGS[lut.preset] ?? { label: lut.preset, description: 'Unknown preset' };
  const hasCustomCube = typeof lut.cubeData === 'string' && lut.cubeData.trim().length > 0;
  const activeSourceLabel = hasCustomCube
    ? (lut.cubeName?.trim() || 'Custom .cube')
    : 'Built-in preset';

  const handleOpenCubePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleCubeFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const cubeData = await file.text();
      await onCubeImport(effect.id, file.name, cubeData);
    } finally {
      event.target.value = '';
    }
  }, [effect.id, onCubeImport]);

  return (
    <div className="border-b border-border/50 pb-2 mb-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".cube,text/plain"
        className="hidden"
        onChange={handleCubeFileChange}
      />

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

      <PropertyRow label="Source">
        <div className="flex items-center gap-1 min-w-0 w-full">
          <div
            className="flex-1 min-w-0 text-xs text-muted-foreground truncate"
            title={activeSourceLabel}
          >
            {activeSourceLabel}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs flex-shrink-0"
                disabled={!effect.enabled}
                title={hasCustomCube ? 'Replace .cube file' : 'Import .cube file'}
              >
                <FileUp className="w-3 h-3 mr-1" />
                {hasCustomCube ? 'Replace' : 'Import'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={handleOpenCubePicker}>
                <FileUp className="w-3 h-3" />
                Upload .cube
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                Saved LUTs
              </DropdownMenuLabel>
              {savedCubeLuts.length > 0 ? (
                savedCubeLuts.map((savedLut) => (
                  <DropdownMenuItem
                    key={savedLut.id}
                    onSelect={() => onSavedCubeSelect(effect.id, savedLut.id)}
                    title={savedLut.name}
                    className="text-xs"
                  >
                    <span className="truncate flex-1 min-w-0">{savedLut.name}</span>
                    <button
                      type="button"
                      className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-destructive"
                      title={`Delete ${savedLut.name}`}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void onSavedCubeDelete(savedLut.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuItem disabled className="text-xs">
                  No saved LUTs
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 flex-shrink-0 ${hasCustomCube ? '' : 'opacity-30'}`}
            onClick={() => onCubeClear(effect.id)}
            title="Clear custom .cube LUT"
            disabled={!hasCustomCube}
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      </PropertyRow>

      {!hasCustomCube && (
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
      )}

      {hasCustomCube && (
        <div className="px-2 pb-1 text-[10px] text-muted-foreground">
          Custom .cube active. Preset fallback: {presetMeta.label}.
        </div>
      )}

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
