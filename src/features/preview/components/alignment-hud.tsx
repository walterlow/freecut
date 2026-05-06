import { useCallback, useMemo } from 'react'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Magnet,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@/components/ui/button'
import { cn } from '@/shared/ui/cn'
import { useSelectionStore } from '@/shared/state/selection'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSettingsStore } from '@/features/preview/deps/settings'
import { useTimelineStore, useKeyframesStore } from '@/features/preview/deps/timeline-store'
import { getAutoKeyframeOperation, type AutoKeyframeOperation } from '../deps/keyframes'
import { useVisualTransforms } from '../hooks/use-visual-transform'
import type { TransformProperties } from '@/types/transform'

type AlignmentType =
  | 'left'
  | 'center-h'
  | 'right'
  | 'top'
  | 'center-v'
  | 'bottom'
  | 'distribute-h'
  | 'distribute-v'

const ALIGNMENT_ACTIONS: Array<{
  type: AlignmentType
  icon: typeof AlignStartHorizontal
  label: string
  minItems: number
}> = [
  { type: 'left', icon: AlignStartVertical, label: 'Align Left', minItems: 1 },
  { type: 'center-h', icon: AlignCenterVertical, label: 'Center Horizontally', minItems: 1 },
  { type: 'right', icon: AlignEndVertical, label: 'Align Right', minItems: 1 },
  { type: 'top', icon: AlignStartHorizontal, label: 'Align Top', minItems: 1 },
  { type: 'center-v', icon: AlignCenterHorizontal, label: 'Center Vertically', minItems: 1 },
  { type: 'bottom', icon: AlignEndHorizontal, label: 'Align Bottom', minItems: 1 },
  {
    type: 'distribute-h',
    icon: AlignHorizontalDistributeCenter,
    label: 'Distribute Horizontally',
    minItems: 3,
  },
  {
    type: 'distribute-v',
    icon: AlignVerticalDistributeCenter,
    label: 'Distribute Vertically',
    minItems: 3,
  },
]

const BUTTON_STYLE = { height: 22, width: 22 }

interface AlignmentToolbarProps {
  projectSize: { width: number; height: number }
}

