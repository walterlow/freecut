/** Shared pointer lifecycle for Parent, Property Link, and Expression pick whips. */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react'

export interface MotionPickWhipClipBounds {
  left: number
  top: number
  right: number
  bottom: number
}

interface MotionPickWhipCandidate<TValue> {
  row: HTMLElement
  value: TValue
}

export type MotionPickWhipTarget<TValue> =
  | {
      status: 'valid'
      row: HTMLElement
      value: TValue
    }
  | {
      status: 'invalid'
      row: HTMLElement
      message: string
    }
  | null

export interface MotionPickWhipOverlaySnapshot {
  startX: number
  startY: number
  currentX: number
  currentY: number
  valid: boolean
  rejectionMessage?: string | null
  clipBounds: MotionPickWhipClipBounds
}

export interface MotionPickWhipPresentation {
  current: MotionPickWhipOverlaySnapshot
  publish: (snapshot: MotionPickWhipOverlaySnapshot) => void
  subscribe: (listener: (snapshot: MotionPickWhipOverlaySnapshot) => void) => () => void
}

export interface MotionPickWhipModifiers {
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

interface MotionPickWhipDragState<TOrigin, TCandidate> {
  pointerId: number
  origin: TOrigin
  startX: number
  startY: number
  currentX: number
  currentY: number
  moved: boolean
  candidate: MotionPickWhipCandidate<TCandidate> | null
  rejection: { row: HTMLElement; message: string } | null
  clipBounds: MotionPickWhipClipBounds
  presentation: MotionPickWhipPresentation
}

interface UseMotionPickWhipDragOptions<TOrigin, TCandidate> {
  hoverAttribute: string
  rejectionHoverAttribute?: string
  eligibleAttribute?: string
  resolveEligibleRows?: (origin: TOrigin) => Iterable<HTMLElement>
  getClipRoot?: (originElement: HTMLElement) => HTMLElement | null
  resolveTarget: (
    clientX: number,
    clientY: number,
    origin: TOrigin,
  ) => MotionPickWhipTarget<TCandidate>
  onCommit: (origin: TOrigin, candidate: TCandidate, modifiers: MotionPickWhipModifiers) => void
  onReject?: (origin: TOrigin, message: string, modifiers: MotionPickWhipModifiers) => void
}

const AUTO_SCROLL_EDGE_PX = 48
const AUTO_SCROLL_MAX_PX_PER_SECOND = 720

function getAutoScrollVelocity(
  pointerX: number,
  pointerY: number,
  bounds: MotionPickWhipClipBounds,
): number {
  if (
    pointerX < bounds.left ||
    pointerX > bounds.right ||
    pointerY < bounds.top ||
    pointerY > bounds.bottom
  ) {
    return 0
  }
  const topDepth = AUTO_SCROLL_EDGE_PX - (pointerY - bounds.top)
  if (topDepth > 0) {
    return -AUTO_SCROLL_MAX_PX_PER_SECOND * (topDepth / AUTO_SCROLL_EDGE_PX)
  }
  const bottomDepth = AUTO_SCROLL_EDGE_PX - (bounds.bottom - pointerY)
  if (bottomDepth > 0) {
    return AUTO_SCROLL_MAX_PX_PER_SECOND * (bottomDepth / AUTO_SCROLL_EDGE_PX)
  }
  return 0
}

function updateHover(
  hoverRef: MutableRefObject<HTMLElement | null>,
  row: HTMLElement | null,
  attribute: string,
): void {
  if (hoverRef.current === row) return
  hoverRef.current?.removeAttribute(attribute)
  if (row) row.setAttribute(attribute, 'true')
  hoverRef.current = row
}

function getClipBounds(root: HTMLElement): MotionPickWhipClipBounds {
  const rect = root.getBoundingClientRect()
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

function createPresentation(
  initialSnapshot: MotionPickWhipOverlaySnapshot,
): MotionPickWhipPresentation {
  const listeners = new Set<(snapshot: MotionPickWhipOverlaySnapshot) => void>()
  const presentation: MotionPickWhipPresentation = {
    current: initialSnapshot,
    publish: (snapshot) => {
      presentation.current = snapshot
      for (const listener of listeners) listener(snapshot)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      listener(presentation.current)
      return () => listeners.delete(listener)
    },
  }
  return presentation
}

function getOverlaySnapshot<TOrigin, TCandidate>(
  drag: MotionPickWhipDragState<TOrigin, TCandidate>,
): MotionPickWhipOverlaySnapshot {
  return {
    startX: drag.startX,
    startY: drag.startY,
    currentX: drag.currentX,
    currentY: drag.currentY,
    valid: Boolean(drag.candidate),
    rejectionMessage: drag.rejection?.message ?? null,
    clipBounds: drag.clipBounds,
  }
}

export function useMotionPickWhipDrag<TOrigin, TCandidate>(
  options: UseMotionPickWhipDragOptions<TOrigin, TCandidate>,
) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const [drag, setDrag] = useState<MotionPickWhipDragState<TOrigin, TCandidate> | null>(null)
  const dragRef = useRef<MotionPickWhipDragState<TOrigin, TCandidate> | null>(null)
  const hoverRef = useRef<HTMLElement | null>(null)
  const rejectionHoverRef = useRef<HTMLElement | null>(null)
  const eligibleRowsRef = useRef<Set<HTMLElement>>(new Set())
  const originElementRef = useRef<HTMLElement | null>(null)
  const clipRootRef = useRef<HTMLElement | null>(null)
  const presentationFrameRef = useRef<number | null>(null)
  const layoutRefreshPendingRef = useRef(false)
  const autoScrollFrameRef = useRef<number | null>(null)
  const autoScrollTimeRef = useRef<number | null>(null)

  const begin = useCallback((event: ReactPointerEvent<HTMLElement>, origin: TOrigin) => {
    if (event.button !== 0) return
    const clipRoot =
      optionsRef.current.getClipRoot?.(event.currentTarget) ??
      event.currentTarget.closest<HTMLElement>(
        '[data-pick-whip-scroll-area], [data-testid="motion-layer-scroll-area"]',
      )
    if (!clipRoot) return
    const rect = event.currentTarget.getBoundingClientRect()
    const clipBounds = getClipBounds(clipRoot)
    const startX = rect.left + rect.width / 2
    const startY = rect.top + rect.height / 2
    const next: MotionPickWhipDragState<TOrigin, TCandidate> = {
      pointerId: event.pointerId,
      origin,
      startX,
      startY,
      currentX: event.clientX,
      currentY: event.clientY,
      moved: false,
      candidate: null,
      rejection: null,
      clipBounds,
      presentation: createPresentation({
        startX,
        startY,
        currentX: event.clientX,
        currentY: event.clientY,
        valid: false,
        rejectionMessage: null,
        clipBounds,
      }),
    }
    originElementRef.current = event.currentTarget
    clipRootRef.current = clipRoot
    const eligibleAttribute = optionsRef.current.eligibleAttribute
    if (eligibleAttribute) {
      for (const row of optionsRef.current.resolveEligibleRows?.(origin) ?? []) {
        row.setAttribute(eligibleAttribute, 'true')
        eligibleRowsRef.current.add(row)
      }
    }
    dragRef.current = next
    setDrag(next)
  }, [])

  useEffect(() => {
    const clearHover = () => updateHover(hoverRef, null, optionsRef.current.hoverAttribute)
    const clearRejectionHover = () => {
      const attribute = optionsRef.current.rejectionHoverAttribute
      if (attribute) updateHover(rejectionHoverRef, null, attribute)
    }
    const clearEligibleRows = () => {
      const eligibleAttribute = optionsRef.current.eligibleAttribute
      if (eligibleAttribute) {
        for (const row of eligibleRowsRef.current) row.removeAttribute(eligibleAttribute)
      }
      eligibleRowsRef.current.clear()
    }
    const cancelPresentation = () => {
      if (presentationFrameRef.current !== null) {
        window.cancelAnimationFrame(presentationFrameRef.current)
        presentationFrameRef.current = null
      }
      layoutRefreshPendingRef.current = false
    }
    const presentDrag = () => {
      presentationFrameRef.current = null
      const current = dragRef.current
      if (!current) return
      const target = optionsRef.current.resolveTarget(
        current.currentX,
        current.currentY,
        current.origin,
      )
      const candidate = target?.status === 'valid' ? { row: target.row, value: target.value } : null
      const rejection =
        target?.status === 'invalid' ? { row: target.row, message: target.message } : null
      updateHover(hoverRef, candidate?.row ?? null, optionsRef.current.hoverAttribute)
      const rejectionAttribute = optionsRef.current.rejectionHoverAttribute
      if (rejectionAttribute) {
        updateHover(rejectionHoverRef, rejection?.row ?? null, rejectionAttribute)
      }
      let next: MotionPickWhipDragState<TOrigin, TCandidate> = {
        ...current,
        candidate,
        rejection,
      }
      if (layoutRefreshPendingRef.current) {
        const originElement = originElementRef.current
        const clipRoot = clipRootRef.current
        layoutRefreshPendingRef.current = false
        if (!originElement?.isConnected || !clipRoot?.isConnected) return
        const rect = originElement.getBoundingClientRect()
        next = {
          ...next,
          startX: rect.left + rect.width / 2,
          startY: rect.top + rect.height / 2,
          clipBounds: getClipBounds(clipRoot),
        }
      }
      dragRef.current = next
      next.presentation.publish(getOverlaySnapshot(next))
    }
    const schedulePresentation = (refreshLayout = false) => {
      if (!dragRef.current) return
      if (refreshLayout) layoutRefreshPendingRef.current = true
      if (presentationFrameRef.current !== null) return
      presentationFrameRef.current = window.requestAnimationFrame(presentDrag)
    }
    const scheduleLayoutRefresh = () => schedulePresentation(true)
    const cancelAutoScroll = () => {
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current)
        autoScrollFrameRef.current = null
      }
      autoScrollTimeRef.current = null
    }
    const autoScroll = (timestamp: number) => {
      autoScrollFrameRef.current = null
      const current = dragRef.current
      const clipRoot = clipRootRef.current
      if (!current || !clipRoot) {
        autoScrollTimeRef.current = null
        return
      }
      const velocity = getAutoScrollVelocity(current.currentX, current.currentY, current.clipBounds)
      if (velocity === 0) {
        autoScrollTimeRef.current = null
        return
      }
      const previousTimestamp = autoScrollTimeRef.current ?? timestamp - 1000 / 60
      const elapsedSeconds = Math.min(32, Math.max(0, timestamp - previousTimestamp)) / 1000
      autoScrollTimeRef.current = timestamp
      const previousScrollTop = clipRoot.scrollTop
      const maxScrollTop = Math.max(0, clipRoot.scrollHeight - clipRoot.clientHeight)
      clipRoot.scrollTop = Math.min(
        maxScrollTop,
        Math.max(0, previousScrollTop + velocity * elapsedSeconds),
      )
      if (clipRoot.scrollTop === previousScrollTop) {
        autoScrollTimeRef.current = null
        return
      }
      scheduleLayoutRefresh()
      autoScrollFrameRef.current = window.requestAnimationFrame(autoScroll)
    }
    const updateAutoScroll = () => {
      const current = dragRef.current
      if (
        !current ||
        getAutoScrollVelocity(current.currentX, current.currentY, current.clipBounds) === 0
      ) {
        cancelAutoScroll()
        return
      }
      if (autoScrollFrameRef.current !== null) return
      autoScrollFrameRef.current = window.requestAnimationFrame(autoScroll)
    }
    const move = (event: PointerEvent) => {
      const current = dragRef.current
      if (!current || current.pointerId !== event.pointerId) return
      const next = {
        ...current,
        currentX: event.clientX,
        currentY: event.clientY,
        moved:
          current.moved ||
          Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= 3,
      }
      dragRef.current = next
      schedulePresentation()
      updateAutoScroll()
    }
    const finish = (event: PointerEvent, commit: boolean) => {
      const current = dragRef.current
      if (!current || current.pointerId !== event.pointerId) return
      const target =
        commit && current.moved
          ? optionsRef.current.resolveTarget(event.clientX, event.clientY, current.origin)
          : null
      const candidate = target?.status === 'valid' ? { row: target.row, value: target.value } : null
      const rejection = target?.status === 'invalid' ? target : null
      clearHover()
      clearRejectionHover()
      clearEligibleRows()
      cancelPresentation()
      cancelAutoScroll()
      dragRef.current = null
      originElementRef.current = null
      clipRootRef.current = null
      setDrag(null)
      const modifiers = {
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      }
      if (candidate) {
        optionsRef.current.onCommit(current.origin, candidate.value, modifiers)
      } else if (rejection) {
        optionsRef.current.onReject?.(current.origin, rejection.message, modifiers)
      }
    }
    const pointerUp = (event: PointerEvent) => finish(event, true)
    const pointerCancel = (event: PointerEvent) => finish(event, false)
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !dragRef.current) return
      clearHover()
      clearRejectionHover()
      clearEligibleRows()
      cancelPresentation()
      cancelAutoScroll()
      dragRef.current = null
      originElementRef.current = null
      clipRootRef.current = null
      setDrag(null)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', pointerUp)
    window.addEventListener('pointercancel', pointerCancel)
    window.addEventListener('keydown', keyDown)
    window.addEventListener('scroll', scheduleLayoutRefresh, true)
    window.addEventListener('resize', scheduleLayoutRefresh)
    return () => {
      clearHover()
      clearRejectionHover()
      clearEligibleRows()
      cancelPresentation()
      cancelAutoScroll()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', pointerUp)
      window.removeEventListener('pointercancel', pointerCancel)
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('scroll', scheduleLayoutRefresh, true)
      window.removeEventListener('resize', scheduleLayoutRefresh)
    }
  }, [])

  return { drag, begin }
}
