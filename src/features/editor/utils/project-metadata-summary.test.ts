import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import {
  buildProjectMetadataSummary,
  collectProjectMediaReferenceIds,
} from './project-metadata-summary'

function videoItem(overrides: Partial<Extract<TimelineItem, { type: 'video' }>> = {}) {
  return {
    id: 'video-1',
    trackId: 'track-1',
    type: 'video',
    from: 0,
    durationInFrames: 90,
    label: 'clip.mp4',
    mediaId: 'media-1',
    src: 'blob://clip.mp4',
    ...overrides,
  } satisfies Extract<TimelineItem, { type: 'video' }>
}

describe('project metadata summary', () => {
  it('collects unique media references from timeline items', () => {
    expect(
      collectProjectMediaReferenceIds([
        videoItem({ id: 'a', mediaId: 'media-a' }),
        videoItem({ id: 'b', mediaId: 'media-a' }),
        videoItem({ id: 'c', mediaId: 'media-c' }),
      ]),
    ).toEqual(['media-a', 'media-c'])
  })

  it('summarizes duration, clip count, media count, and broken media count', () => {
    expect(
      buildProjectMetadataSummary({
        fps: 30,
        items: [
          videoItem({ id: 'a', mediaId: 'media-a', from: 0, durationInFrames: 90 }),
          videoItem({ id: 'b', mediaId: 'media-b', from: 120, durationInFrames: 60 }),
        ],
        brokenMediaIds: ['media-b', 'unused'],
      }),
    ).toEqual({
      durationSeconds: 6,
      clipCount: 2,
      mediaCount: 2,
      brokenMediaCount: 1,
    })
  })
})
