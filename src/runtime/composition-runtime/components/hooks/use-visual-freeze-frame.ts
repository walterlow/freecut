import { useRef } from 'react'
import { usePlaybackStore } from '@/runtime/composition-runtime/deps/stores'

/**
 * Returns the frame the DOM composition tree should use for *visual* derivation
 * (transforms, masks, text layout, fades).
 *
 * During overlay playback the GPU fast-scrub overlay composites the actual
 * frames on top of the (now occluded) DOM composition. Re-deriving per-item
 * visual styles on every clock tick is wasted work behind the overlay, so while
 * `compositionVisualFrozen` is set we hold the last frame seen before the freeze
 * began. Callers must feed the returned value into their visual memos *and* use
 * it as the memo dependency, so a frozen frame keeps those memos cached.
 *
 * Mount/visibility and video element sync intentionally keep reading the live
 * sequence frame elsewhere — only the occluded visual styling is frozen here.
 *
 * On unfreeze (playback stop), the held value snaps back to the live frame and
 * the visual memos recompute once to land on the exact paused frame.
 */
export function useVisualFreezeFrame(liveFrame: number): number {
  const frozen = usePlaybackStore((s) => s.compositionVisualFrozen)
  const heldFrameRef = useRef(liveFrame)
  // Track the live frame whenever we're not frozen so the freeze always starts
  // from the most recent frame. Writing a ref during render is safe here: it is
  // a pure function of the current value and has no effect when frozen.
  if (!frozen) {
    heldFrameRef.current = liveFrame
  }
  return frozen ? heldFrameRef.current : liveFrame
}
