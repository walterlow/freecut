import { resolvePlaybackDomVideoElement } from './use-preview-render-pump-controller'

describe('resolvePlaybackDomVideoElement', () => {
  it('prefers pinned transition videos over registered playback videos', () => {
    const pinned = document.createElement('video')
    const registered = document.createElement('video')

    const result = resolvePlaybackDomVideoElement(
      'clip-1',
      () => pinned,
      () => registered,
    )

    expect(result).toBe(pinned)
  })

  it('falls back to the registered playback video for normal clips', () => {
    const registered = document.createElement('video')

    const result = resolvePlaybackDomVideoElement(
      'clip-1',
      () => null,
      () => registered,
    )

    expect(result).toBe(registered)
  })
})