export function AlignmentToolbar({ projectSize }: AlignmentToolbarProps) {
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const updateItemsTransformMap = useTimelineStore((s) => s.updateItemsTransformMap)
  const applyAutoKeyframeOperations = useTimelineStore((s) => s.applyAutoKeyframeOperations)
  const canvasSnapEnabled = useSettingsStore((s) => s.canvasSnapEnabled)
  const setSetting = useSettingsStore((s) => s.setSetting)

  const visualItems = useTimelineStore(
    useShallow((s) =>
      s.items.filter((item) => item.type !== 'audio' && item.type !== 'adjustment'),
    ),
  )

  const selectedItemIdsSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds])

  const selectedVisualItems = useMemo(() => {
    return visualItems.filter((item) => selectedItemIdsSet.has(item.id))
  }, [visualItems, selectedItemIdsSet])

  const visualTransformsMap = useVisualTransforms(selectedVisualItems, projectSize)

  const itemCount = selectedVisualItems.length

  const handleAlign = useCallback(
    (alignment: AlignmentType) => {
      const tolerance = 0.5
      const updates = new Map<string, Partial<TransformProperties>>()

      const entries = selectedVisualItems
        .map((item) => {
          const resolved = visualTransformsMap.get(item.id)
          if (!resolved) return null
          return {
            id: item.id,
            x: resolved.x,
            y: resolved.y,
            width: resolved.width,
            height: resolved.height,
          }
        })
        .filter(<T,>(v: T | null): v is T => v !== null)

      if (entries.length === 0) return

      if (alignment === 'distribute-h' || alignment === 'distribute-v') {
        if (entries.length < 3) return
        const axis = alignment === 'distribute-h' ? 'x' : 'y'
        const size = axis === 'x' ? 'width' : 'height'
        const sorted = [...entries].sort((a, b) => a[axis] - b[axis])
        const first = sorted[0]!
        const last = sorted[sorted.length - 1]!

        // Distribute gaps evenly between item edges, not centers
        const spanStart = first[axis] - first[size] / 2
        const spanEnd = last[axis] + last[size] / 2
        const totalItemSize = sorted.reduce((sum, e) => sum + e[size], 0)
        const gap = (spanEnd - spanStart - totalItemSize) / (sorted.length - 1)

        let cursor = spanStart + first[size]
        for (let index = 1; index < sorted.length - 1; index += 1) {
          const entry = sorted[index]!
          const target = cursor + gap + entry[size] / 2
          cursor = target + entry[size] / 2
          if (Math.abs(target - entry[axis]) <= tolerance) continue
          updates.set(entry.id, axis === 'x' ? { x: target } : { y: target })
        }
      } else {
        for (const entry of entries) {
          let nextX: number | undefined
          let nextY: number | undefined

          switch (alignment) {
            case 'left':
              nextX = -projectSize.width / 2 + entry.width / 2
              break
            case 'center-h':
              nextX = 0
              break
            case 'right':
              nextX = projectSize.width / 2 - entry.width / 2
              break
            case 'top':
              nextY = -projectSize.height / 2 + entry.height / 2
              break
            case 'center-v':
              nextY = 0
              break
            case 'bottom':
              nextY = projectSize.height / 2 - entry.height / 2
              break
          }

          const props: Partial<TransformProperties> = {}
          if (nextX !== undefined && Math.abs(nextX - entry.x) > tolerance) props.x = nextX
          if (nextY !== undefined && Math.abs(nextY - entry.y) > tolerance) props.y = nextY
          if (Object.keys(props).length > 0) updates.set(entry.id, props)
        }
      }

      if (updates.size === 0) return

      // Split updates into keyframe operations and base transform updates
      const currentFrame = usePlaybackStore.getState().currentFrame
      const autoOps: AutoKeyframeOperation[] = []
      const baseUpdates = new Map<string, Partial<TransformProperties>>()

      for (const [itemId, props] of updates) {
        const item = selectedVisualItems.find((i) => i.id === itemId)
        if (!item) continue

        const itemKeyframes = useKeyframesStore.getState().keyframesByItemId[itemId]
        const baseProps: Partial<TransformProperties> = {}

        for (const axis of ['x', 'y'] as const) {
          if (props[axis] === undefined) continue
          const op = getAutoKeyframeOperation(item, itemKeyframes, axis, props[axis], currentFrame)
          if (op) {
            autoOps.push(op)
          } else {
            baseProps[axis] = props[axis]
          }
        }

        if (Object.keys(baseProps).length > 0) {
          baseUpdates.set(itemId, baseProps)
        }
      }

      if (autoOps.length > 0) {
        applyAutoKeyframeOperations(autoOps)
      }
      if (baseUpdates.size > 0) {
        updateItemsTransformMap(baseUpdates, { operation: 'move' })
      }
    },
    [
      selectedVisualItems,
      visualTransformsMap,
      projectSize,
      updateItemsTransformMap,
      applyAutoKeyframeOperations,
    ],
  )

  if (itemCount < 1) return null

  const renderButton = ({
    type,
    icon: Icon,
    label,
    minItems,
  }: (typeof ALIGNMENT_ACTIONS)[number]) => (
    <Button
      key={type}
      variant="ghost"
      size="icon"
      className="flex-shrink-0 text-muted-foreground hover:text-foreground"
      style={BUTTON_STYLE}
      onClick={() => handleAlign(type)}
      disabled={itemCount < minItems}
      data-tooltip={label}
      aria-label={label}
    >
      <Icon className="w-3.5 h-3.5" />
    </Button>
  )

  return (
    <>
      {ALIGNMENT_ACTIONS.slice(0, 3).map(renderButton)}
      <div className="w-px h-3.5 bg-border mx-0.5" />
      {ALIGNMENT_ACTIONS.slice(3, 6).map(renderButton)}
      <div className="w-px h-3.5 bg-border mx-0.5" />
      {ALIGNMENT_ACTIONS.slice(6).map(renderButton)}
      <div className="w-px h-3.5 bg-border mx-0.5" />
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          'flex-shrink-0 text-muted-foreground hover:text-foreground',
          canvasSnapEnabled && 'text-foreground bg-accent',
        )}
        style={BUTTON_STYLE}
        onClick={() => setSetting('canvasSnapEnabled', !canvasSnapEnabled)}
        data-tooltip={
          canvasSnapEnabled
            ? 'Disable Canvas Snapping (hold Alt while dragging to bypass)'
            : 'Enable Canvas Snapping'
        }
        aria-label="Toggle Canvas Snapping"
        aria-pressed={canvasSnapEnabled}
      >
        <Magnet className="w-3.5 h-3.5" />
      </Button>
    </>
  )
}
