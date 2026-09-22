/**
 * Panel chrome sizing for the keyframe graph panel: the container/parent
 * measurements, the user-resizable content height and the drag handle.
 *
 * The measurements and listeners move verbatim out of KeyframeGraphPanel — the
 * perf test pins how the panel re-renders, so effect dependencies and ordering
 * are preserved exactly. The refs are returned for the panel's JSX to attach.
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react'
import type { KeyframeEditorSurface } from './keyframe-graph-panel-model'

/** Height of the panel header bar in pixels */
export const GRAPH_PANEL_HEADER_HEIGHT = 32

/** Height of the resize handle in pixels */
export const RESIZE_HANDLE_HEIGHT = 6

/** Default ratio of parent height for the graph content area */
const DEFAULT_PARENT_RATIO = 0.6

/** Minimum content height */
export const MIN_CONTENT_HEIGHT = 100

/** Fallback maximum content height when parent size is unknown */
const MAX_CONTENT_HEIGHT_FALLBACK = 500

/** Maximum ratio the panel can occupy of its parent container */
const MAX_PARENT_RATIO = 0.8

interface KeyframeGraphPanelChromeParams {
  isOpen: boolean
  placement: 'bottom' | 'top' | 'side' | undefined
  surface: KeyframeEditorSurface | undefined
}

interface KeyframeGraphPanelChrome {
  containerRef: RefObject<HTMLDivElement | null>
  panelRef: RefObject<HTMLDivElement | null>
  containerWidth: number
  /** Content height, clamped to the current maximum for the parent size. */
  clampedContentHeight: number
  parentHeight: number
  panelHeaderHeight: number
  isResizing: boolean
  handleResizeStart: (e: MouseEvent) => void
}

export function useKeyframeGraphPanelChrome({
  isOpen,
  placement,
  surface,
}: KeyframeGraphPanelChromeParams): KeyframeGraphPanelChrome {
  // Ref to measure container width
  const containerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [parentHeight, setParentHeight] = useState(0)
  const hasInitialSized = useRef(false)

  // Track content height (user can resize)
  const [contentHeight, setContentHeight] = useState(MIN_CONTENT_HEIGHT)

  // Edit's classic sheet has no redundant title bar; its timeline toolbar and
  // clip diamond already own panel visibility.
  const panelHeaderHeight = surface === 'edit' ? 0 : GRAPH_PANEL_HEADER_HEIGHT
  const chrome = panelHeaderHeight + RESIZE_HANDLE_HEIGHT
  const maxParentRatio = surface === 'edit' ? 0.65 : MAX_PARENT_RATIO
  const defaultParentRatio = surface === 'edit' ? 0.38 : DEFAULT_PARENT_RATIO
  const maxContentHeight =
    parentHeight > 0
      ? Math.max(MIN_CONTENT_HEIGHT, Math.floor(parentHeight * maxParentRatio) - chrome)
      : MAX_CONTENT_HEIGHT_FALLBACK

  // Set default height to 60% of parent on first measurement
  useEffect(() => {
    if (parentHeight > 0 && !hasInitialSized.current) {
      hasInitialSized.current = true
      const defaultHeight = Math.floor(parentHeight * defaultParentRatio) - chrome
      setContentHeight(Math.max(MIN_CONTENT_HEIGHT, Math.min(maxContentHeight, defaultHeight)))
    }
  }, [parentHeight, chrome, defaultParentRatio, maxContentHeight])

  // Resize state
  const [isResizing, setIsResizing] = useState(false)
  const resizeStartY = useRef(0)
  const resizeStartHeight = useRef(0)

  // Measure container width on mount and resize
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateWidth = () => {
      setContainerWidth(container.clientWidth)
    }

    // Initial measurement
    updateWidth()

    // Use ResizeObserver to track size changes
    const resizeObserver = new ResizeObserver(updateWidth)
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
    }
  }, [isOpen]) // Re-measure when panel opens

  // Measure parent height so the panel can cap at MAX_PARENT_RATIO
  useEffect(() => {
    const panel = panelRef.current
    const parent = panel?.parentElement
    if (!parent) return

    const update = () => setParentHeight(parent.clientHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [isOpen])

  // Handle resize drag
  const handleResizeStart = useCallback(
    (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsResizing(true)
      resizeStartY.current = e.clientY
      resizeStartHeight.current = contentHeight
    },
    [contentHeight],
  )

  // Handle resize move and end via document events
  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: globalThis.MouseEvent) => {
      const deltaY =
        placement === 'top' ? e.clientY - resizeStartY.current : resizeStartY.current - e.clientY
      const newHeight = Math.min(
        maxContentHeight,
        Math.max(MIN_CONTENT_HEIGHT, resizeStartHeight.current + deltaY),
      )
      setContentHeight(newHeight)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      // Note: We intentionally do NOT call onHeightChange during resize
      // The timeline panel should only resize when the graph panel is opened/closed,
      // not when the user drags the resize handle within the existing space
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, placement, maxContentHeight])

  // Clamp content height when max shrinks (e.g. parent resized smaller)
  const clampedContentHeight = Math.min(contentHeight, maxContentHeight)

  return {
    containerRef,
    panelRef,
    containerWidth,
    clampedContentHeight,
    parentHeight,
    panelHeaderHeight,
    isResizing,
    handleResizeStart,
  }
}
