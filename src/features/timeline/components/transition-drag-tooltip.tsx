import { memo } from 'react'
import { createPortal } from 'react-dom'
import { useTransitionDragStore } from '@/shared/state/transition-drag'

export const TransitionDragTooltip = memo(function TransitionDragTooltip() {
  const invalidHint = useTransitionDragStore((s) => s.invalidHint)

  if (!invalidHint) return null

  return createPortal(
    <div
      className="pointer-events-none"
      style={{
        position: 'fixed',
        left: invalidHint.x,
        top: invalidHint.y - 12,
        transform: 'translate(-50%, -100%)',
        zIndex: 10000,
      }}
    >
      <div className="max-w-[220px] rounded-md border border-slate-200/70 bg-slate-900/92 px-2.5 py-1.5 text-[11px] font-medium text-slate-50 shadow-xl backdrop-blur-sm">
        {invalidHint.message}
      </div>
    </div>,
    document.body,
  )
})
