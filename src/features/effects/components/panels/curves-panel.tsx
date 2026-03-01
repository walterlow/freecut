import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { Eye, EyeOff, Trash2, RotateCcw, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
  ItemEffect,
  CurvesEffect,
  CurvesChannels,
  CurvePoint,
} from '@/types/effects';
import { PropertyRow } from '@/shared/ui/property-controls';
import { buildMonotoneCurveSvgPath, normalizeCurvePoints } from '@/shared/utils/curve-spline';

interface CurvesPanelProps {
  effect: ItemEffect;
  curves: CurvesEffect;
  onCurvesChange: (effectId: string, channels: CurvesChannels) => void;
  onCurvesLiveChange: (effectId: string, channels: CurvesChannels) => void;
  onReset: (effectId: string) => void;
  onToggle: (effectId: string) => void;
  onRemove: (effectId: string) => void;
}

const CURVE_SIZE = 230;
const CHANNELS: Array<{ key: keyof CurvesChannels; label: string; color: string }> = [
  { key: 'master', label: 'Master', color: '#e5e7eb' },
  { key: 'red', label: 'Red', color: '#ef4444' },
  { key: 'green', label: 'Green', color: '#22c55e' },
  { key: 'blue', label: 'Blue', color: '#3b82f6' },
];

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function defaultCurve(): CurvePoint[] {
  return [{ x: 0, y: 0 }, { x: 1, y: 1 }];
}

function normalizePoints(points: CurvePoint[]): CurvePoint[] {
  const normalized = normalizeCurvePoints(points);
  return normalized.length > 0 ? normalized : defaultCurve();
}

function normalizeChannels(channels: CurvesChannels | undefined): CurvesChannels {
  return {
    master: normalizePoints(channels?.master ?? defaultCurve()),
    red: normalizePoints(channels?.red ?? defaultCurve()),
    green: normalizePoints(channels?.green ?? defaultCurve()),
    blue: normalizePoints(channels?.blue ?? defaultCurve()),
  };
}

