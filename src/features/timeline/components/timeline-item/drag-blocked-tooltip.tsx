import { memo } from 'react'
import { createPortal } from 'react-dom'

interface DragBlockedTooltipProps {
  hint: { x: number; y: number; message: string; tone?: 'warning' | 'danger' } | null
}

/**
 * Tooltip shown when trying to drag in rate-stretch mode
 */
export const DragBlockedTooltip = memo(function DragBlockedTooltip({
  hint,
}: DragBlockedTooltipProps) {
  if (!hint) return null

  return createPortal(
    <div
      className="pointer-events-none"
      style={{
        position: 'fixed',
        left: hint.x,
        top: hint.y - 8,
        transform: 'translate(-50%, -100%)',
        zIndex: 9999,
      }}
    >
      <div
        className={[
          'overflow-hidden rounded-md px-3 py-1.5 text-xs text-white shadow-lg',
          hint.tone === 'danger' ? 'bg-red-500' : 'bg-orange-500',
        ].join(' ')}
      >
        {hint.message}
      </div>
    </div>,
    document.body,
  )
})
