/**
 * Parser and utilities for the Adobe/Resolve `.cube` 3D LUT format.
 *
 * Data is stored as rgba8 with the red axis varying fastest
 * (standard .cube ordering), alpha fixed at 255.
 */

export interface ParsedCubeLut {
  title: string | null
  size: number
  /** rgba8: size*size*size*4 bytes, red fastest axis (standard .cube order), alpha=255 */
  data: Uint8Array
}

const MIN_LUT_SIZE = 2
const MAX_LUT_SIZE = 129
const BASE64_CHUNK_SIZE = 8192

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function parseFloatToken(token: string | undefined, context: string): number {
  if (token === undefined) {
    throw new Error(`Invalid .cube file: missing value in ${context}`)
  }
  const value = Number.parseFloat(token)
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid .cube file: non-numeric value "${token}" in ${context}`)
  }
  return value
}

interface CubeParseState {
  title: string | null
  size: number | null
  domainMin: [number, number, number]
  domainMax: [number, number, number]
  data: Uint8Array | null
  expectedEntries: number
  entryIndex: number
}

function applyLut3dSize(line: string, state: CubeParseState): void {
  const tokens = line.split(/\s+/)
  const parsed = Number.parseInt(tokens[1] ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < MIN_LUT_SIZE || parsed > MAX_LUT_SIZE) {
    throw new Error(
      `Invalid .cube file: LUT_3D_SIZE must be an integer between ${MIN_LUT_SIZE} and ${MAX_LUT_SIZE}, got "${tokens[1] ?? ''}"`,
    )
  }
  state.size = parsed
  state.expectedEntries = parsed * parsed * parsed
  state.data = new Uint8Array(state.expectedEntries * 4)
}

function parseDomainTriple(line: string, context: string, target: [number, number, number]): void {
  const tokens = line.split(/\s+/)
  for (let c = 0; c < 3; c++) {
    target[c] = parseFloatToken(tokens[c + 1], context)
  }
}

/** Handles header keywords. Returns true when the line was consumed. */
function handleHeaderKeyword(line: string, state: CubeParseState): boolean {
  if (line.startsWith('TITLE')) {
    const match = line.match(/^TITLE\s+"(.*)"\s*$/)
    state.title = match?.[1] ?? line.slice('TITLE'.length).trim()
    return true
  }
  if (line.startsWith('LUT_1D_SIZE')) {
    throw new Error('1D LUTs are not supported')
  }
  if (line.startsWith('LUT_3D_SIZE')) {
    applyLut3dSize(line, state)
    return true
  }
  if (line.startsWith('DOMAIN_MIN')) {
    parseDomainTriple(line, 'DOMAIN_MIN', state.domainMin)
    return true
  }
  if (line.startsWith('DOMAIN_MAX')) {
    parseDomainTriple(line, 'DOMAIN_MAX', state.domainMax)
    return true
  }
  return false
}

/** Data lines always start with a digit, '-', '+', or '.'. */
function isCubeDataLine(line: string): boolean {
  const firstChar = line.charCodeAt(0)
  return (
    (firstChar >= 48 && firstChar <= 57) || // 0-9
    firstChar === 45 || // -
    firstChar === 43 || // +
    firstChar === 46 // .
  )
}

/** Normalizes a raw channel value into the domain and quantizes to a byte. */
function quantizeChannel(raw: number, min: number, max: number): number {
  const range = max - min
  const normalized = range !== 0 ? (raw - min) / range : 0
  return Math.round(clamp01(normalized) * 255)
}

function parseDataLine(line: string, state: CubeParseState): void {
  if (state.size === null || state.data === null) {
    throw new Error('Invalid .cube file: data encountered before LUT_3D_SIZE')
  }
  if (state.entryIndex >= state.expectedEntries) {
    throw new Error(
      `Invalid .cube file: too many data entries (expected ${state.expectedEntries} for LUT_3D_SIZE ${state.size})`,
    )
  }

  const tokens = line.split(/\s+/)
  if (tokens.length < 3) {
    throw new Error(`Invalid .cube file: data line "${line}" must contain three values`)
  }

  const offset = state.entryIndex * 4
  for (let c = 0; c < 3; c++) {
    const raw = parseFloatToken(tokens[c], `data entry ${state.entryIndex}`)
    const min = state.domainMin[c] as number
    const max = state.domainMax[c] as number
    state.data[offset + c] = quantizeChannel(raw, min, max)
  }
  state.data[offset + 3] = 255
  state.entryIndex++
}

export function parseCubeLut(text: string): ParsedCubeLut {
  const state: CubeParseState = {
    title: null,
    size: null,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    data: null,
    expectedEntries: 0,
    entryIndex: 0,
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    if (handleHeaderKeyword(line, state)) continue
    // Skip other known keywords (e.g. LUT_3D_INPUT_RANGE variants) that start
    // with a letter — data lines always start with a digit, '-', '+', or '.'.
    if (!isCubeDataLine(line)) continue
    parseDataLine(line, state)
  }

  if (state.size === null || state.data === null) {
    throw new Error('Invalid .cube file: missing LUT_3D_SIZE')
  }
  if (state.entryIndex !== state.expectedEntries) {
    throw new Error(
      `Invalid .cube file: expected ${state.expectedEntries} data entries for LUT_3D_SIZE ${state.size}, got ${state.entryIndex}`,
    )
  }

  return { title: state.title, size: state.size, data: state.data }
}

function sampleChannel(
  data: Uint8Array,
  size: number,
  x: number,
  y: number,
  z: number,
  channel: number,
): number {
  return data[((z * size + y) * size + x) * 4 + channel] ?? 0
}

export function resampleCubeLut(lut: ParsedCubeLut, maxSize: number): ParsedCubeLut {
  if (lut.size <= maxSize) return lut

  const srcSize = lut.size
  const dstSize = maxSize
  const src = lut.data
  const dst = new Uint8Array(dstSize * dstSize * dstSize * 4)
  const scale = dstSize > 1 ? (srcSize - 1) / (dstSize - 1) : 0

  for (let b = 0; b < dstSize; b++) {
    const sz = b * scale
    const z0 = Math.min(Math.floor(sz), srcSize - 1)
    const z1 = Math.min(z0 + 1, srcSize - 1)
    const fz = sz - z0
    for (let g = 0; g < dstSize; g++) {
      const sy = g * scale
      const y0 = Math.min(Math.floor(sy), srcSize - 1)
      const y1 = Math.min(y0 + 1, srcSize - 1)
      const fy = sy - y0
      for (let r = 0; r < dstSize; r++) {
        const sx = r * scale
        const x0 = Math.min(Math.floor(sx), srcSize - 1)
        const x1 = Math.min(x0 + 1, srcSize - 1)
        const fx = sx - x0

        const offset = ((b * dstSize + g) * dstSize + r) * 4
        for (let c = 0; c < 3; c++) {
          const c000 = sampleChannel(src, srcSize, x0, y0, z0, c)
          const c100 = sampleChannel(src, srcSize, x1, y0, z0, c)
          const c010 = sampleChannel(src, srcSize, x0, y1, z0, c)
          const c110 = sampleChannel(src, srcSize, x1, y1, z0, c)
          const c001 = sampleChannel(src, srcSize, x0, y0, z1, c)
          const c101 = sampleChannel(src, srcSize, x1, y0, z1, c)
          const c011 = sampleChannel(src, srcSize, x0, y1, z1, c)
          const c111 = sampleChannel(src, srcSize, x1, y1, z1, c)

          const c00 = c000 + (c100 - c000) * fx
          const c10 = c010 + (c110 - c010) * fx
          const c01 = c001 + (c101 - c001) * fx
          const c11 = c011 + (c111 - c011) * fx
          const c0 = c00 + (c10 - c00) * fy
          const c1 = c01 + (c11 - c01) * fy
          dst[offset + c] = Math.round(c0 + (c1 - c0) * fz)
        }
        dst[offset + 3] = 255
      }
    }
  }

  return { title: lut.title, size: dstSize, data: dst }
}

export function encodeLutData(data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.length; i += BASE64_CHUNK_SIZE) {
    const chunk = data.subarray(i, i + BASE64_CHUNK_SIZE)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

export function decodeLutData(encoded: string): Uint8Array {
  const binary = atob(encoded)
  const data = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    data[i] = binary.charCodeAt(i)
  }
  return data
}

export function createIdentityLutData(size: number): Uint8Array {
  const data = new Uint8Array(size * size * size * 4)
  const denom = size > 1 ? size - 1 : 1
  let offset = 0
  for (let b = 0; b < size; b++) {
    const blue = Math.round((b / denom) * 255)
    for (let g = 0; g < size; g++) {
      const green = Math.round((g / denom) * 255)
      for (let r = 0; r < size; r++) {
        data[offset] = Math.round((r / denom) * 255)
        data[offset + 1] = green
        data[offset + 2] = blue
        data[offset + 3] = 255
        offset += 4
      }
    }
  }
  return data
}
