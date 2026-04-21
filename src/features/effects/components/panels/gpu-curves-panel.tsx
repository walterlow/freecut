import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { Eye, EyeOff, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { GpuEffectDefinition } from '@/infrastructure/gpu/effects';
import { PropertyRow } from '@/shared/ui/property-controls';
import { buildMonotoneCurveSvgPath } from '@/shared/utils/curve-spline';
import {
  buildGpuCurvesChannelPoints,
  getDefaultGpuCurvesChannelControl,
  getGpuCurvesDefaultParams,
  getGpuCurvesDraftParams,
  GPU_CURVES_CHANNELS,
  GPU_CURVES_POINT_MAX_X,
  GPU_CURVES_POINT_MIN_GAP,
  GPU_CURVES_POINT_MIN_X,
  readGpuCurvesChannelControl,
  toGpuCurvesChannelParamUpdates,
  type GpuCurvesChannelControl,
  type GpuCurvesChannelKey,
} from '@/shared/utils/gpu-curves';
import type { GpuEffect, ItemEffect } from '@/types/effects';

interface GpuCurvesPanelProps {
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

type DraftParams = Record<string, number>;
type PointKey = keyof GpuCurvesChannelControl;

const CURVE_SIZE = 230;
const CHANNELS: Array<{ key: GpuCurvesChannelKey; label: string; color: string }> = [
  { key: 'master', label: 'Master', color: '#e5e7eb' },
  { key: 'red', label: 'Red', color: '#ef4444' },
  { key: 'green', label: 'Green', color: '#22c55e' },
  { key: 'blue', label: 'Blue', color: '#3b82f6' },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getResetParamsForChannel(channel: GpuCurvesChannelKey): Record<string, number> {
  return toGpuCurvesChannelParamUpdates(channel, getDefaultGpuCurvesChannelControl());
}

export const GpuCurvesPanel = memo(function GpuCurvesPanel({
  effect,
  gpuEffect,
  definition,
  onParamsBatchChange,
  onParamsBatchLiveChange,
  onReset,
  onToggle,
  onRemove,
}: GpuCurvesPanelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [activeChannel, setActiveChannel] = useState<GpuCurvesChannelKey>('master');
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState<DraftParams>(() => getGpuCurvesDraftParams(gpuEffect.params));
  const draftRef = useRef(draft);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!dragging) {
      setDraft(getGpuCurvesDraftParams(gpuEffect.params));
    }
  }, [dragging, gpuEffect.params]);

  const isDefault = useMemo(() => {
    const defaults = getGpuCurvesDefaultParams();
    return Object.entries(defaults).every(([key, value]) => draft[key] === value);
  }, [draft]);

  const activeChannelMeta = CHANNELS.find((channel) => channel.key === activeChannel)!;
  const activeControl = useMemo(
    () => readGpuCurvesChannelControl(draft, activeChannel),
    [activeChannel, draft],
  );
  const handlePoints = useMemo(
    () => buildGpuCurvesChannelPoints(activeControl).slice(1, 3),
    [activeControl],
  );

  const curvePaths = useMemo(
    () =>
      Object.fromEntries(
        GPU_CURVES_CHANNELS.map((channel) => [
          channel,
          buildMonotoneCurveSvgPath(
            buildGpuCurvesChannelPoints(readGpuCurvesChannelControl(draft, channel)),
            CURVE_SIZE,
            CURVE_SIZE,
          ),
        ]),
      ) as Record<GpuCurvesChannelKey, string>,
    [draft],
  );

  const dragRef = useRef<{
    channel: GpuCurvesChannelKey;
    pointKey: PointKey;
  } | null>(null);

  const getNormalizedPointFromClient = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: clamp((clientX - rect.left) / rect.width, 0, 1),
      y: clamp(1 - (clientY - rect.top) / rect.height, 0, 1),
    };
  }, []);

  const computeDragUpdates = useCallback((clientX: number, clientY: number) => {
    const state = dragRef.current;
    if (!state) return null;

    const position = getNormalizedPointFromClient(clientX, clientY);
    if (!position) return null;

    const current = readGpuCurvesChannelControl(draftRef.current, state.channel);
    const otherPoint = state.pointKey === 'shadow' ? current.highlight : current.shadow;

    const nextControl: GpuCurvesChannelControl = {
      ...current,
      [state.pointKey]: {
        x: state.pointKey === 'shadow'
          ? clamp(position.x, GPU_CURVES_POINT_MIN_X, otherPoint.x - GPU_CURVES_POINT_MIN_GAP)
          : clamp(position.x, otherPoint.x + GPU_CURVES_POINT_MIN_GAP, GPU_CURVES_POINT_MAX_X),
        y: position.y,
      },
    };

    return toGpuCurvesChannelParamUpdates(state.channel, nextControl);
  }, [getNormalizedPointFromClient]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const updates = computeDragUpdates(event.clientX, event.clientY);
      if (!updates) return;
      setDraft((prev) => ({ ...prev, ...updates }));
      onParamsBatchLiveChange(effect.id, updates);
    };

    const handleMouseUp = (event: MouseEvent) => {
      const state = dragRef.current;
      if (!state) return;

      const updates = computeDragUpdates(event.clientX, event.clientY)
        ?? toGpuCurvesChannelParamUpdates(state.channel, readGpuCurvesChannelControl(draftRef.current, state.channel));

      setDraft((prev) => ({ ...prev, ...updates }));
      onParamsBatchChange(effect.id, updates);
      dragRef.current = null;
      setDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [computeDragUpdates, effect.id, onParamsBatchChange, onParamsBatchLiveChange]);

  const handlePointMouseDown = useCallback(
    (event: React.MouseEvent, pointKey: PointKey) => {
      if (!effect.enabled) return;
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = { channel: activeChannel, pointKey };
      setDragging(true);
    },
    [activeChannel, effect.enabled],
  );

  const handleResetChannel = useCallback(() => {
    const updates = getResetParamsForChannel(activeChannel);
    setDraft((prev) => ({ ...prev, ...updates }));
    onParamsBatchChange(effect.id, updates);
  }, [activeChannel, effect.id, onParamsBatchChange]);

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

      <PropertyRow label="Channel">
        <div className="flex items-center gap-1 flex-wrap justify-end">
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
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleResetChannel}
            disabled={!effect.enabled}
          >
            Reset Channel
          </Button>
        </div>
      </PropertyRow>

      <div className="px-2">
        <div className="relative overflow-hidden rounded border border-border/70 bg-black/50">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${CURVE_SIZE} ${CURVE_SIZE}`}
            className="aspect-square w-full cursor-default"
          >
            {[0.25, 0.5, 0.75].map((grid) => (
              <g key={grid}>
                <line
                  x1={grid * CURVE_SIZE}
                  y1={0}
                  x2={grid * CURVE_SIZE}
                  y2={CURVE_SIZE}
                  stroke="rgba(148,163,184,0.22)"
                  strokeWidth={1}
                />
                <line
                  x1={0}
                  y1={grid * CURVE_SIZE}
                  x2={CURVE_SIZE}
                  y2={grid * CURVE_SIZE}
                  stroke="rgba(148,163,184,0.22)"
                  strokeWidth={1}
                />
              </g>
            ))}

            <path
              d={`M 0 ${CURVE_SIZE} L ${CURVE_SIZE} 0`}
              stroke="rgba(148,163,184,0.35)"
              strokeWidth={1}
              fill="none"
              strokeDasharray="4 4"
            />

            {activeChannel === 'master' && (
              <>
                <path d={curvePaths.red} stroke="#ef4444" strokeWidth={1.2} fill="none" opacity={0.35} />
                <path d={curvePaths.green} stroke="#22c55e" strokeWidth={1.2} fill="none" opacity={0.35} />
                <path d={curvePaths.blue} stroke="#3b82f6" strokeWidth={1.2} fill="none" opacity={0.35} />
              </>
            )}

            {activeChannel !== 'master' && (
              <path
                d={curvePaths.master}
                stroke="rgba(229,231,235,0.35)"
                strokeWidth={1.2}
                fill="none"
                strokeDasharray="5 4"
              />
            )}

            <path
              d={curvePaths[activeChannel]}
              stroke={activeChannelMeta.color}
              strokeWidth={2}
              fill="none"
            />

            {handlePoints.map((point, index) => {
              const pointKey = index === 0 ? 'shadow' : 'highlight';
              const x = point.x * CURVE_SIZE;
              const y = (1 - point.y) * CURVE_SIZE;

              return (
                <g key={pointKey}>
                  <line
                    x1={x}
                    y1={CURVE_SIZE}
                    x2={x}
                    y2={y}
                    stroke={activeChannelMeta.color}
                    strokeWidth={1}
                    opacity={0.18}
                  />
                  <circle
                    cx={x}
                    cy={y}
                    r={6}
                    fill={activeChannelMeta.color}
                    stroke="rgba(3,7,18,0.95)"
                    strokeWidth={1.5}
                    className={effect.enabled ? 'cursor-move' : 'pointer-events-none'}
                    onMouseDown={(event) => handlePointMouseDown(event, pointKey)}
                  />
                </g>
              );
            })}
          </svg>
        </div>
        <div className="mt-1 text-center text-[10px] text-muted-foreground">
          Drag both points to shape the {activeChannelMeta.label.toLowerCase()} curve. Pull the left point down and the right point up for a classic S-curve.
        </div>
      </div>
    </div>
  );
});
