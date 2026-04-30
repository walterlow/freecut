import { describe, expect, it } from 'vite-plus/test'
import { parseSubtitleCueText } from './subtitle-cue-format'

describe('parseSubtitleCueText', () => {
  it('returns a single plain span for unmarked text', () => {
    const result = parseSubtitleCueText('Hello world')
    expect(result.spans).toEqual([{ text: 'Hello world' }])
    expect(result.plainText).toBe('Hello world')
    expect(result.alignment).toBeUndefined()
  })

  it('parses <i> as an italic span', () => {
    const result = parseSubtitleCueText("<i>Where do you think you're going?</i>")
    expect(result.spans).toEqual([
      { text: "Where do you think you're going?", fontStyle: 'italic' },
    ])
  })

  it('parses mixed <i> and surrounding text into separate spans', () => {
    const result = parseSubtitleCueText('She said <i>maybe</i> tomorrow.')
    expect(result.spans).toEqual([
      { text: 'She said ' },
      { text: 'maybe', fontStyle: 'italic' },
      { text: ' tomorrow.' },
    ])
  })

  it('handles nested <b><i>', () => {
    const result = parseSubtitleCueText('<b>bold <i>and italic</i></b>')
    expect(result.spans).toEqual([
      { text: 'bold ', fontWeight: 'bold' },
      { text: 'and italic', fontWeight: 'bold', fontStyle: 'italic' },
    ])
  })

  it('extracts ASS {\\an8} alignment as top-center', () => {
    const result = parseSubtitleCueText('{\\an8}Jun-ho.')
    expect(result.alignment).toEqual({ textAlign: 'center', verticalAlign: 'top' })
    expect(result.spans).toEqual([{ text: 'Jun-ho.' }])
  })

  it('strips unrecognised ASS overrides', () => {
    const result = parseSubtitleCueText('{\\i1}Italic-ish text{\\i0}')
    // Other ASS toggles are dropped (italic-via-tag is the documented path)
    expect(result.spans).toEqual([{ text: 'Italic-ish text' }])
    expect(result.alignment).toBeUndefined()
  })

  it('parses <font color="...">', () => {
    const result = parseSubtitleCueText('<font color="#ff0">Yellow</font> rest')
    expect(result.spans).toEqual([{ text: 'Yellow', color: '#ff0' }, { text: ' rest' }])
  })

  it('treats stray < as literal when not a recognised tag', () => {
    const result = parseSubtitleCueText('a < b is true')
    expect(result.plainText).toBe('a < b is true')
  })

  it('reports empty for whitespace/markup-only cues', () => {
    const result = parseSubtitleCueText('<i></i>')
    expect(result.isEmpty).toBe(true)
  })
})
