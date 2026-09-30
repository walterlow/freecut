import { memo, useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { Globe } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { useTimelineStore } from '@/features/preview/deps/timeline-store'
import type { TimelineItem } from '@/types/timeline'
import { DEFAULT_PROJECTION_360_SETTINGS, type Projection360Settings } from '@/types/projection360'

interface Projection360OrbitOverlayProps {
  item: TimelineItem
  containerRect: DOMRect | null
}

function wrapYaw(angle: number): number {
  let a = angle % 360
  if (a > 180) a -= 360
  if (a < -180) a += 360
  return Math.round(a * 10) / 10
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export const Projection360OrbitOverlay = memo(function Projection360OrbitOverlay({
  item,
}: Projection360OrbitOverlayProps) {
  const updateItem = useTimelineStore((s) => s.updateItem)

  const settings: Projection360Settings = item.projection360 ?? DEFAULT_PROJECTION_360_SETTINGS
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null)

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      setIsDragging(true)
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        yaw: settings.yaw,
        pitch: settings.pitch,
      }
    },
    [settings.pitch, settings.yaw],
  )

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragStartRef.current || !isDragging) return
      e.stopPropagation()
      const deltaX = e.clientX - dragStartRef.current.x
      const deltaY = e.clientY - dragStartRef.current.y

      const sensitivity = (settings.fov / 100) * 0.25
      const newYaw = wrapYaw(dragStartRef.current.yaw - deltaX * sensitivity)
      const newPitch = Math.round(clamp(dragStartRef.current.pitch + deltaY * sensitivity, -90, 90) * 10) / 10

      updateItem(item.id, {
        projection360: {
          ...settings,
          yaw: newYaw,
          pitch: newPitch,
        },
      })
    },
    [isDragging, item.id, settings, updateItem],
  )

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragStartRef.current) {
        e.stopPropagation()
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
          // pointer might already be released
        }
        dragStartRef.current = null
        setIsDragging(false)
      }
    },
    [],
  )

  const handleWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      e.stopPropagation()
      const zoomDelta = e.deltaY * 0.05
      const newFov = Math.round(clamp(settings.fov + zoomDelta, 30, 150))
      if (newFov !== settings.fov) {
        updateItem(item.id, {
          projection360: {
            ...settings,
            fov: newFov,
            preset: 'custom',
          },
        })
      }
    },
    [item.id, settings, updateItem],
  )

  const handleDoubleClick = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      updateItem(item.id, {
        projection360: {
          ...settings,
          yaw: 0,
          pitch: 0,
          roll: 0,
        },
      })
    },
    [item.id, settings, updateItem],
  )

  return (
    <div
      className={cn(
        'absolute inset-0 z-30 select-none touch-none',
        isDragging ? 'cursor-grabbing' : 'cursor-grab',
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick as any}
    >
      {/* 360 Orbit HUD Badge */}
      <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/75 backdrop-blur-sm border border-white/10 text-white text-[11px] font-mono shadow-md pointer-events-none transition-opacity">
        <Globe className="h-3.5 w-3.5 text-primary animate-pulse" />
        <span className="font-semibold text-white/90">360° Orbit</span>
        <span className="text-white/40">|</span>
        <span>Yaw: {settings.yaw}°</span>
        <span>Pitch: {settings.pitch}°</span>
        <span>FOV: {settings.fov}°</span>
      </div>
    </div>
  )
})
