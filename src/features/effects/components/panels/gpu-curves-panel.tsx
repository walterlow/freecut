import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PropertyRow } from '@/shared/ui/property-controls'
import { cn } from '@/shared/ui/cn'
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
import type { GpuEffect } from '@/types/effects'
import { getEffectDefinitionName } from '@/features/effects/utils/effect-i18n'
import { EffectPanelHeaderRow } from './effect-panel-header-actions'
import type { GpuPanelBaseProps, GpuParamUpdates } from './panel-props'

interface GpuCurvesPanelProps extends GpuPanelBaseProps {
  layout?: 'sidebar' | 'dock'
  onParamsBatchChange: (effectId: string, updates: GpuParamUpdates) => void
  onParamsBatchLiveChange: (effectId: string, updates: GpuParamUpdates) => void
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

function getInsertIndexForCurvePoint(
  points: GpuCurvesControlPoint[],
  position: GpuCurvesControlPoint,
): number | null {
  if (points.length >= GPU_CURVES_MAX_POINTS) return null

  const firstGreaterIndex = points.findIndex((point) => position.x < point.x)
  const rawInsertIndex = firstGreaterIndex === -1 ? points.length : firstGreaterIndex
  const insertIndex = clamp(rawInsertIndex, 1, points.length - 1)
  const previous = points[insertIndex - 1]
  const next = points[insertIndex]
  if (!previous || !next) return null

  const minGap = GPU_CURVES_POINT_MIN_GAP / 2
  if (position.x - previous.x < minGap || next.x - position.x < minGap) {
    return null
  }

  return insertIndex
}

function getKeyboardPointDelta(
  event: React.KeyboardEvent<SVGElement>,
): GpuCurvesControlPoint | null {
  const step = event.shiftKey ? 0.05 : 0.01
  if (event.key === 'ArrowLeft') return { x: -step, y: 0 }
  if (event.key === 'ArrowRight') return { x: step, y: 0 }
  if (event.key === 'ArrowDown') return { x: 0, y: -step }
  if (event.key === 'ArrowUp') return { x: 0, y: step }
  return null
}

function isRemovePointKey(key: string): boolean {
  return key === 'Delete' || key === 'Backspace'
}

export const GpuCurvesPanel = memo(function GpuCurvesPanel({
  effect,
  gpuEffect,
  definition,
  layout = 'sidebar',
  collapsible = false,
  onEditInColor,
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
  const isDock = layout === 'dock'
  // Collapse only in the sidebar — the dock is the dedicated grading surface.
  const allowCollapse = collapsible && !isDock
  const [collapsed, setCollapsed] = useState(allowCollapse)
  const showBody = !(allowCollapse && collapsed)
  const svgRef = useRef<SVGSVGElement>(null)
  const [svgSize, setSvgSize] = useState({ width: CURVE_SIZE, height: CURVE_SIZE })
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

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    const updateSize = () => {
      const rect = svg.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      setSvgSize({ width: rect.width, height: rect.height })
    }

    updateSize()
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(updateSize)
    observer.observe(svg)
    return () => observer.disconnect()
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

  const handlePointKeyDown = useCallback(
    (event: React.KeyboardEvent<SVGEllipseElement>, index: number) => {
      if (!effect.enabled) return

      const points = draftRef.current[activeChannel]
      const point = points[index]
      if (!point) return

      const isEndpoint = index === 0 || index === points.length - 1
      if (isRemovePointKey(event.key) && !isEndpoint) {
        event.preventDefault()
        const nextPoints = points.filter((_, pointIndex) => pointIndex !== index)
        updateChannelDraft(activeChannel, nextPoints)
        onParamsBatchChange(effect.id, {
          [getGpuCurvesPointsParamKey(activeChannel)]: serializeGpuCurvesChannelPoints(nextPoints),
        })
        return
      }

      const delta = getKeyboardPointDelta(event)
      if (!delta) return
      event.preventDefault()

      const nextPoint = clampDraggedPoint(points, index, {
        x: point.x + delta.x,
        y: point.y + delta.y,
      })
      if (!nextPoint) return
      const nextPoints = sanitizeGpuCurvesChannelPoints(
        points.map((candidate, pointIndex) => (pointIndex === index ? nextPoint : candidate)),
      )
      updateChannelDraft(activeChannel, nextPoints)
      onParamsBatchChange(effect.id, {
        [getGpuCurvesPointsParamKey(activeChannel)]: serializeGpuCurvesChannelPoints(nextPoints),
      })
    },
    [activeChannel, effect.enabled, effect.id, onParamsBatchChange, updateChannelDraft],
  )

  const handleSvgMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (!effect.enabled || event.button !== 0 || dragRef.current) return

      const position = getNormalizedPointFromClient(event.clientX, event.clientY)
      if (!position) return

      const points = draftRef.current[activeChannel]
      const insertIndex = getInsertIndexForCurvePoint(points, position)
      if (insertIndex === null) return

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

  const resetChannelLabel = t('effects.curves.resetChannel')
  const pointScaleX = Math.max(svgSize.width / CURVE_SIZE, 0.001)
  const pointScaleY = Math.max(svgSize.height / CURVE_SIZE, 0.001)
  const pointScreenScale = Math.min(pointScaleX, pointScaleY)
  const pointRadiusX = (6 * pointScreenScale) / pointScaleX
  const pointRadiusY = (6 * pointScreenScale) / pointScaleY
  const pointStrokeWidth = (1.5 * pointScreenScale) / Math.max(pointScaleX, pointScaleY)
  const channelControls = (
    <div
      className={cn(
        'flex items-center gap-1 justify-end',
        isDock ? 'min-w-0 flex-nowrap' : 'flex-wrap',
      )}
    >
      {CHANNELS.map((channel) => (
        <Button
          key={channel.key}
          variant={activeChannel === channel.key ? 'secondary' : 'outline'}
          size="sm"
          className={cn('h-7 text-xs', isDock ? 'shrink-0 px-1.5' : 'px-2')}
          onClick={() => setActiveChannel(channel.key)}
        >
          {t(channel.labelKey)}
        </Button>
      ))}
      <Button
        variant="ghost"
        size={isDock ? 'icon' : 'sm'}
        className={cn('h-7 text-xs', isDock ? 'w-7 shrink-0' : 'px-2')}
        onClick={handleResetChannel}
        disabled={!effect.enabled}
        title={resetChannelLabel}
        aria-label={resetChannelLabel}
      >
        {isDock ? <RotateCcw className="h-3 w-3" /> : resetChannelLabel}
      </Button>
    </div>
  )

  return (
    <div className={cn('space-y-0', isDock && 'flex h-full min-h-0 flex-col overflow-hidden')}>
      <EffectPanelHeaderRow
        label={getEffectDefinitionName(definition)}
        effectId={effect.id}
        enabled={effect.enabled}
        isDefault={isDefault}
        onReset={onReset}
        onToggle={onToggle}
        onRemove={onRemove}
        onMove={onMove}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        collapsed={allowCollapse ? collapsed : undefined}
        onToggleCollapsed={allowCollapse ? () => setCollapsed((value) => !value) : undefined}
        onEditInColor={onEditInColor}
      />

      {showBody &&
        (isDock ? (
          <div className="flex h-9 shrink-0 items-center justify-between gap-2 px-2">
            <span className="text-xs text-muted-foreground">{t('effects.curves.channel')}</span>
            {channelControls}
          </div>
        ) : (
          <PropertyRow label={t('effects.curves.channel')}>{channelControls}</PropertyRow>
        ))}

      {showBody && (
        <div className={cn('px-2', isDock && 'flex min-h-0 flex-1 pb-2')}>
          <div
            className={cn(
              'relative overflow-hidden rounded border border-border/70 bg-black/50',
              isDock && 'flex min-h-0 flex-1',
            )}
          >
            <svg
              ref={svgRef}
              data-curves-editor="true"
              aria-label={t('effects.curves.editorAriaLabel', {
                channel: activeChannelLabel,
                defaultValue: `${activeChannelLabel} curve editor`,
              })}
              viewBox={`0 0 ${CURVE_SIZE} ${CURVE_SIZE}`}
              preserveAspectRatio={isDock ? 'none' : 'xMidYMid meet'}
              className={cn(
                isDock ? 'h-full w-full' : 'aspect-square w-full',
                effect.enabled ? 'cursor-crosshair' : 'cursor-default',
              )}
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
                    vectorEffect="non-scaling-stroke"
                  />
                  <line
                    x1={0}
                    y1={grid * CURVE_SIZE}
                    x2={CURVE_SIZE}
                    y2={grid * CURVE_SIZE}
                    stroke="rgba(148,163,184,0.22)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ))}

              <path
                d={`M 0 ${CURVE_SIZE} L ${CURVE_SIZE} 0`}
                stroke="rgba(148,163,184,0.35)"
                strokeWidth={1}
                fill="none"
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />

              {activeChannel === 'master' && (
                <>
                  <path
                    d={curvePaths.red}
                    stroke="#ef4444"
                    strokeWidth={1.2}
                    fill="none"
                    opacity={0.35}
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d={curvePaths.green}
                    stroke="#22c55e"
                    strokeWidth={1.2}
                    fill="none"
                    opacity={0.35}
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d={curvePaths.blue}
                    stroke="#3b82f6"
                    strokeWidth={1.2}
                    fill="none"
                    opacity={0.35}
                    vectorEffect="non-scaling-stroke"
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
                  vectorEffect="non-scaling-stroke"
                />
              )}

              <path
                d={curvePaths[activeChannel]}
                stroke={activeChannelMeta.color}
                strokeWidth={2}
                fill="none"
                vectorEffect="non-scaling-stroke"
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
                      vectorEffect="non-scaling-stroke"
                    />
                    <ellipse
                      data-curve-point={index}
                      tabIndex={effect.enabled ? 0 : -1}
                      role="slider"
                      aria-label={t('effects.curves.pointAriaLabel', {
                        channel: activeChannelLabel,
                        index: index + 1,
                        defaultValue: `${activeChannelLabel} curve point ${index + 1}`,
                      })}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(point.y * 100)}
                      aria-valuetext={`input ${Math.round(point.x * 100)}%, output ${Math.round(point.y * 100)}%`}
                      cx={x}
                      cy={y}
                      rx={pointRadiusX}
                      ry={pointRadiusY}
                      fill={activeChannelMeta.color}
                      stroke="rgba(3,7,18,0.95)"
                      strokeWidth={pointStrokeWidth}
                      className={effect.enabled ? 'cursor-move' : 'pointer-events-none'}
                      onMouseDown={(event) => handlePointMouseDown(event, index)}
                      onKeyDown={(event) => handlePointKeyDown(event, index)}
                    />
                  </g>
                )
              })}
            </svg>
          </div>
          {!isDock && (
            <div className="mt-1 text-center text-[10px] text-muted-foreground">
              {t('effects.curves.multiPointHint', { channel: activeChannelLabel.toLowerCase() })}
            </div>
          )}
        </div>
      )}
    </div>
  )
})
