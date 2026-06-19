import { memo, useCallback, useMemo, useRef, type PointerEvent } from 'react'
import { useSelectionStore } from '@/shared/state/selection'
import type { ItemEffect } from '@/types/effects'
import type { TimelineItem } from '@/types/timeline'
import { resolveTransform, getSourceDimensions } from '@/features/preview/deps/composition-runtime'
import { useGizmoStore } from '../stores/gizmo-store'
import { useItemsStore, useTimelineStore } from '../deps/timeline-store'
import type { CoordinateParams, Point, Transform } from '../types/gizmo'
import {
  getEffectiveScale,
  rotatePoint,
  screenToCanvas,
  transformToScreenBounds,
} from '../utils/coordinate-transform'
import {
  buildPowerWindowEffects,
  derivePowerWindowDragParams,
  readPowerWindowParams,
  type PowerWindowDragState,
  type PowerWindowHandle,
  type PowerWindowParams,
} from './power-window-overlay-utils'

interface PowerWindowOverlayContainerProps {
  containerRect: DOMRect | null
  playerSize: { width: number; height: number }
  projectSize: { width: number; height: number }
  zoom: number
}

interface PowerWindowOverlayProps {
  coordParams: CoordinateParams
  playerSize: { width: number; height: number }
  item: TimelineItem
  effect: ItemEffect
  itemTransform: Transform
}

const HANDLE_SIZE = 14

function resolveItemTransform(item: TimelineItem, projectSize: { width: number; height: number }) {
  const canvas = { width: projectSize.width, height: projectSize.height, fps: 30 }
  const resolved = resolveTransform(item, canvas, getSourceDimensions(item))
  return {
    x: resolved.x,
    y: resolved.y,
    width: resolved.width,
    height: resolved.height,
    anchorX: resolved.anchorX,
    anchorY: resolved.anchorY,
    rotation: resolved.rotation,
    opacity: resolved.opacity,
    cornerRadius: resolved.cornerRadius,
  }
}

function findPowerWindowEffect(item: TimelineItem): ItemEffect | null {
  return (
    (item.effects ?? []).find(
      (entry) =>
        entry.enabled &&
        entry.effect.type === 'gpu-effect' &&
        entry.effect.gpuEffectType === 'gpu-power-window',
    ) ?? null
  )
}

function pointerToItemUv(
  event: Pick<PointerEvent<HTMLElement>, 'clientX' | 'clientY'>,
  coordParams: CoordinateParams,
  itemTransform: Transform,
): Point {
  const projectPoint = screenToCanvas(event.clientX, event.clientY, coordParams)
  const center = {
    x: coordParams.projectSize.width / 2 + itemTransform.x,
    y: coordParams.projectSize.height / 2 + itemTransform.y,
  }
  const unrotated = rotatePoint(projectPoint, center, -itemTransform.rotation)
  return {
    x: (unrotated.x - (center.x - itemTransform.width / 2)) / itemTransform.width,
    y: (unrotated.y - (center.y - itemTransform.height / 2)) / itemTransform.height,
  }
}

export const PowerWindowOverlayContainer = memo(function PowerWindowOverlayContainer({
  containerRect,
  playerSize,
  projectSize,
  zoom,
}: PowerWindowOverlayContainerProps) {
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const items = useItemsStore((s) => s.items)

  const selectedItem = useMemo(() => {
    if (selectedItemIds.length !== 1) return null
    return items.find((item) => item.id === selectedItemIds[0]) ?? null
  }, [items, selectedItemIds])

  const effect = selectedItem ? findPowerWindowEffect(selectedItem) : null
  const coordParams = useMemo((): CoordinateParams | null => {
    if (!containerRect) return null
    return { containerRect, playerSize, projectSize, zoom }
  }, [containerRect, playerSize, projectSize, zoom])
  const itemTransform = useMemo(
    () => (selectedItem ? resolveItemTransform(selectedItem, projectSize) : null),
    [projectSize, selectedItem],
  )

  if (!coordParams || !selectedItem || !effect || !itemTransform) return null

  return (
    <PowerWindowOverlay
      coordParams={coordParams}
      effect={effect}
      item={selectedItem}
      itemTransform={itemTransform}
      playerSize={playerSize}
    />
  )
})

