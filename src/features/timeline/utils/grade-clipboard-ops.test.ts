import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { VisualEffect } from '@/types/effects'
import { useGradeClipboardStore } from '@/shared/state/grade-clipboard'
import { seedTimelineWithVideoAndAudioTracks } from '../test-helpers'
import { useItemsStore } from '../stores/items-store'
import { useTimelineCommandStore } from '../stores/timeline-command-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { addEffect } from '../stores/actions/effect-actions'
import { copyGradeFromItem, itemHasColorGrade, pasteGradeToItems } from './grade-clipboard-ops'

function makeColorEffect(amount = 0.5): VisualEffect {
  return { type: 'gpu-effect', gpuEffectType: 'gpu-brightness', params: { amount } }
}

function makeNonColorEffect(): VisualEffect {
  return { type: 'gpu-effect', gpuEffectType: 'gpu-gaussian-blur', params: { radius: 4 } }
}

function getEffects(itemId: string) {
  const item = useItemsStore.getState().itemById[itemId]
  expect(item).toBeDefined()
  return (
    (item as { effects?: Array<{ id: string; effect: VisualEffect; enabled: boolean }> }).effects ??
    []
  )
}

describe('grade clipboard ops', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useGradeClipboardStore.setState({ grade: null })
    seedTimelineWithVideoAndAudioTracks({
      firstVideoId: 'source',
      secondVideoId: 'target',
      audioId: 'audio-1',
    })
  })

  it('itemHasColorGrade detects color-category effects only', () => {
    expect(itemHasColorGrade(useItemsStore.getState().itemById.source)).toBe(false)

    addEffect('source', makeNonColorEffect())
    expect(itemHasColorGrade(useItemsStore.getState().itemById.source)).toBe(false)

    addEffect('source', makeColorEffect())
    expect(itemHasColorGrade(useItemsStore.getState().itemById.source)).toBe(true)
  })

  it('copies only color effects and pastes them with fresh ids', () => {
    addEffect('source', makeNonColorEffect())
    addEffect('source', makeColorEffect(0.7))

    expect(copyGradeFromItem('source')).toBe(true)
    expect(useGradeClipboardStore.getState().grade).toHaveLength(1)

    expect(pasteGradeToItems(['target'])).toBe(true)
    const targetEffects = getEffects('target')
    expect(targetEffects).toHaveLength(1)
    expect(targetEffects[0]?.effect).toMatchObject({
      gpuEffectType: 'gpu-brightness',
      params: { amount: 0.7 },
    })
    expect(targetEffects[0]?.id).not.toBe(getEffects('source')[1]?.id)
  })

  it('paste replaces existing color effects but keeps non-color effects', () => {
    addEffect('source', makeColorEffect(0.9))
    addEffect('target', makeColorEffect(0.1))
    addEffect('target', makeNonColorEffect())

    copyGradeFromItem('source')
    pasteGradeToItems(['target'])

    const targetEffects = getEffects('target')
    expect(targetEffects).toHaveLength(2)
    expect(targetEffects[0]?.effect.gpuEffectType).toBe('gpu-gaussian-blur')
    expect(targetEffects[1]?.effect.params.amount).toBe(0.9)
  })

  it('paste is undoable as a single step across items', () => {
    addEffect('source', makeColorEffect())
    copyGradeFromItem('source')

    pasteGradeToItems(['target', 'audio-1'])
    expect(getEffects('target')).toHaveLength(1)
    expect(getEffects('audio-1')).toHaveLength(0)

    useTimelineCommandStore.getState().undo()
    expect(getEffects('target')).toHaveLength(0)
  })

  it('returns false when there is nothing to copy or paste', () => {
    expect(copyGradeFromItem('source')).toBe(false)
    expect(pasteGradeToItems(['target'])).toBe(false)

    addEffect('source', makeNonColorEffect())
    expect(copyGradeFromItem('source')).toBe(false)
  })

  it('pasted params are clones — editing the target does not mutate the clipboard', () => {
    addEffect('source', makeColorEffect(0.4))
    copyGradeFromItem('source')
    pasteGradeToItems(['target'])

    const clipboardGrade = useGradeClipboardStore.getState().grade
    const pasted = getEffects('target')[0]
    expect(pasted?.effect.params).not.toBe(clipboardGrade?.[0]?.params)
  })
})
