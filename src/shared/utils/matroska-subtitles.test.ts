import { describe, expect, it } from 'vite-plus/test'
import { extractMatroskaTextSubtitleTracks } from './matroska-subtitles'

const textEncoder = new TextEncoder()

describe('extractMatroskaTextSubtitleTracks', () => {
  it('extracts text subtitle cues from a Matroska block group', () => {
    const buffer = element(
      [0x18, 0x53, 0x80, 0x67],
      [
        element([0x15, 0x49, 0xa9, 0x66], [element([0x2a, 0xd7, 0xb1], uint(1_000_000))]),
        element(
          [0x16, 0x54, 0xae, 0x6b],
          [
            element(
              [0xae],
              [
                element([0xd7], uint(1)),
                element([0x83], uint(17)),
                element([0x86], ascii('S_TEXT/UTF8')),
                element([0x22, 0xb5, 0x9c], ascii('eng')),
                element([0x88], uint(1)),
              ],
            ),
          ],
        ),
        element(
          [0x1f, 0x43, 0xb6, 0x75],
          [
            element([0xe7], uint(0)),
            element(
              [0xa0],
              [
                element([0xa1], block(1, 1000, 'Hello from inside the file')),
                element([0x9b], uint(2000)),
              ],
            ),
          ],
        ),
      ],
    )

    const tracks = extractMatroskaTextSubtitleTracks(toArrayBuffer(buffer))

    expect(tracks).toHaveLength(1)
    expect(tracks[0]).toMatchObject({
      trackNumber: 1,
      codecId: 'S_TEXT/UTF8',
      language: 'eng',
      default: true,
      forced: false,
    })
    expect(tracks[0]?.cues).toEqual([
      {
        id: 'embedded-1-1',
        startSeconds: 1,
        endSeconds: 3,
        text: 'Hello from inside the file',
      },
    ])
  })

  it('normalizes ASS dialogue payloads', () => {
    const buffer = element(
      [0x18, 0x53, 0x80, 0x67],
      [
        element(
          [0x16, 0x54, 0xae, 0x6b],
          [
            element(
              [0xae],
              [
                element([0xd7], uint(2)),
                element([0x83], uint(17)),
                element([0x86], ascii('S_TEXT/ASS')),
                element([0x55, 0xaa], uint(1)),
              ],
            ),
          ],
        ),
        element(
          [0x1f, 0x43, 0xb6, 0x75],
          [
            element([0xe7], uint(5)),
            element([0xa3], block(2, 0, '0,0,Default,,0,0,0,,{\\i1}Line one\\NLine two')),
          ],
        ),
      ],
    )

    const tracks = extractMatroskaTextSubtitleTracks(toArrayBuffer(buffer))

    expect(tracks[0]?.forced).toBe(true)
    expect(tracks[0]?.cues[0]).toMatchObject({
      startSeconds: 0.005,
      endSeconds: 3.005,
      text: 'Line one\nLine two',
    })
  })
})

function element(id: number[], payloadParts: Uint8Array[] | Uint8Array): Uint8Array {
  const payload = Array.isArray(payloadParts) ? concat(payloadParts) : payloadParts
  return concat([new Uint8Array(id), size(payload.length), payload])
}

function block(trackNumber: number, timecode: number, text: string): Uint8Array {
  const payload = utf8(text)
  return concat([
    new Uint8Array([0x80 | trackNumber, (timecode >> 8) & 0xff, timecode & 0xff, 0x00]),
    payload,
  ])
}

function size(length: number): Uint8Array {
  if (length < 0x7f) {
    return new Uint8Array([0x80 | length])
  }
  if (length < 0x3fff) {
    return new Uint8Array([0x40 | (length >> 8), length & 0xff])
  }
  throw new Error('fixture payload is too large')
}

function uint(value: number): Uint8Array {
  if (value === 0) return new Uint8Array([0])
  const bytes: number[] = []
  let next = value
  while (next > 0) {
    bytes.unshift(next & 0xff)
    next = Math.floor(next / 256)
  }
  return new Uint8Array(bytes)
}

function ascii(value: string): Uint8Array {
  return new Uint8Array([...value].map((char) => char.charCodeAt(0)))
}

function utf8(value: string): Uint8Array {
  return textEncoder.encode(value)
}

function concat(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return copy.buffer
}
