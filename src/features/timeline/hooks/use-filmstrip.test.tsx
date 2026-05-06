import { createElement } from 'react'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const filmstripCacheMocks = vi.hoisted(() => ({
  getFromCacheSync: vi.fn(() => null),
  subscribe: vi.fn(() => vi.fn()),
  needsPriorityRefinement: vi.fn(() => false),
  getFilmstrip: vi.fn(() => new Promise<never>(() => {})),
  abort: vi.fn(),
}))

vi.mock('../services/filmstrip-cache', () => ({
  filmstripCache: filmstripCacheMocks,
}))

vi.mock('./preview-work-budget', () => ({
  getPreviewStartupDelayMs: vi.fn(() => 0),
  schedulePreviewWork: vi.fn((task: () => void) => {
    task()
    return () => {}
  }),
}))

import { useFilmstrip } from './use-filmstrip'
import { schedulePreviewWork } from './preview-work-budget'

function FilmstripProbe({ mediaId, isVisible }: { mediaId: string; isVisible: boolean }) {
  useFilmstrip({
    mediaId,
    blobUrl: 'blob:test',
    duration: 10,
    isVisible,
    enabled: true,
  })

  return null
}

describe('useFilmstrip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    filmstripCacheMocks.getFromCacheSync.mockReturnValue(null)
    filmstripCacheMocks.subscribe.mockReturnValue(vi.fn())
    filmstripCacheMocks.needsPriorityRefinement.mockReturnValue(false)
    filmstripCacheMocks.getFilmstrip.mockReturnValue(new Promise<never>(() => {}))
  })

  it('aborts extraction when the clip leaves the active workset', async () => {
    const view = render(
      createElement(FilmstripProbe, {
        mediaId: 'media-1',
        isVisible: true,
      }),
    )

    await waitFor(() => {
      expect(filmstripCacheMocks.getFilmstrip).toHaveBeenCalledWith(
        'media-1',
        'blob:test',
        10,
        expect.any(Function),
        undefined,
        {
          targetFrameCount: undefined,
          targetFrameIndices: undefined,
        },
      )
    })

    view.rerender(
      createElement(FilmstripProbe, {
        mediaId: 'media-1',
        isVisible: false,
      }),
    )

    expect(filmstripCacheMocks.abort).toHaveBeenCalledWith('media-1')
  })

  it('aborts extraction on unmount or media switch', async () => {
    const view = render(
      createElement(FilmstripProbe, {
        mediaId: 'media-1',
        isVisible: true,
      }),
    )

    await waitFor(() => {
      expect(filmstripCacheMocks.getFilmstrip).toHaveBeenCalled()
    })

    view.unmount()

    expect(filmstripCacheMocks.abort).toHaveBeenCalledWith('media-1')
  })

  it('starts visible filmstrip work without waiting on the audio startup hold', async () => {
    render(
      createElement(FilmstripProbe, {
        mediaId: 'media-1',
        isVisible: true,
      }),
    )

    await waitFor(() => {
      expect(schedulePreviewWork).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          delayMs: 0,
          ignoreAudioStartupHold: true,
        }),
      )
    })
  })
})
