import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { Eye, EyeOff, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ItemEffect, GpuEffect } from '@/types/effects';
import type { GpuEffectDefinition } from '@/infrastructure/gpu/effects';
import { PropertyRow, SliderInput } from '@/shared/ui/property-controls';

interface GpuWheelsPanelProps {
  effect: ItemEffect;
  gpuEffect: GpuEffect;
  definition: GpuEffectDefinition;
  onParamChange: (effectId: string, paramKey: string, value: number | boolean | string) => void;
  onParamLiveChange: (effectId: string, paramKey: string, value: number | boolean | string) => void;
  onParamsBatchChange: (effectId: string, updates: Record<string, number | boolean | string>) => void;
  onParamsBatchLiveChange: (effectId: string, updates: Record<string, number | boolean | string>) => void;
  onReset: (effectId: string) => void;
  onToggle: (effectId: string) => void;
  onRemove: (effectId: string) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const MAX_WHEEL_SIZE = 100;
const MIN_WHEEL_SIZE = 64;
const GRID_GAP_PX = 4;
const PUCK_RADIUS_PX = 4;

function getHueAmountFromClient(clientX: number, clientY: number, element: HTMLButtonElement) {
  const rect = element.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const trackRadius = Math.max(1, rect.width / 2 - PUCK_RADIUS_PX - 1);
  const amount = clamp(dist / trackRadius, 0, 1);
  const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  return { hue, amount };
}

interface WheelControlProps {
  label: string;
  hue: number;
  amount: number;
  size: number;
  disabled: boolean;
  onLiveChange: (hue: number, amount: number) => void;
  onCommit: (hue: number, amount: number) => void;
  onReset: () => void;
}

const WheelControl = memo(function WheelControl({
  label,
  hue,
  amount,
  size,
  disabled,
  onLiveChange,
  onCommit,
  onReset,
}: WheelControlProps) {
  const wheelRef = useRef<HTMLButtonElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localHue, setLocalHue] = useState(hue);
  const [localAmount, setLocalAmount] = useState(clamp(amount, 0, 1));

  useEffect(() => {
    if (!dragging) {
      setLocalHue(hue);
      setLocalAmount(clamp(amount, 0, 1));
    }
  }, [amount, dragging, hue]);

  const updateFromPointer = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const el = wheelRef.current;
    if (!el) return null;
    const next = getHueAmountFromClient(event.clientX, event.clientY, el);
    setLocalHue(next.hue);
    setLocalAmount(next.amount);
    onLiveChange(next.hue, next.amount);
    return next;
  }, [onLiveChange]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const el = wheelRef.current;
    if (!el) return;
    el.setPointerCapture(event.pointerId);
    setDragging(true);
    updateFromPointer(event);
  }, [disabled, updateFromPointer]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || !dragging) return;
    updateFromPointer(event);
  }, [disabled, dragging, updateFromPointer]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || !dragging) return;
    const next = updateFromPointer(event);
    if (next) {
      onCommit(next.hue, next.amount);
    } else {
      onCommit(localHue, localAmount);
    }
    setDragging(false);
  }, [disabled, dragging, localAmount, localHue, onCommit, updateFromPointer]);

  const handlePointerCancel = useCallback(() => {
    if (!dragging) return;
    onCommit(localHue, localAmount);
    setDragging(false);
  }, [dragging, localAmount, localHue, onCommit]);

  const displayTrackRadius = size / 2 - PUCK_RADIUS_PX - 1;
  const puckX = Math.cos((localHue * Math.PI) / 180) * (displayTrackRadius * localAmount);
  const puckY = Math.sin((localHue * Math.PI) / 180) * (displayTrackRadius * localAmount);

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        ref={wheelRef}
        type="button"
        disabled={disabled}
        aria-disabled={disabled}
        className={`relative rounded-full border border-border/70 ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-crosshair'}`}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          touchAction: 'none',
          backgroundImage:
            'radial-gradient(circle at center, hsl(0 0% 18%) 0%, hsl(0 0% 10%) 26%, transparent 28%), conic-gradient(from 0deg, #ff3b30, #ff9500, #ffcc00, #34c759, #00c7be, #007aff, #5856d6, #ff2d55, #ff3b30)',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div
          className="absolute rounded-full border border-black/60 shadow-sm"
          style={{
            width: `${PUCK_RADIUS_PX * 2}px`,
            height: `${PUCK_RADIUS_PX * 2}px`,
            background: '#f8fafc',
            left: '50%',
            top: '50%',
            transform: `translate(-50%, -50%) translate(${puckX}px, ${puckY}px)`,
          }}
        />
      </button>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-[10px] text-muted-foreground font-mono">
        {Math.round(localHue)}° • {Math.round(localAmount * 100)}%
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5"
        onClick={onReset}
        disabled={disabled}
        title={`Reset ${label}`}
      >
        <RotateCcw className="w-3 h-3" />
      </Button>
    </div>
  );
});

