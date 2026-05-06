import { describe, expect, it } from 'vite-plus/test'
import { inferSubtitleFormat, parseSrt, parseVtt, serializeSrt, serializeVtt } from './subtitles'

describe('subtitles', () => {
  it('infers subtitle formats from filenames', () => {
    expect(inferSubtitleFormat('captions.srt')).toBe('srt')
    expect(inferSubtitleFormat('captions.VTT')).toBe('vtt')
    expect(inferSubtitleFormat('captions.txt')).toBeNull()
  })

  it('parses multiline SRT cues', () => {
    const result = parseSrt(`1
00:00:01,000 --> 00:00:03,250
Hello
world

2
00:00:04,000 --> 00:00:05,000
Next`)

    expect(result.warnings).toEqual([])
    expect(result.cues).toEqual([
      { id: 'cue-1', startSeconds: 1, endSeconds: 3.25, text: 'Hello\nworld' },
      { id: 'cue-2', startSeconds: 4, endSeconds: 5, text: 'Next' },
    ])
  })

  it('parses VTT with cue ids and NOTE blocks', () => {
    const result = parseVtt(`WEBVTT

NOTE generated elsewhere

intro
00:00:02.500 --> 00:00:04.000 align:center
<c.yellow>Hello</c> there`)

    expect(result.cues).toEqual([
      { id: 'cue-1', startSeconds: 2.5, endSeconds: 4, text: 'Hello there' },
    ])
    expect(result.warnings).toEqual([])
  })

  it('warns and skips malformed cues', () => {
    const result = parseSrt(`1
bad timestamp
Hello

2
00:00:05,000 --> 00:00:04,000
Backwards`)

    expect(result.cues).toEqual([])
    expect(result.warnings).toHaveLength(2)
  })

  it('serializes SRT and VTT in timeline order', () => {
    const cues = [
      { id: 'b', startSeconds: 2, endSeconds: 3.5, text: 'Two' },
      { id: 'a', startSeconds: 0, endSeconds: 1.25, text: 'One' },
    ]

    expect(serializeSrt(cues)).toBe(`1
00:00:00,000 --> 00:00:01,250
One

2
00:00:02,000 --> 00:00:03,500
Two`)

    expect(serializeVtt(cues)).toBe(`WEBVTT

00:00:00.000 --> 00:00:01.250
One

00:00:02.000 --> 00:00:03.500
Two`)
  })
})
