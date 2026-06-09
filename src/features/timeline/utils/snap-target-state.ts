import type { MutableRefObject } from 'react'
import type { SnapTarget } from '../types/drag'

type SnapTargetSnapshot = { frame: number; type: string } | null

export function setActiveSnapTargetIfChanged({
  previousRef,
  snapTarget,
  setActiveSnapTarget,
}: {
  previousRef: MutableRefObject<SnapTargetSnapshot>
  snapTarget: SnapTarget | null
  setActiveSnapTarget: (snapTarget: SnapTarget | null) => void
}): void {
  const previous = previousRef.current
  const changed =
    (previous === null && snapTarget !== null) ||
    (previous !== null && snapTarget === null) ||
    (previous !== null &&
      snapTarget !== null &&
      (previous.frame !== snapTarget.frame || previous.type !== snapTarget.type))

  if (!changed) return

  previousRef.current = snapTarget ? { frame: snapTarget.frame, type: snapTarget.type } : null
  setActiveSnapTarget(snapTarget)
}
