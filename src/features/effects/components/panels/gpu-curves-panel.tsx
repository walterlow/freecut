import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, RotateCcw, Trash2 } from 'lucide-react'
import { EffectMoveButtons, type EffectMoveProps } from './effect-move-buttons'
import { Button } from '@/components/ui/button'
import type { GpuEffectDefinition } from '@/infrastructure/gpu-effects'
import { PropertyRow } from '@/shared/ui/property-controls'
import { evaluateMonotoneCurve } from '@/shared/utils/curve-spline'
import {
  buildGpuCurvesChannelPoints,
  getDefaultGpuCurvesChannelControl,
  getGpuCurvesPointsParamKey,
  GPU_CURVES_CHANNELS,
  GPU_CURVES_MAX_POINTS,
  GPU_CURVES_POINT_MIN_GAP,
  isGpuCurvesChannelIdentity,
  readGpuCurvesChannelPoints,
  sanitizeGpuCurvesChannelPoints,
  serializeGpuCurvesChannelPoints,
  toGpuCurvesChannelParamUpdates,
  type GpuCurvesChannelKey,
  type GpuCurvesControlPoint,
} from '@/shared/utils/gpu-curves'
import type { GpuEffect, ItemEffect } from '@/types/effects'
import { getEffectDefinitionName } from '@/features/effects/utils/effect-i18n'

interface GpuCurvesPanelProps extends EffectMoveProps {
  effect: ItemEffect
  gpuEffect: GpuEffect
  definition: GpuEffectDefinition
  onParamChange: (effectId: string, paramKey: string, value: number | boolean | string) => void
  onParamLiveChange: (effectId: string, paramKey: string, value: number | boolean | string) => void
  onParamsBatchChange: (
    effectId: string,
    updates: Record<string, number | boolean | string>,
  ) => void
  onParamsBatchLiveChange: (
    effectId: string,
    updates: Record<string, number | boolean | string>,
  ) => void
  onReset: (effectId: string) => void
  onToggle: (effectId: string) => void
  onRemove: (effectId: string) => void
}

type ChannelPointsDraft = Record<GpuCurvesChannelKey, GpuCurvesControlPoint[]>

interface DragState {
  channel: GpuCurvesChannelKey
  index: number
}

const CURVE_SIZE = 230
const CURVE_SAMPLE_STEPS = 64
const CHANNELS: Array<{ key: GpuCurvesChannelKey; labelKey: string; color: string }> = [
  { key: 'master', labelKey: 'effects.curves.channelMaster', color: '#e5e7eb' },
  { key: 'red', labelKey: 'effects.curves.channelRed', color: '#ef4444' },
  { key: 'green', labelKey: 'effects.curves.channelGreen', color: '#22c55e' },
  { key: 'blue', labelKey: 'effects.curves.channelBlue', color: '#3b82f6' },
]

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function readAllChannelPoints(params: GpuEffect['params']): ChannelPointsDraft {
  return {
    master: readGpuCurvesChannelPoints(params, 'master'),
    red: readGpuCurvesChannelPoints(params, 'red'),
    green: readGpuCurvesChannelPoints(params, 'green'),
    blue: readGpuCurvesChannelPoints(params, 'blue'),
  }
}

function buildSampledCurvePath(points: GpuCurvesControlPoint[], size: number): string {
  const segments: string[] = []
  for (let i = 0; i <= CURVE_SAMPLE_STEPS; i += 1) {
    const x = i / CURVE_SAMPLE_STEPS
    const y = evaluateMonotoneCurve(points, x)
    const command = i === 0 ? 'M' : 'L'
    segments.push(`${command} ${(x * size).toFixed(2)} ${((1 - y) * size).toFixed(2)}`)
  }
  return segments.join(' ')
}

/**
 * Endpoints keep their x locked to 0/1 (y free); interior points stay strictly
 * ordered by clamping x between their neighbors with a minimum gap.
 */
