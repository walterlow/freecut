import { describe, expect, it } from 'vite-plus/test'
import {
  getGhostHighlightClasses,
  getGhostPreviewItemClasses,
  isValidDragMediaItem,
} from './drag-drop-preview'

describe('drag-drop-preview', () => {
  it('prioritizes the strongest ghost highlight class present', () => {
    expect(getGhostHighlightClasses([{ type: 'image' }, { type: 'audio' }])).toBe(
      'border-timeline-audio/60 bg-timeline-audio/10',
    )
  })

  it('returns the expected item classes for preview types', () => {
    expect(getGhostPreviewItemClasses('composition')).toBe('border-violet-400 bg-violet-600/20')
    expect(getGhostPreviewItemClasses('external-file')).toBe('border-orange-500 bg-orange-500/15')
    expect(getGhostPreviewItemClasses('image')).toBe('border-timeline-image bg-timeline-image/20')
  })

  it('validates drag media payloads', () => {
    expect(
      isValidDragMediaItem({
        mediaId: 'clip-1',
        mediaType: 'video',
        fileName: 'clip.mp4',
        duration: 12.5,
      }),
    ).toBe(true)

    expect(
      isValidDragMediaItem({
        mediaId: 'clip-1',
        mediaType: 'text',
        fileName: 'clip.mp4',
        duration: 12.5,
      }),
    ).toBe(false)
  })
})