export const CurvesPanel = memo(function CurvesPanel({
  effect,
  curves,
  onCurvesChange,
  onCurvesLiveChange,
  onReset,
  onToggle,
  onRemove,
}: CurvesPanelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [activeChannel, setActiveChannel] = useState<keyof CurvesChannels>('master');
  const [draftChannels, setDraftChannels] = useState<CurvesChannels>(() =>
    normalizeChannels(curves.channels)
  );
  const dragStateRef = useRef<{
    channel: keyof CurvesChannels;
    pointIndex: number;
    latestChannels: CurvesChannels;
  } | null>(null);

  useEffect(() => {
    setDraftChannels(normalizeChannels(curves.channels));
  }, [curves.channels]);

  const currentPoints = useMemo(() => draftChannels[activeChannel], [draftChannels, activeChannel]);
  const currentCurvePath = useMemo(
    () => buildMonotoneCurveSvgPath(currentPoints, CURVE_SIZE, CURVE_SIZE),
    [currentPoints]
  );

  const getCurveCoordinates = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const x = clamp((clientX - rect.left) / rect.width, 0, 1);
    const y = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
    return { x, y };
  }, []);

  const applyPointUpdate = useCallback((
    channel: keyof CurvesChannels,
    pointIndex: number,
    x: number,
    y: number
  ) => {
    const points = [...draftChannels[channel]];
    const prev = points[pointIndex - 1];
    const next = points[pointIndex + 1];

    // Keep endpoints anchored on x-axis bounds.
    if (pointIndex === 0) {
      x = 0;
    } else if (pointIndex === points.length - 1) {
      x = 1;
    } else {
      const minX = (prev?.x ?? 0) + 0.01;
      const maxX = (next?.x ?? 1) - 0.01;
      x = clamp(x, minX, maxX);
    }

    points[pointIndex] = { x, y: clamp(y, 0, 1) };
    const normalized = normalizePoints(points);
    const nextChannels: CurvesChannels = {
      ...draftChannels,
      [channel]: normalized,
    };
    setDraftChannels(nextChannels);
    return nextChannels;
  }, [draftChannels]);

  const handlePointMouseDown = useCallback((
    event: React.MouseEvent<SVGCircleElement>,
    pointIndex: number
  ) => {
    if (!effect.enabled) return;
    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current = {
      channel: activeChannel,
      pointIndex,
      latestChannels: draftChannels,
    };
  }, [activeChannel, draftChannels, effect.enabled]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const state = dragStateRef.current;
      if (!state) return;
      const coords = getCurveCoordinates(event.clientX, event.clientY);
      if (!coords) return;
      const nextChannels = applyPointUpdate(state.channel, state.pointIndex, coords.x, coords.y);
      dragStateRef.current = { ...state, latestChannels: nextChannels };
      onCurvesLiveChange(effect.id, nextChannels);
    };

    const handleMouseUp = () => {
      const state = dragStateRef.current;
      if (!state) return;
      onCurvesChange(effect.id, state.latestChannels);
      dragStateRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [applyPointUpdate, effect.id, getCurveCoordinates, onCurvesChange, onCurvesLiveChange]);

  const addPointAtClientPosition = useCallback((
    clientX: number,
    clientY: number
  ): { channels: CurvesChannels; pointIndex: number } | null => {
    if (!effect.enabled) return null;
    const coords = getCurveCoordinates(clientX, clientY);
    if (!coords) return null;
    const points = draftChannels[activeChannel];
    const nearest = points.some((p) => Math.abs(p.x - coords.x) < 0.03);
    if (nearest) return null;

    const nextPoints = normalizePoints([...points, coords]);
    const nextChannels: CurvesChannels = {
      ...draftChannels,
      [activeChannel]: nextPoints,
    };
    setDraftChannels(nextChannels);
    onCurvesLiveChange(effect.id, nextChannels);

    let insertedIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    nextPoints.forEach((point, idx) => {
      const distance = Math.abs(point.x - coords.x) + Math.abs(point.y - coords.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        insertedIndex = idx;
      }
    });

    return { channels: nextChannels, pointIndex: insertedIndex };
  }, [activeChannel, draftChannels, effect.enabled, getCurveCoordinates, onCurvesLiveChange, effect.id]);

  const handleCurveLineMouseDown = useCallback((event: React.MouseEvent<SVGPathElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const inserted = addPointAtClientPosition(event.clientX, event.clientY);
    if (!inserted) return;
    dragStateRef.current = {
      channel: activeChannel,
      pointIndex: inserted.pointIndex,
      latestChannels: inserted.channels,
    };
  }, [activeChannel, addPointAtClientPosition]);

  const handleRemovePoint = useCallback((
    event: React.MouseEvent<SVGCircleElement>,
    pointIndex: number
  ) => {
    if (!effect.enabled) return;
    event.preventDefault();
    event.stopPropagation();

    const points = draftChannels[activeChannel];
    if (pointIndex === 0 || pointIndex === points.length - 1 || points.length <= 2) return;

    const nextPoints = normalizePoints(points.filter((_, idx) => idx !== pointIndex));
    const nextChannels: CurvesChannels = {
      ...draftChannels,
      [activeChannel]: nextPoints,
    };
    setDraftChannels(nextChannels);
    onCurvesChange(effect.id, nextChannels);
  }, [activeChannel, draftChannels, effect.enabled, effect.id, onCurvesChange]);

  const activeChannelMeta = CHANNELS.find((c) => c.key === activeChannel)!;

  return (
    <div className="border-b border-border/50 pb-2 mb-2">
      <PropertyRow label="Curves">
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
          <span className="text-[10px] text-muted-foreground ml-1">
            Click curve to add | Right-click point to remove
          </span>
        </div>
      </PropertyRow>

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
                  x1={g * CURVE_SIZE}
                  y1={0}
                  x2={g * CURVE_SIZE}
                  y2={CURVE_SIZE}
                  stroke="rgba(148,163,184,0.22)"
                  strokeWidth={1}
                />
                <line
                  x1={0}
                  y1={g * CURVE_SIZE}
                  x2={CURVE_SIZE}
                  y2={g * CURVE_SIZE}
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

            <path
              d={currentCurvePath}
              stroke={activeChannelMeta.color}
              strokeWidth={2}
              fill="none"
              className="pointer-events-none"
            />

            <path
              d={currentCurvePath}
              stroke="transparent"
              strokeWidth={16}
              fill="none"
              pointerEvents="stroke"
              className={effect.enabled ? 'cursor-crosshair' : 'pointer-events-none'}
              onMouseDown={handleCurveLineMouseDown}
            />

            {currentPoints.map((point, idx) => (
              <circle
                key={`${point.x}-${idx}`}
                cx={point.x * CURVE_SIZE}
                cy={(1 - point.y) * CURVE_SIZE}
                r={idx === 0 || idx === currentPoints.length - 1 ? 4 : 4.5}
                fill={activeChannelMeta.color}
                stroke="rgba(3,7,18,0.95)"
                strokeWidth={1.5}
                onMouseDown={(e) => handlePointMouseDown(e, idx)}
                onContextMenu={(e) => handleRemovePoint(e, idx)}
              />
            ))}
          </svg>

        </div>
      </div>

      <PropertyRow label="Reset">
        <div className="flex items-center gap-1 min-w-0 w-full">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs flex-1"
            onClick={() => onReset(effect.id)}
            disabled={!effect.enabled}
          >
            <RotateCcw className="w-3 h-3 mr-1" />
            Reset Curves
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            title="Add control point"
            onClick={() => {
              const points = draftChannels[activeChannel];
              const first = points[0] ?? { x: 0, y: 0 };
              const last = points[points.length - 1] ?? { x: 1, y: 1 };
              const midX = (first.x + last.x) / 2;
              const midY = (first.y + last.y) / 2;
              const newX = clamp(midX + 0.08 * (midX < 0.5 ? 1 : -1), Number.EPSILON, 1 - Number.EPSILON);
              const next = normalizePoints([...points, { x: newX, y: midY }]);
              const nextChannels: CurvesChannels = {
                ...draftChannels,
                [activeChannel]: next,
              };
              setDraftChannels(nextChannels);
              onCurvesChange(effect.id, nextChannels);
            }}
            disabled={!effect.enabled}
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>
    </div>
  );
});
