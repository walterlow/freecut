import { memo } from 'react'
import { cn } from '@/shared/ui/cn'

interface StretchHandlesProps {
  trackLocked: boolean
  isAnyDragActive: boolean
  isStretching: boolean
  stretchHandle: 'start' | 'end' | null
  stretchConstrained: boolean
  isRateStretchItem: boolean
  onStretchStart: (e: React.MouseEvent, handle: 'start' | 'end') => void
}

/**
 * Rate stretch handles for media items
 * Renders left and right stretch handles for adjusting playback speed
 */
export const StretchHandles = memo(function StretchHandles({
  trackLocked,
  isAnyDragActive,
  isStretching,
  stretchHandle,
  stretchConstrained,
  isRateStretchItem,
  onStretchStart,
}: StretchHandlesProps) {
  const showLeftHandle =
    !trackLocked &&
    (!isAnyDragActive || isStretching) &&
    isRateStretchItem &&
    isStretching &&
    stretchHandle === 'start'

  const showRightHandle =
    !trackLocked &&
    (!isAnyDragActive || isStretching) &&
    isRateStretchItem &&
    isStretching &&
    stretchHandle === 'end'

  return (
    <>
      {/* Left stretch handle - wider hit area, thin visible indicator */}
      <div
        className={cn(
          'absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize transition-opacity duration-75',
          showLeftHandle ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        onMouseDown={(e) => onStretchStart(e, 'start')}
      >
        <div
          className={cn(
            'absolute inset-y-0 left-0 w-px rounded-l-sm bg-orange-400/85 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]',
            isStretching && stretchHandle === 'start' && 'opacity-0',
            stretchConstrained &&
              stretchHandle === 'start' &&
              'bg-red-300/95 shadow-[0_0_0_1px_rgba(252,165,165,0.35)]',
          )}
        />
      </div>

      {/* Right stretch handle - wider hit area, thin visible indicator */}
      <div
        className={cn(
          'absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize transition-opacity duration-75',
          showRightHandle ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        onMouseDown={(e) => onStretchStart(e, 'end')}
      >
        <div
          className={cn(
            'absolute inset-y-0 right-0 w-px rounded-r-sm bg-orange-400/85 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]',
            isStretching && stretchHandle === 'end' && 'opacity-0',
            stretchConstrained &&
              stretchHandle === 'end' &&
              'bg-red-300/95 shadow-[0_0_0_1px_rgba(252,165,165,0.35)]',
          )}
        />
      </div>
    </>
  )
})
