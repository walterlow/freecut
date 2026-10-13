import { useCallback, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { TFunction } from 'i18next'
import { usePlaybackStore } from '@/shared/state/playback'
import type { CanvasSettings, TransformParentingBehavior } from '@/types/transform'
import {
  setTransformParents,
  useItemsStore,
  useKeyframesStore,
} from '@/features/editor/deps/timeline-motion'
import {
  useMotionPickWhipDrag,
  type MotionPickWhipModifiers,
  type MotionPickWhipTarget,
} from '@/shared/hooks/use-pick-whip-drag'
import {
  getTransformParentRejection,
  getTransformParentRejectionMessage,
} from './transform-parent-validation'

interface ParentOrigin {
  childItemId: string
}

interface ParentCandidate {
  parentItemId: string
}

function evaluateParentTarget(
  clientX: number,
  clientY: number,
  origin: ParentOrigin,
  t: TFunction,
): MotionPickWhipTarget<ParentCandidate> {
  const element = document.elementFromPoint(clientX, clientY)
  const row = element?.closest<HTMLElement>('[data-motion-layer-item-id]')
  const parentItemId = row?.dataset.motionLayerItemId
  if (!row || !parentItemId) return null

  const rejection = getTransformParentRejection({
    childItemId: origin.childItemId,
    parentItemId,
    itemById: useItemsStore.getState().itemById,
    keyframesByItemId: useKeyframesStore.getState().keyframesByItemId,
  })
  if (rejection) {
    return {
      status: 'invalid',
      row,
      message: getTransformParentRejectionMessage(t, rejection),
    }
  }
  return { status: 'valid', row, value: { parentItemId } }
}

function getParentingBehavior(
  modifiers: Pick<MotionPickWhipModifiers, 'shiftKey' | 'altKey'>,
): TransformParentingBehavior {
  if (modifiers.shiftKey) return 'snap-to-parent'
  if (modifiers.altKey) return 'restore-local'
  return 'preserve-world'
}

export function useTransformParentPickWhip(canvas: CanvasSettings) {
  const { t } = useTranslation()
  const applyParent = useCallback(
    (
      childItemId: string,
      parentItemId: string | undefined,
      behavior: TransformParentingBehavior,
    ) => {
      const playback = usePlaybackStore.getState()
      setTransformParents({
        childItemIds: [childItemId],
        parentItemId,
        behavior,
        frame: playback.previewFrame ?? playback.currentFrame,
        canvas,
      })
    },
    [canvas],
  )
  const commit = useCallback(
    (origin: ParentOrigin, candidate: ParentCandidate, modifiers: MotionPickWhipModifiers) => {
      applyParent(origin.childItemId, candidate.parentItemId, getParentingBehavior(modifiers))
    },
    [applyParent],
  )
  const resolveTarget = useCallback(
    (clientX: number, clientY: number, origin: ParentOrigin) =>
      evaluateParentTarget(clientX, clientY, origin, t),
    [t],
  )
  const reject = useCallback((_origin: ParentOrigin, message: string) => {
    toast.error(message)
  }, [])
  const { drag: genericDrag, begin: beginDrag } = useMotionPickWhipDrag({
    hoverAttribute: 'data-transform-parent-link-hover',
    rejectionHoverAttribute: 'data-transform-parent-link-rejected',
    resolveTarget,
    onCommit: commit,
    onReject: reject,
  })

  const begin = useCallback(
    (
      event: ReactPointerEvent<HTMLButtonElement>,
      childItemId: string,
      currentParentItemId: string | undefined,
    ) => {
      if (event.button !== 0) return
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        if (currentParentItemId) {
          applyParent(childItemId, undefined, event.altKey ? 'restore-local' : 'preserve-world')
        }
        return
      }
      beginDrag(event, { childItemId })
    },
    [applyParent, beginDrag],
  )
  const drag = genericDrag
    ? {
        startX: genericDrag.startX,
        startY: genericDrag.startY,
        currentX: genericDrag.currentX,
        currentY: genericDrag.currentY,
        sourceItemId: genericDrag.candidate?.value.parentItemId ?? null,
        clipBounds: genericDrag.clipBounds,
        presentation: genericDrag.presentation,
      }
    : null

  return { drag, begin }
}
