import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '@/shared/ui/cn'

import {
  getKeyframeNavigatorThumbMetrics,
  type KeyframeNavigatorViewport,
} from './compact-navigator-utils'

const DRAG_THRESHOLD_PX = 2
type MarqueeMode = 'replace' | 'add' | 'toggle'

interface KeyframeTimingStripMarker {
  id: string
  frame: number
  selected: boolean
  draggable: boolean
}

interface KeyframeTimingStripProps {
  viewport: KeyframeNavigatorViewport
  contentFrameMax: number
  markers: KeyframeTimingStripMarker[]
  previewFrames?: Record<string, number> | null
  disabled?: boolean
  onSelectionChange?: (selectedIds: Set<string>) => void
  onSlideStart?: (selectedIds: string[]) => void
  onSlideChange?: (deltaFrames: number, selectedIds: string[]) => void
  onSlideEnd?: (selectedIds: string[]) => void
}

interface DragState {
  pointerId: number
  startClientX: number
  started: boolean
  selectedIds: string[]
}

interface MarqueeState {
  pointerId: number
  startClientX: number
  currentClientX: number
  started: boolean
  mode: MarqueeMode
  baseSelection: Set<string>
}

function getMarkerLabel(marker: KeyframeTimingStripMarker, frame: number): string {
  if (marker.selected && marker.draggable) {
    return `Slide selected keyframe at frame ${frame}`
  }

  if (marker.selected) {
    return `Selected keyframe at frame ${frame}`
  }

  return `Select keyframe at frame ${frame}`
}

function getMarkerLeft(
  frame: number,
  metrics: ReturnType<typeof getKeyframeNavigatorThumbMetrics>,
): number {
  const maxFrame = Math.max(1, metrics.contentFrameMax - 1)
  return Math.max(
    metrics.edgeInset,
    Math.min(
      metrics.edgeInset + metrics.usableTrackWidth,
      metrics.edgeInset +
        (Math.max(0, Math.min(maxFrame, frame)) / maxFrame) * metrics.usableTrackWidth,
    ),
  )
}

