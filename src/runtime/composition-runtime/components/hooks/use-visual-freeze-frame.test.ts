import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePlaybackStore } from '@/shared/state/playback'
import { useVisualFreezeFrame } from './use-visual-freeze-frame'

describe('useVisualFreezeFrame', () => {
  beforeEach(() => {
    usePlaybackStore.getState().setCompositionVisualFrozen(false)
  })

  it('passes the live frame through when not frozen', () => {
    const { result, rerender } = renderHook(({ frame }) => useVisualFreezeFrame(frame), {
      initialProps: { frame: 10 },
    })
    expect(result.current).toBe(10)
    rerender({ frame: 25 })
    expect(result.current).toBe(25)
  })

  it('holds the last pre-freeze frame while frozen, then snaps back on unfreeze', () => {
    const { result, rerender } = renderHook(({ frame }) => useVisualFreezeFrame(frame), {
      initialProps: { frame: 100 },
    })
    expect(result.current).toBe(100)

    // Freeze: subsequent live-frame changes must be ignored (occluded by overlay).
    usePlaybackStore.getState().setCompositionVisualFrozen(true)
    rerender({ frame: 130 })
    expect(result.current).toBe(100)
    rerender({ frame: 160 })
    expect(result.current).toBe(100)

    // Unfreeze (e.g. playback paused): snap to the current live frame.
    usePlaybackStore.getState().setCompositionVisualFrozen(false)
    rerender({ frame: 160 })
    expect(result.current).toBe(160)
  })
})
