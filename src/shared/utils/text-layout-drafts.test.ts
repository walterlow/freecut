import { describe, expect, it } from 'vite-plus/test'
import type { TextItem } from '@/types/timeline'
import {
  buildEditableBaseSpans,
  buildTextSingleLayoutDraft,
  cloneTextLayoutDrafts,
  getTextItemLayoutMode,
} from './text-layout-drafts'

function createTextItem(overrides: Partial<TextItem> = {}): TextItem {
  return {
    id: 'text-1',
    type: 'text',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 90,
    label: 'Text',
    text: 'Headline',
    color: '#ffffff',
    ...overrides,
  }
}

describe('text-layout-drafts', () => {
  it('detects text layout mode from span count', () => {
    expect(getTextItemLayoutMode(createTextItem())).toBe('single')
    expect(
      getTextItemLayoutMode(
        createTextItem({
          textSpans: [{ text: 'Title' }, { text: 'Subtitle' }],
        }),
      ),
    ).toBe('two')
    expect(
      getTextItemLayoutMode(
        createTextItem({
          textSpans: [{ text: 'Eyebrow' }, { text: 'Title' }, { text: 'Subtitle' }],
        }),
      ),
    ).toBe('three')
  })

  it('builds editable base spans from single text styling', () => {
    const spans = buildEditableBaseSpans(
      createTextItem({
        text: 'Solo',
        fontSize: 88,
        fontFamily: 'Inter Tight',
        fontWeight: 'bold',
        color: '#f8fafc',
      }),
    )

    expect(spans).toEqual([
      {
        text: 'Solo',
        fontSize: 88,
        fontFamily: 'Inter Tight',
        fontWeight: 'bold',
        fontStyle: undefined,
        underline: undefined,
        color: '#f8fafc',
        letterSpacing: undefined,
      },
    ])
  })

  it('derives single draft from the title span in three-span layouts', () => {
    const draft = buildTextSingleLayoutDraft(
      createTextItem({
        text: 'Eyebrow\nHeadline\nSubtitle',
        fontSize: 60,
        fontFamily: 'Inter',
        color: '#ffffff',
        textSpans: [
          { text: 'Eyebrow', fontSize: 24, color: '#fbbf24' },
          {
            text: 'Headline',
            fontSize: 92,
            fontFamily: 'Bebas Neue',
            fontWeight: 'bold',
            color: '#f8fafc',
          },
          { text: 'Subtitle', fontSize: 32, color: '#cbd5e1' },
        ],
      }),
    )

    expect(draft).toMatchObject({
      text: 'Headline',
      fontSize: 92,
      fontFamily: 'Bebas Neue',
      fontWeight: 'bold',
      color: '#f8fafc',
    })
  })

  it('clones text layout drafts without retaining references', () => {
    const source = {
      single: { text: 'Single' },
      twoSpans: [{ text: 'Title' }, { text: 'Subtitle' }],
    }
    const drafts = cloneTextLayoutDrafts(source)

    if (drafts?.single) {
      drafts.single.text = 'Changed'
    }
    if (drafts?.twoSpans) {
      drafts.twoSpans[0]!.text = 'Changed'
    }

    expect(source).toMatchObject({
      single: { text: 'Single' },
      twoSpans: [{ text: 'Title' }, { text: 'Subtitle' }],
    })
  })
})