export function KeyframeTimingStrip({
  viewport,
  contentFrameMax,
  markers,
  previewFrames = null,
  disabled = false,
  onSelectionChange,
  onSlideStart,
  onSlideChange,
  onSlideEnd,
}: KeyframeTimingStripProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const marqueeStateRef = useRef<MarqueeState | null>(null)
  const [trackWidth, setTrackWidth] = useState(0)
  const [marqueeRange, setMarqueeRange] = useState<{ left: number; width: number } | null>(null)

  const metrics = getKeyframeNavigatorThumbMetrics({
    viewport,
    contentFrameMax,
    trackWidth,
    minThumbWidth: 0,
  })

  const renderedMarkers = useMemo(
    () =>
      markers.map((marker) => ({
        ...marker,
        frame: previewFrames?.[marker.id] ?? marker.frame,
      })),
    [markers, previewFrames],
  )
  const getMarqueeModeFromPointerEvent = useCallback(
    (event: Pick<React.PointerEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>): MarqueeMode =>
      event.shiftKey ? 'add' : event.ctrlKey || event.metaKey ? 'toggle' : 'replace',
    [],
  )
  const updateMarqueeSelection = useCallback(
    (state: MarqueeState) => {
      const track = trackRef.current
      if (!track) {
        return
      }

      const rect = track.getBoundingClientRect()
      const startX = state.startClientX - rect.left
      const currentX = state.currentClientX - rect.left
      const minX = Math.min(startX, currentX)
      const maxX = Math.max(startX, currentX)
      const hitIds = new Set(
        renderedMarkers
          .filter((marker) => {
            const left = getMarkerLeft(marker.frame, metrics)
            return left >= minX && left <= maxX
          })
          .map((marker) => marker.id),
      )

      let nextSelection = new Set<string>()
      if (state.mode === 'replace') {
        nextSelection = hitIds
      } else if (state.mode === 'add') {
        nextSelection = new Set([...state.baseSelection, ...hitIds])
      } else {
        nextSelection = new Set(state.baseSelection)
        for (const id of hitIds) {
          if (nextSelection.has(id)) {
            nextSelection.delete(id)
          } else {
            nextSelection.add(id)
          }
        }
      }

      onSelectionChange?.(nextSelection)
      setMarqueeRange({
        left: Math.max(0, minX),
        width: Math.max(1, maxX - minX),
      })
    },
    [metrics, onSelectionChange, renderedMarkers],
  )

  const handleMarkerPointerDown = useCallback(
    (markerId: string, isSelected: boolean) => (event: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const selectedIds = isSelected
        ? markers.filter((marker) => marker.selected).map((marker) => marker.id)
        : [markerId]

      onSelectionChange?.(new Set(selectedIds))
      dragStateRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        started: false,
        selectedIds,
      }
    },
    [disabled, markers, onSelectionChange],
  )
  const handleTrackPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || event.button !== 0) {
        return
      }

      event.preventDefault()
      marqueeStateRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        currentClientX: event.clientX,
        started: false,
        mode: getMarqueeModeFromPointerEvent(event),
        baseSelection: new Set(
          markers.filter((marker) => marker.selected).map((marker) => marker.id),
        ),
      }
      setMarqueeRange(null)
    },
    [disabled, getMarqueeModeFromPointerEvent, markers],
  )

  useEffect(() => {
    const track = trackRef.current
    if (!track) {
      return
    }

    const updateWidth = () => {
      setTrackWidth(track.clientWidth)
    }

    updateWidth()

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(updateWidth)
    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current
      if (dragState && dragState.pointerId === event.pointerId && metrics.usableTrackWidth > 0) {
        const deltaX = event.clientX - dragState.startClientX
        if (!dragState.started && Math.abs(deltaX) > DRAG_THRESHOLD_PX) {
          dragState.started = true
          onSlideStart?.(dragState.selectedIds)
        }

        if (!dragState.started) {
          return
        }

        const maxFrame = Math.max(1, metrics.contentFrameMax - 1)
        const deltaFrames = Math.round((deltaX / metrics.usableTrackWidth) * maxFrame)
        onSlideChange?.(deltaFrames, dragState.selectedIds)
        return
      }

      const marqueeState = marqueeStateRef.current
      if (!marqueeState || marqueeState.pointerId !== event.pointerId) {
        return
      }

      marqueeState.currentClientX = event.clientX
      if (
        !marqueeState.started &&
        Math.abs(event.clientX - marqueeState.startClientX) > DRAG_THRESHOLD_PX
      ) {
        marqueeState.started = true
      }

      if (!marqueeState.started) {
        return
      }

      updateMarqueeSelection(marqueeState)
    }

    const handlePointerUp = (event: PointerEvent) => {
      const dragState = dragStateRef.current
      if (dragState && dragState.pointerId === event.pointerId) {
        dragStateRef.current = null
        if (dragState.started) {
          onSlideEnd?.(dragState.selectedIds)
        }
        return
      }

      const marqueeState = marqueeStateRef.current
      if (!marqueeState || marqueeState.pointerId !== event.pointerId) {
        return
      }

      if (!marqueeState.started && marqueeState.mode === 'replace') {
        onSelectionChange?.(new Set())
      }

      marqueeStateRef.current = null
      setMarqueeRange(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [
    metrics.contentFrameMax,
    metrics.usableTrackWidth,
    onSelectionChange,
    onSlideChange,
    onSlideEnd,
    onSlideStart,
    updateMarqueeSelection,
  ])

  return (
    <div className="h-4 border-t border-border/60 bg-background/90 px-2 py-0.5">
      <div
        ref={trackRef}
        data-testid="keyframe-timing-strip-track"
        className={cn('relative h-full rounded-sm bg-secondary/35', disabled && 'opacity-50')}
        onPointerDown={handleTrackPointerDown}
      >
        <div
          className="pointer-events-none absolute inset-y-[1px] rounded-sm bg-muted-foreground/10"
          style={{
            left: metrics.thumbLeft,
            width: metrics.thumbWidth,
          }}
        />
        {marqueeRange ? (
          <div
            className="pointer-events-none absolute inset-y-0 rounded-sm bg-primary/20"
            style={{
              left: marqueeRange.left,
              width: marqueeRange.width,
            }}
          />
        ) : null}

        {renderedMarkers.map((marker) => {
          const left = getMarkerLeft(marker.frame, metrics)
          const label = getMarkerLabel(marker, marker.frame)
          const markerStyle = {
            left,
            top: '50%',
          } as const

          return (
            <button
              key={marker.id}
              type="button"
              data-testid={`keyframe-timing-strip-marker-${marker.id}`}
              className={cn(
                'absolute -translate-x-1/2 -translate-y-1/2 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]',
                disabled
                  ? 'cursor-default'
                  : marker.draggable
                    ? 'cursor-ew-resize'
                    : 'cursor-pointer',
                marker.selected
                  ? 'h-3 w-3 rounded-[2px] border border-orange-200/70 bg-orange-500 rotate-45'
                  : 'h-2 w-2 rounded-full border border-muted-foreground/60 bg-muted-foreground/70',
              )}
              style={markerStyle}
              onPointerDown={handleMarkerPointerDown(marker.id, marker.selected)}
              title={label}
              aria-label={label}
            >
              <span className="sr-only">{label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
