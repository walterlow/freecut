import { useCallback } from 'react'
import { useTimelineStore } from '@/runtime/composition-runtime/deps/stores'
import { useItemKeyframesFromContext } from '../../contexts/keyframes-context'

export function useRuntimeItemKeyframes(itemId: string) {
  const contextKeyframes = useItemKeyframesFromContext(itemId)
  const storeKeyframes = useTimelineStore(
    useCallback(
      (state) => state.keyframes.find((keyframes) => keyframes.itemId === itemId),
      [itemId],
    ),
  )

  return contextKeyframes ?? storeKeyframes
}