const WHEEL_DESCRIPTORS = [
  { label: 'Shadows', hueKey: 'shadowsHue', amountKey: 'shadowsAmount' },
  { label: 'Midtones', hueKey: 'midtonesHue', amountKey: 'midtonesAmount' },
  { label: 'Highlights', hueKey: 'highlightsHue', amountKey: 'highlightsAmount' },
] as const;

const TONAL_PARAMS = ['temperature', 'tint', 'saturation'] as const;

export const GpuWheelsPanel = memo(function GpuWheelsPanel({
  effect,
  gpuEffect,
  definition,
  onParamChange,
  onParamLiveChange,
  onParamsBatchChange,
  onParamsBatchLiveChange,
  onReset,
  onToggle,
  onRemove,
}: GpuWheelsPanelProps) {
  const wheelGridRef = useRef<HTMLDivElement>(null);
  const [wheelSize, setWheelSize] = useState(MAX_WHEEL_SIZE);

  const paramEntries = Object.entries(definition.params);
  const isDefault = paramEntries.every(
    ([key, param]) => gpuEffect.params[key] === param.default
  );

  useEffect(() => {
    const el = wheelGridRef.current;
    if (!el) return;

    const updateSize = () => {
      const width = el.clientWidth;
      const slotWidth = (width - GRID_GAP_PX * 2) / 3;
      setWheelSize(clamp(Math.floor(slotWidth), MIN_WHEEL_SIZE, MAX_WHEEL_SIZE));
    };

    updateSize();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => updateSize());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const tonalRowClass = '[&>span]:w-[84px] [&>span]:min-w-[84px]';

  return (
    <div className="space-y-0">
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

      <div className="px-2 pb-2">
        <div ref={wheelGridRef} className="grid grid-cols-3 gap-1">
          {WHEEL_DESCRIPTORS.map((desc) => (
            <WheelControl
              key={desc.label}
              label={desc.label}
              hue={(gpuEffect.params[desc.hueKey] as number) ?? 0}
              amount={(gpuEffect.params[desc.amountKey] as number) ?? 0}
              size={wheelSize}
              disabled={!effect.enabled}
              onLiveChange={(hue, amount) => {
                onParamsBatchLiveChange(effect.id, {
                  [desc.hueKey]: hue,
                  [desc.amountKey]: amount,
                });
              }}
              onCommit={(hue, amount) => {
                onParamsBatchChange(effect.id, {
                  [desc.hueKey]: hue,
                  [desc.amountKey]: amount,
                });
              }}
              onReset={() => {
                onParamsBatchChange(effect.id, {
                  [desc.hueKey]: 0,
                  [desc.amountKey]: 0,
                });
              }}
            />
          ))}
        </div>
      </div>

      {TONAL_PARAMS.map((key) => {
        const param = definition.params[key];
        if (!param) return null;
        const value = (gpuEffect.params[key] as number) ?? param.default;
        return (
          <PropertyRow key={key} label={param.label} className={tonalRowClass}>
            <div className="flex items-center gap-1 min-w-0 w-full">
              <SliderInput
                value={value}
                onChange={(v) => onParamChange(effect.id, key, v)}
                onLiveChange={(v) => onParamLiveChange(effect.id, key, v)}
                min={param.min ?? -100}
                max={param.max ?? 100}
                step={param.step ?? 1}
                disabled={!effect.enabled}
                className="flex-1 min-w-0"
              />
            </div>
          </PropertyRow>
        );
      })}
    </div>
  );
});
