import type { SubtitleCue } from './subtitles'

export interface EmbeddedSubtitleTrack {
  trackNumber: number
  codecId: string
  language: string
  name?: string
  default: boolean
  forced: boolean
  defaultDurationSeconds?: number
  cues: SubtitleCue[]
}

interface MatroskaSubtitleTrackInfo {
  trackNumber: number
  codecId: string
  language: string
  name?: string
  default: boolean
  forced: boolean
  defaultDurationSeconds?: number
}

interface ElementHeader {
  id: number
  dataStart: number
  dataEnd: number
  next: number
}

interface ParsedSubtitleBlock {
  trackNumber: number
  startSeconds: number
  payload: Uint8Array
}

const IDS = {
  SEGMENT: 0x18538067,
  INFO: 0x1549a966,
  TIMESTAMP_SCALE: 0x2ad7b1,
  TRACKS: 0x1654ae6b,
  TRACK_ENTRY: 0xae,
  TRACK_NUMBER: 0xd7,
  TRACK_TYPE: 0x83,
  FLAG_DEFAULT: 0x88,
  FLAG_FORCED: 0x55aa,
  CODEC_ID: 0x86,
  NAME: 0x536e,
  LANGUAGE: 0x22b59c,
  LANGUAGE_IETF: 0x22b59d,
  DEFAULT_DURATION: 0x23e383,
  CLUSTER: 0x1f43b675,
  TIMECODE: 0xe7,
  SIMPLE_BLOCK: 0xa3,
  BLOCK_GROUP: 0xa0,
  BLOCK: 0xa1,
  BLOCK_DURATION: 0x9b,
} as const

const SUBTITLE_TRACK_TYPE = 17
const SUPPORTED_TEXT_CODECS = new Set(['S_TEXT/UTF8', 'S_TEXT/WEBVTT', 'S_TEXT/ASS', 'S_TEXT/SSA'])
const DEFAULT_CUE_DURATION_SECONDS = 3

const utf8Decoder = new TextDecoder()

export function extractMatroskaTextSubtitleTracks(buffer: ArrayBuffer): EmbeddedSubtitleTrack[] {
  const bytes = new Uint8Array(buffer)
  const segment = findElement(bytes, 0, bytes.length, IDS.SEGMENT)
  if (!segment) return []

  let timestampScale = 1_000_000
  const tracks = new Map<number, EmbeddedSubtitleTrack>()

  forEachElement(bytes, segment.dataStart, segment.dataEnd, (element) => {
    if (element.id === IDS.INFO) {
      timestampScale = parseTimestampScale(bytes, element) ?? timestampScale
      return
    }

    if (element.id === IDS.TRACKS) {
      for (const info of parseSubtitleTrackInfos(bytes, element)) {
        tracks.set(info.trackNumber, {
          trackNumber: info.trackNumber,
          codecId: info.codecId,
          language: info.language,
          name: info.name,
          default: info.default,
          forced: info.forced,
          defaultDurationSeconds: info.defaultDurationSeconds,
          cues: [],
        })
      }
      return
    }

    if (element.id === IDS.CLUSTER && tracks.size > 0) {
      extractClusterCues(bytes, element, tracks, timestampScale)
    }
  })

  return finalizeTracks(tracks)
}

export interface ExtractFromBlobOptions {
  /** Optional progress callback — fired roughly every 100 clusters. */
  onProgress?: (info: { bytesRead: number; totalBytes: number; clusters: number }) => void
  /** Optional abort signal; honored between cluster reads. */
  signal?: AbortSignal
}

/**
 * Streaming variant that walks a Matroska/WebM blob without ever materializing
 * the full file into memory. Required for >2 GB sources because Chromium's
 * `Blob.arrayBuffer()` throws `NotReadableError` past that limit.
 *
 * Walks the segment element-by-element, slicing only the bytes each top-level
 * element needs (Info/Tracks: small; Cluster: typically a few MB). Subtitle
 * cues are still well under the per-cluster slice budget, so the only real
 * memory footprint is the active cluster's payload.
 */
