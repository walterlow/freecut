import { memo } from 'react'
import { cn } from '@/shared/ui/cn'
import { EDITOR_LAYOUT } from '@/app/editor-layout'
import type { OperationBoundsVisual } from './tool-operation-overlay-utils'

interface ToolOperationOverlayProps {
  visual: OperationBoundsVisual | null
}

export const ToolOperationOverlay = memo(function ToolOperationOverlay({
  visual,
}: ToolOperationOverlayProps) {
  if (!visual) return null

  const usesCompactTopBox = visual.mode === 'rolling' || visual.mode === 'slide'
  const usesSlipBodyBox = visual.mode === 'slip'
  const usesFilledBoundsBox =
    visual.mode === 'trim' || visual.mode === 'ripple' || visual.mode === 'stretch'
  const showBoundsBox = visual.boxLeftPx !== null && visual.boxWidthPx !== null
  const boxTop = usesCompactTopBox
    ? 0
    : usesSlipBodyBox
      ? Math.round(EDITOR_LAYOUT.timelineClipLabelRowHeight)
      : 1
  const boxHeight = usesCompactTopBox
    ? Math.round(EDITOR_LAYOUT.timelineClipLabelRowHeight * 2)
    : null

  const boxAccentClass = usesCompactTopBox
    ? cn(
        'border-white/85 bg-transparent shadow-[0_0_0_1px_rgba(248,250,252,0.24),0_8px_20px_rgba(15,23,42,0.16)]',
        visual.constrained &&
          'border-white/95 shadow-[0_0_0_1px_rgba(255,255,255,0.36),0_0_14px_rgba(255,255,255,0.14),0_8px_20px_rgba(15,23,42,0.16)]',
      )
    : usesSlipBodyBox
      ? cn(
          'border-white/85 bg-transparent shadow-[0_0_0_1px_rgba(248,250,252,0.24),0_10px_24px_rgba(15,23,42,0.18)]',
          visual.constrained &&
            'border-white/95 shadow-[0_0_0_1px_rgba(255,255,255,0.36),0_0_14px_rgba(255,255,255,0.14),0_10px_24px_rgba(15,23,42,0.18)]',
        )
      : usesFilledBoundsBox
        ? 'border-white/80 bg-white/[0.035] shadow-[0_0_0_1px_rgba(15,23,42,0.45),0_10px_24px_rgba(15,23,42,0.18)]'
        : 'border-white/80 bg-white/[0.035] shadow-[0_0_0_1px_rgba(15,23,42,0.45),0_10px_24px_rgba(15,23,42,0.18)]'

  return (
    <>
      {showBoundsBox && (
        <div
          data-testid="tool-operation-bounds-box"
          className={cn('absolute pointer-events-none z-[1] rounded-[6px] border', boxAccentClass)}
          style={{
            left: `${visual.boxLeftPx}px`,
            width: `${visual.boxWidthPx}px`,
            top: boxTop,
            ...(boxHeight === null ? { bottom: 1 } : { height: boxHeight }),
          }}
        />
      )}
    </>
  )
})