const PowerWindowOverlay = memo(function PowerWindowOverlay({
  coordParams,
  effect,
  item,
  itemTransform,
}: PowerWindowOverlayProps) {
  const dragRef = useRef<PowerWindowDragState | null>(null)
  const setEffectsPreviewNew = useGizmoStore((s) => s.setEffectsPreviewNew)
  const clearPreviewForItems = useGizmoStore((s) => s.clearPreviewForItems)
  const setItemEffects = useTimelineStore((s) => s.setItemEffects)

  const params = readPowerWindowParams(effect)
  const scale = getEffectiveScale(coordParams)
  const bounds = transformToScreenBounds(itemTransform, coordParams)
  const transformOrigin = `${(itemTransform.anchorX ?? itemTransform.width / 2) * scale}px ${
    (itemTransform.anchorY ?? itemTransform.height / 2) * scale
  }px`

  const applyPreview = useCallback(
    (nextParams: PowerWindowParams) => {
      setEffectsPreviewNew({
        [item.id]: buildPowerWindowEffects(item.effects ?? [], effect.id, nextParams),
      })
    },
    [effect.id, item.effects, item.id, setEffectsPreviewNew],
  )

  const commit = useCallback(
    (nextParams: PowerWindowParams) => {
      setItemEffects([
        {
          itemId: item.id,
          effects: buildPowerWindowEffects(item.effects ?? [], effect.id, nextParams),
        },
      ])
      clearPreviewForItems([item.id])
    },
    [clearPreviewForItems, effect.id, item.effects, item.id, setItemEffects],
  )

  const handlePointerDown = useCallback(
    (handle: PowerWindowHandle, event: PointerEvent<HTMLElement>) => {
      if (!params) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      dragRef.current = {
        handle,
        startParams: params,
        startUv: pointerToItemUv(event, coordParams, itemTransform),
      }
    },
    [coordParams, itemTransform, params],
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const drag = dragRef.current
      if (!drag || event.buttons !== 1) return
      event.preventDefault()
      event.stopPropagation()
      applyPreview(
        derivePowerWindowDragParams(drag, pointerToItemUv(event, coordParams, itemTransform)),
      )
    },
    [applyPreview, coordParams, itemTransform],
  )

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const drag = dragRef.current
      if (!drag) return
      event.preventDefault()
      event.stopPropagation()
      const nextParams = derivePowerWindowDragParams(
        drag,
        pointerToItemUv(event, coordParams, itemTransform),
      )
      dragRef.current = null
      commit(nextParams)
    },
    [commit, coordParams, itemTransform],
  )

  if (!params) return null

  const handleStyle = {
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
  }
  const shapeClass = params.shape === 'rectangle' ? 'rounded-[2px]' : 'rounded-full'

  return (
    <div
      className="pointer-events-none absolute z-50"
      data-testid="power-window-overlay"
      style={{
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        transform: `rotate(${itemTransform.rotation}deg)`,
        transformOrigin,
      }}
    >
      <div
        className={`absolute border border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.65)] ${shapeClass}`}
        style={{
          left: `${params.centerX * 100}%`,
          top: `${params.centerY * 100}%`,
          width: `${params.sizeX * 100}%`,
          height: `${params.sizeY * 100}%`,
          transform: `translate(-50%, -50%) rotate(${params.rotation}deg)`,
        }}
      >
        <button
          type="button"
          aria-label="Move power window"
          className="pointer-events-auto absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border border-black/70 bg-white shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
          onPointerDown={(event) => handlePointerDown('center', event)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
        {(
          [
            ['east', 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize'],
            ['west', 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize'],
            ['north', 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize'],
            ['south', 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize'],
          ] as const
        ).map(([handle, className]) => (
          <button
            key={handle}
            type="button"
            aria-label={`Resize power window ${handle}`}
            className={`pointer-events-auto absolute rounded-full border border-black/70 bg-white shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white ${className}`}
            style={handleStyle}
            onPointerDown={(event) => handlePointerDown(handle, event)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        ))}
      </div>
    </div>
  )
})
