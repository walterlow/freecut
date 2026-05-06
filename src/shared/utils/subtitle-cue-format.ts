/**
 * Parse a subtitle cue's raw text into formatted runs plus optional
 * positioning overrides.
 *
 * Handles the inline markup that shows up in real-world SRT/VTT/ASS:
 *   - `<i>...</i>`        → fontStyle: italic
 *   - `<b>...</b>`        → fontWeight: bold
 *   - `<u>...</u>`        → underline
 *   - `<font color="X">…` → color (X is any CSS color)
 *   - `{\anN}` (1-9)      → ASS positioning override (numpad layout)
 *
 * Anything we don't recognize is left alone; the parser is intentionally
 * permissive so a cue containing a literal `<` doesn't get mangled.
 */
import type { TextSpan } from '@/types/timeline'

export interface ParsedSubtitleCue {
  spans: TextSpan[]
  /** Plain text concatenation of every span — useful for fallback rendering. */
  plainText: string
  /** Empty string when the cue resolves to no visible text. */
  isEmpty: boolean
  alignment?: {
    textAlign: 'left' | 'center' | 'right'
    verticalAlign: 'top' | 'middle' | 'bottom'
  }
}

interface SpanFormat {
  fontStyle?: 'italic'
  fontWeight?: 'bold'
  underline?: true
  color?: string
}

/**
 * ASS `\anN` numpad layout — 7=top-left, 8=top-center, …, 5=middle-center,
 * …, 2=bottom-center, 3=bottom-right.
 */
const ASS_ALIGNMENT_MAP: Record<
  string,
  { textAlign: 'left' | 'center' | 'right'; verticalAlign: 'top' | 'middle' | 'bottom' }
> = {
  '1': { textAlign: 'left', verticalAlign: 'bottom' },
  '2': { textAlign: 'center', verticalAlign: 'bottom' },
  '3': { textAlign: 'right', verticalAlign: 'bottom' },
  '4': { textAlign: 'left', verticalAlign: 'middle' },
  '5': { textAlign: 'center', verticalAlign: 'middle' },
  '6': { textAlign: 'right', verticalAlign: 'middle' },
  '7': { textAlign: 'left', verticalAlign: 'top' },
  '8': { textAlign: 'center', verticalAlign: 'top' },
  '9': { textAlign: 'right', verticalAlign: 'top' },
}

const TAG_PATTERN = /<\/?(?:i|b|u|font|c|v|ruby|rt|lang)\b[^>]*>|\{\\an[1-9]\}|\{\\[^}]*\}/gi

export function parseSubtitleCueText(raw: string): ParsedSubtitleCue {
  if (raw.length === 0) {
    return { spans: [], plainText: '', isEmpty: true }
  }

  let alignment: ParsedSubtitleCue['alignment']
  const tokens = tokenize(raw)

  // Walk tokens, maintaining a format stack for nested tags.
  const formatStack: SpanFormat[] = [{}]
  const spans: TextSpan[] = []
  let plainText = ''

  for (const token of tokens) {
    if (token.kind === 'text') {
      const current = formatStack[formatStack.length - 1]!
      if (token.value.length === 0) continue
      const last = spans[spans.length - 1]
      // Coalesce adjacent runs with the same formatting so the resulting
      // span list is as short as possible (matters for storage and the
      // text-spans renderer's per-span DOM cost).
      if (last && spanFormatMatches(last, current)) {
        last.text += token.value
      } else {
        spans.push({ text: token.value, ...current })
      }
      plainText += token.value
      continue
    }

    if (token.kind === 'open') {
      const next = mergeFormat(formatStack[formatStack.length - 1]!, token.format)
      formatStack.push(next)
      continue
    }

    if (token.kind === 'close') {
      // Pop the matching tag; if the cue is malformed we just keep going.
      if (formatStack.length > 1) formatStack.pop()
      continue
    }

    if (token.kind === 'alignment') {
      alignment = token.alignment
    }
    // 'unknown' braces (other ASS overrides) are silently dropped.
  }

  return {
    spans,
    plainText: plainText.trim(),
    isEmpty: plainText.trim().length === 0,
    alignment,
  }
}

interface TextToken {
  kind: 'text'
  value: string
}
interface OpenToken {
  kind: 'open'
  format: SpanFormat
}
interface CloseToken {
  kind: 'close'
  tag: string
}
interface AlignmentToken {
  kind: 'alignment'
  alignment: NonNullable<ParsedSubtitleCue['alignment']>
}
interface UnknownToken {
  kind: 'unknown'
}
type Token = TextToken | OpenToken | CloseToken | AlignmentToken | UnknownToken

