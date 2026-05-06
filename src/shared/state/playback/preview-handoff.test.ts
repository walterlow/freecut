import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { usePlaybackStore } from './store'
import { commitPreviewFrameToCurrentFrame } from './preview-handoff'

describe('commitPreviewFrameToCurrentFrame', () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      currentFrame: 12,
      currentFrameEpoch: 0,
      isPlaying: false,
      playbackRate: 1,
      loop: false,
      volume: 1,
      muted: false,
      masterBusDb: 0,
      busAudioEq: undefined,
      zoom: -1,
      previewFrame: null,
      previewFrameEpoch: 0,
      frameUpdateEpoch: 0,
      previewItemId: null,
      useProxy: true,
      previewQuality: 1,
    })
  })

  it('promotes the active preview frame before clearing it', () => {
    usePlaybackStore.getState().setPreviewFrame(48, 'item-1')

    commitPreviewFrameToCurrentFrame()

    const state = usePlaybackStore.getState()
    expect(state.currentFrame).toBe(48)
    expect(state.previewFrame).toBeNull()
    expect(state.previewItemId).toBeNull()
  })

  it('does nothing when there is no active preview frame', () => {
    commitPreviewFrameToCurrentFrame()

    const state = usePlaybackStore.getState()
    expect(state.currentFrame).toBe(12)
    expect(state.previewFrame).toBeNull()
  })
})
