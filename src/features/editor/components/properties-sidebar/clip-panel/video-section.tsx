import { useCallback, useMemo, useRef } from 'react'
import { Crop, RotateCcw, Video } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@/components/ui/button'
import type { TimelineItem, VideoItem, AudioItem } from '@/types/timeline'
import type { CropSettings } from '@/types/transform'
import type { ItemKeyframes } from '@/types/keyframe'
import {
  captureSnapshot,
  rateStretchItemWithoutHistory,
  useKeyframesStore,
  useTimelineCommandStore,
  useTimelineStore,
} from '@/features/editor/deps/timeline-store'
import { useGizmoStore, useThrottledFrame } from '@/features/editor/deps/preview'
import type { TimelineState, TimelineActions } from '@/features/editor/deps/timeline-store'
import {
  timelineToSourceFrames,
  sourceToTimelineFrames,
} from '@/features/editor/deps/timeline-utils'
import {
  getAutoKeyframeOperation,
  getCropPropertyValue,
  type AutoKeyframeOperation,
  KeyframeToggle,
  resolveAnimatedCrop,
} from '@/features/editor/deps/keyframes'
import { PropertySection, PropertyRow, SliderInput } from '../components'
import { getMixedValue } from '../utils'
import {
  cropPixelsToRatio,
  cropSignedPixelsToRatio,
  getCropSoftnessReferenceDimension,
  normalizeCropSettings,
} from '@/shared/utils/media-crop'

const MIN_SPEED = 0.1
const MAX_SPEED = 10.0
const CROP_STEP = 0.1
const CROP_TOLERANCE = 0.01

interface VideoSectionProps {
  items: TimelineItem[]
}

type CropEdge = 'left' | 'right' | 'top' | 'bottom'
type CropProperty = 'cropLeft' | 'cropRight' | 'cropTop' | 'cropBottom' | 'cropSoftness'
type CropDimensions = { width: number; height: number }
type ResolvedCropState = {
  crop: CropSettings | undefined
  dimensions: CropDimensions
}

const CROP_EDGE_PROPERTY: Record<CropEdge, Exclude<CropProperty, 'cropSoftness'>> = {
  left: 'cropLeft',
  right: 'cropRight',
  top: 'cropTop',
  bottom: 'cropBottom',
}

function getCropDimensions(item: VideoItem): CropDimensions {
  return {
    width: Math.max(1, item.sourceWidth ?? item.transform?.width ?? 1920),
    height: Math.max(1, item.sourceHeight ?? item.transform?.height ?? 1080),
  }
}

function buildCropUpdate(
  crop: CropSettings | undefined,
  edge: CropEdge,
  pixels: number,
  dimensions: CropDimensions,
): CropSettings | undefined {
  const dimension = edge === 'left' || edge === 'right' ? dimensions.width : dimensions.height
  return normalizeCropSettings({
    ...crop,
    [edge]: cropPixelsToRatio(pixels, dimension),
  })
}

function buildCropSoftnessUpdate(
  crop: CropSettings | undefined,
  pixels: number,
  dimensions: CropDimensions,
): CropSettings | undefined {
  return normalizeCropSettings({
    ...crop,
    softness: cropSignedPixelsToRatio(
      pixels,
      Math.max(1, getCropSoftnessReferenceDimension(dimensions.width, dimensions.height)),
    ),
  })
}

function getResolvedCropState(
  item: VideoItem,
  currentFrame: number,
  itemKeyframes: ItemKeyframes | null | undefined,
): ResolvedCropState {
  const dimensions = getCropDimensions(item)
  return {
    dimensions,
    crop: resolveAnimatedCrop(
      item.crop,
      itemKeyframes ?? undefined,
      currentFrame - item.from,
      dimensions,
    ),
  }
}

function formatCropValue(value: number): string {
  return value.toFixed(3)
}

function getResolvedCropPropertyValue(
  state: ResolvedCropState | undefined,
  property: CropProperty,
): number | undefined {
  if (!state) return undefined
  return getCropPropertyValue(state.crop, property, state.dimensions)
}

/**
 * Playback section - playback rate, video fades, and edge crop.
 *
 * Speed changes affect clip duration (rate stretch behavior):
 * - Faster speed = shorter clip (same content plays faster)
 * - Slower speed = longer clip (same content plays slower)
 */
