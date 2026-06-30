/**
 * Minimal ProRes frame-header parser (SMPTE RDD 36).
 *
 * mediabunny demuxes ProRes-in-QuickTime fine but does not recognize ProRes as a
 * decodable codec (`track.codec === null`), so we drive turbores ourselves from raw
 * `EncodedPacketSink` packets. turbores' `Decoder.create` needs a `proresFourCc` up
 * front, and mediabunny does not expose the container sample-entry fourcc. We recover
 * the only decode-relevant distinction — 4:2:2 vs 4:4:4 — directly from the packet's
 * `icpf` frame header, which lets us pick a safe decoder variant:
 *   - 4:2:2 → `apch` (covers apcn/apcs/apco/apch; 10-bit 4:2:2)
 *   - 4:4:4 → `ap4h` (covers ap4h/ap4x; 12-bit 4:4:4, optional alpha)
 *
 * Exact bit depth and alpha presence are read from turbores' decoded output
 * (`Frame.originalPixelFormat`) rather than guessed here, so this parser stays small.
 *
 * Layout, relative to the `icpf` marker (which itself follows a 4-byte big-endian
 * frame size), verified byte-for-byte against real apch footage:
 *   +0..3   'icpf'
 *   +4..5   frame_header_size (u16 BE)
 *   +6      reserved
 *   +7      bitstream_version
 *   +8..11  encoder_identifier (e.g. 'apl0')
 *   +12..13 horizontal_size (u16 BE)
 *   +14..15 vertical_size   (u16 BE)
 *   +16     chroma_format (top 2 bits) | interlace_mode | reserved
 *   +17     aspect_ratio (4) | frame_rate_code (4)
 *   +18     color_primaries
 *   +19     transfer_characteristic
 *   +20     matrix_coefficients
 */

/** Decoder-variant fourcc selected purely by chroma subsampling. */
export type ProResDecoderFourCc = 'apch' | 'ap4h'

export interface ProResFrameInfo {
  /** turbores decoder variant to request for this stream. */
  fourCc: ProResDecoderFourCc
  /** `'4:2:2'` or `'4:4:4'`. */
  chromaFormat: '4:2:2' | '4:4:4'
  /** Display width encoded in the frame header (pixels). */
  width: number
  /** Display height encoded in the frame header (pixels). */
  height: number
  /** ISO/IEC 23091-4 color primaries code (e.g. 9 = BT.2020). */
  colorPrimaries: number
  /** ISO/IEC 23091-4 transfer characteristics code (e.g. 18 = HLG). */
  transferCharacteristics: number
  /** ISO/IEC 23001-8 matrix coefficients code (e.g. 9 = BT.2020-NCL). */
  matrixCoefficients: number
}

const ICPF = 0x69_63_70_66 // 'icpf'

function readFourCc(data: Uint8Array, offset: number): number {
  return (
    ((data[offset]! << 24) |
      (data[offset + 1]! << 16) |
      (data[offset + 2]! << 8) |
      data[offset + 3]!) >>>
    0
  )
}

function readU16(data: Uint8Array, offset: number): number {
  return (data[offset]! << 8) | data[offset + 1]!
}

/** Locate the `icpf` frame marker. It sits at offset 4 in a well-formed packet, but
 * we scan a small window as a fallback in case of leading container padding. */
function findIcpf(data: Uint8Array): number {
  if (data.length >= 8 && readFourCc(data, 4) === ICPF) {
    return 4
  }
  const limit = Math.min(data.length - 4, 64)
  for (let i = 0; i <= limit; i++) {
    if (readFourCc(data, i) === ICPF) {
      return i
    }
  }
  return -1
}

/**
 * Parses a single ProRes packet's frame header. Returns `null` when the packet is not
 * a recognizable ProRes frame (no `icpf` marker, truncated header, or an invalid
 * chroma_format), which callers use as a "this isn't ProRes" signal.
 */
export function parseProResFrameHeader(data: Uint8Array): ProResFrameInfo | null {
  const icpf = findIcpf(data)
  if (icpf < 0 || data.length < icpf + 21) {
    return null
  }

  // chroma_format occupies the top 2 bits: 2 = 4:2:2, 3 = 4:4:4 (0/1 are reserved).
  const chromaCode = (data[icpf + 16]! >> 6) & 0x3
  if (chromaCode !== 2 && chromaCode !== 3) {
    return null
  }
  const chromaFormat = chromaCode === 3 ? '4:4:4' : '4:2:2'

  return {
    fourCc: chromaCode === 3 ? 'ap4h' : 'apch',
    chromaFormat,
    width: readU16(data, icpf + 12),
    height: readU16(data, icpf + 14),
    colorPrimaries: data[icpf + 18]!,
    transferCharacteristics: data[icpf + 19]!,
    matrixCoefficients: data[icpf + 20]!,
  }
}
