import { memo, useEffect, useRef, useState, type RefObject } from 'react'
import { FloatingReadout } from './floating-readout'

const AUDIO_VOLUME_HOVER_ARM_DELAY_MS = 180

interface AudioVolumeControlProps {
  trackLocked: boolean
  activeTool: string
  lineYPercent: number
  isEditing: boolean
  editLabel?: string | null
  editLabelRef?: RefObject<HTMLElement | null>
  onVolumeMouseDown: (e: React.MouseEvent) => void
  onVolumeDoubleClick: () => void
}

export const AudioVolumeControl = memo(function AudioVolumeControl({
  trackLocked,
  activeTool,
  lineYPercent,
  isEditing,
  editLabel,
  editLabelRef,
  onVolumeMouseDown,
  onVolumeDoubleClick,
}: AudioVolumeControlProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isHoverArmed, setIsHoverArmed] = useState(false)
  const volumeHandleRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (isEditing) {
      setIsHoverArmed(true)
      return
    }

    if (!isHovered) {
      setIsHoverArmed(false)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setIsHoverArmed(true)
    }, AUDIO_VOLUME_HOVER_ARM_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [isEditing, isHovered])

  const isDragEnabled = isEditing || isHoverArmed

  if (trackLocked || activeTool !== 'select') {
    return null
  }

  return (
    <div className="absolute inset-x-0 inset-y-0 pointer-events-none z-30">
      <button
        ref={volumeHandleRef}
        type="button"
        className={`absolute left-0 right-0 h-2 -translate-y-1/2 pointer-events-auto touch-none ${isDragEnabled ? 'cursor-ns-resize' : 'cursor-default'}`}
        style={{ top: `var(--timeline-audio-volume-line-y, ${lineYPercent}%)` }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={(e) => {
          if (!isDragEnabled) {
            return
          }
          e.preventDefault()
          e.stopPropagation()
        }}
        onMouseDown={(e) => {
          if (!isDragEnabled) {
            return
          }

          e.preventDefault()
          e.stopPropagation()
          onVolumeMouseDown(e)
        }}
        onDoubleClick={(e) => {
          e.preventDefault()
          e.stopPropagation()

          if (isDragEnabled) {
            onVolumeDoubleClick()
          }
        }}
        tabIndex={-1}
        aria-label="Adjust clip volume"
      />

      {isEditing && editLabel && (
        <FloatingReadout
          anchorRef={volumeHandleRef}
          measureKey={`${lineYPercent}:${editLabel}`}
          offsetY={6}
        >
          <span ref={editLabelRef}>{editLabel}</span>
        </FloatingReadout>
      )}
    </div>
  )
})
