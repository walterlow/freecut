import { describe, expect, it } from 'vitest'
import { parseProResFrameHeader } from './prores-frame-header'

/**
 * Builds a ProRes-like packet: 4-byte BE frame size, 'icpf', then a frame header.
 * `chromaByte` is the byte at icpf+16 whose top 2 bits carry chroma_format.
 */
function makePacket(chromaByte: number, leadingPad = 0): Uint8Array {
  const header = [
    0x00,
    0x94, // frame_header_size
    0x00, // reserved
    0x00, // bitstream_version
    0x61,
    0x70,
    0x6c,
    0x30, // 'apl0'
    0x07,
    0x80, // horizontal_size = 1920
    0x04,
    0x38, // vertical_size = 1080
    chromaByte, // chroma_format (top 2 bits) | flags
    0x05, // aspect_ratio | frame_rate_code
    0x09, // color_primaries = 9 (BT.2020)
    0x12, // transfer_characteristic = 18 (HLG)
    0x09, // matrix_coefficients = 9 (BT.2020-NCL)
  ]
  const icpf = [0x69, 0x63, 0x70, 0x66]
  const frameSize = [0x00, 0x0e, 0x05, 0x30]
  return new Uint8Array([...new Array(leadingPad).fill(0), ...frameSize, ...icpf, ...header])
}

describe('parseProResFrameHeader', () => {
  it('parses a real 4:2:2 (apch) frame header', () => {
    // 0x80 = 0b10_000000 → chroma_format = 2 (4:2:2)
    const info = parseProResFrameHeader(makePacket(0x80))
    expect(info).toEqual({
      fourCc: 'apch',
      chromaFormat: '4:2:2',
      width: 1920,
      height: 1080,
      colorPrimaries: 9,
      transferCharacteristics: 18,
      matrixCoefficients: 9,
    })
  })

  it('selects ap4h for 4:4:4 chroma', () => {
    // 0xC0 = 0b11_000000 → chroma_format = 3 (4:4:4)
    const info = parseProResFrameHeader(makePacket(0xc0))
    expect(info?.fourCc).toBe('ap4h')
    expect(info?.chromaFormat).toBe('4:4:4')
  })

  it('finds the icpf marker past leading container padding', () => {
    const info = parseProResFrameHeader(makePacket(0x80, 6))
    expect(info?.fourCc).toBe('apch')
    expect(info?.width).toBe(1920)
  })

  it('returns null for a reserved/invalid chroma_format', () => {
    // 0x00 → chroma_format = 0 (reserved) → not a valid ProRes frame
    expect(parseProResFrameHeader(makePacket(0x00))).toBeNull()
  })

  it('returns null when there is no icpf marker', () => {
    const notProRes = new Uint8Array(32).fill(0xaa)
    expect(parseProResFrameHeader(notProRes)).toBeNull()
  })

  it('returns null for a truncated header', () => {
    const full = makePacket(0x80)
    expect(parseProResFrameHeader(full.slice(0, 10))).toBeNull()
  })
})
