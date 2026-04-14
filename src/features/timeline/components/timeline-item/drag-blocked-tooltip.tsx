import { memo } from 'react';
import { createPortal } from 'react-dom';

interface DragBlockedTooltipProps {
  position: { x: number; y: number } | null;
}

/**
 * Tooltip shown when trying to drag in rate-stretch mode
 */
export const DragBlockedTooltip = memo(function DragBlockedTooltip({
  position,
}: DragBlockedTooltipProps) {
  if (!position) return null;

  return createPortal(
    <div
      className="pointer-events-none"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y - 8,
        transform: 'translate(-50%, -100%)',
        zIndex: 9999,
      }}
    >
      <div className="overflow-hidden rounded-md bg-[#EC407A] px-3 py-1.5 text-xs text-white shadow-lg">
        Can't move clips in rate stretch mode
      </div>
    </div>,
    document.body
  );
});
