import { LAYER_COLUMN_WIDTH } from './motion-timeline-primitives'
import type { MotionTimeViewport } from './motion-time-viewport-controller'
import { beginTextMotionEdit, commitTextMotionEdit, updateTextMotionLive } from '@/features/editor/deps/timeline-store'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import type { TextMotionTimelineBand } from '@/shared/timeline/text-motion-timeline'
import type { TextMotionSlot } from '@/types/text-motion'
import { memo, useCallback, useRef, useState } from 'react'

const PROCEDURAL_HATCH =
  'repeating-linear-gradient(45deg, rgba(56,189,248,0.55) 0 2px, transparent 2px 5px)'

export const TextMotionTimelineLanes = memo(function TextMotionTimelineLanes({
  itemId,
  bands,
  timeViewport,
}: {
  itemId: string
  bands: TextMotionTimelineBand[]
  timeViewport: MotionTimeViewport
}) {
  const dragRef = useRef<{
    pointerId: number
    slot: TextMotionSlot
    startX: number
    startDurationFrames: number
    currentDurationFrames: number
    laneWidth: number
    before: ReturnType<typeof beginTextMotionEdit> | null
  } | null>(null)
  const suppressClickRef = useRef(false)
  const [previewDurationBySlot, setPreviewDurationBySlot] = useState<
    Partial<Record<TextMotionSlot, number>>
  >({})
  const visibleFrameRange = Math.max(1, timeViewport.endFrame - timeViewport.startFrame)

  const beginDurationDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, band: TextMotionTimelineBand) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const laneWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 0
      if (laneWidth <= 0) return
      event.currentTarget.setPointerCapture?.(event.pointerId)
      dragRef.current = {
        pointerId: event.pointerId,
        slot: band.slot,
        startX: event.clientX,
        startDurationFrames: band.durationFrames,
        currentDurationFrames: band.durationFrames,
        laneWidth,
        before: null,
      }
    },
    [],
  )

  const moveDurationDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      const deltaFrames = ((event.clientX - drag.startX) / drag.laneWidth) * visibleFrameRange
      if (!drag.before) {
        if (Math.abs(event.clientX - drag.startX) < 3) return
        drag.before = beginTextMotionEdit()
      }
      const directedDelta = drag.slot === 'out' ? -deltaFrames : deltaFrames
      const durationFrames = Math.max(1, Math.round(drag.startDurationFrames + directedDelta))
      if (durationFrames === drag.currentDurationFrames) return
      drag.currentDurationFrames = durationFrames
      // Keep the high-frequency preview local to these tiny band rows. A live
      // item-store write invalidates the full expanded dopesheet on every tick.
      setPreviewDurationBySlot((previous) => ({ ...previous, [drag.slot]: durationFrames }))
    },
    [visibleFrameRange],
  )

  const finishDurationDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      dragRef.current = null
      suppressClickRef.current = commit && drag.before !== null
      if (commit && drag.before) {
        updateTextMotionLive([itemId], drag.slot, {
          durationFrames: drag.currentDurationFrames,
        })
        commitTextMotionEdit(drag.before, { slot: drag.slot, itemIds: [itemId] })
      }
      setPreviewDurationBySlot((previous) => {
        if (previous[drag.slot] === undefined) return previous
        const next = { ...previous }
        delete next[drag.slot]
        return next
      })
    },
    [itemId],
  )

  const endDurationDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => finishDurationDrag(event, true),
    [finishDurationDrag],
  )
  const cancelDurationDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => finishDurationDrag(event, false),
    [finishDurationDrag],
  )

  const openAnimationInspector = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.stopPropagation()
      if (suppressClickRef.current) {
        suppressClickRef.current = false
        return
      }
      useSelectionStore.getState().selectItems([itemId])
      const editor = useEditorStore.getState()
      editor.setRightSidebarOpen(true)
      editor.setClipInspectorTab('audio')
    },
    [itemId],
  )

  return (
    <div data-testid="motion-text-procedural-lanes">
      {bands.map((band) => {
        const previewDuration = previewDurationBySlot[band.slot] ?? band.durationFrames
        const durationDelta = previewDuration - band.durationFrames
        const previewFromFrame =
          band.slot === 'out' ? band.fromFrame - durationDelta : band.fromFrame
        const previewToFrame = band.slot === 'out' ? band.toFrame : band.toFrame + durationDelta
        const left = ((previewFromFrame - timeViewport.startFrame) / visibleFrameRange) * 100
        const width = ((previewToFrame - previewFromFrame) / visibleFrameRange) * 100
        return (
          <div key={band.slot} className="flex h-7 border-t border-border/45 bg-background/25">
            <div
              className="flex shrink-0 items-center border-r border-border pl-14 pr-2 text-[9px] text-sky-300/90"
              style={{ width: LAYER_COLUMN_WIDTH }}
            >
              <span className="w-8 uppercase tracking-[0.08em]">{band.slot}</span>
              <span className="truncate text-muted-foreground">{band.presetId}</span>
              <span className="ml-auto pl-2 tabular-nums text-muted-foreground/70">
                {previewDuration}f · {band.unitCount}u
              </span>
            </div>
            <div className="relative h-7 min-w-0 flex-1 overflow-hidden">
              <div data-motion-viewport-surface className="absolute inset-0 overflow-hidden">
                <div
                  data-testid={`motion-text-procedural-band-${band.slot}`}
                  data-motion-span-drag-visual
                  data-from-frame={previewFromFrame}
                  data-to-frame={previewToFrame}
                  className="absolute top-1/2 h-4 -translate-y-1/2 touch-none cursor-ew-resize rounded-sm border border-sky-300/45 bg-sky-400/10 transition-[border-color,background-color] hover:border-sky-200/80 hover:bg-sky-400/20 active:border-sky-100"
                  style={{
                    left: `${left}%`,
                    width: `${Math.max(0.5, width)}%`,
                    backgroundImage: PROCEDURAL_HATCH,
                  }}
                  title={`${band.presetId} · drag to change duration · ${previewDuration}f · ${band.unitCount} units`}
                  onPointerDown={(event) => beginDurationDrag(event, band)}
                  onPointerMove={moveDurationDrag}
                  onPointerUp={endDurationDrag}
                  onPointerCancel={cancelDurationDrag}
                  onClick={openAnimationInspector}
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
})
