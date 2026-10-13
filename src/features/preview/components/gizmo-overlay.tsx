import { useMemo, useCallback, useRef, useEffect, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { useSelectionStore } from '@/shared/state/selection'
import { useSettingsStore } from '@/features/preview/deps/settings'
import {
  useItemsStore,
  useKeyframesStore,
  useTimelineSettingsStore,
  useTimelineStore,
} from '@/features/preview/deps/timeline-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import { getResolvedPlaybackFrame } from '@/shared/state/playback/frame-resolution'
import { useGizmoStore, type ItemPreview } from '../stores/gizmo-store'
import { useExclusiveCanvasEditor } from '../hooks/use-exclusive-canvas-editor'
import { TransformGizmo } from './transform-gizmo'
import { GroupGizmo } from './group-gizmo'
import { SelectableItem } from './selectable-item'
import { MotionPathOverlay } from './motion-path-overlay'
import { SnapGuides } from './snap-guides'
import {
  getEffectiveScale,
  getScreenTransformOrigin,
  screenToCanvas,
  transformToScreenBounds,
} from '../utils/coordinate-transform'
import { attachWindowTransformInteraction } from '../utils/gizmo-transform-interaction'
import { computeItemAabb } from '../utils/canvas-snap-utils'
import {
  useMarqueeSelection,
  isMarqueeJustFinished,
  type Rect,
} from '@/shared/marquee/use-marquee-selection'
import { MarqueeOverlay } from '@/shared/marquee/marquee-overlay'
import { useVisualTransforms } from '../hooks/use-visual-transform'
import { useCanvasMediaDrop } from '../hooks/use-canvas-media-drop'
import {
  buildMotionPathPoints,
  canvasPointToMotionPathScreenPoint,
  type MotionPathScreenPoint,
} from '../utils/motion-path'
import {
  buildDefaultSpatialTangents,
  updateSpatialTangent,
  worldPointToPositionKeyframeValue,
} from '../utils/motion-path-edit'
import { attachWindowMotionPathPointerInteraction } from '../utils/motion-path-pointer-interaction'
import {
  getAutoKeyframeOperation,
  type AutoKeyframeOperation,
} from '@/features/preview/deps/keyframes'
import type { ItemKeyframes, SpatialBezierTangents } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import type { BoundingBox, CoordinateParams, Transform, Point } from '../types/gizmo'
import type { ResolvedTransform, TransformProperties } from '@/types/transform'
import { normalizeCropSettings } from '@/shared/utils/media-crop'
import { getSourceDimensions, resolveTransform } from '@/features/preview/deps/composition-runtime'
import {
  buildGizmoAnchorCommit,
  buildGizmoTransformCommit,
  resolveEditableGizmoTransform,
  resolveGizmoCommitParentWorld,
} from '../utils/gizmo-transform-commit'
import {
  buildGroupTextScaleCommit,
  type GroupScaledTextProperties,
} from '../utils/group-text-scale'
import { CROP_EDGE_PROPERTY, type CropEdge } from '../utils/crop-gizmo'
import {
  MARQUEE_CANDIDATE_ATTRIBUTE,
  updateMarqueeCandidateElements,
} from '../utils/marquee-candidate-preview'
import { getPositionLinkOwner } from '../utils/position-link-ownership'

interface GizmoOverlayProps {
  itemsSnapshot: TimelineItem[]
  containerRect: DOMRect | null
  playerSize: { width: number; height: number }
  projectSize: { width: number; height: number }
  zoom: number
  /** Ref to the hit area element for marquee bounds checking */
  hitAreaRef?: React.RefObject<HTMLDivElement>
  /** Padding around player for marquee display when starting from outside */
  overlayPadding?: number
}

interface MotionPathEditPreview {
  itemId: string
  keyframeId: string
  frame: number
  x: number
  y: number
  spatial?: SpatialBezierTangents
}

function LiveSnapGuides({ coordParams }: { coordParams: CoordinateParams }) {
  const snapLines = useGizmoStore((state) => state.snapLines)
  return <SnapGuides snapLines={snapLines} coordParams={coordParams} />
}

function getEditablePositionKeyframe(itemId: string, keyframeId: string) {
  const position = useKeyframesStore
    .getState()
    .keyframesByItemId[itemId]?.vectorProperties?.find(
      (property) => property.property === 'position',
    )
  const keyframe = position?.keyframes.find((candidate) => candidate.id === keyframeId)
  return position && keyframe ? { position, keyframe } : null
}

function toResolvedTransform(transform: Transform): ResolvedTransform {
  return {
    x: transform.x,
    y: transform.y,
    width: transform.width,
    height: transform.height,
    anchorX: transform.anchorX ?? transform.width / 2,
    anchorY: transform.anchorY ?? transform.height / 2,
    rotation: transform.rotation,
    opacity: transform.opacity,
    cornerRadius: transform.cornerRadius ?? 0,
  }
}

/**
 * Overlay that renders transform gizmos for selected items
 * and clickable hit areas for all visible items.
 * Positioned absolutely over the video player.
 */
export function GizmoOverlay({
  itemsSnapshot,
  containerRect,
  playerSize,
  projectSize,
  zoom,
  hitAreaRef,
  overlayPadding = 100,
}: GizmoOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  // Track the marquee portal target (the full preview background) in state so
  // React re-renders once the parent's ref is populated. Refs alone don't
  // trigger re-renders.
  const [marqueePortalTarget, setMarqueePortalTarget] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setMarqueePortalTarget(hitAreaRef?.current ?? null)
  }, [hitAreaRef])
  const getResolvedFrameForPlaybackState = useCallback(
    (
      playbackState: ReturnType<typeof usePlaybackStore.getState>,
      displayedFrame = usePreviewBridgeStore.getState().displayedFrame,
    ) =>
      getResolvedPlaybackFrame({
        ...playbackState,
        displayedFrame,
      }),
    [],
  )

  // Context menu state for selecting from overlapping items
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    items: TimelineItem[]
  } | null>(null)

  // Selection state
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const selectItems = useSelectionStore((s) => s.selectItems)

  // Create Set for O(1) lookups instead of O(n) includes()
  const selectedItemIdsSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds])
  const marqueeCandidateElementsRef = useRef<Map<string, HTMLElement>>(new Map())
  const marqueeCandidateIdsRef = useRef<Set<string>>(new Set())
  const bindMarqueeCandidateElement = useCallback(
    (itemId: string, element: HTMLDivElement | null) => {
      if (!element) {
        marqueeCandidateElementsRef.current.delete(itemId)
        return
      }
      marqueeCandidateElementsRef.current.set(itemId, element)
      if (marqueeCandidateIdsRef.current.has(itemId)) {
        element.setAttribute(MARQUEE_CANDIDATE_ATTRIBUTE, 'true')
      }
    },
    [],
  )
  const updateMarqueeCandidatePreview = useCallback((ids: string[]) => {
    marqueeCandidateIdsRef.current = updateMarqueeCandidateElements(
      marqueeCandidateElementsRef.current,
      marqueeCandidateIdsRef.current,
      ids,
    )
  }, [])
  const clearMarqueeCandidatePreview = useCallback(() => {
    updateMarqueeCandidatePreview([])
  }, [updateMarqueeCandidatePreview])

  const liveTransforms = useItemsStore(
    useShallow(
      useCallback(
        (state) =>
          itemsSnapshot.map((item) => {
            const liveItem = state.itemById[item.id]
            if (liveItem && 'transform' in liveItem) return liveItem.transform
            return 'transform' in item ? item.transform : undefined
          }),
        [itemsSnapshot],
      ),
    ),
  )
  const itemsWithLiveTransforms = useMemo(
    () =>
      itemsSnapshot.map((item, index) => {
        const liveTransform = liveTransforms[index]
        if (!liveTransform || !('transform' in item) || Object.is(liveTransform, item.transform)) {
          return item
        }
        return { ...item, transform: liveTransform } as TimelineItem
      }),
    [itemsSnapshot, liveTransforms],
  )

  // Stay on VideoPreview's transform-stable scene membership while merging
  // current transforms locally. A transform commit updates this overlay and
  // its hit targets without invalidating VideoPreview/MainComposition.
  const visualItems = useMemo(
    () =>
      itemsWithLiveTransforms.filter((item) => item.type !== 'audio' && item.type !== 'adjustment'),
    [itemsWithLiveTransforms],
  )
  const tracks = useTimelineStore((s) => s.tracks)
  const fps = useTimelineSettingsStore((s) => s.fps)
  const canvasSnapEnabled = useSettingsStore((s) => s.canvasSnapEnabled)
  const updateItemTransform = useTimelineStore((s) => s.updateItemTransform)
  const updateItemsTransformMap = useTimelineStore((s) => s.updateItemsTransformMap)
  const updateItem = useTimelineStore((s) => s.updateItem)
  const applyAutoKeyframeOperations = useTimelineStore((s) => s.applyAutoKeyframeOperations)
  const updateVectorKeyframe = useTimelineStore((s) => s.updateVectorKeyframe)

  // Ref to track if we just finished a drag (to prevent background click from deselecting)
  const justFinishedDragRef = useRef(false)

  // Playback state - only subscribe to isPlaying to avoid re-renders during playback
  // Read currentFrame directly from store when needed (not during playback)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)

  // Track the "frozen" frame when playback starts - gizmos stay at this frame during playback
  // This prevents re-renders during playback while maintaining accuracy when paused/skimming
  const initialPlaybackState = {
    ...usePlaybackStore.getState(),
    displayedFrame: usePreviewBridgeStore.getState().displayedFrame,
  }
  const frozenFrameRef = useRef<number>(getResolvedPlaybackFrame(initialPlaybackState))

  // Update frozen frame when playback stops or when paused/skimming frame changes
  useEffect(() => {
    if (!isPlaying) {
      // When paused/skimming, sync to the effective preview frame
      const nextFrame = getResolvedFrameForPlaybackState(usePlaybackStore.getState())
      if (frozenFrameRef.current !== nextFrame) {
        frozenFrameRef.current = nextFrame
        setForceUpdate((n) => n + 1)
      }
    }
  }, [getResolvedFrameForPlaybackState, isPlaying])

  // Subscribe to frame changes - always update when paused/skimming, or at clip boundaries during playback
  // NOTE: Reads items on-demand inside subscribe callback to avoid re-rendering on items change
  useEffect(() => {
    let prevFrame = usePlaybackStore.getState().currentFrame
    const updatePausedFrame = (
      nextPlaybackState: ReturnType<typeof usePlaybackStore.getState>,
      prevPlaybackState: ReturnType<typeof usePlaybackStore.getState>,
      nextDisplayedFrame = usePreviewBridgeStore.getState().displayedFrame,
      prevDisplayedFrame = nextDisplayedFrame,
    ) => {
      const effectiveFrame = getResolvedFrameForPlaybackState(nextPlaybackState, nextDisplayedFrame)
      const prevEffectiveFrame = getResolvedFrameForPlaybackState(
        prevPlaybackState,
        prevDisplayedFrame,
      )
      if (effectiveFrame !== prevEffectiveFrame) {
        frozenFrameRef.current = effectiveFrame
        setForceUpdate((n) => n + 1)
      }
    }

    const unsubscribePlayback = usePlaybackStore.subscribe((state, prevState) => {
      const currentFrame = state.currentFrame

      if (!state.isPlaying) {
        // When paused/skimming, follow whichever source was updated most recently.
        updatePausedFrame(state, prevState)
      } else {
        // During playback, only update when crossing a clip boundary
        // Read items on-demand for fresh clip edges (avoids re-subscribing on items change)
        const currentItems = useTimelineStore.getState().items
        const minFrame = Math.min(prevFrame, currentFrame)
        const maxFrame = Math.max(prevFrame, currentFrame)

        for (const item of currentItems) {
          const start = item.from
          const end = item.from + item.durationInFrames
          // Check if we crossed this item's start or end
          if ((start > minFrame && start <= maxFrame) || (end > minFrame && end <= maxFrame)) {
            // Crossed a clip boundary - update frozen frame
            frozenFrameRef.current = currentFrame
            setForceUpdate((n) => n + 1)
            break
          }
        }
      }

      prevFrame = currentFrame
    })
    const unsubscribeBridge = usePreviewBridgeStore.subscribe((bridgeState, prevBridgeState) => {
      const playbackState = usePlaybackStore.getState()
      if (playbackState.isPlaying) return
      updatePausedFrame(
        playbackState,
        playbackState,
        bridgeState.displayedFrame,
        prevBridgeState.displayedFrame,
      )
    })

    return () => {
      unsubscribePlayback()
      unsubscribeBridge()
    }
  }, [getResolvedFrameForPlaybackState]) // Reads items on-demand from stores

  // Force update state to trigger re-render and useMemo recalculation when frame changes while paused/skimming
  const [frameUpdateKey, setForceUpdate] = useState(0)

  // Gizmo store
  const setCanvasSize = useGizmoStore((s) => s.setCanvasSize)
  const setCanvasScale = useGizmoStore((s) => s.setCanvasScale)
  const setSnappingEnabled = useGizmoStore((s) => s.setSnappingEnabled)
  const setOtherItemBounds = useGizmoStore((s) => s.setOtherItemBounds)
  const {
    cornerPin: isCornerPinEditing,
    mask: isMaskEditing,
    powerWindow: isPowerWindowEditing,
    spatialEffect: isSpatialEffectEditing,
    active: isExclusiveCanvasEditorActive,
  } = useExclusiveCanvasEditor()
  const startTranslate = useGizmoStore((s) => s.startTranslate)
  const updateInteraction = useGizmoStore((s) => s.updateInteraction)
  const endInteraction = useGizmoStore((s) => s.endInteraction)
  const clearInteraction = useGizmoStore((s) => s.clearInteraction)
  const cancelInteraction = useGizmoStore((s) => s.cancelInteraction)
  const setTransformPreview = useGizmoStore((s) => s.setTransformPreview)
  const replaceItemPreview = useGizmoStore((s) => s.replaceItemPreview)
  const [motionPathEditPreview, setMotionPathEditPreview] = useState<MotionPathEditPreview | null>(
    null,
  )
  const cancelMotionPathInteractionRef = useRef<(() => void) | null>(null)

  useEffect(
    () => () => {
      cancelMotionPathInteractionRef.current?.()
    },
    [],
  )

  // Update canvas size in gizmo store when project size changes
  useEffect(() => {
    setCanvasSize(projectSize.width, projectSize.height)
  }, [projectSize.width, projectSize.height, setCanvasSize])

  useEffect(() => {
    setSnappingEnabled(canvasSnapEnabled)
  }, [canvasSnapEnabled, setSnappingEnabled])

  // Get visual items visible at current frame (excluding hidden tracks and locked tracks)
  // Sorted by track order: items on top tracks (lower order) come LAST for proper stacking/click priority
  // Uses frozenFrameRef to avoid re-renders during playback - only updates when paused
  const visibleItems = useMemo(() => {
    void frameUpdateKey
    void isPlaying
    // Read the frozen frame (updated via effect when paused)
    const frame = frozenFrameRef.current

    // Create maps for track properties
    const trackVisible = new Map<string, boolean>()
    const trackLocked = new Map<string, boolean>()
    const trackOrder = new Map<string, number>()
    for (const track of tracks) {
      trackVisible.set(track.id, track.visible)
      trackLocked.set(track.id, track.locked)
      trackOrder.set(track.id, track.order)
    }

    // visualItems already excludes audio and adjustment (filtered in selector)
    return (
      visualItems
        .filter((item) => {
          // Check if item's track is visible
          if (!trackVisible.get(item.trackId)) return false
          // Check if item's track is locked (locked items can't be selected)
          if (trackLocked.get(item.trackId)) return false
          // Check if item is visible at current frame
          const itemEnd = item.from + item.durationInFrames
          return frame >= item.from && frame < itemEnd
        })
        // Sort by track order descending: higher order (bottom tracks) first, lower order (top tracks) last
        // This ensures top track items render last (on top) and get click priority (toSorted for immutability)
        .toSorted((a, b) => (trackOrder.get(b.trackId) ?? 0) - (trackOrder.get(a.trackId) ?? 0))
    )
  }, [visualItems, tracks, isPlaying, frameUpdateKey])

  // Get selected items visible on the current preview frame.
  const selectedItems = useMemo(() => {
    return visibleItems.filter((item) => selectedItemIdsSet.has(item.id))
  }, [visibleItems, selectedItemIdsSet])
  const selectedVisibleItemIds = useMemo(
    () => selectedItems.map((item) => item.id),
    [selectedItems],
  )
  const selectedItemKeyframes = useKeyframesStore(
    useShallow(
      useCallback(
        (s) => selectedVisibleItemIds.map((itemId) => s.keyframesByItemId[itemId] ?? null),
        [selectedVisibleItemIds],
      ),
    ),
  )
  const keyframesByItemId = useKeyframesStore((s) => s.keyframesByItemId)
  const itemLabelById = useMemo(
    () =>
      new Map(
        itemsSnapshot.map((item) => [item.id, item.label || item.type || 'the source layer']),
      ),
    [itemsSnapshot],
  )
  const positionLinkByItemId = useMemo(() => {
    const links = new Map<string, ReturnType<typeof getPositionLinkOwner>>()
    for (const item of visibleItems) {
      const link = getPositionLinkOwner(keyframesByItemId[item.id])
      if (link) links.set(item.id, link)
    }
    return links
  }, [keyframesByItemId, visibleItems])
  const getPositionLinkFeedback = useCallback(
    (itemId: string) => {
      const link = positionLinkByItemId.get(itemId)
      if (!link) return null
      const sourceLabel = itemLabelById.get(link.sourceItemId) ?? 'the source layer'
      return {
        label: `Position is linked to ${sourceLabel}. Select ${sourceLabel} in Layers to move it, or use Position's link control to unlink.`,
      }
    },
    [itemLabelById, positionLinkByItemId],
  )
  const showPositionLinkFeedback = useCallback(
    (itemId: string) => {
      const feedback = getPositionLinkFeedback(itemId)
      if (!feedback) return
      toast.warning(feedback.label, {
        id: `canvas-position-link-guidance-${itemId}`,
      })
    },
    [getPositionLinkFeedback],
  )

  // Associate keyframes with items by id rather than array position so
  // consumers stay correct if the selection ordering changes.
  const selectedItemKeyframesById = useMemo(() => {
    const map = new Map<string, ItemKeyframes | null>()
    selectedVisibleItemIds.forEach((itemId, index) => {
      map.set(itemId, selectedItemKeyframes[index] ?? null)
    })
    return map
  }, [selectedVisibleItemIds, selectedItemKeyframes])

  // Get unselected visible items (for click-to-select, use Set for O(1) lookups)
  const unselectedItems = useMemo(() => {
    return visibleItems.filter((item) => !selectedItemIdsSet.has(item.id))
  }, [visibleItems, selectedItemIdsSet])

  // Coordinate params for gizmo positioning
  const coordParams: CoordinateParams | null = useMemo(() => {
    if (!containerRect) return null

    return {
      containerRect,
      playerSize,
      projectSize,
      zoom,
    }
  }, [containerRect, playerSize, projectSize, zoom])

  // Publish the effective preview scale so snap thresholds (authored in
  // screen pixels) convert to the correct canvas-pixel distance at any zoom.
  useEffect(() => {
    if (!coordParams) return
    setCanvasScale(getEffectiveScale(coordParams))
  }, [coordParams, setCanvasScale])

  const { dropState, handleDragEnter, handleDragLeave, handleDragOver, handleDrop } =
    useCanvasMediaDrop({
      coordParams,
      projectSize,
    })

  const focusMotionPathFrame = useCallback((frame: number) => {
    const playback = usePlaybackStore.getState()
    if (playback.previewFrame !== null) playback.setPreviewFrame(null)
    if (playback.currentFrame !== frame) playback.setCurrentFrame(frame)
    usePreviewBridgeStore.getState().setDisplayedFrame(frame)
    frozenFrameRef.current = frame
    setForceUpdate((value) => value + 1)
  }, [])

  const markMotionPathInteractionFinished = useCallback(() => {
    justFinishedDragRef.current = true
    setTimeout(() => {
      justFinishedDragRef.current = false
    }, 100)
  }, [])

  const handleMotionPathKeyframePointerDown = useCallback(
    (itemId: string, point: MotionPathScreenPoint, event: ReactPointerEvent<SVGCircleElement>) => {
      if (event.button !== 0 || !coordParams || !point.keyframeId) return
      const editable = getEditablePositionKeyframe(itemId, point.keyframeId)
      if (!editable) return

      event.preventDefault()
      focusMotionPathFrame(point.frame)
      cancelMotionPathInteractionRef.current?.()

      const { keyframe } = editable
      const item = visualItems.find((candidate) => candidate.id === itemId)
      const itemKeyframes = keyframesByItemId[itemId]
      if (!item || !itemKeyframes) return
      const canvas = { width: projectSize.width, height: projectSize.height, fps }
      const itemsById = new Map(visualItems.map((candidate) => [candidate.id, candidate]))
      const previousPreview: ItemPreview | undefined = useGizmoStore.getState().preview?.[itemId]
      let latestValue = keyframe.value
      let cleanup = () => {}
      let finished = false

      const previewAtPointer = (pointerEvent: PointerEvent) => {
        const canvasPoint = screenToCanvas(pointerEvent.clientX, pointerEvent.clientY, coordParams)
        latestValue = worldPointToPositionKeyframeValue({
          item,
          itemKeyframes,
          frame: point.frame,
          worldPoint: {
            x: canvasPoint.x - projectSize.width / 2,
            y: canvasPoint.y - projectSize.height / 2,
          },
          currentValue: keyframe.value,
          canvas,
          getItem: (candidateId) => itemsById.get(candidateId),
          getKeyframes: (candidateId) => keyframesByItemId[candidateId],
        })
        setMotionPathEditPreview({
          itemId,
          keyframeId: keyframe.id,
          frame: keyframe.frame,
          x: latestValue.x,
          y: latestValue.y,
          spatial: keyframe.spatial,
        })
        // The timeline stays untouched during the gesture, while the preview
        // renderer and transform gizmo still show the pending position.
        setTransformPreview({ [itemId]: latestValue })
      }

      const restoreLivePreview = () => {
        replaceItemPreview(itemId, previousPreview ?? null)
        setMotionPathEditPreview(null)
      }

      const cancel = () => {
        if (finished) return
        finished = true
        cleanup()
        cancelMotionPathInteractionRef.current = null
        restoreLivePreview()
      }

      cleanup = attachWindowMotionPathPointerInteraction({
        pointerId: event.pointerId,
        onMove: previewAtPointer,
        onCommit: (pointerEvent) => {
          if (finished) return
          finished = true
          previewAtPointer(pointerEvent)
          cancelMotionPathInteractionRef.current = null
          if (latestValue.x !== keyframe.value.x || latestValue.y !== keyframe.value.y) {
            updateVectorKeyframe(itemId, 'position', keyframe.id, { value: latestValue })
          }
          restoreLivePreview()
          markMotionPathInteractionFinished()
        },
        onCancel: cancel,
      })
      cancelMotionPathInteractionRef.current = cancel
    },
    [
      coordParams,
      focusMotionPathFrame,
      fps,
      keyframesByItemId,
      markMotionPathInteractionFinished,
      projectSize.height,
      projectSize.width,
      replaceItemPreview,
      setTransformPreview,
      updateVectorKeyframe,
      visualItems,
    ],
  )

  const handleMotionPathTangentPointerDown = useCallback(
    (
      itemId: string,
      point: MotionPathScreenPoint,
      handle: 'in' | 'out',
      event: ReactPointerEvent<SVGCircleElement>,
    ) => {
      if (event.button !== 0 || !coordParams || !point.keyframeId) return
      const editable = getEditablePositionKeyframe(itemId, point.keyframeId)
      if (!editable?.keyframe.spatial) return

      event.preventDefault()
      focusMotionPathFrame(point.frame)
      cancelMotionPathInteractionRef.current?.()

      const { keyframe } = editable
      const item = visualItems.find((candidate) => candidate.id === itemId)
      const itemKeyframes = keyframesByItemId[itemId]
      if (!item || !itemKeyframes) return
      const canvas = { width: projectSize.width, height: projectSize.height, fps }
      const itemsById = new Map(visualItems.map((candidate) => [candidate.id, candidate]))
      let latestSpatial = keyframe.spatial
      let cleanup = () => {}
      let finished = false

      const previewAtPointer = (pointerEvent: PointerEvent) => {
        const canvasPoint = screenToCanvas(pointerEvent.clientX, pointerEvent.clientY, coordParams)
        const endpoint = worldPointToPositionKeyframeValue({
          item,
          itemKeyframes,
          frame: point.frame,
          worldPoint: {
            x: canvasPoint.x - projectSize.width / 2,
            y: canvasPoint.y - projectSize.height / 2,
          },
          currentValue: keyframe.value,
          canvas,
          getItem: (candidateId) => itemsById.get(candidateId),
          getKeyframes: (candidateId) => keyframesByItemId[candidateId],
        })
        latestSpatial = updateSpatialTangent(keyframe.spatial!, handle, {
          x: endpoint.x - keyframe.value.x,
          y: endpoint.y - keyframe.value.y,
        })
        setMotionPathEditPreview({
          itemId,
          keyframeId: keyframe.id,
          frame: keyframe.frame,
          x: keyframe.value.x,
          y: keyframe.value.y,
          spatial: latestSpatial,
        })
      }

      const cancel = () => {
        if (finished) return
        finished = true
        cleanup()
        cancelMotionPathInteractionRef.current = null
        setMotionPathEditPreview(null)
      }

      cleanup = attachWindowMotionPathPointerInteraction({
        pointerId: event.pointerId,
        onMove: previewAtPointer,
        onCommit: (pointerEvent) => {
          if (finished) return
          finished = true
          previewAtPointer(pointerEvent)
          cancelMotionPathInteractionRef.current = null
          updateVectorKeyframe(itemId, 'position', keyframe.id, { spatial: latestSpatial })
          setMotionPathEditPreview(null)
          markMotionPathInteractionFinished()
        },
        onCancel: cancel,
      })
      cancelMotionPathInteractionRef.current = cancel
    },
    [
      coordParams,
      focusMotionPathFrame,
      fps,
      keyframesByItemId,
      markMotionPathInteractionFinished,
      projectSize.height,
      projectSize.width,
      updateVectorKeyframe,
      visualItems,
    ],
  )

  const handleCreateSpatialTangents = useCallback(
    (itemId: string, point: MotionPathScreenPoint) => {
      if (!point.keyframeId) return
      const editable = getEditablePositionKeyframe(itemId, point.keyframeId)
      if (!editable || editable.keyframe.spatial) return
      const spatial = buildDefaultSpatialTangents(editable.position.keyframes, point.keyframeId)
      if (!spatial) return
      focusMotionPathFrame(point.frame)
      updateVectorKeyframe(itemId, 'position', point.keyframeId, { spatial })
    },
    [focusMotionPathFrame, updateVectorKeyframe],
  )

  // Motion paths describe the whole clip and are independent of the current
  // preview frame, but `selectedItems` gets a fresh array identity on every
  // paused/skimming frame. Derive a stable signature from only the fields
  // `buildMotionPathPoints` actually reads (id, from, durationInFrames,
  // transform, motionModifiers) so the expensive rebuild runs only when those
  // change. The items themselves are read via ref to avoid the identity churn.
  const motionPathSignature = useMemo(
    () =>
      selectedItems
        .map(
          (item) =>
            `${item.id}:${item.from}:${item.durationInFrames}:${JSON.stringify(
              item.transform ?? null,
            )}:${JSON.stringify(item.transformParent ?? null)}:${JSON.stringify(
              item.motionModifiers ?? null,
            )}:${JSON.stringify(item.motionLayers ?? null)}`,
        )
        .join('|'),
    [selectedItems],
  )
  const selectedItemsRef = useRef(selectedItems)
  selectedItemsRef.current = selectedItems

  const motionPaths = useMemo(() => {
    if (
      !coordParams ||
      isCornerPinEditing ||
      isMaskEditing ||
      isPowerWindowEditing ||
      isSpatialEffectEditing
    )
      return []
    const canvas = { width: projectSize.width, height: projectSize.height, fps }
    const itemsById = new Map(visualItems.map((item) => [item.id, item]))
    return selectedItemsRef.current.flatMap((item) => {
      const directEdit = motionPathEditPreview?.itemId === item.id ? motionPathEditPreview : null
      const points = buildMotionPathPoints({
        item,
        itemKeyframes: selectedItemKeyframesById.get(item.id) ?? undefined,
        canvas,
        getItem: (itemId) => itemsById.get(itemId),
        getKeyframes: (itemId) => keyframesByItemId[itemId],
        preview: directEdit
          ? {
              frame: directEdit.frame,
              x: directEdit.x,
              y: directEdit.y,
              keyframeId: directEdit.keyframeId,
              spatial: directEdit.spatial,
            }
          : undefined,
      })
      if (points.length === 0) return []
      return [
        {
          itemId: item.id,
          points: points.map((point) => canvasPointToMotionPathScreenPoint(point, coordParams)),
        },
      ]
    })
    // `selectedItemsRef` is intentionally read via ref; `motionPathSignature`
    // captures the item fields that affect the result so the rebuild still
    // reruns when the selection's motion data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    coordParams,
    fps,
    isCornerPinEditing,
    isMaskEditing,
    isPowerWindowEditing,
    isSpatialEffectEditing,
    projectSize.height,
    projectSize.width,
    motionPathSignature,
    visualItems,
    keyframesByItemId,
    selectedItemKeyframesById,
    motionPathEditPreview,
  ])

  // Get visual transforms for all visible items (base + keyframes + preview).
  const visualTransformsMap = useVisualTransforms(
    visibleItems,
    projectSize,
    itemsWithLiveTransforms,
    frozenFrameRef.current,
  )

  // Create marquee items with pre-computed bounding rects for collision detection
  // Rects are calculated once when items/coords change, not on every mouse move
  const marqueeItems = useMemo(() => {
    if (!coordParams || !containerRect) return []
    return visibleItems.map((item) => {
      // Get pre-computed visual transform from the hook
      const resolved = visualTransformsMap.get(item.id)
      if (!resolved)
        return {
          id: item.id,
          getBoundingRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
        }

      const screenBounds = transformToScreenBounds(
        {
          x: resolved.x,
          y: resolved.y,
          width: resolved.width,
          height: resolved.height,
          rotation: resolved.rotation,
          opacity: resolved.opacity,
          cornerRadius: resolved.cornerRadius,
        },
        coordParams,
      )
      const rect: Rect = {
        left: containerRect.left + screenBounds.left,
        top: containerRect.top + screenBounds.top,
        right: containerRect.left + screenBounds.left + screenBounds.width,
        bottom: containerRect.top + screenBounds.top + screenBounds.height,
        width: screenBounds.width,
        height: screenBounds.height,
      }
      return {
        id: item.id,
        getBoundingRect: () => rect,
      }
    })
  }, [visibleItems, coordParams, containerRect, visualTransformsMap])

  // Marquee selection hook
  // Use the full preview background as both the hit area and the coordinate
  // space so drag-started-outside-the-player positions don't get clipped to a
  // smaller overlay, which previously produced a phantom marquee pinned to the
  // overlay's edge.
  const marqueeContainerRef = (hitAreaRef ?? overlayRef) as React.RefObject<HTMLElement>
  const { marquee } = useMarqueeSelection({
    containerRef: marqueeContainerRef,
    items: marqueeItems,
    enabled: !isExclusiveCanvasEditorActive,
    onSelectionChange: useCallback(
      (ids: string[]) => {
        selectItems(ids)
      },
      [selectItems],
    ),
    onPreviewSelectionChange: updateMarqueeCandidatePreview,
    onGestureEnd: clearMarqueeCandidatePreview,
    commitSelectionOnMouseUp: true,
    threshold: 5,
  })

  useEffect(() => {
    if (!isExclusiveCanvasEditorActive) return
    cancelInteraction()
    setOtherItemBounds([])
    setContextMenu(null)
    document.body.style.cursor = ''
  }, [cancelInteraction, isExclusiveCanvasEditorActive, setOtherItemBounds])

  const handleTransformStart = useCallback(() => {
    const playback = usePlaybackStore.getState()
    if (playback.previewFrame !== null) {
      if (playback.currentFrame !== playback.previewFrame) {
        playback.setCurrentFrame(playback.previewFrame)
      }
      playback.setPreviewFrame(null)
    }

    // Collect AABBs of non-selected visible items so snap can align to them.
    // Snapshot at drag start — other items don't move during the drag.
    const bounds: BoundingBox[] = []
    for (const item of unselectedItems) {
      const resolved = visualTransformsMap.get(item.id)
      if (!resolved) continue
      const strokeExpansion =
        item.type === 'shape' && typeof item.strokeWidth === 'number' ? item.strokeWidth : 0
      bounds.push(
        computeItemAabb(
          {
            x: resolved.x,
            y: resolved.y,
            width: resolved.width,
            height: resolved.height,
            rotation: resolved.rotation,
            opacity: resolved.opacity,
          },
          projectSize.width,
          projectSize.height,
          strokeExpansion,
        ),
      )
    }
    setOtherItemBounds(bounds)
  }, [
    unselectedItems,
    visualTransformsMap,
    projectSize.width,
    projectSize.height,
    setOtherItemBounds,
  ])

  // Handle transform end - commit the transform to the timeline with auto-keyframing
  const handleTransformEnd = useCallback(
    (
      itemId: string,
      transform: Transform,
      operation: 'move' | 'resize' | 'rotate' | 'anchor' = 'move',
    ) => {
      const currentFrame = usePlaybackStore.getState().currentFrame
      const item = visualItems.find((i) => i.id === itemId)
      if (!item) return
      const itemsById = new Map(visualItems.map((candidate) => [candidate.id, candidate]))
      const editableTransform = resolveEditableGizmoTransform({
        item,
        visualTransform: toResolvedTransform(transform),
        parentVisualTransform: resolveGizmoCommitParentWorld({
          item,
          canvas: { width: projectSize.width, height: projectSize.height, fps },
          frame: currentFrame,
          getItem: (candidateId) => itemsById.get(candidateId),
          getKeyframes: (candidateId) => keyframesByItemId[candidateId],
        }),
        relativeFrame: currentFrame - item.from,
        fps,
        frameWidth: projectSize.width,
        frameHeight: projectSize.height,
      })
      const itemKeyframes = useKeyframesStore.getState().keyframesByItemId[itemId]
      const commit = buildGizmoTransformCommit({
        item,
        itemKeyframes,
        transform: editableTransform,
        baseTransform: resolveTransform(
          item,
          { width: projectSize.width, height: projectSize.height, fps },
          getSourceDimensions(item),
        ),
        currentFrame,
      })
      const anchorCommit =
        operation === 'anchor'
          ? buildGizmoAnchorCommit({
              item,
              itemKeyframes,
              transform: editableTransform,
              currentFrame,
            })
          : null
      const transformProps = anchorCommit
        ? anchorCommit.transformProps
        : commit.shouldUpdateBase
          ? commit.transformProps
          : {}
      updateItemTransform(itemId, transformProps, {
        operation: operation === 'anchor' ? 'transform' : operation,
        autoKeyframeOperations: anchorCommit?.autoOps ?? commit.autoOps,
      })

      // Prevent background click from deselecting after drag
      justFinishedDragRef.current = true
      setTimeout(() => {
        justFinishedDragRef.current = false
      }, 100)
      setOtherItemBounds([])
      // Sync the resolved frame the gizmo/overlay reads to the current (paused)
      // frame. Otherwise a stale `displayedFrame` (left over from skimming) keeps
      // resolving the transform at the wrong frame, so the gizmo/motion-path sit
      // at a different point on the path than the rendered shape until the next
      // scrub. Then force a recompute of the selection.
      if (!usePlaybackStore.getState().isPlaying) {
        usePreviewBridgeStore.getState().setDisplayedFrame(usePlaybackStore.getState().currentFrame)
      }
      setForceUpdate((n) => n + 1)
    },
    [
      visualItems,
      keyframesByItemId,
      updateItemTransform,
      setOtherItemBounds,
      fps,
      projectSize.width,
      projectSize.height,
    ],
  )

  const handleCropEnd = useCallback(
    (itemId: string, edge: CropEdge, ratio: number) => {
      const item = visualItems.find((candidate) => candidate.id === itemId)
      if (!item || (item.type !== 'video' && item.type !== 'composition')) return

      const currentFrame = usePlaybackStore.getState().currentFrame
      const sourceDimensions = getSourceDimensions(item) ?? {
        width: Math.max(1, item.transform?.width ?? projectSize.width),
        height: Math.max(1, item.transform?.height ?? projectSize.height),
      }
      const sourceDimension =
        edge === 'left' || edge === 'right' ? sourceDimensions.width : sourceDimensions.height
      const sourcePixels = Math.round(ratio * sourceDimension)
      const operation = getAutoKeyframeOperation(
        item,
        useKeyframesStore.getState().keyframesByItemId[itemId],
        CROP_EDGE_PROPERTY[edge],
        sourcePixels,
        currentFrame,
      )

      if (operation) {
        applyAutoKeyframeOperations([operation])
      } else {
        updateItem(itemId, {
          crop: normalizeCropSettings({ ...item.crop, [edge]: sourcePixels / sourceDimension }),
        })
      }

      justFinishedDragRef.current = true
      setTimeout(() => {
        justFinishedDragRef.current = false
      }, 100)
      setOtherItemBounds([])
      if (!usePlaybackStore.getState().isPlaying) {
        usePreviewBridgeStore.getState().setDisplayedFrame(usePlaybackStore.getState().currentFrame)
      }
      setForceUpdate((value) => value + 1)
    },
    [
      applyAutoKeyframeOperations,
      projectSize.height,
      projectSize.width,
      setOtherItemBounds,
      updateItem,
      visualItems,
    ],
  )

  // Handle group transform end - commit transforms for all items as a single undo operation
  const handleGroupTransformEnd = useCallback(
    (
      transforms: Map<string, Transform>,
      operation: 'move' | 'resize' | 'rotate',
      textUpdates?: ReadonlyMap<string, GroupScaledTextProperties>,
    ) => {
      const currentFrame = usePlaybackStore.getState().currentFrame
      // Convert Transform to TransformProperties for the batch update
      const transformsMap = new Map<string, Partial<TransformProperties>>()
      const autoKeyframeOperations: AutoKeyframeOperation[] = []
      const itemUpdates = new Map<string, Partial<TimelineItem>>()
      const itemsById = new Map(visualItems.map((candidate) => [candidate.id, candidate]))
      for (const [itemId, transform] of transforms) {
        const item = visualItems.find((candidate) => candidate.id === itemId)
        if (!item) continue
        const parentId = item.transformParent?.parentItemId
        const parentTransform = parentId ? transforms.get(parentId) : undefined
        const parentWorld = parentTransform
          ? toResolvedTransform(parentTransform)
          : resolveGizmoCommitParentWorld({
              item,
              canvas: { width: projectSize.width, height: projectSize.height, fps },
              frame: currentFrame,
              getItem: (candidateId) => itemsById.get(candidateId),
              getKeyframes: (candidateId) => keyframesByItemId[candidateId],
            })
        const editableTransform = resolveEditableGizmoTransform({
          item,
          visualTransform: toResolvedTransform(transform),
          parentVisualTransform: parentWorld,
          relativeFrame: currentFrame - item.from,
          fps,
          frameWidth: projectSize.width,
          frameHeight: projectSize.height,
        })
        const commit = buildGizmoTransformCommit({
          item,
          itemKeyframes: useKeyframesStore.getState().keyframesByItemId[itemId],
          transform: editableTransform,
          baseTransform: resolveTransform(
            item,
            { width: projectSize.width, height: projectSize.height, fps },
            getSourceDimensions(item),
          ),
          currentFrame,
        })
        autoKeyframeOperations.push(...commit.autoOps)
        if (commit.shouldUpdateBase) transformsMap.set(itemId, commit.transformProps)

        const textUpdate = textUpdates?.get(itemId)
        if (item.type === 'text' && textUpdate) {
          const hasFrameScopedScale = commit.autoOps.some(
            (autoOperation) =>
              autoOperation.property === 'scale' ||
              autoOperation.property === 'width' ||
              autoOperation.property === 'height',
          )
          const textCommit = buildGroupTextScaleCommit(
            item,
            useKeyframesStore.getState().keyframesByItemId[itemId],
            textUpdate,
            currentFrame,
            hasFrameScopedScale,
          )
          autoKeyframeOperations.push(...textCommit.autoKeyframeOperations)
          if (Object.keys(textCommit.itemUpdates).length > 0) {
            itemUpdates.set(itemId, textCommit.itemUpdates)
          }
        }
      }
      // Use batch update for single undo operation
      updateItemsTransformMap(transformsMap, {
        operation,
        autoKeyframeOperations,
        itemUpdates,
      })

      // Prevent background click from deselecting after drag
      // Use setTimeout instead of requestAnimationFrame because click events
      // may fire after the next animation frame
      justFinishedDragRef.current = true
      setTimeout(() => {
        justFinishedDragRef.current = false
      }, 100)
      setOtherItemBounds([])
    },
    [
      visualItems,
      keyframesByItemId,
      updateItemsTransformMap,
      setOtherItemBounds,
      fps,
      projectSize.width,
      projectSize.height,
    ],
  )

  // Handle click on overlay background to deselect
  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      if (isExclusiveCanvasEditorActive) return
      // Don't deselect if we just finished a drag or marquee operation
      if (justFinishedDragRef.current || isMarqueeJustFinished()) {
        return
      }
      // Don't clear if clicking on gizmo elements
      const target = e.target as HTMLElement
      if (target.closest('[data-gizmo]')) return

      // Stop propagation so video-preview doesn't also clear
      e.stopPropagation()
      useSelectionStore.getState().clearItemSelection()
    },
    [isExclusiveCanvasEditorActive],
  )

  // Handle clicking an item to select it
  // For unselected items: select that item (or add to selection with shift)
  // For selected items in a group: select just that item (break group selection)
  const handleItemClick = useCallback(
    (itemId: string, e: React.MouseEvent) => {
      if (isExclusiveCanvasEditorActive) return
      e.stopPropagation()
      // A crop handle moves away from the pointer as it is dragged inward.
      // Suppress the click synthesized after mouseup so it cannot select a
      // different item that is now underneath the pointer.
      if (justFinishedDragRef.current) return
      const isSelected = selectedItemIdsSet.has(itemId)
      const isGroupSelection = selectedItemIds.length > 1

      if (e.shiftKey) {
        // Shift+click: toggle in selection
        if (isSelected) {
          selectItems(selectedItemIds.filter((id) => id !== itemId))
        } else {
          selectItems([...selectedItemIds, itemId])
        }
      } else if (isSelected && isGroupSelection) {
        // Clicking on a selected item in a group: select just that item
        selectItems([itemId])
      } else if (!isSelected) {
        // Clicking on an unselected item: select it
        selectItems([itemId])
      }
      // If single selected item is clicked again, do nothing (keeps selection)
    },
    [isExclusiveCanvasEditorActive, selectItems, selectedItemIds, selectedItemIdsSet],
  )

  // Helper to find all items at a canvas point (for context menu)
  const findAllItemsAtPoint = useCallback(
    (canvasPoint: Point): TimelineItem[] => {
      const canvasCenterX = projectSize.width / 2
      const canvasCenterY = projectSize.height / 2
      const result: TimelineItem[] = []

      for (const item of visibleItems) {
        // Get visual transform from the pre-computed map
        const resolved = visualTransformsMap.get(item.id)
        if (!resolved) continue

        // Convert transform position to absolute canvas coordinates
        const itemCenterX = canvasCenterX + resolved.x
        const itemCenterY = canvasCenterY + resolved.y

        // AABB check
        const left = itemCenterX - resolved.width / 2
        const right = itemCenterX + resolved.width / 2
        const top = itemCenterY - resolved.height / 2
        const bottom = itemCenterY + resolved.height / 2

        if (
          canvasPoint.x >= left &&
          canvasPoint.x <= right &&
          canvasPoint.y >= top &&
          canvasPoint.y <= bottom
        ) {
          result.push(item)
        }
      }

      return result
    },
    [visibleItems, projectSize, visualTransformsMap],
  )

  // Handle right-click to show context menu for overlapping items
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!coordParams || isExclusiveCanvasEditorActive) return

      e.preventDefault()
      e.stopPropagation()

      const canvasPoint = screenToCanvas(e.clientX, e.clientY, coordParams)
      const itemsAtPoint = findAllItemsAtPoint(canvasPoint)

      // Only show menu if there are multiple overlapping items
      if (itemsAtPoint.length > 1) {
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          items: itemsAtPoint,
        })
      } else if (itemsAtPoint.length === 1) {
        // Single item: just select it
        selectItems([itemsAtPoint[0]!.id])
      }
    },
    [coordParams, findAllItemsAtPoint, isExclusiveCanvasEditorActive, selectItems],
  )

  // Handle selecting an item from context menu
  const handleContextMenuSelect = useCallback(
    (itemId: string) => {
      selectItems([itemId])
      setContextMenu(null)
    },
    [selectItems],
  )

  // Close context menu when clicking elsewhere
  useEffect(() => {
    if (!contextMenu) return

    const handleClickOutside = () => setContextMenu(null)
    window.addEventListener('click', handleClickOutside)
    window.addEventListener('contextmenu', handleClickOutside)

    return () => {
      window.removeEventListener('click', handleClickOutside)
      window.removeEventListener('contextmenu', handleClickOutside)
    }
  }, [contextMenu])

  // Handle drag start from SelectableItem - select and start dragging in one motion
  const handleItemDragStart = useCallback(
    (itemId: string, e: React.MouseEvent, transform: Transform) => {
      if (!coordParams || isExclusiveCanvasEditorActive) return

      const startTransformSnapshot = { ...transform }
      const point = screenToCanvas(e.clientX, e.clientY, coordParams)

      const itemType = visibleItems.find((item) => item.id === itemId)?.type
      const interactionId = startTranslate(itemId, point, transform, undefined, itemType)
      document.body.style.cursor = 'move'

      attachWindowTransformInteraction({
        toCanvasPoint: (moveEvent) =>
          screenToCanvas(moveEvent.clientX, moveEvent.clientY, coordParams),
        updateInteraction,
        startTransform: startTransformSnapshot,
        endInteraction,
        onTransformEnd: (finalTransform, operation) => {
          handleTransformEnd(itemId, finalTransform, operation)
        },
        operation: 'move',
        afterFinish: () => {
          clearInteraction(interactionId)
        },
      })
    },
    [
      coordParams,
      startTranslate,
      updateInteraction,
      endInteraction,
      clearInteraction,
      handleTransformEnd,
      isExclusiveCanvasEditorActive,
      visibleItems,
    ],
  )

  // Don't render if no coordinate params (container not measured yet)
  if (!coordParams) {
    return null
  }

  // Note: We render even with no visible items so users can still interact
  // with the canvas (e.g., marquee selection area is ready when items appear)

  return (
    <div
      ref={overlayRef}
      className="absolute z-40"
      style={{
        top: -overlayPadding,
        left: -overlayPadding,
        width: playerSize.width + overlayPadding * 2,
        height: playerSize.height + overlayPadding * 2,
        pointerEvents: 'none',
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* Marquee selection rectangle — portaled into the preview background so
          it renders in the same coordinate space the marquee hook tracks.
          Hidden during corner pin / mask editing. */}
      {!isExclusiveCanvasEditorActive &&
        marqueePortalTarget &&
        createPortal(<MarqueeOverlay marquee={marquee} />, marqueePortalTarget)}

      {/* Player area - receives clicks for deselection and contains gizmos */}
      {/* Disabled while any exclusive editor owns canvas input. */}
      <div
        className="absolute"
        style={{
          top: overlayPadding,
          left: overlayPadding,
          width: playerSize.width,
          height: playerSize.height,
          pointerEvents: isExclusiveCanvasEditorActive ? 'none' : 'auto',
        }}
        onClick={handleBackgroundClick}
        onContextMenu={handleContextMenu}
        onDragEnter={isExclusiveCanvasEditorActive ? undefined : handleDragEnter}
        onDragOver={isExclusiveCanvasEditorActive ? undefined : handleDragOver}
        onDragLeave={isExclusiveCanvasEditorActive ? undefined : handleDragLeave}
        onDrop={isExclusiveCanvasEditorActive ? undefined : handleDrop}
      >
        {!isExclusiveCanvasEditorActive && dropState && (
          <div
            className={`absolute inset-0 pointer-events-none z-20 flex items-center justify-center border-2 border-dashed ${
              dropState.allowed
                ? 'border-primary/70 bg-primary/10'
                : 'border-destructive/60 bg-destructive/10'
            }`}
          >
            <div className="rounded-lg border border-border/70 bg-background/90 px-4 py-3 text-center shadow-lg backdrop-blur-sm">
              <p
                className={`text-sm font-semibold ${dropState.allowed ? 'text-primary' : 'text-destructive'}`}
              >
                {dropState.title}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{dropState.description}</p>
            </div>
          </div>
        )}

        {/* Hide the motion path during playback — it clutters the frame and the
            moving object already conveys the motion. */}
        {!isPlaying && !isPowerWindowEditing && !isSpatialEffectEditing && (
          <MotionPathOverlay
            paths={motionPaths}
            width={playerSize.width}
            height={playerSize.height}
            activeFrame={frozenFrameRef.current}
            onKeyframePointerDown={handleMotionPathKeyframePointerDown}
            onTangentPointerDown={handleMotionPathTangentPointerDown}
            onCreateSpatialTangents={handleCreateSpatialTangents}
          />
        )}

        {/* Candidate membership changes imperatively during marquee drag. This
            keeps the committed selection and gizmo stable while avoiding a
            selection-dependent React render for every item intersection. */}
        {!isExclusiveCanvasEditorActive &&
          visibleItems.map((item) => {
            const resolved = visualTransformsMap.get(item.id)
            if (!resolved) return null
            const transform: Transform = {
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
            const bounds = transformToScreenBounds(transform, coordParams)
            return (
              <div
                key={`marquee-candidate-${item.id}`}
                ref={(element) => bindMarqueeCandidateElement(item.id, element)}
                data-marquee-candidate-item-id={item.id}
                className="pointer-events-none absolute z-[6] hidden rounded-sm border-2 border-dashed border-white/65 bg-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.12)] data-[marquee-candidate=true]:block"
                style={{
                  left: bounds.left,
                  top: bounds.top,
                  width: bounds.width,
                  height: bounds.height,
                  transform: `rotate(${transform.rotation}deg)`,
                  transformOrigin: getScreenTransformOrigin(transform, coordParams),
                }}
              />
            )
          })}

        {/* Clickable areas for UNSELECTED visible items */}
        {/* Selected items are handled by their respective gizmos (TransformGizmo or GroupGizmo) */}
        {!isExclusiveCanvasEditorActive &&
          unselectedItems.map((item) => {
            const resolved = visualTransformsMap.get(item.id)
            if (!resolved) return null
            const positionLinkFeedback = getPositionLinkFeedback(item.id)
            return (
              <SelectableItem
                key={item.id}
                item={item}
                transform={{
                  x: resolved.x,
                  y: resolved.y,
                  width: resolved.width,
                  height: resolved.height,
                  anchorX: resolved.anchorX,
                  anchorY: resolved.anchorY,
                  rotation: resolved.rotation,
                  opacity: resolved.opacity,
                  cornerRadius: resolved.cornerRadius,
                }}
                coordParams={coordParams}
                onSelect={(e) => handleItemClick(item.id, e)}
                onDragStart={(e, transform) => handleItemDragStart(item.id, e, transform)}
                translateBlocked={!!positionLinkFeedback}
                translateBlockedLabel={positionLinkFeedback?.label}
                onTranslateBlocked={() => showPositionLinkFeedback(item.id)}
              />
            )
          })}

        {/* Transform gizmo(s) for selected items - hidden while another canvas editor is active */}
        {isExclusiveCanvasEditorActive || isPlaying ? null : selectedItems.length === 1 &&
          selectedItems[0] ? (
          <TransformGizmo
            item={selectedItems[0]}
            coordParams={coordParams}
            onTransformStart={handleTransformStart}
            onTransformEnd={(transform, operation) =>
              handleTransformEnd(selectedItems[0]!.id, transform, operation)
            }
            onCropEnd={(edge, ratio) => handleCropEnd(selectedItems[0]!.id, edge, ratio)}
            isPlaying={isPlaying}
            translateBlocked={positionLinkByItemId.has(selectedItems[0].id)}
            translateBlockedLabel={getPositionLinkFeedback(selectedItems[0].id)?.label}
            onTranslateBlocked={() => showPositionLinkFeedback(selectedItems[0]!.id)}
          />
        ) : selectedItems.length > 1 ? (
          <GroupGizmo
            items={selectedItems}
            coordParams={coordParams}
            onTransformStart={handleTransformStart}
            onTransformEnd={handleGroupTransformEnd}
            onItemClick={(itemId) => selectItems([itemId])}
            isPlaying={isPlaying}
            translateBlocked={selectedItems.some((item) => positionLinkByItemId.has(item.id))}
            translateBlockedLabel={
              getPositionLinkFeedback(
                selectedItems.find((item) => positionLinkByItemId.has(item.id))?.id ?? '',
              )?.label
            }
            onTranslateBlocked={() => {
              const blockedItem = selectedItems.find((item) => positionLinkByItemId.has(item.id))
              if (blockedItem) showPositionLinkFeedback(blockedItem.id)
            }}
          />
        ) : null}

        {/* Snap guides shown during drag */}
        {!isExclusiveCanvasEditorActive && <LiveSnapGuides coordParams={coordParams} />}
      </div>

      {/* Context menu for selecting from overlapping items - rendered via portal to ensure it's above all other elements */}
      {!isExclusiveCanvasEditorActive &&
        contextMenu &&
        createPortal(
          <div
            className="fixed z-[9999] bg-popover border border-border rounded-md shadow-lg py-1 min-w-[160px]"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2 py-1.5 text-xs text-muted-foreground border-b border-border mb-1">
              Select Layer
            </div>
            {contextMenu.items.map((item, index) => {
              const track = tracks.find((t) => t.id === item.trackId)
              const trackName = track?.name ?? `Track ${index + 1}`
              const itemName = item.label || `${item.type} clip`

              return (
                <button
                  key={item.id}
                  className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
                  onClick={() => handleContextMenuSelect(item.id)}
                >
                  <span className="text-muted-foreground text-xs">{trackName}:</span>
                  <span className="truncate">{itemName}</span>
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}
