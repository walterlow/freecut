import { beforeEach, describe, expect, it } from 'vite-plus/test'

import { useNewTrackZonePreviewStore } from './new-track-zone-preview-store'

describe('new-track-zone-preview-store', () => {
  beforeEach(() => {
    useNewTrackZonePreviewStore.getState().clearGhostPreviews()
  })

  it('keeps state identity when clearing an already empty preview', () => {
    const initialState = useNewTrackZonePreviewStore.getState()

    useNewTrackZonePreviewStore.getState().clearGhostPreviews()

    expect(useNewTrackZonePreviewStore.getState()).toBe(initialState)
  })

  it('keeps state identity when setting the same previews again', () => {
    const ghostPreviews = [
      {
        left: 10,
        width: 50,
        label: 'clip-a',
        type: 'video' as const,
        targetZone: 'video' as const,
      },
      {
        left: 10,
        width: 50,
        label: 'clip-a',
        type: 'audio' as const,
        targetZone: 'audio' as const,
      },
    ]

    useNewTrackZonePreviewStore.getState().setGhostPreviews(ghostPreviews)
    const firstState = useNewTrackZonePreviewStore.getState()

    useNewTrackZonePreviewStore.getState().setGhostPreviews([...ghostPreviews])

    expect(useNewTrackZonePreviewStore.getState()).toBe(firstState)
  })

  it('reuses unchanged per-zone preview arrays across updates', () => {
    useNewTrackZonePreviewStore.getState().setGhostPreviews([
      { left: 10, width: 50, label: 'clip-a', type: 'video', targetZone: 'video' },
      { left: 10, width: 50, label: 'clip-a', type: 'audio', targetZone: 'audio' },
    ])

    const firstVideoPreviews = useNewTrackZonePreviewStore.getState().ghostPreviewsByZone.video

    useNewTrackZonePreviewStore.getState().setGhostPreviews([
      { left: 10, width: 50, label: 'clip-a', type: 'video', targetZone: 'video' },
      { left: 18, width: 50, label: 'clip-a', type: 'audio', targetZone: 'audio' },
    ])

    expect(useNewTrackZonePreviewStore.getState().ghostPreviewsByZone.video).toBe(
      firstVideoPreviews,
    )
  })
})
