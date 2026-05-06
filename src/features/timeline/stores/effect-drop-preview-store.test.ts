import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useEffectDropPreviewStore } from './effect-drop-preview-store'

describe('effect-drop-preview-store', () => {
  beforeEach(() => {
    useEffectDropPreviewStore.getState().clearPreview()
  })

  it('keeps state identity when clearing an already empty preview', () => {
    const initialState = useEffectDropPreviewStore.getState()

    useEffectDropPreviewStore.getState().clearPreview()

    expect(useEffectDropPreviewStore.getState()).toBe(initialState)
  })

  it('keeps state identity when setting the same preview again', () => {
    useEffectDropPreviewStore.getState().setPreview(['item-1', 'item-2'], 'item-1')
    const firstState = useEffectDropPreviewStore.getState()

    useEffectDropPreviewStore.getState().setPreview(['item-1', 'item-2'], 'item-1')

    expect(useEffectDropPreviewStore.getState()).toBe(firstState)
  })
})