function clampDraggedPoint(
  points: GpuCurvesControlPoint[],
  index: number,
  position: GpuCurvesControlPoint,
): GpuCurvesControlPoint | null {
  const lastIndex = points.length - 1
  const y = clamp(position.y, 0, 1)
  if (index === 0) return { x: 0, y }
  if (index === lastIndex) return { x: 1, y }

  const previous = points[index - 1]
  const next = points[index + 1]
  if (!previous || !next) return null

  const min = previous.x + GPU_CURVES_POINT_MIN_GAP
  const max = next.x - GPU_CURVES_POINT_MIN_GAP
  const x = min > max ? (previous.x + next.x) / 2 : clamp(position.x, min, max)
  return { x, y }
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
  onMove,
  canMoveUp,
  canMoveDown,
}: GpuCurvesPanelProps) {
  const { t } = useTranslation()
  const svgRef = useRef<SVGSVGElement>(null)
  const [activeChannel, setActiveChannel] = useState<GpuCurvesChannelKey>('master')
  const [dragging, setDragging] = useState(false)
  const [draft, setDraft] = useState<ChannelPointsDraft>(() =>
    readAllChannelPoints(gpuEffect.params),
  )
  const draftRef = useRef(draft)

  const dragRef = useRef<DragState | null>(null)
  const rafRef = useRef<number | null>(null)
  const pendingPositionRef = useRef<GpuCurvesControlPoint | null>(null)

  const updateChannelDraft = useCallback(
    (channel: GpuCurvesChannelKey, points: GpuCurvesControlPoint[]) => {
      draftRef.current = { ...draftRef.current, [channel]: points }
      setDraft(draftRef.current)
    },
    [],
  )

  useEffect(() => {
    if (dragging) return
    const next = readAllChannelPoints(gpuEffect.params)
    draftRef.current = next
    setDraft(next)
  }, [dragging, gpuEffect.params])

  const isDefault = useMemo(
    () => GPU_CURVES_CHANNELS.every((channel) => isGpuCurvesChannelIdentity(draft[channel])),
    [draft],
  )

  const activeChannelMeta = CHANNELS.find((channel) => channel.key === activeChannel)!
  const activeChannelLabel = t(activeChannelMeta.labelKey)
  const activePoints = draft[activeChannel]

  const curvePaths = useMemo(
    () =>
      Object.fromEntries(
        GPU_CURVES_CHANNELS.map((channel) => [
          channel,
          buildSampledCurvePath(draft[channel], CURVE_SIZE),
        ]),
      ) as Record<GpuCurvesChannelKey, string>,
    [draft],
  )

  const getNormalizedPointFromClient = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: clamp((clientX - rect.left) / rect.width, 0, 1),
      y: clamp(1 - (clientY - rect.top) / rect.height, 0, 1),
    }
  }, [])

  const moveDraggedPoint = useCallback(
    (state: DragState, position: GpuCurvesControlPoint): GpuCurvesControlPoint[] | null => {
      const points = draftRef.current[state.channel]
      if (state.index < 0 || state.index >= points.length) return null
      const moved = clampDraggedPoint(points, state.index, position)
      if (!moved) return null
      return points.map((point, index) => (index === state.index ? moved : point))
    },
    [],
  )

  useEffect(() => {
    const flushDragFrame = () => {
      rafRef.current = null
      const state = dragRef.current
      const position = pendingPositionRef.current
      if (!state || !position) return
      const points = moveDraggedPoint(state, position)
      if (!points) return
      updateChannelDraft(state.channel, points)
      onParamsBatchLiveChange(effect.id, {
        [getGpuCurvesPointsParamKey(state.channel)]: serializeGpuCurvesChannelPoints(points),
      })
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!dragRef.current) return
      const position = getNormalizedPointFromClient(event.clientX, event.clientY)
      if (!position) return
      pendingPositionRef.current = position
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(flushDragFrame)
      }
    }

    const handleMouseUp = (event: MouseEvent) => {
      const state = dragRef.current
      if (!state) return

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }

      const position = getNormalizedPointFromClient(event.clientX, event.clientY)
      const moved = position ? moveDraggedPoint(state, position) : null
      const points = sanitizeGpuCurvesChannelPoints(moved ?? draftRef.current[state.channel])

      updateChannelDraft(state.channel, points)
      onParamsBatchChange(effect.id, {
        [getGpuCurvesPointsParamKey(state.channel)]: serializeGpuCurvesChannelPoints(points),
      })

      dragRef.current = null
      pendingPositionRef.current = null
      setDragging(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [
    effect.id,
    getNormalizedPointFromClient,
    moveDraggedPoint,
    onParamsBatchChange,
    onParamsBatchLiveChange,
    updateChannelDraft,
  ])

  const handlePointMouseDown = useCallback(
    (event: React.MouseEvent, index: number) => {
      if (!effect.enabled || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()

      const points = draftRef.current[activeChannel]
      const isEndpoint = index === 0 || index === points.length - 1

      if (event.detail >= 2) {
        // Double-click removes interior points; endpoints are fixed.
        if (isEndpoint) return
        const nextPoints = points.filter((_, pointIndex) => pointIndex !== index)
        updateChannelDraft(activeChannel, nextPoints)
        onParamsBatchChange(effect.id, {
          [getGpuCurvesPointsParamKey(activeChannel)]: serializeGpuCurvesChannelPoints(nextPoints),
        })
        return
      }

      dragRef.current = { channel: activeChannel, index }
      setDragging(true)
    },
    [activeChannel, effect.enabled, effect.id, onParamsBatchChange, updateChannelDraft],
  )

  const handleSvgMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (!effect.enabled || event.button !== 0 || dragRef.current) return

      const position = getNormalizedPointFromClient(event.clientX, event.clientY)
      if (!position) return

      const points = draftRef.current[activeChannel]
      if (points.length >= GPU_CURVES_MAX_POINTS) return

      let insertIndex = points.length
      for (let i = 0; i < points.length; i += 1) {
        const point = points[i]
        if (point && position.x < point.x) {
          insertIndex = i
          break
        }
      }
      insertIndex = clamp(insertIndex, 1, points.length - 1)

      const previous = points[insertIndex - 1]
      const next = points[insertIndex]
      if (!previous || !next) return
      if (
        position.x - previous.x < GPU_CURVES_POINT_MIN_GAP / 2 ||
        next.x - position.x < GPU_CURVES_POINT_MIN_GAP / 2
      ) {
        return
      }

      event.preventDefault()
      const nextPoints = [
        ...points.slice(0, insertIndex),
        { x: position.x, y: position.y },
        ...points.slice(insertIndex),
      ]
      updateChannelDraft(activeChannel, nextPoints)
      onParamsBatchLiveChange(effect.id, {
        [getGpuCurvesPointsParamKey(activeChannel)]: serializeGpuCurvesChannelPoints(nextPoints),
      })

      // The new point is grabbed immediately; mouseup commits it.
      dragRef.current = { channel: activeChannel, index: insertIndex }
      setDragging(true)
    },
    [
      activeChannel,
      effect.enabled,
      effect.id,
      getNormalizedPointFromClient,
      onParamsBatchLiveChange,
      updateChannelDraft,
    ],
  )

  const handleResetChannel = useCallback(() => {
    const updates: Record<string, number | string> = {
      [getGpuCurvesPointsParamKey(activeChannel)]: '',
      ...toGpuCurvesChannelParamUpdates(activeChannel, getDefaultGpuCurvesChannelControl()),
    }
    updateChannelDraft(
      activeChannel,
      buildGpuCurvesChannelPoints(getDefaultGpuCurvesChannelControl()),
    )
    onParamsBatchChange(effect.id, updates)
  }, [activeChannel, effect.id, onParamsBatchChange, updateChannelDraft])

  return (
    <div className="space-y-0">
      <PropertyRow label={getEffectDefinitionName(definition)}>
        <div className="flex items-center gap-1 min-w-0 w-full justify-end">
          <EffectMoveButtons
            effectId={effect.id}
            onMove={onMove}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
          />
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 flex-shrink-0 ${isDefault ? 'opacity-30' : ''}`}
            onClick={() => onReset(effect.id)}
            title={t('effects.panel.resetToDefaults')}
            disabled={isDefault}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0"
            onClick={() => onToggle(effect.id)}
            title={
              effect.enabled ? t('effects.panel.disableEffect') : t('effects.panel.enableEffect')
            }
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
            title={t('effects.panel.removeEffect')}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </PropertyRow>

      <PropertyRow label={t('effects.curves.channel')}>
        <div className="flex items-center gap-1 flex-wrap justify-end">
          {CHANNELS.map((channel) => (
            <Button
              key={channel.key}
              variant={activeChannel === channel.key ? 'secondary' : 'outline'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setActiveChannel(channel.key)}
            >
              {t(channel.labelKey)}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleResetChannel}
            disabled={!effect.enabled}
          >
            {t('effects.curves.resetChannel')}
          </Button>
        </div>
      </PropertyRow>

      <div className="px-2">
        <div className="relative overflow-hidden rounded border border-border/70 bg-black/50">
          <svg
            ref={svgRef}
            data-curves-editor="true"
            viewBox={`0 0 ${CURVE_SIZE} ${CURVE_SIZE}`}
            className={`aspect-square w-full ${effect.enabled ? 'cursor-crosshair' : 'cursor-default'}`}
            onMouseDown={handleSvgMouseDown}
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
                <path
                  d={curvePaths.red}
                  stroke="#ef4444"
                  strokeWidth={1.2}
                  fill="none"
                  opacity={0.35}
                />
                <path
                  d={curvePaths.green}
                  stroke="#22c55e"
                  strokeWidth={1.2}
                  fill="none"
                  opacity={0.35}
                />
                <path
                  d={curvePaths.blue}
                  stroke="#3b82f6"
                  strokeWidth={1.2}
                  fill="none"
                  opacity={0.35}
                />
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

            {activePoints.map((point, index) => {
              const x = point.x * CURVE_SIZE
              const y = (1 - point.y) * CURVE_SIZE

              return (
                <g key={`${activeChannel}-${index}`}>
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
                    data-curve-point={index}
                    cx={x}
                    cy={y}
                    r={6}
                    fill={activeChannelMeta.color}
                    stroke="rgba(3,7,18,0.95)"
                    strokeWidth={1.5}
                    className={effect.enabled ? 'cursor-move' : 'pointer-events-none'}
                    onMouseDown={(event) => handlePointMouseDown(event, index)}
                  />
                </g>
              )
            })}
          </svg>
        </div>
        <div className="mt-1 text-center text-[10px] text-muted-foreground">
          {t('effects.curves.multiPointHint', { channel: activeChannelLabel.toLowerCase() })}
        </div>
      </div>
    </div>
  )
})
