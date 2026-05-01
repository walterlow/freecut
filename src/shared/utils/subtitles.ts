export type SubtitleFormat = 'srt' | 'vtt'

export interface SubtitleCue {
  id: string
  startSeconds: number
  endSeconds: number
  text: string
}

export interface SubtitleParseResult {
  cues: SubtitleCue[]
  warnings: string[]
}

const TIMESTAMP_PATTERN =
  /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})([,.])(\d{1,3})\s+-->\s+(?:(\d{1,2}):)?(\d{1,2}):(\d{2})([,.])(\d{1,3})(?:\s+.*)?$/

export function inferSubtitleFormat(fileName: string): SubtitleFormat | null {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.srt')) return 'srt'
  if (lower.endsWith('.vtt')) return 'vtt'
  return null
}

export function parseSubtitleFile(text: string, format: SubtitleFormat): SubtitleParseResult {
  return format === 'srt' ? parseSrt(text) : parseVtt(text)
}

export function serializeSubtitleFile(
  cues: readonly SubtitleCue[],
  format: SubtitleFormat,
): string {
  return format === 'srt' ? serializeSrt(cues) : serializeVtt(cues)
}

export function parseSrt(text: string): SubtitleParseResult {
  return parseSubtitleBlocks(stripBom(text).replace(/\r\n?/g, '\n'), 'srt')
}

export function parseVtt(text: string): SubtitleParseResult {
  const normalized = stripBom(text).replace(/\r\n?/g, '\n')
  const withoutHeader = normalized.replace(/^WEBVTT(?:[^\n]*)\n+/, '')
  return parseSubtitleBlocks(withoutHeader, 'vtt')
}

export function serializeSrt(cues: readonly SubtitleCue[]): string {
  return normalizeCuesForExport(cues)
    .map((cue, index) =>
      [
        String(index + 1),
        `${formatSrtTimestamp(cue.startSeconds)} --> ${formatSrtTimestamp(cue.endSeconds)}`,
        cue.text,
      ].join('\n'),
    )
    .join('\n\n')
}

export function serializeVtt(cues: readonly SubtitleCue[]): string {
  const body = normalizeCuesForExport(cues)
    .map(
      (cue) =>
        `${formatVttTimestamp(cue.startSeconds)} --> ${formatVttTimestamp(cue.endSeconds)}\n${cue.text}`,
    )
    .join('\n\n')
  return `WEBVTT\n\n${body}`
}

function parseSubtitleBlocks(text: string, format: SubtitleFormat): SubtitleParseResult {
  const warnings: string[] = []
  const cues: SubtitleCue[] = []
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  for (const [blockIndex, block] of blocks.entries()) {
    const lines = block.split('\n')
    const timestampLineIndex = lines.findIndex((line) => line.includes('-->'))

    if (timestampLineIndex === -1) {
      if (!isSkippableVttBlock(lines[0] ?? '', format)) {
        warnings.push(`Skipped block ${blockIndex + 1}: missing timestamp`)
      }
      continue
    }

    const timestamp = parseTimestampRange(lines[timestampLineIndex]!.trim())
    if (!timestamp) {
      warnings.push(`Skipped block ${blockIndex + 1}: invalid timestamp`)
      continue
    }

    if (timestamp.endSeconds <= timestamp.startSeconds) {
      warnings.push(`Skipped block ${blockIndex + 1}: end time must be after start time`)
      continue
    }

    const textLines = lines
      .slice(timestampLineIndex + 1)
      .map((line) => stripVttCueMarkup(line).trimEnd())
    const cueText = textLines.join('\n').trim()
    if (!cueText) {
      warnings.push(`Skipped block ${blockIndex + 1}: empty cue text`)
      continue
    }

    cues.push({
      id: `cue-${cues.length + 1}`,
      startSeconds: timestamp.startSeconds,
      endSeconds: timestamp.endSeconds,
      text: cueText,
    })
  }

  const sorted = [...cues].sort((a, b) => a.startSeconds - b.startSeconds)
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1]!
    const current = sorted[i]!
    if (current.startSeconds < previous.endSeconds) {
      warnings.push(`Cue ${i + 1} overlaps the previous cue`)
    }
  }

  return { cues: sorted, warnings }
}

function parseTimestampRange(line: string): { startSeconds: number; endSeconds: number } | null {
  const match = line.match(TIMESTAMP_PATTERN)
  if (!match) return null

  const startSeconds = timestampPartsToSeconds(match[1], match[2], match[3], match[5])
  const endSeconds = timestampPartsToSeconds(match[6], match[7], match[8], match[10])
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) return null
  return { startSeconds, endSeconds }
}

function timestampPartsToSeconds(
  hours: string | undefined,
  minutes: string | undefined,
  seconds: string | undefined,
  millis: string | undefined,
): number {
  const h = Number.parseInt(hours ?? '0', 10)
  const m = Number.parseInt(minutes ?? '0', 10)
  const s = Number.parseInt(seconds ?? '0', 10)
  const ms = Number.parseInt((millis ?? '0').padEnd(3, '0').slice(0, 3), 10)
  return h * 3600 + m * 60 + s + ms / 1000
}

function formatSrtTimestamp(seconds: number): string {
  return formatTimestamp(seconds, ',')
}

function formatVttTimestamp(seconds: number): string {
  return formatTimestamp(seconds, '.')
}

function formatTimestamp(seconds: number, separator: ',' | '.'): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000))
  const ms = totalMs % 1000
  const totalSeconds = Math.floor(totalMs / 1000)
  const s = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const m = totalMinutes % 60
  const h = Math.floor(totalMinutes / 60)
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}${separator}${String(ms).padStart(3, '0')}`
}

function normalizeCuesForExport(cues: readonly SubtitleCue[]): SubtitleCue[] {
  return cues
    .filter((cue) => cue.text.trim().length > 0 && cue.endSeconds > cue.startSeconds)
    .map((cue) => ({ ...cue, text: cue.text.trim() }))
    .sort((a, b) => a.startSeconds - b.startSeconds)
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function stripVttCueMarkup(line: string): string {
  return line.replace(/<[^>]+>/g, '')
}

function isSkippableVttBlock(firstLine: string, format: SubtitleFormat): boolean {
  if (format !== 'vtt') return false
  return firstLine.startsWith('NOTE') || firstLine === 'STYLE' || firstLine === 'REGION'
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}
