import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { Eye, EyeOff, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ItemEffect, WheelsEffect } from '@/types/effects';
import { WHEELS_CONFIG } from '@/types/effects';
import { PropertyRow, NumberInput } from '@/shared/ui/property-controls';

interface WheelsPanelProps {
  effect: ItemEffect;
  wheels: WheelsEffect;
  onPropertyChange: (effectId: string, property: keyof WheelsEffect, value: number) => void;
  onPropertyLiveChange: (effectId: string, property: keyof WheelsEffect, value: number) => void;
  onWheelChange: (
    effectId: string,
    hueKey: 'shadowsHue' | 'midtonesHue' | 'highlightsHue',
    amountKey: 'shadowsAmount' | 'midtonesAmount' | 'highlightsAmount',
    hue: number,
    amount: number
  ) => void;
  onWheelLiveChange: (
    effectId: string,
    hueKey: 'shadowsHue' | 'midtonesHue' | 'highlightsHue',
    amountKey: 'shadowsAmount' | 'midtonesAmount' | 'highlightsAmount',
    hue: number,
    amount: number
  ) => void;
  onReset: (effectId: string, property: keyof WheelsEffect) => void;
  onToggle: (effectId: string) => void;
  onRemove: (effectId: string) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

  const displayHue = localHue;
  const displayAmount = localAmount;
  const displayTrackRadius = size / 2 - PUCK_RADIUS_PX - 1;
  const puckX = Math.cos((displayHue * Math.PI) / 180) * (displayTrackRadius * displayAmount);
  const puckY = Math.sin((displayHue * Math.PI) / 180) * (displayTrackRadius * displayAmount);

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
        {Math.round(displayHue)}° • {Math.round(displayAmount * 100)}%
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

export const WheelsPanel = memo(function WheelsPanel({
  effect,
  wheels,
  onPropertyChange,
  onPropertyLiveChange,
  onWheelChange,
  onWheelLiveChange,
  onReset,
  onToggle,
  onRemove,
}: WheelsPanelProps) {
  const wheelGridRef = useRef<HTMLDivElement>(null);
  const [wheelSize, setWheelSize] = useState(MAX_WHEEL_SIZE);
  const wheelDescriptors = useMemo(() => ([
    {
      label: 'Shadows',
      hueKey: 'shadowsHue' as const,
      amountKey: 'shadowsAmount' as const,
    },
    {
      label: 'Midtones',
      hueKey: 'midtonesHue' as const,
      amountKey: 'midtonesAmount' as const,
    },
    {
      label: 'Highlights',
      hueKey: 'highlightsHue' as const,
      amountKey: 'highlightsAmount' as const,
    },
  ]), []);
  const tonalRowClass = '[&>span]:w-[84px] [&>span]:min-w-[84px]';

  useEffect(() => {
    const el = wheelGridRef.current;
    if (!el) return;

    const updateSize = () => {
      const width = el.clientWidth;
      const slotWidth = (width - GRID_GAP_PX * 2) / 3;
      const nextSize = clamp(Math.floor(slotWidth), MIN_WHEEL_SIZE, MAX_WHEEL_SIZE);
      setWheelSize(nextSize);
    };

    updateSize();

    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      updateSize();
    });
    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  return (
    <div className="border-b border-border/50 pb-2 mb-2">
      <PropertyRow label="Wheels">
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

      <div className="px-2 pb-2">
        <div ref={wheelGridRef} className="grid grid-cols-3 gap-1">
          {wheelDescriptors.map((descriptor) => (
            <WheelControl
              key={descriptor.label}
              label={descriptor.label}
              hue={wheels[descriptor.hueKey]}
              amount={wheels[descriptor.amountKey]}
              size={wheelSize}
              disabled={!effect.enabled}
              onLiveChange={(hue, amount) => {
                onWheelLiveChange(effect.id, descriptor.hueKey, descriptor.amountKey, hue, amount);
              }}
              onCommit={(hue, amount) => {
                onWheelChange(effect.id, descriptor.hueKey, descriptor.amountKey, hue, amount);
              }}
              onReset={() => {
                onReset(effect.id, descriptor.hueKey);
                onReset(effect.id, descriptor.amountKey);
              }}
            />
          ))}
        </div>
      </div>

      <PropertyRow label={WHEELS_CONFIG.temperature.label} className={tonalRowClass}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <NumberInput
            value={wheels.temperature}
            onChange={(v) => onPropertyChange(effect.id, 'temperature', v)}
            onLiveChange={(v) => onPropertyLiveChange(effect.id, 'temperature', v)}
            min={WHEELS_CONFIG.temperature.min}
            max={WHEELS_CONFIG.temperature.max}
            step={WHEELS_CONFIG.temperature.step}
            unit={WHEELS_CONFIG.temperature.unit}
            disabled={!effect.enabled}
            className="flex-1 min-w-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 flex-shrink-0 ${wheels.temperature === WHEELS_CONFIG.temperature.default ? 'opacity-30' : ''}`}
            onClick={() => onReset(effect.id, 'temperature')}
            title="Reset to default"
            disabled={wheels.temperature === WHEELS_CONFIG.temperature.default}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </PropertyRow>

      <PropertyRow label={WHEELS_CONFIG.tint.label} className={tonalRowClass}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <NumberInput
            value={wheels.tint}
            onChange={(v) => onPropertyChange(effect.id, 'tint', v)}
            onLiveChange={(v) => onPropertyLiveChange(effect.id, 'tint', v)}
            min={WHEELS_CONFIG.tint.min}
            max={WHEELS_CONFIG.tint.max}
            step={WHEELS_CONFIG.tint.step}
            unit={WHEELS_CONFIG.tint.unit}
            disabled={!effect.enabled}
            className="flex-1 min-w-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 flex-shrink-0 ${wheels.tint === WHEELS_CONFIG.tint.default ? 'opacity-30' : ''}`}
            onClick={() => onReset(effect.id, 'tint')}
            title="Reset to default"
            disabled={wheels.tint === WHEELS_CONFIG.tint.default}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </PropertyRow>

      <PropertyRow label={WHEELS_CONFIG.saturation.label} className={tonalRowClass}>
        <div className="flex items-center gap-1 min-w-0 w-full">
          <NumberInput
            value={wheels.saturation}
            onChange={(v) => onPropertyChange(effect.id, 'saturation', v)}
            onLiveChange={(v) => onPropertyLiveChange(effect.id, 'saturation', v)}
            min={WHEELS_CONFIG.saturation.min}
            max={WHEELS_CONFIG.saturation.max}
            step={WHEELS_CONFIG.saturation.step}
            unit={WHEELS_CONFIG.saturation.unit}
            disabled={!effect.enabled}
            className="flex-1 min-w-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 flex-shrink-0 ${wheels.saturation === WHEELS_CONFIG.saturation.default ? 'opacity-30' : ''}`}
            onClick={() => onReset(effect.id, 'saturation')}
            title="Reset to default"
            disabled={wheels.saturation === WHEELS_CONFIG.saturation.default}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </PropertyRow>
    </div>
  );
});
