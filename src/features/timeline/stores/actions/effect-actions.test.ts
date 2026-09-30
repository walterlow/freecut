// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { VisualEffect } from '@/types/effects'
import { makeTimelineAudioItem, makeTimelineTrack, makeTimelineVideoItem } from '../../test-helpers'
import { useItemsStore } from '../items-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import {
  addEffect,
  addEffects,
  clearEffects,
  removeEffect,
  toggleEffect,
  updateEffect,
} from './effect-actions'

function makeBrightness(value = 0.5): VisualEffect {
  return { type: 'gpu-effect', gpuEffectType: 'gpu-brightness', params: { brightness: value } }
}

function getEffects(itemId: string) {
  const item = useItemsStore.getState().itemById[itemId]
  expect(item).toBeDefined()
  return (
    (item as { effects?: Array<{ id: string; effect: VisualEffect; enabled: boolean }> }).effects ??
    []
  )
}

describe('effect actions', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useItemsStore
      .getState()
      .setTracks([
        makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
        makeTimelineTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 1 }),
      ])
    useItemsStore
      .getState()
      .setItems([
        makeTimelineVideoItem({ id: 'a' }),
        makeTimelineVideoItem({ id: 'b', from: 60 }),
        makeTimelineAudioItem({ id: 'audio-1' }),
      ])
  })

  it('addEffect appends an enabled effect instance with a generated id', () => {
    addEffect('a', makeBrightness())

    const effects = getEffects('a')
    expect(effects).toHaveLength(1)
    expect(effects[0]).toMatchObject({
      enabled: true,
      effect: { gpuEffectType: 'gpu-brightness' },
    })
    expect(effects[0]?.id).toBeTruthy()
    expect(useTimelineSettingsStore.getState().isDirty).toBe(true)
  })

  it('addEffects applies to multiple items but skips audio items', () => {
    addEffects([
      { itemId: 'a', effects: [makeBrightness()] },
      { itemId: 'b', effects: [makeBrightness(), makeBrightness(0.8)] },
      { itemId: 'audio-1', effects: [makeBrightness()] },
    ])

    expect(getEffects('a')).toHaveLength(1)
    expect(getEffects('b')).toHaveLength(2)
    expect(getEffects('audio-1')).toHaveLength(0)
  })

  it('updateEffect replaces effect params', () => {
    addEffect('a', makeBrightness(0.5))
    const effectId = getEffects('a')[0]!.id

    updateEffect('a', effectId, { effect: makeBrightness(0.9) })

    expect(getEffects('a')[0]?.effect.params.brightness).toBe(0.9)
  })

  it('toggleEffect flips enabled and removeEffect deletes', () => {
    addEffect('a', makeBrightness())
    const effectId = getEffects('a')[0]!.id

    toggleEffect('a', effectId)
    expect(getEffects('a')[0]?.enabled).toBe(false)
    toggleEffect('a', effectId)
    expect(getEffects('a')[0]?.enabled).toBe(true)

    removeEffect('a', effectId)
    expect(getEffects('a')).toHaveLength(0)
  })

  it('clearEffects removes all effects and supports undo', () => {
    addEffect('a', makeBrightness(0.3))
    addEffect('a', makeBrightness(0.7))
    expect(getEffects('a')).toHaveLength(2)

    clearEffects('a')
    expect(getEffects('a')).toHaveLength(0)

    useTimelineCommandStore.getState().undo()
    expect(getEffects('a')).toHaveLength(2)
  })

  it('undo restores the pre-add state', () => {
    addEffect('a', makeBrightness())
    expect(getEffects('a')).toHaveLength(1)

    useTimelineCommandStore.getState().undo()
    expect(getEffects('a')).toHaveLength(0)
  })
})
