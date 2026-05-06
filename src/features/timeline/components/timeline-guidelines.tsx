import { useCallback, useEffect, useRef } from 'react'
import { useSelectionStore } from '@/shared/state/selection'
import type { SnapTarget } from '../types/drag'
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context'

/**
 * Timeline Guidelines Component
 *
 * Renders vertical snap line for the active snap target during drag operations
 * - Green line for magnetic snap (item edges)
 * - Primary color for playhead snap
 *
 * Only shows when actively snapping to magnetic or playhead targets
 */
export function TimelineGuidelines() {
  const { frameToPixels } = useTimelineZoomContext()
  const containerRef = useRef<HTMLDivElement>(null)
  const lineRef = useRef<HTMLDivElement>(null)
  const activeSnapTargetRef = useRef<SnapTarget | null>(
    useSelectionStore.getState().activeSnapTarget,
  )

  const syncGuideline = useCallback(
    (activeSnapTarget: SnapTarget | null) => {
      const container = containerRef.current
      const line = lineRef.current
      if (!container || !line) {
        return
      }

      if (!activeSnapTarget) {
        container.style.display = 'none'
        return
      }

      const isMagnetic =
        activeSnapTarget.type === 'item-start' || activeSnapTarget.type === 'item-end'
      const isPlayhead = activeSnapTarget.type === 'playhead'
      if (!isMagnetic && !isPlayhead) {
        container.style.display = 'none'
        return
      }

      container.style.display = ''
      line.style.left = `${frameToPixels(activeSnapTarget.frame)}px`
    },
    [frameToPixels],
  )

  useEffect(() => {
    syncGuideline(activeSnapTargetRef.current)

    return useSelectionStore.subscribe((state, previous) => {
      if (state.activeSnapTarget === previous.activeSnapTarget) {
        return
      }

      activeSnapTargetRef.current = state.activeSnapTarget
      syncGuideline(state.activeSnapTarget)
    })
  }, [syncGuideline])

  useEffect(() => {
    syncGuideline(activeSnapTargetRef.current)
  }, [syncGuideline])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 10000, display: 'none' }}
    >
      <div
        ref={lineRef}
        className="absolute top-0 bottom-0 w-px"
        style={{
          backgroundColor: 'var(--color-timeline-snap)',
          opacity: 0.9,
          boxShadow: '0 0 4px var(--color-timeline-snap)',
        }}
      />
    </div>
  )
}
