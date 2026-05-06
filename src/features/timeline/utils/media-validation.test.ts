import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { validateProjectMediaReferences } from './media-validation'

const mediaLibraryServiceMocks = vi.hoisted(() => ({
  getMediaForProject: vi.fn(),
}))

vi.mock('@/features/timeline/deps/media-library-service', () => ({
  mediaLibraryService: mediaLibraryServiceMocks,
}))

describe('validateProjectMediaReferences', () => {
  beforeEach(() => {
    mediaLibraryServiceMocks.getMediaForProject.mockReset()
  })

  it('reports missing media inside nested compound clips', async () => {
    mediaLibraryServiceMocks.getMediaForProject.mockResolvedValue([{ id: 'media-keep' }])

    const orphans = await validateProjectMediaReferences({
      rootItems: [
        {
          id: 'root-video',
          type: 'video',
          trackId: 'track-v1',
          from: 0,
          durationInFrames: 60,
          label: 'root.mp4',
          src: 'blob:root',
          mediaId: 'media-keep',
        },
      ],
      compositions: [
        {
          items: [
            {
              id: 'nested-video',
              type: 'video',
              trackId: 'comp-track-v1',
              from: 0,
              durationInFrames: 60,
              label: 'nested.mp4',
              src: 'blob:nested',
              mediaId: 'media-missing',
            },
          ],
        },
      ],
      projectId: 'project-1',
    })

    expect(orphans).toEqual([
      {
        itemId: 'nested-video',
        mediaId: 'media-missing',
        itemType: 'video',
        fileName: 'nested.mp4',
        trackId: 'comp-track-v1',
      },
    ])
  })

  it('collapses a linked synchronized audio-video pair into one orphan entry', async () => {
    mediaLibraryServiceMocks.getMediaForProject.mockResolvedValue([])

    const orphans = await validateProjectMediaReferences({
      rootItems: [
        {
          id: 'video-1',
          type: 'video',
          trackId: 'track-v1',
          from: 0,
          durationInFrames: 60,
          label: 'paired.mp4',
          src: 'blob:video',
          mediaId: 'media-missing',
          linkedGroupId: 'group-1',
        },
        {
          id: 'audio-1',
          type: 'audio',
          trackId: 'track-a1',
          from: 0,
          durationInFrames: 60,
          label: 'paired.mp4',
          src: 'blob:audio',
          mediaId: 'media-missing',
          linkedGroupId: 'group-1',
        },
      ],
      compositions: [],
      projectId: 'project-1',
    })

    expect(orphans).toEqual([
      {
        itemId: 'video-1',
        mediaId: 'media-missing',
        itemType: 'video',
        fileName: 'paired.mp4',
        trackId: 'track-v1',
      },
    ])
  })
})
