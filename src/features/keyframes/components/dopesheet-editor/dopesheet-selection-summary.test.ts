import { describe, expect, it } from 'vitest'
import type { AnimatableProperty, Keyframe } from '@/types/keyframe'
import type { KeyframeMeta } from './dopesheet-types'
import {
  buildSelectedFrameSummary,
  collectSelectedFrames,
} from './dopesheet-selection-summary'

function meta(property: string, frame: number): KeyframeMeta {
  const keyframe = { id: `${property}-${frame}`, frame } as Keyframe
  return { property: property as AnimatableProperty, keyframe }
}

function summarize(
  ids: string[],
  metaById: Map<string, KeyframeMeta>,
  globalFrame: number | null,
  currentFrame: number,
) {
  return buildSelectedFrameSummary(
    collectSelectedFrames(new Set(ids), metaById),
    globalFrame,
    currentFrame,
  )
}

describe('dopesheet selection summary', () => {
  const sheet = new Map<string, KeyframeMeta>([
    ['x-4', meta('x', 4)],
    ['y-4', meta('y', 4)],
    ['y-9', meta('y', 9)],
  ])

  it('reports no frame for an empty selection', () => {
    expect(summarize([], sheet, 10, 4)).toEqual({
      hasSelection: false,
      hasMixedFrames: false,
      localFrame: null,
      globalFrame: null,
    })
  })

  it('ignores selected ids the sheet no longer renders', () => {
    expect(summarize(['ghost'], sheet, 10, 4)).toEqual({
      hasSelection: false,
      hasMixedFrames: false,
      localFrame: null,
      globalFrame: null,
    })
  })

  it('reads a single frame locally and globally', () => {
    expect(summarize(['x-4'], sheet, 10, 4)).toEqual({
      hasSelection: true,
      hasMixedFrames: false,
      localFrame: 4,
      globalFrame: 10,
    })
  })

  it('keeps a shared frame across properties and applies a negative offset', () => {
    expect(summarize(['x-4', 'y-4'], sheet, 0, 4)).toEqual({
      hasSelection: true,
      hasMixedFrames: false,
      localFrame: 4,
      globalFrame: 0,
    })
  })

  it('withholds the global frame when the editor does not know the offset', () => {
    expect(summarize(['x-4'], sheet, null, 4)).toEqual({
      hasSelection: true,
      hasMixedFrames: false,
      localFrame: 4,
      globalFrame: null,
    })
  })

  it('reports no frame when the selection spans several frames', () => {
    expect(summarize(['x-4', 'y-9'], sheet, 10, 4)).toEqual({
      hasSelection: true,
      hasMixedFrames: true,
      localFrame: null,
      globalFrame: null,
    })
  })
})
