import { useState, useEffect, useRef, useCallback } from 'react'
import { getResolvedPlaybackFrame, usePlaybackStore } from '@/shared/state/playback'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import { formatTimecodeCompact } from '@/shared/utils/time-utils'

interface TimecodeDisplayProps {
  fps: number
  totalFrames: number
}

/**
 * Timecode Display Component
 *
 * Displays current time and total duration in SMPTE format (HH:MM:SS:FF)
 * - Click to toggle between SMPTE timecode and frame numbers
 * - Synchronized with playback store via manual subscription (no re-renders during playback)
 * - Tabular numbers for consistent width
 * - Primary color for current time
 */
export function TimecodeDisplay({ fps, totalFrames }: TimecodeDisplayProps) {
  const [showFrames, setShowFrames] = useState(false)
  const currentTimeRef = useRef<HTMLSpanElement>(null)
  const frameDigits = Math.max(totalFrames.toString().length, 1)
  const reservedCharWidth = Math.max(frameDigits, 8)
  const lastFrame = Math.max(0, totalFrames - 1)
  const reservedDisplayWidth = `calc(${reservedCharWidth * 2 + 1}ch + 0.75rem)`

  // Use refs for values accessed in subscription to avoid stale closures
  const showFramesRef = useRef(showFrames)
  showFramesRef.current = showFrames
  const fpsRef = useRef(fps)
  fpsRef.current = fps
  const totalFramesRef = useRef(totalFrames)
  totalFramesRef.current = totalFrames

  // Format frame number with padding based on total frames to prevent layout shift
  const formatFrameNumber = useCallback((frame: number) => {
    const maxDigits = Math.max(totalFramesRef.current.toString().length, 1)
    return frame.toString().padStart(maxDigits, '0')
  }, [])

  const getVisibleFrame = useCallback(() => {
    const playbackState = usePlaybackStore.getState()
    return getResolvedPlaybackFrame({
      currentFrame: playbackState.currentFrame,
      currentFrameEpoch: playbackState.currentFrameEpoch,
      previewFrame: playbackState.previewFrame,
      previewFrameEpoch: playbackState.previewFrameEpoch,
      isPlaying: playbackState.isPlaying,
      displayedFrame: usePreviewBridgeStore.getState().displayedFrame,
    })
  }, [])

  // Subscribe to the resolved visible preview frame and update DOM directly
  // (no React re-renders during playback/scrub).
  useEffect(() => {
    const updateDisplay = (frame: number) => {
      if (!currentTimeRef.current) return
      currentTimeRef.current.textContent = showFramesRef.current
        ? formatFrameNumber(frame)
        : formatTimecodeCompact(frame, fpsRef.current)
    }

    // Initial update
    updateDisplay(getVisibleFrame())

    const syncDisplay = () => {
      updateDisplay(getVisibleFrame())
    }

    const unsubscribePlayback = usePlaybackStore.subscribe(syncDisplay)
    const unsubscribePreviewBridge = usePreviewBridgeStore.subscribe(syncDisplay)

    return () => {
      unsubscribePlayback()
      unsubscribePreviewBridge()
    }
  }, [formatFrameNumber, getVisibleFrame])

  // Update display when showFrames or fps changes (rare - can trigger re-render)
  useEffect(() => {
    if (!currentTimeRef.current) return
    const frame = getVisibleFrame()
    currentTimeRef.current.textContent = showFrames
      ? formatFrameNumber(frame)
      : formatTimecodeCompact(frame, fps)
  }, [showFrames, fps, formatFrameNumber, getVisibleFrame])

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 bg-transparent p-0 font-mono text-[11px] tabular-nums text-left transition-colors select-none text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
      style={{ width: reservedDisplayWidth }}
      onClick={() => setShowFrames((prev) => !prev)}
    >
      <span ref={currentTimeRef} className="text-primary font-semibold">
        {showFrames
          ? formatFrameNumber(getVisibleFrame())
          : formatTimecodeCompact(getVisibleFrame(), fps)}
      </span>
      <span className="text-muted-foreground/50">/</span>
      <span>
        {showFrames ? formatFrameNumber(lastFrame) : formatTimecodeCompact(lastFrame, fps)}
      </span>
    </button>
  )
}
