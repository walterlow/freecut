import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { Eye, EyeOff, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ItemEffect, GpuEffect } from '@/types/effects';
import type { GpuEffectDefinition } from '@/infrastructure/gpu/effects';
import { PropertyRow, SliderInput } from '@/shared/ui/property-controls';

interface GpuCurvesPanelProps {
  effect: ItemEffect;
  gpuEffect: GpuEffect;
  definition: GpuEffectDefinition;
  onParamChange: (effectId: string, paramKey: string, value: number | boolean | string) => void;
  onParamLiveChange: (effectId: string, paramKey: string, value: number | boolean | string) => void;
  onReset: (effectId: string) => void;
  onToggle: (effectId: string) => void;
  onRemove: (effectId: string) => void;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

const CURVE_SIZE = 230;
const CURVE_SAMPLES = 64;

// Mirror the GPU shader's tone mapping chain to compute the transfer curve
function applyShadows(c: number, amount: number): number {
  const shadow = 1 - c;
  return c + shadow * shadow * amount * 0.5;
}

function applyMidtones(c: number, amount: number): number {
  const mid = 4 * c * (1 - c);
  return c + mid * amount * 0.25;
}

function applyHighlights(c: number, amount: number): number {
  return c + c * c * amount * 0.5;
}

function applyContrast(c: number, amount: number): number {
  return (c - 0.5) * (1 + amount) + 0.5;
}

function computeCurve(
  input: number,
  shadows: number,
  midtones: number,
  highlights: number,
  contrast: number,
): number {
  let c = input;
  c = applyShadows(c, shadows / 100);
  c = applyMidtones(c, midtones / 100);
  c = applyHighlights(c, highlights / 100);
  c = applyContrast(c, contrast / 100);
  return clamp(c, 0, 1);
}

function buildCurvePath(
  shadows: number,
  midtones: number,
  highlights: number,
  contrast: number,
  size: number,
): string {
  const points: string[] = [];
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const input = i / CURVE_SAMPLES;
    const output = computeCurve(input, shadows, midtones, highlights, contrast);
    const x = input * size;
    const y = (1 - output) * size;
    points.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return `M ${points.join(' L ')}`;
}

function buildChannelPath(
  shadows: number,
  midtones: number,
  highlights: number,
  contrast: number,
  offset: number,
  size: number,
): string {
  const points: string[] = [];
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const input = i / CURVE_SAMPLES;
    const output = clamp(computeCurve(input, shadows, midtones, highlights, contrast) + offset, 0, 1);
    const x = input * size;
    const y = (1 - output) * size;
    points.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return `M ${points.join(' L ')}`;
}

function solveParam(
  inputX: number,
  targetY: number,
  paramKey: 'shadows' | 'midtones' | 'highlights',
  otherParams: { shadows: number; midtones: number; highlights: number; contrast: number },
): number {
  let lo = -100;
  let hi = 100;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const params = { ...otherParams, [paramKey]: mid };
    const y = computeCurve(inputX, params.shadows, params.midtones, params.highlights, params.contrast);
    if (y < targetY) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return Math.round((lo + hi) / 2);
}

type ChannelKey = 'master' | 'red' | 'green' | 'blue';

const CHANNELS: Array<{ key: ChannelKey; label: string; color: string }> = [
  { key: 'master', label: 'Master', color: '#e5e7eb' },
  { key: 'red', label: 'Red', color: '#ef4444' },
  { key: 'green', label: 'Green', color: '#22c55e' },
  { key: 'blue', label: 'Blue', color: '#3b82f6' },
];

const HANDLES: Array<{
  paramKey: 'shadows' | 'midtones' | 'highlights';
  inputX: number;
}> = [
  { paramKey: 'shadows', inputX: 0.25 },
  { paramKey: 'midtones', inputX: 0.5 },
  { paramKey: 'highlights', inputX: 0.75 },
];

interface DraftParams {
  shadows: number;
  midtones: number;
  highlights: number;
  contrast: number;
  red: number;
  green: number;
  blue: number;
}

function paramsFromGpu(gpuEffect: GpuEffect): DraftParams {
  return {
    shadows: (gpuEffect.params.shadows as number) ?? 0,
    midtones: (gpuEffect.params.midtones as number) ?? 0,
    highlights: (gpuEffect.params.highlights as number) ?? 0,
    contrast: (gpuEffect.params.contrast as number) ?? 0,
    red: (gpuEffect.params.red as number) ?? 0,
    green: (gpuEffect.params.green as number) ?? 0,
    blue: (gpuEffect.params.blue as number) ?? 0,
  };
}

export const GpuCurvesPanel = memo(function GpuCurvesPanel({
  effect,
  gpuEffect,
  definition,
  onParamChange,
  onParamLiveChange,
  onReset,
  onToggle,
  onRemove,
}: GpuCurvesPanelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [activeChannel, setActiveChannel] = useState<ChannelKey>('master');
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState<DraftParams>(() => paramsFromGpu(gpuEffect));

  // Sync from props when not dragging
  useEffect(() => {
    if (!dragging) {
      setDraft(paramsFromGpu(gpuEffect));
    }
  }, [gpuEffect, dragging]);

  // Use draft values for all rendering
  const { shadows, midtones, highlights, contrast, red, green, blue } = draft;

  const dragRef = useRef<{
    paramKey: 'shadows' | 'midtones' | 'highlights';
    inputX: number;
  } | null>(null);

  const rgbDragRef = useRef<{
    channel: 'red' | 'green' | 'blue';
    startY: number;
    startValue: number;
  } | null>(null);

  const paramEntries = Object.entries(definition.params);
  const isDefault = paramEntries.every(
    ([key, param]) => gpuEffect.params[key] === param.default
  );

  const masterPath = useMemo(
    () => buildCurvePath(shadows, midtones, highlights, contrast, CURVE_SIZE),
    [shadows, midtones, highlights, contrast]
  );

  const redPath = useMemo(
    () => buildChannelPath(shadows, midtones, highlights, contrast, red / 200, CURVE_SIZE),
    [shadows, midtones, highlights, contrast, red]
  );
  const greenPath = useMemo(
    () => buildChannelPath(shadows, midtones, highlights, contrast, green / 200, CURVE_SIZE),
    [shadows, midtones, highlights, contrast, green]
  );
  const bluePath = useMemo(
    () => buildChannelPath(shadows, midtones, highlights, contrast, blue / 200, CURVE_SIZE),
    [shadows, midtones, highlights, contrast, blue]
  );

  const handlePositions = useMemo(
    () =>
      HANDLES.map(({ paramKey, inputX }) => ({
        paramKey,
        inputX,
        outputY: computeCurve(inputX, shadows, midtones, highlights, contrast),
      })),
    [shadows, midtones, highlights, contrast]
  );

  const getYFromClient = useCallback((clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.height <= 0) return null;
    return clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
  }, []);

  // Master curve handle drag
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const state = dragRef.current;
      if (!state) return;
      const targetY = getYFromClient(event.clientY);
      if (targetY === null) return;

      const newValue = clamp(
        solveParam(state.inputX, targetY, state.paramKey, { shadows, midtones, highlights, contrast }),
        -100, 100,
      );
      setDraft((prev) => ({ ...prev, [state.paramKey]: newValue }));
      onParamLiveChange(effect.id, state.paramKey, newValue);
    };