export async function extractMatroskaTextSubtitleTracksFromBlob(
  blob: Blob,
  options: ExtractFromBlobOptions = {},
): Promise<EmbeddedSubtitleTrack[]> {
  const { onProgress, signal } = options
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
  const totalBytes = blob.size

  const segment = await findElementInBlob(blob, 0, totalBytes, IDS.SEGMENT)
  if (!segment) return []

  let timestampScale = 1_000_000
  const tracks = new Map<number, EmbeddedSubtitleTrack>()
  let clustersProcessed = 0
  let cursor = segment.dataStart
  const segmentEnd = Math.min(segment.dataEnd, totalBytes)

  while (cursor < segmentEnd) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    const element = await readElementHeaderFromBlob(blob, cursor, segmentEnd)
    if (!element) break

    if (element.id === IDS.INFO) {
      const data = await readBlobSlice(blob, element.dataStart, element.dataEnd)
      timestampScale = parseTimestampScale(data, makeWholeBufferHeader(data)) ?? timestampScale
    } else if (element.id === IDS.TRACKS) {
      const data = await readBlobSlice(blob, element.dataStart, element.dataEnd)
      for (const info of parseSubtitleTrackInfos(data, makeWholeBufferHeader(data))) {
        tracks.set(info.trackNumber, {
          trackNumber: info.trackNumber,
          codecId: info.codecId,
          language: info.language,
          name: info.name,
          default: info.default,
          forced: info.forced,
          defaultDurationSeconds: info.defaultDurationSeconds,
          cues: [],
        })
      }
    } else if (element.id === IDS.CLUSTER && tracks.size > 0) {
      const data = await readBlobSlice(blob, element.dataStart, element.dataEnd)
      extractClusterCues(data, makeWholeBufferHeader(data), tracks, timestampScale)
      clustersProcessed++
      if (onProgress && clustersProcessed % 100 === 0) {
        onProgress({ bytesRead: element.dataEnd, totalBytes, clusters: clustersProcessed })
      }
    }

    cursor = element.dataEnd
  }

  if (onProgress) {
    onProgress({ bytesRead: Math.min(cursor, totalBytes), totalBytes, clusters: clustersProcessed })
  }

  return finalizeTracks(tracks)
}

function finalizeTracks(tracks: Map<number, EmbeddedSubtitleTrack>): EmbeddedSubtitleTrack[] {
  return [...tracks.values()]
    .map((track) => ({
      ...track,
      cues: track.cues
        .filter((cue) => cue.text.trim().length > 0 && cue.endSeconds > cue.startSeconds)
        .sort((a, b) => a.startSeconds - b.startSeconds),
    }))
    .filter((track) => track.cues.length > 0)
}

/**
 * The inner parsers expect (bytes, ElementHeader) and read inside
 * [dataStart, dataEnd). When we slice an element's payload into its own
 * Uint8Array the relative bounds are simply [0, length) — this builds the
 * matching header so the existing parsers can be reused unchanged.
 */
function makeWholeBufferHeader(bytes: Uint8Array): ElementHeader {
  return { id: 0, dataStart: 0, dataEnd: bytes.length, next: bytes.length }
}

async function readBlobSlice(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  const buffer = await blob.slice(start, end).arrayBuffer()
  return new Uint8Array(buffer)
}

/** Maximum bytes needed to parse one EBML element header (id vint + size vint). */
const MAX_ELEMENT_HEADER_BYTES = 16

async function readElementHeaderFromBlob(
  blob: Blob,
  offset: number,
  endLimit: number,
): Promise<ElementHeader | null> {
  if (offset >= endLimit) return null
  const peekEnd = Math.min(offset + MAX_ELEMENT_HEADER_BYTES, endLimit)
  const peek = await readBlobSlice(blob, offset, peekEnd)
  const id = readVint(peek, 0, peek.length, true)
  if (!id) return null
  const size = readVint(peek, id.next, peek.length, false)
  if (!size) return null

  const headerLength = size.next
  const dataStart = offset + headerLength
  const dataEnd = Math.min(endLimit, dataStart + size.value)
  if (dataEnd < dataStart) return null
  return { id: id.value, dataStart, dataEnd, next: dataEnd }
}

async function findElementInBlob(
  blob: Blob,
  start: number,
  end: number,
  targetId: number,
): Promise<ElementHeader | null> {
  let offset = start
  while (offset < end) {
    const element = await readElementHeaderFromBlob(blob, offset, end)
    if (!element) return null
    if (element.id === targetId) return element
    offset = element.dataEnd
  }
  return null
}

function parseTimestampScale(bytes: Uint8Array, info: ElementHeader): number | null {
  let scale: number | null = null
  forEachElement(bytes, info.dataStart, info.dataEnd, (element) => {
    if (element.id === IDS.TIMESTAMP_SCALE) {
      scale = readUnsigned(bytes, element.dataStart, element.dataEnd)
    }
  })
  return scale
}

