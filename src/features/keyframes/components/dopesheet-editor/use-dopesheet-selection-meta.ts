/**
 * Dopesheet selection metadata.
 * One render-time pass over the frame-independent sheet structure builds the
 * keyframe meta map; the selection summaries and the KeyframeRef list the
 * action layer needs are derived from it. The meta map is mirrored into a ref
 * so drag handlers can read the latest meta without subscribing to it.
 *
 * The follow-up effect that pushes the selected curve onto the active graph
 * property deliberately stays in the editor: it is the editor's
 * selection→active-property contract and must keep its place in the
 * passive-effect order.
 */

import { useMemo, useRef, type RefObject } from 'react'
import type { AnimatableProperty, Keyframe, KeyframeRef } from '@/types/keyframe'
import type { KeyframeMeta } from './dopesheet-types'
import {
  buildSelectedFrameSummary,
  collectSelectedFrames,
  type DopesheetSelectedFrameSummary,
} from './dopesheet-selection-summary'

export interface UseDopesheetSelectionMetaOptions {
  sheetRowsStructure: readonly { property: AnimatableProperty; keyframes: Keyframe[] }[]
  selectedKeyframeIds: Set<string>
  currentFrame: number
  globalFrame: number | null
  isPropertyLocked: (property: AnimatableProperty) => boolean
  itemId: string
}

export interface UseDopesheetSelectionMetaReturn {
  keyframeMetaById: Map<string, KeyframeMeta>
  keyframeMetaByIdRef: RefObject<Map<string, KeyframeMeta>>
  selectedFrameSummary: DopesheetSelectedFrameSummary
  selectedCurveProperty: AnimatableProperty | null
  selectedRefs: KeyframeRef[]
  selectedRefIds: string[]
}

export function useDopesheetSelectionMeta({
  sheetRowsStructure,
  selectedKeyframeIds,
  currentFrame,
  globalFrame,
  isPropertyLocked,
  itemId,
}: UseDopesheetSelectionMetaOptions): UseDopesheetSelectionMetaReturn {
  const keyframeMetaById = useMemo(() => {
    const map = new Map<string, KeyframeMeta>()
    for (const row of sheetRowsStructure) {
      for (const keyframe of row.keyframes) {
        map.set(keyframe.id, { property: row.property, keyframe })
      }
    }
    return map
  }, [sheetRowsStructure])

  const keyframeMetaByIdRef = useRef(keyframeMetaById)
  keyframeMetaByIdRef.current = keyframeMetaById

  const selectedFrameSummary = useMemo(
    () =>
      buildSelectedFrameSummary(
        collectSelectedFrames(selectedKeyframeIds, keyframeMetaById),
        globalFrame,
        currentFrame,
      ),
    [currentFrame, globalFrame, keyframeMetaById, selectedKeyframeIds],
  )
  const selectedCurveProperty = useMemo(() => {
    let property: AnimatableProperty | null = null

    for (const keyframeId of selectedKeyframeIds) {
      const meta = keyframeMetaById.get(keyframeId)
      if (!meta) {
        continue
      }

      if (property === null) {
        property = meta.property
        continue
      }

      if (property !== meta.property) {
        return null
      }
    }

    return property
  }, [keyframeMetaById, selectedKeyframeIds])
  const selectedRefs = useMemo(() => {
    const refs: KeyframeRef[] = []
    for (const keyframeId of selectedKeyframeIds) {
      const meta = keyframeMetaById.get(keyframeId)
      if (!meta) continue
      if (isPropertyLocked(meta.property)) continue
      refs.push({
        itemId,
        property: meta.property,
        keyframeId,
      })
    }
    return refs
  }, [selectedKeyframeIds, keyframeMetaById, isPropertyLocked, itemId])
  const selectedRefIds = useMemo(() => selectedRefs.map((ref) => ref.keyframeId), [selectedRefs])

  return {
    keyframeMetaById,
    keyframeMetaByIdRef,
    selectedFrameSummary,
    selectedCurveProperty,
    selectedRefs,
    selectedRefIds,
  }
}
