import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  useTimelineStore,
  useItemsStore,
  useTransitionsStore,
  useMediaDependencyStore,
} from '@/features/preview/deps/timeline-store'
import {
  useRollingEditPreviewStore,
  useRippleEditPreviewStore,
  useSlipEditPreviewStore,
  useSlideEditPreviewStore,
} from '@/features/preview/deps/timeline-edit-preview'
import { useSelectionStore } from '@/shared/state/selection'
import {
  getProjectBrokenMediaIds,
  useMediaLibraryStore,
} from '@/features/preview/deps/media-library'
import { useBlobUrlVersion } from '@/infrastructure/browser/blob-url-manager'
import { usePlaybackStore } from '@/shared/state/playback'
import { useGizmoStore } from '../stores/gizmo-store'
import { useMaskEditorStore } from '../stores/mask-editor-store'
import { isMarqueeJustFinished } from '@/shared/marquee/use-marquee-selection'
import { getPreviewNeedsOverflow, getPreviewPlayerSize } from '../utils/preview-pixel-snap'

interface PreviewProjectDimensions {
  width: number
  height: number
}

interface PreviewContainerDimensions {
  width: number
  height: number
}

interface UsePreviewViewModelParams {
  project: PreviewProjectDimensions
  containerSize: PreviewContainerDimensions
  suspendOverlay: boolean
}

export function usePreviewViewModel({
  project,
  containerSize,
  suspendOverlay,
}: UsePreviewViewModelParams) {
  const playerContainerRef = useRef<HTMLDivElement>(null)
  const backgroundRef = useRef<HTMLDivElement>(null)
  const [playerContainerRect, setPlayerContainerRect] = useState<DOMRect | null>(null)

  const fps = useTimelineStore((s) => s.fps)
  const tracks = useTimelineStore((s) => s.tracks)
  const keyframes = useTimelineStore((s) => s.keyframes)
  const items = useItemsStore((s) => s.items)
  const itemsByTrackId = useItemsStore((s) => s.itemsByTrackId)
  const mediaDependencyVersion = useMediaDependencyStore((s) => s.mediaDependencyVersion)
  const transitions = useTransitionsStore((s) => s.transitions)
  const mediaById = useMediaLibraryStore((s) => s.mediaById)
  const brokenMediaCount = useMediaLibraryStore(
    (s) => getProjectBrokenMediaIds(s.brokenMediaIds, s.mediaById).length,
  )
  const hasRolling2Up = useRollingEditPreviewStore((s) =>
    Boolean(s.trimmedItemId && s.neighborItemId && s.handle),
  )
  const hasRipple2Up = useRippleEditPreviewStore((s) => Boolean(s.trimmedItemId && s.handle))
  const hasSlip4Up = useSlipEditPreviewStore((s) => Boolean(s.itemId))
  const hasSlide4Up = useSlideEditPreviewStore((s) => Boolean(s.itemId))
  const activeGizmoItemId = useGizmoStore((s) => s.activeGizmo?.itemId ?? null)
  const isGizmoInteracting = useGizmoStore((s) => s.activeGizmo !== null)
  const isMaskEditingActive = useMaskEditorStore((s) => s.isEditing)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const zoom = usePlaybackStore((s) => s.zoom)
  const useProxy = usePlaybackStore((s) => s.useProxy)
  const busAudioEq = usePlaybackStore((s) => s.busAudioEq)
  const blobUrlVersion = useBlobUrlVersion()
  const proxyStatus = useMediaLibraryStore((s) => s.proxyStatus)
  const proxyReadyCount = useMemo(() => {
    let count = 0
    for (const status of proxyStatus.values()) {
      if (status === 'ready') count++
    }
    return count
  }, [proxyStatus])

  const activeGizmoItemType = useMemo(
    () =>
      activeGizmoItemId
        ? (items.find((item) => item.id === activeGizmoItemId)?.type ?? null)
        : null,
    [activeGizmoItemId, items],
  )

  const containerWidth = containerSize.width
  const containerHeight = containerSize.height
  const projectWidth = project.width
  const projectHeight = project.height
  const playerSize = useMemo(
    () =>
      getPreviewPlayerSize({
        sourceSize: { width: projectWidth, height: projectHeight },
        containerSize: { width: containerWidth, height: containerHeight },
        zoom,
      }),
    [containerHeight, containerWidth, projectHeight, projectWidth, zoom],
  )

  const needsOverflow = useMemo(
    () => getPreviewNeedsOverflow({ playerSize, containerSize, zoom }),
    [containerSize, playerSize, zoom],
  )

  const setPlayerContainerRefCallback = useCallback((el: HTMLDivElement | null) => {
    playerContainerRef.current = el
    if (el) {
      setPlayerContainerRect(el.getBoundingClientRect())
    }
  }, [])

  useLayoutEffect(() => {
    if (suspendOverlay) return
    const container = playerContainerRef.current
    if (!container) return

    const updateRect = () => {
      const nextRect = container.getBoundingClientRect()
      setPlayerContainerRect((prev) => {
        if (
          prev &&
          prev.left === nextRect.left &&
          prev.top === nextRect.top &&
          prev.width === nextRect.width &&
          prev.height === nextRect.height
        ) {
          return prev
        }
        return nextRect
      })
    }

    updateRect()

    const resizeObserver = new ResizeObserver(updateRect)
    resizeObserver.observe(container)

    window.addEventListener('scroll', updateRect, true)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('scroll', updateRect, true)
    }
  }, [suspendOverlay])

  const handleBackgroundClick = useCallback(
    (event: React.MouseEvent) => {
      if (isMaskEditingActive) {
        event.stopPropagation()
        return
      }
      if (isMarqueeJustFinished()) return

      const target = event.target as HTMLElement
      if (target.closest('[data-gizmo]')) return

      useSelectionStore.getState().clearItemSelection()
    },
    [isMaskEditingActive],
  )

  return {
    fps,
    tracks,
    keyframes,
    items,
    itemsByTrackId,
    mediaDependencyVersion,
    transitions,
    mediaById,
    brokenMediaCount,
    hasRolling2Up,
    hasRipple2Up,
    hasSlip4Up,
    hasSlide4Up,
    activeGizmoItemId,
    activeGizmoItemType,
    isGizmoInteracting,
    isMaskEditingActive,
    isPlaying,
    zoom,
    useProxy,
    busAudioEq,
    blobUrlVersion,
    proxyReadyCount,
    playerSize,
    needsOverflow,
    playerContainerRef,
    playerContainerRect,
    backgroundRef,
    setPlayerContainerRefCallback,
    handleBackgroundClick,
  }
}