    const handleMouseUp = (event: MouseEvent) => {
      const state = dragRef.current;
      if (!state) return;
      const targetY = getYFromClient(event.clientY);
      if (targetY !== null) {
        const newValue = clamp(
          solveParam(state.inputX, targetY, state.paramKey, { shadows, midtones, highlights, contrast }),
          -100, 100,
        );
        onParamChange(effect.id, state.paramKey, newValue);
      }
      dragRef.current = null;
      setDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [shadows, midtones, highlights, contrast, effect.id, getYFromClient, onParamChange, onParamLiveChange]);

  const handlePointMouseDown = useCallback(
    (event: React.MouseEvent, paramKey: 'shadows' | 'midtones' | 'highlights', inputX: number) => {
      if (!effect.enabled) return;
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = { paramKey, inputX };
      setDragging(true);
    },
    [effect.enabled]
  );

  // RGB channel drag
  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const state = rgbDragRef.current;
      if (!state) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const currentY = event.clientY - rect.top;
      const deltaPixels = state.startY - currentY;
      const deltaValue = (deltaPixels / rect.height) * 200;
      const newValue = clamp(Math.round(state.startValue + deltaValue), -100, 100);
      setDraft((prev) => ({ ...prev, [state.channel]: newValue }));
      onParamLiveChange(effect.id, state.channel, newValue);
    };

    const handleUp = (event: MouseEvent) => {
      const state = rgbDragRef.current;
      if (!state) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const currentY = event.clientY - rect.top;
      const deltaPixels = state.startY - currentY;
      const deltaValue = (deltaPixels / rect.height) * 200;
      const newValue = clamp(Math.round(state.startValue + deltaValue), -100, 100);
      onParamChange(effect.id, state.channel, newValue);
      rgbDragRef.current = null;
      setDragging(false);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [effect.id, onParamChange, onParamLiveChange]);

  const handleRgbCurveMouseDown = useCallback(
    (event: React.MouseEvent, channel: 'red' | 'green' | 'blue') => {
      if (!effect.enabled || activeChannel === 'master') return;
      event.preventDefault();
      event.stopPropagation();
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const startY = event.clientY - rect.top;
      const startValue = channel === 'red' ? red : channel === 'green' ? green : blue;
      rgbDragRef.current = { channel, startY, startValue };
      setDragging(true);
    },
    [effect.enabled, activeChannel, red, green, blue]
  );

  // NumberInput live change — also update draft for curve display
  const handleSliderLiveChange = useCallback(
    (key: string, value: number) => {
      setDraft((prev) => ({ ...prev, [key]: value }));
      onParamLiveChange(effect.id, key, value);
    },
    [effect.id, onParamLiveChange]
  );

  const activeChannelMeta = CHANNELS.find((c) => c.key === activeChannel)!;
  const activePath =
    activeChannel === 'master' ? masterPath
      : activeChannel === 'red' ? redPath
        : activeChannel === 'green' ? greenPath
          : bluePath;

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

      {/* Channel tabs */}
      <PropertyRow label="Channel">
        <div className="flex items-center gap-1 flex-wrap">
          {CHANNELS.map((channel) => (
            <Button
              key={channel.key}
              variant={activeChannel === channel.key ? 'secondary' : 'outline'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setActiveChannel(channel.key)}
            >
              {channel.label}
            </Button>
          ))}
        </div>
      </PropertyRow>

      {/* SVG Curve Editor */}
      <div className="px-2">
        <div className="relative rounded border border-border/70 bg-black/50 overflow-hidden">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${CURVE_SIZE} ${CURVE_SIZE}`}
            className="w-full aspect-square cursor-default"
          >
            {[0.25, 0.5, 0.75].map((g) => (
              <g key={g}>
                <line
                  x1={g * CURVE_SIZE} y1={0}
                  x2={g * CURVE_SIZE} y2={CURVE_SIZE}
                  stroke="rgba(148,163,184,0.22)" strokeWidth={1}
                />
                <line
                  x1={0} y1={g * CURVE_SIZE}
                  x2={CURVE_SIZE} y2={g * CURVE_SIZE}
                  stroke="rgba(148,163,184,0.22)" strokeWidth={1}
                />
              </g>
            ))}

            <path
              d={`M 0 ${CURVE_SIZE} L ${CURVE_SIZE} 0`}
              stroke="rgba(148,163,184,0.35)" strokeWidth={1}
              fill="none" strokeDasharray="4 4"
            />

            {activeChannel === 'master' && red !== 0 && (
              <path d={redPath} stroke="#ef4444" strokeWidth={1} fill="none" opacity={0.3} />
            )}
            {activeChannel === 'master' && green !== 0 && (
              <path d={greenPath} stroke="#22c55e" strokeWidth={1} fill="none" opacity={0.3} />
            )}
            {activeChannel === 'master' && blue !== 0 && (
              <path d={bluePath} stroke="#3b82f6" strokeWidth={1} fill="none" opacity={0.3} />
            )}

            <path
              d={activePath}
              stroke={activeChannelMeta.color}
              strokeWidth={2}
              fill="none"
              className="pointer-events-none"
            />

            {activeChannel !== 'master' && (
              <path
                d={activePath}
                stroke="transparent"
                strokeWidth={16}
                fill="none"
                pointerEvents="stroke"
                className={effect.enabled ? 'cursor-ns-resize' : 'pointer-events-none'}
                onMouseDown={(e) =>
                  handleRgbCurveMouseDown(e, activeChannel as 'red' | 'green' | 'blue')
                }
              />
            )}

            {activeChannel === 'master' &&
              handlePositions.map(({ paramKey, inputX, outputY }) => (
                <circle
                  key={paramKey}
                  cx={inputX * CURVE_SIZE}
                  cy={(1 - outputY) * CURVE_SIZE}
                  r={5}
                  fill={activeChannelMeta.color}
                  stroke="rgba(3,7,18,0.95)"
                  strokeWidth={1.5}
                  className={effect.enabled ? 'cursor-ns-resize' : 'pointer-events-none'}
                  onMouseDown={(e) => handlePointMouseDown(e, paramKey, inputX)}
                />
              ))}
          </svg>
        </div>
        {activeChannel !== 'master' && (
          <div className="text-[10px] text-muted-foreground text-center mt-1">
            Drag curve up/down to adjust {activeChannel} offset
          </div>
        )}
      </div>

      {/* Param sliders */}
      {activeChannel === 'master' ? (
        <>
          {(['shadows', 'midtones', 'highlights', 'contrast'] as const).map((key) => {
            const param = definition.params[key];
            if (!param) return null;
            return (
              <PropertyRow key={key} label={param.label}>
                <SliderInput
                  value={draft[key]}
                  onChange={(v) => onParamChange(effect.id, key, v)}
                  onLiveChange={(v) => handleSliderLiveChange(key, v)}
                  min={param.min ?? -100}
                  max={param.max ?? 100}
                  step={param.step ?? 1}
                  disabled={!effect.enabled}
                  className="flex-1 min-w-0"
                />
              </PropertyRow>
            );
          })}
        </>
      ) : (
        <>
          {(['red', 'green', 'blue'] as const).map((key) => {
            const param = definition.params[key];
            if (!param) return null;
            return (
              <PropertyRow key={key} label={param.label}>
                <SliderInput
                  value={draft[key]}
                  onChange={(v) => onParamChange(effect.id, key, v)}
                  onLiveChange={(v) => handleSliderLiveChange(key, v)}
                  min={param.min ?? -100}
                  max={param.max ?? 100}
                  step={param.step ?? 1}
                  disabled={!effect.enabled}
                  className="flex-1 min-w-0"
                />
              </PropertyRow>
            );
          })}
        </>
      )}
    </div>
  );
});
