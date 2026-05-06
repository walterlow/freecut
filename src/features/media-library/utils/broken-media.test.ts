import { describe, expect, it } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import {
  getProjectBrokenMediaIds,
  getProjectBrokenMediaInfo,
} from '@/features/media-library/utils/broken-media'

function makeMedia(id: string, fileName = `${id}.mp4`): MediaMetadata {
  return {
    id,
    storageType: 'handle',
    fileName,
    fileSize: 1024,
    mimeType: 'video/mp4',
    duration: 5,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    bitrate: 5000,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('broken-media project scoping', () => {
  it('filters broken media ids to media used by the current project', () => {
    const mediaById = {
      'clip-b': makeMedia('clip-b'),
    }

    expect(getProjectBrokenMediaIds(['clip-a', 'clip-b'], mediaById)).toEqual(['clip-b'])
  })

  it('filters broken media info to media used by the current project', () => {
    const mediaById = {
      'clip-shared': makeMedia('clip-shared'),
    }
    const brokenMediaInfo = new Map([
      [
        'clip-a',
        {
          mediaId: 'clip-a',
          fileName: 'clip-a.mp4',
          errorType: 'file_missing' as const,
        },
      ],
      [
        'clip-shared',
        {
          mediaId: 'clip-shared',
          fileName: 'clip-shared.mp4',
          errorType: 'permission_denied' as const,
        },
      ],
    ])

    expect(getProjectBrokenMediaInfo(brokenMediaInfo, mediaById)).toEqual([
      {
        mediaId: 'clip-shared',
        fileName: 'clip-shared.mp4',
        errorType: 'permission_denied',
      },
    ])
  })
})
