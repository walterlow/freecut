// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { SubtitleSegmentItem, TimelineItem } from '@/types/timeline'
import { detectTranscriptSubtitles, getSubtitleModeOptions } from './export-subtitles'

type TranscriptCaptions = NonNullable<
  Extract<TimelineItem, { type: 'video' }>['transcriptCaptions']
>

const ENABLED_CAPTIONS: TranscriptCaptions = {
  type: 'transcript',
  mediaId: 'media-1',
  enabled: true,
  updatedAt: 0,
  cues: [],
}

function videoItem(overrides: Partial<Extract<TimelineItem, { type: 'video' }>> = {}) {
  return {
    id: 'clip-1',
    trackId: 'track-1',
    type: 'video',
    from: 0,
    durationInFrames: 30,
    label: 'clip.mp4',
    mediaId: 'media-1',
    src: 'blob://clip.mp4',
    ...overrides,
  } satisfies Extract<TimelineItem, { type: 'video' }>
}

function imageItem() {
  return {
    id: 'image-1',
    trackId: 'track-1',
    type: 'image',
    from: 0,
    durationInFrames: 30,
    label: 'loop.gif',
    src: 'blob://loop.gif',
  } satisfies Extract<TimelineItem, { type: 'image' }>
}

function subtitleItem(overrides: Partial<SubtitleSegmentItem> = {}): SubtitleSegmentItem {
  return {
    id: 'subtitle-1',
    trackId: 'track-1',
    type: 'subtitle',
    from: 0,
    durationInFrames: 30,
    label: 'Transcript',
    mediaId: 'media-1',
    color: '#ffffff',
    cues: [],
    source: { type: 'transcript', mediaId: 'media-1', clipId: 'clip-1' },
    ...overrides,
  }
}

describe('getSubtitleModeOptions', () => {
  it('offers the embedded track only for containers that can mux it', () => {
    expect(getSubtitleModeOptions('webm')).toContain('embedded')
    expect(getSubtitleModeOptions('mkv')).toContain('embedded')
    expect(getSubtitleModeOptions('mp4')).toEqual(['off', 'burn', 'sidecar'])
    expect(getSubtitleModeOptions('mov')).toEqual(['off', 'burn', 'sidecar'])
  })
})

describe('detectTranscriptSubtitles', () => {
  it('detects a transcript-generated subtitle segment', () => {
    expect(detectTranscriptSubtitles([subtitleItem()])).toBe(true)
  })

  it('ignores subtitle segments whose source clip was reversed', () => {
    expect(detectTranscriptSubtitles([subtitleItem(), videoItem({ isReversed: true })])).toBe(false)
  })

  it('ignores subtitle items that did not come from a transcript', () => {
    expect(
      detectTranscriptSubtitles([
        subtitleItem({
          source: { type: 'subtitle-import', fileName: 'subs.srt', format: 'srt', importedAt: 0 },
        }),
      ]),
    ).toBe(false)
  })

  it('detects clips whose own enabled transcript captions will be exported', () => {
    expect(detectTranscriptSubtitles([videoItem({ transcriptCaptions: ENABLED_CAPTIONS })])).toBe(true)
  })

  it('ignores captions that are disabled or on a reversed clip', () => {
    expect(
      detectTranscriptSubtitles([
        videoItem({ transcriptCaptions: { ...ENABLED_CAPTIONS, enabled: false } }),
      ]),
    ).toBe(false)
    expect(
      detectTranscriptSubtitles([
        videoItem({ transcriptCaptions: ENABLED_CAPTIONS, isReversed: true }),
      ]),
    ).toBe(false)
  })

  it('reports nothing to export for an empty timeline or caption-free items', () => {
    expect(detectTranscriptSubtitles([])).toBe(false)
    expect(detectTranscriptSubtitles([imageItem(), videoItem({ transcriptCaptions: undefined })])).toBe(
      false,
    )
  })
})
