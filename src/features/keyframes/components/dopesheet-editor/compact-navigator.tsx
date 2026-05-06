import { useCallback, useEffect, useRef, useState } from 'react'

import { cn } from '@/shared/ui/cn'

import {
  getKeyframeNavigatorResizeDragResult,
  getKeyframeNavigatorThumbMetrics,
  getStartFrameFromNavigatorThumbLeft,
  type KeyframeNavigatorDragTarget,
  type KeyframeNavigatorViewport,
} from './compact-navigator-utils'

interface CompactNavigatorProps {
  viewport: KeyframeNavigatorViewport
  currentFrame: number
  contentFrameMax: number
  minVisibleFrames: number
  disabled?: boolean
  onViewportChange: (viewport: KeyframeNavigatorViewport) => void
}

type DragTarget = 'thumb' | KeyframeNavigatorDragTarget | null

export function CompactNavigator({
  viewport,
  currentFrame,
  contentFrameMax,
  minVisibleFrames,
  disabled = false,
  onViewportChange,
}: CompactNavigatorProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [trackWidth, setTrackWidth] = useState(0)
  const [dragTarget, setDragTarget] = useState<DragTarget>(null)
  const [dragStartX, setDragStartX] = useState(0)
  const [dragStartThumbLeft, setDragStartThumbLeft] = useState(0)
  const [dragStartThumbWidth, setDragStartThumbWidth] = useState(0)

  const metrics = getKeyframeNavigatorThumbMetrics({
    viewport,
    contentFrameMax,
    trackWidth,
  })

  const playheadLeft =
    trackWidth > 0
      ? Math.max(
          metrics.edgeInset,
          Math.min(
            metrics.edgeInset + metrics.usableTrackWidth,
            metrics.edgeInset +
              (Math.max(0, Math.min(metrics.contentFrameMax, currentFrame)) /
                metrics.contentFrameMax) *
                metrics.usableTrackWidth,
          ),
        )
      : 0

  const handleMouseDown = useCallback(
    (event: React.MouseEvent, target: Exclude<DragTarget, null>) => {
      if (disabled) return
      event.preventDefault()
      event.stopPropagation()
      setDragTarget(target)
      setDragStartX(event.clientX)
      setDragStartThumbLeft(metrics.thumbLeft)
      setDragStartThumbWidth(metrics.thumbWidth)
    },
    [disabled, metrics.thumbLeft, metrics.thumbWidth],
  )

  const handleTrackClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (
        disabled ||
        !trackRef.current ||
        dragTarget ||
        metrics.maxStartFrame <= 0 ||
        metrics.thumbTravel <= 0
      ) {
        return
      }

      const rect = trackRef.current.getBoundingClientRect()
      const clickX = event.clientX - rect.left
      const desiredThumbLeft = Math.max(
        metrics.edgeInset,
        Math.min(metrics.edgeInset + metrics.thumbTravel, clickX - metrics.thumbWidth / 2),
      )
      const nextStartFrame = getStartFrameFromNavigatorThumbLeft(desiredThumbLeft, metrics)
      onViewportChange({
        startFrame: nextStartFrame,
        endFrame: nextStartFrame + metrics.visibleFrameRange,
      })
    },
    [disabled, dragTarget, metrics, onViewportChange],
  )

  useEffect(() => {
    const track = trackRef.current
    if (!track) return

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
    if (!dragTarget || disabled) return

    const handleMouseMove = (event: MouseEvent) => {
      if (!trackRef.current) return

      const nextTrackWidth = trackRef.current.clientWidth
      if (nextTrackWidth <= 0) return

      const deltaX = event.clientX - dragStartX

      if (dragTarget === 'thumb') {
        if (metrics.thumbTravel <= 0 || metrics.maxStartFrame <= 0) return
        const nextThumbLeft = Math.max(
          metrics.edgeInset,
          Math.min(metrics.edgeInset + metrics.thumbTravel, dragStartThumbLeft + deltaX),
        )
        const nextStartFrame = getStartFrameFromNavigatorThumbLeft(nextThumbLeft, metrics)
        onViewportChange({
          startFrame: nextStartFrame,
          endFrame: nextStartFrame + metrics.visibleFrameRange,
        })
        return
      }

      onViewportChange(
        getKeyframeNavigatorResizeDragResult({
          dragTarget,
          deltaX,
          dragStartThumbWidth,
          trackWidth: nextTrackWidth,
          viewport,
          contentFrameMax,
          minVisibleFrames,
        }),
      )
    }

    const handleMouseUp = () => {
      setDragTarget(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [
    contentFrameMax,
    disabled,
    dragStartThumbLeft,
    dragStartThumbWidth,
    dragStartX,
    dragTarget,
    metrics,
    minVisibleFrames,
    onViewportChange,
    viewport,
  ])

  return (
    <div className="h-5 border-t border-border bg-background/80 px-2 py-1">
      <div
        ref={trackRef}
        className={cn('relative h-full rounded-sm bg-secondary/70', disabled && 'opacity-50')}
        onClick={handleTrackClick}
      >
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-primary/70"
          style={{ left: playheadLeft }}
        />
        <div
          className={cn(
            'absolute top-0 flex h-full items-center justify-between rounded-sm bg-muted-foreground/55 transition-colors',
            disabled
              ? 'cursor-default'
              : dragTarget
                ? 'cursor-grabbing bg-muted-foreground/75'
                : 'cursor-grab hover:bg-muted-foreground/70',
          )}
          style={{
            left: metrics.thumbLeft,
            width: metrics.thumbWidth,
          }}
          onMouseDown={disabled ? undefined : (event) => handleMouseDown(event, 'thumb')}
          onClick={(event) => event.stopPropagation()}
          data-testid="keyframe-navigator-thumb"
        >
          <div
            className={cn(
              'flex h-full w-2 items-center justify-center',
              disabled ? 'cursor-default' : 'cursor-ew-resize',
            )}
            onMouseDown={disabled ? undefined : (event) => handleMouseDown(event, 'left')}
          >
            <div className="h-1.5 w-0.5 rounded-full bg-background/90" />
          </div>
          <div className="h-1.5 w-5 rounded-full bg-background/25" />
          <div
            className={cn(
              'flex h-full w-2 items-center justify-center',
              disabled ? 'cursor-default' : 'cursor-ew-resize',
            )}
            onMouseDown={disabled ? undefined : (event) => handleMouseDown(event, 'right')}
          >
            <div className="h-1.5 w-0.5 rounded-full bg-background/90" />
          </div>
        </div>
      </div>
    </div>
  )
}