export function VideoSection({ items }: VideoSectionProps) {
  const updateItem = useTimelineStore((s: TimelineState & TimelineActions) => s.updateItem)
  const applyAutoKeyframeOperations = useTimelineStore((s) => s.applyAutoKeyframeOperations)
  const currentFrame = useThrottledFrame()

  const setPropertiesPreviewNew = useGizmoStore((s) => s.setPropertiesPreviewNew)
  const clearPreview = useGizmoStore((s) => s.clearPreview)

  const videoItems = useMemo(
    () => items.filter((item): item is VideoItem => item.type === 'video'),
    [items],
  )

  const itemIds = useMemo(() => videoItems.map((item) => item.id), [videoItems])

  const rateStretchableIds = useMemo(
    () =>
      items
        .filter(
          (item): item is VideoItem | AudioItem => item.type === 'video' || item.type === 'audio',
        )
        .map((item) => item.id),
    [items],
  )

  const itemKeyframes = useKeyframesStore(
    useShallow(
      useCallback((s) => itemIds.map((itemId) => s.keyframesByItemId[itemId] ?? null), [itemIds]),
    ),
  )
  const keyframesByItemId = useMemo(() => {
    const map = new Map<string, (typeof itemKeyframes)[number]>()
    for (const [index, itemId] of itemIds.entries()) {
      map.set(itemId, itemKeyframes[index] ?? null)
    }
    return map
  }, [itemIds, itemKeyframes])

  const resolvedCropStatesByItem = useMemo(() => {
    const map = new Map<string, ResolvedCropState>()
    for (const item of videoItems) {
      map.set(item.id, getResolvedCropState(item, currentFrame, keyframesByItemId.get(item.id)))
    }
    return map
  }, [currentFrame, keyframesByItemId, videoItems])

  const speed = getMixedValue(videoItems, (item) => item.speed, 1)
  const fadeIn = getMixedValue(videoItems, (item) => item.fadeIn, 0)
  const fadeOut = getMixedValue(videoItems, (item) => item.fadeOut, 0)
  const cropLeft = getMixedValue(
    videoItems,
    (item) => getResolvedCropPropertyValue(resolvedCropStatesByItem.get(item.id), 'cropLeft'),
    0,
  )
  const cropRight = getMixedValue(
    videoItems,
    (item) => getResolvedCropPropertyValue(resolvedCropStatesByItem.get(item.id), 'cropRight'),
    0,
  )
  const cropTop = getMixedValue(
    videoItems,
    (item) => getResolvedCropPropertyValue(resolvedCropStatesByItem.get(item.id), 'cropTop'),
    0,
  )
  const cropBottom = getMixedValue(
    videoItems,
    (item) => getResolvedCropPropertyValue(resolvedCropStatesByItem.get(item.id), 'cropBottom'),
    0,
  )
  const cropSoftness = getMixedValue(
    videoItems,
    (item) => getResolvedCropPropertyValue(resolvedCropStatesByItem.get(item.id), 'cropSoftness'),
    0,
  )

  const maxSourceWidth = useMemo(
    () => Math.max(1, ...videoItems.map((item) => getCropDimensions(item).width)),
    [videoItems],
  )
  const maxSourceHeight = useMemo(
    () => Math.max(1, ...videoItems.map((item) => getCropDimensions(item).height)),
    [videoItems],
  )
  const maxCropSoftness = useMemo(
    () =>
      Math.max(
        1,
        ...videoItems.map((item) => {
          const dimensions = getCropDimensions(item)
          return Math.max(1, getCropSoftnessReferenceDimension(dimensions.width, dimensions.height))
        }),
      ),
    [videoItems],
  )
  const speedDragSnapshotRef = useRef<ReturnType<typeof captureSnapshot> | null>(null)

  const applySpeedChangeWithoutHistory = useCallback(
    (newSpeed: number) => {
      const roundedSpeed = Math.round(newSpeed * 100) / 100
      const clampedSpeed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, roundedSpeed))

      const { items: currentItems, fps } = useTimelineStore.getState()
      currentItems
        .filter(
          (item: TimelineItem): item is VideoItem | AudioItem =>
            (item.type === 'video' || item.type === 'audio') &&
            rateStretchableIds.includes(item.id),
        )
        .forEach((item: VideoItem | AudioItem) => {
          const currentSpeed = item.speed || 1
          const sourceFps = item.sourceFps ?? fps
          const effectiveSourceFrames =
            item.sourceEnd !== undefined && item.sourceStart !== undefined
              ? item.sourceEnd - item.sourceStart
              : timelineToSourceFrames(item.durationInFrames, currentSpeed, fps, sourceFps)
          const newDuration = Math.max(
            1,
            sourceToTimelineFrames(effectiveSourceFrames, clampedSpeed, sourceFps, fps),
          )
          rateStretchItemWithoutHistory(item.id, item.from, newDuration, clampedSpeed)
        })

      return clampedSpeed
    },
    [rateStretchableIds],
  )

  const commitSpeedChange = useCallback(
    (newSpeed: number) => {
      const beforeSnapshot = speedDragSnapshotRef.current ?? captureSnapshot()
      const clampedSpeed = applySpeedChangeWithoutHistory(newSpeed)
      useTimelineCommandStore.getState().addUndoEntry(
        {
          type: 'RATE_STRETCH_ITEM',
          payload: { ids: rateStretchableIds, newSpeed: clampedSpeed },
        },
        beforeSnapshot,
      )
      speedDragSnapshotRef.current = null
    },
    [applySpeedChangeWithoutHistory, rateStretchableIds],
  )

  const handleSpeedLiveChange = useCallback(
    (newSpeed: number) => {
      if (!speedDragSnapshotRef.current) {
        speedDragSnapshotRef.current = captureSnapshot()
      }
      applySpeedChangeWithoutHistory(newSpeed)
    },
    [applySpeedChangeWithoutHistory],
  )

  const commitPreviewClear = useCallback(() => {
    queueMicrotask(() => clearPreview())
  }, [clearPreview])

  const handleFadeInLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { fadeIn: number }> = {}
      itemIds.forEach((id) => {
        previews[id] = { fadeIn: value }
      })
      setPropertiesPreviewNew(previews)
    },
    [itemIds, setPropertiesPreviewNew],
  )

  const handleFadeInChange = useCallback(
    (value: number) => {
      itemIds.forEach((id) => updateItem(id, { fadeIn: value }))
      commitPreviewClear()
    },
    [itemIds, updateItem, commitPreviewClear],
  )

  const handleFadeOutLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { fadeOut: number }> = {}
      itemIds.forEach((id) => {
        previews[id] = { fadeOut: value }
      })
      setPropertiesPreviewNew(previews)
    },
    [itemIds, setPropertiesPreviewNew],
  )

  const handleFadeOutChange = useCallback(
    (value: number) => {
      itemIds.forEach((id) => updateItem(id, { fadeOut: value }))
      commitPreviewClear()
    },
    [itemIds, updateItem, commitPreviewClear],
  )

  const previewCropEdge = useCallback(
    (edge: CropEdge, pixels: number) => {
      const previews: Record<string, { crop: VideoItem['crop'] }> = {}
      videoItems.forEach((item) => {
        const cropState = resolvedCropStatesByItem.get(item.id)
        if (!cropState) return
        previews[item.id] = {
          crop: buildCropUpdate(cropState.crop, edge, pixels, cropState.dimensions),
        }
      })
      setPropertiesPreviewNew(previews)
    },
    [resolvedCropStatesByItem, setPropertiesPreviewNew, videoItems],
  )

  const commitCropEdge = useCallback(
    (edge: CropEdge, pixels: number) => {
      const property = CROP_EDGE_PROPERTY[edge]
      const autoOps: AutoKeyframeOperation[] = []

      videoItems.forEach((item) => {
        const operation = getAutoKeyframeOperation(
          item,
          keyframesByItemId.get(item.id) ?? undefined,
          property,
          pixels,
          currentFrame,
        )
        if (operation) {
          autoOps.push(operation)
          return
        }

        updateItem(item.id, {
          crop: buildCropUpdate(item.crop, edge, pixels, getCropDimensions(item)),
        })
      })

      if (autoOps.length > 0) {
        applyAutoKeyframeOperations(autoOps)
      }

      commitPreviewClear()
    },
    [
      applyAutoKeyframeOperations,
      commitPreviewClear,
      currentFrame,
      keyframesByItemId,
      updateItem,
      videoItems,
    ],
  )

  const previewCropSoftness = useCallback(
    (pixels: number) => {
      const previews: Record<string, { crop: VideoItem['crop'] }> = {}
      videoItems.forEach((item) => {
        const cropState = resolvedCropStatesByItem.get(item.id)
        if (!cropState) return
        previews[item.id] = {
          crop: buildCropSoftnessUpdate(cropState.crop, pixels, cropState.dimensions),
        }
      })
      setPropertiesPreviewNew(previews)
    },
    [resolvedCropStatesByItem, setPropertiesPreviewNew, videoItems],
  )

  const commitCropSoftness = useCallback(
    (pixels: number) => {
      const autoOps: AutoKeyframeOperation[] = []

      videoItems.forEach((item) => {
        const operation = getAutoKeyframeOperation(
          item,
          keyframesByItemId.get(item.id) ?? undefined,
          'cropSoftness',
          pixels,
          currentFrame,
        )
        if (operation) {
          autoOps.push(operation)
          return
        }

        updateItem(item.id, {
          crop: buildCropSoftnessUpdate(item.crop, pixels, getCropDimensions(item)),
        })
      })

      if (autoOps.length > 0) {
        applyAutoKeyframeOperations(autoOps)
      }

      commitPreviewClear()
    },
    [
      applyAutoKeyframeOperations,
      commitPreviewClear,
      currentFrame,
      keyframesByItemId,
      updateItem,
      videoItems,
    ],
  )

  const resetCropEdge = useCallback(
    (edge: CropEdge) => {
      const property = CROP_EDGE_PROPERTY[edge]
      const needsUpdate = videoItems.some((item) => {
        const cropState = resolvedCropStatesByItem.get(item.id)
        return Math.abs(getResolvedCropPropertyValue(cropState, property) ?? 0) > CROP_TOLERANCE
      })
      if (!needsUpdate) return
      commitCropEdge(edge, 0)
    },
    [commitCropEdge, resolvedCropStatesByItem, videoItems],
  )

  const resetCropSoftness = useCallback(() => {
    const needsUpdate = videoItems.some((item) => {
      const cropState = resolvedCropStatesByItem.get(item.id)
      return Math.abs(getResolvedCropPropertyValue(cropState, 'cropSoftness') ?? 0) > CROP_TOLERANCE
    })
    if (!needsUpdate) return
    commitCropSoftness(0)
  }, [commitCropSoftness, resolvedCropStatesByItem, videoItems])

  const resetSpeedWithRipple = useTimelineStore(
    (s: TimelineState & TimelineActions) => s.resetSpeedWithRipple,
  )
  const handleResetSpeed = useCallback(() => {
    resetSpeedWithRipple(rateStretchableIds)
  }, [rateStretchableIds, resetSpeedWithRipple])

  const handleResetFadeIn = useCallback(() => {
    const tolerance = 0.01
    const currentItems = useTimelineStore.getState().items
    const needsUpdate = currentItems.some(
      (item: TimelineItem) =>
        itemIds.includes(item.id) && ((item as VideoItem).fadeIn ?? 0) > tolerance,
    )
    if (needsUpdate) {
      itemIds.forEach((id) => updateItem(id, { fadeIn: 0 }))
    }
  }, [itemIds, updateItem])

  const handleResetFadeOut = useCallback(() => {
    const tolerance = 0.01
    const currentItems = useTimelineStore.getState().items
    const needsUpdate = currentItems.some(
      (item: TimelineItem) =>
        itemIds.includes(item.id) && ((item as VideoItem).fadeOut ?? 0) > tolerance,
    )
    if (needsUpdate) {
      itemIds.forEach((id) => updateItem(id, { fadeOut: 0 }))
    }
  }, [itemIds, updateItem])

  if (videoItems.length === 0) return null

  return (
    <>
      <PropertySection title="Playback" icon={Video} defaultOpen={true}>
        <PropertyRow label="Speed">
          <div className="flex items-center gap-1 w-full">
            <SliderInput
              value={speed}
              onChange={commitSpeedChange}
              onLiveChange={handleSpeedLiveChange}
              min={MIN_SPEED}
              max={MAX_SPEED}
              step={0.01}
              unit="x"
              className="flex-1 min-w-0"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={handleResetSpeed}
              title="Reset to 1x"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>

        <PropertyRow label="Fade In">
          <div className="flex items-center gap-1 w-full">
            <SliderInput
              value={fadeIn}
              onChange={handleFadeInChange}
              onLiveChange={handleFadeInLiveChange}
              min={0}
              max={5}
              step={0.1}
              unit="s"
              className="flex-1 min-w-0"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={handleResetFadeIn}
              title="Reset to 0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>

        <PropertyRow label="Fade Out">
          <div className="flex items-center gap-1 w-full">
            <SliderInput
              value={fadeOut}
              onChange={handleFadeOutChange}
              onLiveChange={handleFadeOutLiveChange}
              min={0}
              max={5}
              step={0.1}
              unit="s"
              className="flex-1 min-w-0"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={handleResetFadeOut}
              title="Reset to 0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>
      </PropertySection>

      <PropertySection title="Cropping" icon={Crop} defaultOpen={true}>
        <PropertyRow label="Left">
          <div className="flex items-center gap-1 w-full">
            <SliderInput
              value={cropLeft}
              onChange={(value) => commitCropEdge('left', value)}
              onLiveChange={(value) => previewCropEdge('left', value)}
              min={0}
              max={maxSourceWidth}
              step={CROP_STEP}
              unit="px"
              formatValue={formatCropValue}
              formatInputValue={formatCropValue}
              className="flex-1 min-w-0"
            />
            <KeyframeToggle
              itemIds={itemIds}
              property="cropLeft"
              currentValue={cropLeft === 'mixed' ? 0 : cropLeft}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={() => resetCropEdge('left')}
              title="Reset left crop"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>

        <PropertyRow label="Right">
          <div className="flex items-center gap-1 w-full">
            <SliderInput
              value={cropRight}
              onChange={(value) => commitCropEdge('right', value)}
              onLiveChange={(value) => previewCropEdge('right', value)}
              min={0}
              max={maxSourceWidth}
              step={CROP_STEP}
              unit="px"
              formatValue={formatCropValue}
              formatInputValue={formatCropValue}
              className="flex-1 min-w-0"
            />
            <KeyframeToggle
              itemIds={itemIds}
              property="cropRight"
              currentValue={cropRight === 'mixed' ? 0 : cropRight}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={() => resetCropEdge('right')}
              title="Reset right crop"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>

        <PropertyRow label="Top">
          <div className="flex items-center gap-1 w-full">
            <SliderInput
              value={cropTop}
              onChange={(value) => commitCropEdge('top', value)}
              onLiveChange={(value) => previewCropEdge('top', value)}
              min={0}
              max={maxSourceHeight}
              step={CROP_STEP}
              unit="px"
              formatValue={formatCropValue}
              formatInputValue={formatCropValue}
              className="flex-1 min-w-0"
            />
            <KeyframeToggle
              itemIds={itemIds}
              property="cropTop"
              currentValue={cropTop === 'mixed' ? 0 : cropTop}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={() => resetCropEdge('top')}
              title="Reset top crop"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>

        <PropertyRow label="Bottom">
          <div className="flex items-center gap-1 w-full">
            <SliderInput
              value={cropBottom}
              onChange={(value) => commitCropEdge('bottom', value)}
              onLiveChange={(value) => previewCropEdge('bottom', value)}
              min={0}
              max={maxSourceHeight}
              step={CROP_STEP}
              unit="px"
              formatValue={formatCropValue}
              formatInputValue={formatCropValue}
              className="flex-1 min-w-0"
            />
            <KeyframeToggle
              itemIds={itemIds}
              property="cropBottom"
              currentValue={cropBottom === 'mixed' ? 0 : cropBottom}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={() => resetCropEdge('bottom')}
              title="Reset bottom crop"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>

        <PropertyRow label="Softness">
          <div className="flex items-center gap-1 w-full">
            <SliderInput
              value={cropSoftness}
              onChange={commitCropSoftness}
              onLiveChange={previewCropSoftness}
              min={-maxCropSoftness}
              max={maxCropSoftness}
              step={CROP_STEP}
              unit="px"
              formatValue={formatCropValue}
              formatInputValue={formatCropValue}
              className="flex-1 min-w-0"
            />
            <KeyframeToggle
              itemIds={itemIds}
              property="cropSoftness"
              currentValue={cropSoftness === 'mixed' ? 0 : cropSoftness}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={resetCropSoftness}
              title="Reset crop softness"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>
      </PropertySection>
    </>
  )
}
