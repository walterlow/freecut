import { useCallback, useMemo, useRef, useEffect, memo, forwardRef } from 'react'

import { useTimelineStore } from '../stores/timeline-store'
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context'

const IO_LANE_HEIGHT = 14
const IO_HIT_AREA_HEIGHT = IO_LANE_HEIGHT + 6
const IO_HANDLE_WIDTH = 6
const IO_HANDLE_COLOR = 'var(--color-timeline-io-handle)'

/**
 * Timeline In/Out Markers — isolated in its own memo boundary so zoom-driven
 * position updates only re-render these 2 marker divs, not the parent ruler.
 */
export const TimelineInOutMarkers = memo(function TimelineInOutMarkers() {
  const inPoint = useTimelineStore((s) => s.inPoint)
  const outPoint = useTimelineStore((s) => s.outPoint)
  const setInPoint = useTimelineStore((s) => s.setInPoint)
  const setOutPoint = useTimelineStore((s) => s.setOutPoint)
  const { frameToPixels, pixelsToFrame } = useTimelineZoomContext()

  const inMarkerRef = useRef<HTMLDivElement>(null)
  const outMarkerRef = useRef<HTMLDivElement>(null)
  const pixelsToFrameRef = useRef(pixelsToFrame)
  const setInPointRef = useRef(setInPoint)
  const setOutPointRef = useRef(setOutPoint)
  pixelsToFrameRef.current = pixelsToFrame
  setInPointRef.current = setInPoint
  setOutPointRef.current = setOutPoint

  // Store active drag cleanup so we can tear down on unmount
  const dragCleanupRef = useRef<(() => void) | null>(null)

  const startDrag = useCallback(
    (handle: 'in' | 'out') => (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const container = (handle === 'in' ? inMarkerRef : outMarkerRef).current?.closest(
        '.timeline-ruler',
      )
      if (!container) return

      const setter = handle === 'in' ? setInPointRef : setOutPointRef
      const prevCursor = document.body.style.cursor
      document.body.style.cursor = 'col-resize'

      const onMove = (ev: MouseEvent) => {
        const rect = container.getBoundingClientRect()
        const x = ev.clientX - rect.left
        setter.current(Math.max(0, pixelsToFrameRef.current(x)))
      }
      const cleanup = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', cleanup)
        document.body.style.cursor = prevCursor
        dragCleanupRef.current = null
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', cleanup)
      dragCleanupRef.current = cleanup
    },
    [],
  )

  // Tear down listeners if component unmounts mid-drag
  useEffect(
    () => () => {
      dragCleanupRef.current?.()
    },
    [],
  )

  const handleInDown = useMemo(() => startDrag('in'), [startDrag])
  const handleOutDown = useMemo(() => startDrag('out'), [startDrag])

  return (
    <>
      {inPoint !== null && (
        <IOMarker
          ref={inMarkerRef}
          positionPx={frameToPixels(inPoint)}
          side="in"
          onMouseDown={handleInDown}
        />
      )}
      {outPoint !== null && (
        <IOMarker
          ref={outMarkerRef}
          positionPx={frameToPixels(outPoint)}
          side="out"
          onMouseDown={handleOutDown}
        />
      )}
    </>
  )
})

interface IOMarkerProps {
  positionPx: number
  side: 'in' | 'out'
  onMouseDown: (e: React.MouseEvent) => void
}

const IOMarker = memo(
  forwardRef<HTMLDivElement, IOMarkerProps>(function IOMarker(
    { positionPx, side, onMouseDown },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className="absolute top-0"
        style={{
          left: positionPx,
          width: '2px',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 22,
        }}
      >
        {/* Side grip handle */}
        <div
          className="absolute pointer-events-none"
          style={{
            bottom: 0,
            left: side === 'in' ? 0 : -IO_HANDLE_WIDTH,
            width: IO_HANDLE_WIDTH,
            height: IO_LANE_HEIGHT,
            borderRadius: '2px',
            background: `linear-gradient(to bottom, ${IO_HANDLE_COLOR}, color-mix(in oklch, ${IO_HANDLE_COLOR} 75%, black))`,
            boxShadow: `0 0 6px color-mix(in oklch, ${IO_HANDLE_COLOR} 55%, transparent)`,
          }}
        />

        {/* Invisible hit area for dragging */}
        <div
          className="absolute pointer-events-auto"
          style={{
            bottom: 0,
            height: IO_HIT_AREA_HEIGHT,
            left: -8,
            width: 18,
            cursor: 'col-resize',
          }}
          onMouseDown={onMouseDown}
        />
      </div>
    )
  }),
)
IOMarker.displayName = 'IOMarker'