function parseSubtitleTrackInfos(
  bytes: Uint8Array,
  tracksElement: ElementHeader,
): MatroskaSubtitleTrackInfo[] {
  const tracks: MatroskaSubtitleTrackInfo[] = []

  forEachElement(bytes, tracksElement.dataStart, tracksElement.dataEnd, (entry) => {
    if (entry.id !== IDS.TRACK_ENTRY) return

    let trackNumber = -1
    let trackType = -1
    let codecId = ''
    let language = 'und'
    let name: string | undefined
    let defaultTrack = false
    let forced = false
    let defaultDurationSeconds: number | undefined

    forEachElement(bytes, entry.dataStart, entry.dataEnd, (element) => {
      switch (element.id) {
        case IDS.TRACK_NUMBER:
          trackNumber = readUnsigned(bytes, element.dataStart, element.dataEnd)
          break
        case IDS.TRACK_TYPE:
          trackType = readUnsigned(bytes, element.dataStart, element.dataEnd)
          break
        case IDS.CODEC_ID:
          codecId = readAscii(bytes, element.dataStart, element.dataEnd)
          break
        case IDS.LANGUAGE:
        case IDS.LANGUAGE_IETF:
          language = readUtf8(bytes, element.dataStart, element.dataEnd) || 'und'
          break
        case IDS.NAME:
          name = readUtf8(bytes, element.dataStart, element.dataEnd) || undefined
          break
        case IDS.FLAG_DEFAULT:
          defaultTrack = readUnsigned(bytes, element.dataStart, element.dataEnd) !== 0
          break
        case IDS.FLAG_FORCED:
          forced = readUnsigned(bytes, element.dataStart, element.dataEnd) !== 0
          break
        case IDS.DEFAULT_DURATION: {
          const ns = readUnsigned(bytes, element.dataStart, element.dataEnd)
          defaultDurationSeconds = ns / 1_000_000_000
          break
        }
      }
    })

    if (
      trackNumber > 0 &&
      trackType === SUBTITLE_TRACK_TYPE &&
      SUPPORTED_TEXT_CODECS.has(codecId)
    ) {
      tracks.push({
        trackNumber,
        codecId,
        language,
        name,
        default: defaultTrack,
        forced,
        defaultDurationSeconds,
      })
    }
  })

  return tracks
}

function extractClusterCues(
  bytes: Uint8Array,
  cluster: ElementHeader,
  tracks: Map<number, EmbeddedSubtitleTrack>,
  timestampScale: number,
): void {
  let clusterTimecode = 0

  forEachElement(bytes, cluster.dataStart, cluster.dataEnd, (element) => {
    if (element.id === IDS.TIMECODE) {
      clusterTimecode = readUnsigned(bytes, element.dataStart, element.dataEnd)
      return
    }

    if (element.id === IDS.SIMPLE_BLOCK) {
      const cue = parseSubtitleBlock(bytes, element, clusterTimecode, timestampScale)
      if (!cue) return
      const track = tracks.get(cue.trackNumber)
      if (!track) return
      track.cues.push({
        id: `embedded-${track.trackNumber}-${track.cues.length + 1}`,
        startSeconds: cue.startSeconds,
        endSeconds: cue.startSeconds + DEFAULT_CUE_DURATION_SECONDS,
        text: decodeSubtitlePayload(cue.payload, track.codecId),
      })
      return
    }

    if (element.id === IDS.BLOCK_GROUP) {
      extractBlockGroupCue(bytes, element, clusterTimecode, timestampScale, tracks)
    }
  })
}

function extractBlockGroupCue(
  bytes: Uint8Array,
  group: ElementHeader,
  clusterTimecode: number,
  timestampScale: number,
  tracks: Map<number, EmbeddedSubtitleTrack>,
): void {
  const blocks: ParsedSubtitleBlock[] = []
  let blockDurationSeconds: number | null = null

  forEachElement(bytes, group.dataStart, group.dataEnd, (element) => {
    if (element.id === IDS.BLOCK) {
      const block = parseSubtitleBlock(bytes, element, clusterTimecode, timestampScale)
      if (block) blocks.push(block)
    } else if (element.id === IDS.BLOCK_DURATION) {
      blockDurationSeconds = ticksToSeconds(
        readUnsigned(bytes, element.dataStart, element.dataEnd),
        timestampScale,
      )
    }
  })

  const block = blocks[0]
  if (!block) return
  const track = tracks.get(block.trackNumber)
  if (!track) return
  const duration =
    blockDurationSeconds ?? track.defaultDurationSeconds ?? DEFAULT_CUE_DURATION_SECONDS
  track.cues.push({
    id: `embedded-${track.trackNumber}-${track.cues.length + 1}`,
    startSeconds: block.startSeconds,
    endSeconds: block.startSeconds + duration,
    text: decodeSubtitlePayload(block.payload, track.codecId),
  })
}