function tokenize(raw: string): Token[] {
  const tokens: Token[] = []
  TAG_PATTERN.lastIndex = 0
  let lastIndex = 0
  for (const match of raw.matchAll(TAG_PATTERN)) {
    const start = match.index ?? 0
    if (start > lastIndex) {
      tokens.push({ kind: 'text', value: raw.slice(lastIndex, start) })
    }
    tokens.push(classifyTag(match[0]))
    lastIndex = start + match[0].length
  }
  if (lastIndex < raw.length) {
    tokens.push({ kind: 'text', value: raw.slice(lastIndex) })
  }
  return tokens
}

function classifyTag(tag: string): Token {
  // ASS `{\anN}` alignment override.
  const ann = /^\{\\an([1-9])\}$/i.exec(tag)
  if (ann) {
    const value = ASS_ALIGNMENT_MAP[ann[1]!]
    if (value) return { kind: 'alignment', alignment: value }
    return { kind: 'unknown' }
  }
  // Other ASS overrides — `{\i1}`, `{\b1}`, etc. Could be handled later.
  if (tag.startsWith('{')) return { kind: 'unknown' }

  const closing = /^<\/([a-z]+)\b/i.exec(tag)
  if (closing) return { kind: 'close', tag: closing[1]!.toLowerCase() }

  const opening = /^<([a-z]+)\b([^>]*)>$/i.exec(tag)
  if (!opening) return { kind: 'unknown' }
  const name = opening[1]!.toLowerCase()
  const attrs = opening[2] ?? ''
  switch (name) {
    case 'i':
      return { kind: 'open', format: { fontStyle: 'italic' } }
    case 'b':
      return { kind: 'open', format: { fontWeight: 'bold' } }
    case 'u':
      return { kind: 'open', format: { underline: true } }
    case 'font': {
      const colorMatch = /color\s*=\s*"?([^"\s>]+)"?/i.exec(attrs)
      if (colorMatch) return { kind: 'open', format: { color: colorMatch[1]! } }
      return { kind: 'open', format: {} }
    }
    default:
      return { kind: 'open', format: {} }
  }
}

function mergeFormat(base: SpanFormat, patch: SpanFormat): SpanFormat {
  return { ...base, ...patch }
}

function spanFormatMatches(span: TextSpan, format: SpanFormat): boolean {
  return (
    (span.fontStyle ?? undefined) === format.fontStyle &&
    (span.fontWeight ?? undefined) === format.fontWeight &&
    (span.underline ?? undefined) === format.underline &&
    (span.color ?? undefined) === format.color
  )
}

export interface CueFormatFlags {
  italic: boolean
  bold: boolean
  underline: boolean
}

/**
 * Inspect a cue's parsed spans and return whether the *entire* cue is
 * italic/bold/underlined. Mixed-formatting cues (some runs italic, some
 * not) are reported as `false` for that flag — the inspector treats
 * formatting as cue-wide because per-run editing isn't currently exposed.
 */
export function getCueFormatFlags(parsed: ParsedSubtitleCue): CueFormatFlags {
  if (parsed.spans.length === 0) return { italic: false, bold: false, underline: false }
  return {
    italic: parsed.spans.every((s) => s.fontStyle === 'italic'),
    bold: parsed.spans.every((s) => s.fontWeight === 'bold'),
    underline: parsed.spans.every((s) => s.underline === true),
  }
}

const ALIGNMENT_TO_AN: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const [n, value] of Object.entries(ASS_ALIGNMENT_MAP)) {
    map[`${value.textAlign}|${value.verticalAlign}`] = n
  }
  return map
})()

function alignmentToAnNumber(
  alignment: NonNullable<ParsedSubtitleCue['alignment']>,
): string | null {
  return ALIGNMENT_TO_AN[`${alignment.textAlign}|${alignment.verticalAlign}`] ?? null
}

/**
 * Re-emit cue text from a plain-text body plus desired formatting flags.
 * Preserves any ASS `{\anN}` alignment that was present in `previousText`
 * so editing the textarea doesn't drop the cue's positioning.
 *
 * Output order: `{\anN}<b><i><u>text</u></i></b>` — fixed nesting keeps
 * round-trips stable.
 */
export function buildCueText(
  plainText: string,
  flags: CueFormatFlags,
  previousText: string,
): string {
  const previous = parseSubtitleCueText(previousText)
  let result = plainText
  if (flags.underline) result = `<u>${result}</u>`
  if (flags.italic) result = `<i>${result}</i>`
  if (flags.bold) result = `<b>${result}</b>`
  if (previous.alignment) {
    const an = alignmentToAnNumber(previous.alignment)
    if (an !== null) result = `{\\an${an}}${result}`
  }
  return result
}

/**
 * Toggle a single format flag for an existing cue. Reads current flags
 * from the cue's parsed spans, flips the requested one, and rebuilds.
 */
export function toggleCueFormat(text: string, format: keyof CueFormatFlags): string {
  const parsed = parseSubtitleCueText(text)
  const current = getCueFormatFlags(parsed)
  const next: CueFormatFlags = { ...current, [format]: !current[format] }
  return buildCueText(parsed.plainText, next, text)
}
