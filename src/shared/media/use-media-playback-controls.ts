import { useCallback, type RefObject } from 'react'

export function useMediaPlaybackControls<T extends HTMLMediaElement>(
  mediaRef: RefObject<T | null>,
  duration: number,
  setCurrentTime: (time: number) => void,
) {
  const togglePlay = useCallback(() => {
    const el = mediaRef.current
    if (!el) return
    if (el.paused) {
      void el.play()
    } else {
      el.pause()
    }
  }, [mediaRef])

  const seekToPercent = useCallback(
    (values: number[]) => {
      const el = mediaRef.current
      if (!el || !duration) return
      const time = ((values[0] ?? 0) / 100) * duration
      el.currentTime = time
      setCurrentTime(time)
    },
    [duration, mediaRef, setCurrentTime],
  )

  return { togglePlay, seekToPercent }
}