function parseSubtitleBlock(
  bytes: Uint8Array,
  block: ElementHeader,
  clusterTimecode: number,
  timestampScale: number,
): ParsedSubtitleBlock | null {
  const trackNumberVint = readVint(bytes, block.dataStart, block.dataEnd, false)
  if (!trackNumberVint) return null
  const timecodeOffset = trackNumberVint.next
  if (timecodeOffset + 3 > block.dataEnd) return null

  const signedTimecode = (bytes[timecodeOffset]! << 8) | bytes[timecodeOffset + 1]!
  const blockTimecode = signedTimecode & 0x8000 ? signedTimecode - 0x10000 : signedTimecode
  const payloadStart = timecodeOffset + 3

  return {
    trackNumber: trackNumberVint.value,
    startSeconds: ticksToSeconds(clusterTimecode + blockTimecode, timestampScale),
    payload: bytes.subarray(payloadStart, block.dataEnd),
  }
}

function decodeSubtitlePayload(payload: Uint8Array, codecId: string): string {
  const text = utf8Decoder.decode(payload).trim()
  if (codecId === 'S_TEXT/ASS' || codecId === 'S_TEXT/SSA') {
    return stripAssDialoguePrefix(text)
      .replaceAll('\\N', '\n')
      .replace(/\{[^}]*\}/g, '')
      .trim()
  }
  if (codecId === 'S_TEXT/WEBVTT') {
    return text.replace(/^WEBVTT[^\n]*(?:\n{2,})?/i, '').trim()
  }
  return text
}

function stripAssDialoguePrefix(text: string): string {
  let commaCount = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ',') {
      commaCount++
      if (commaCount === 8) return text.slice(i + 1)
    }
  }
  return text
}

function ticksToSeconds(ticks: number, timestampScale: number): number {
  return (ticks * timestampScale) / 1_000_000_000
}

function findElement(
  bytes: Uint8Array,
  start: number,
  end: number,
  targetId: number,
): ElementHeader | null {
  let found: ElementHeader | null = null
  forEachElement(bytes, start, end, (element) => {
    if (element.id === targetId) {
      found = element
      return false
    }
    return true
  })
  return found
}

function forEachElement(
  bytes: Uint8Array,
  start: number,
  end: number,
  visit: (element: ElementHeader) => void | boolean,
): void {
  let offset = start
  while (offset < end) {
    const element = readElementHeader(bytes, offset, end)
    if (!element) return
    const result = visit(element)
    if (result === false) return
    offset = element.next
  }
}

function readElementHeader(bytes: Uint8Array, offset: number, end: number): ElementHeader | null {
  const id = readVint(bytes, offset, end, true)
  if (!id) return null
  const size = readVint(bytes, id.next, end, false)
  if (!size) return null

  const dataStart = size.next
  const dataEnd = Math.min(end, dataStart + size.value)
  if (dataEnd < dataStart) return null
  return {
    id: id.value,
    dataStart,
    dataEnd,
    next: dataEnd,
  }
}

function readVint(
  bytes: Uint8Array,
  offset: number,
  end: number,
  keepMarker: boolean,
): { value: number; next: number } | null {
  if (offset >= end) return null
  const first = bytes[offset]!
  if (first === 0) return null

  let mask = 0x80
  let length = 1
  while (length <= 8 && (first & mask) === 0) {
    mask >>= 1
    length++
  }
  if (length > 8 || offset + length > end) return null

  let value = keepMarker ? first : first & (mask - 1)
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[offset + i]!
  }

  return { value, next: offset + length }
}

function readUnsigned(bytes: Uint8Array, start: number, end: number): number {
  let value = 0
  for (let i = start; i < end; i++) {
    value = value * 256 + bytes[i]!
  }
  return value
}

function readAscii(bytes: Uint8Array, start: number, end: number): string {
  let value = ''
  for (let i = start; i < end; i++) {
    value += String.fromCharCode(bytes[i]!)
  }
  return value
}

function readUtf8(bytes: Uint8Array, start: number, end: number): string {
  return utf8Decoder.decode(bytes.subarray(start, end))
}
