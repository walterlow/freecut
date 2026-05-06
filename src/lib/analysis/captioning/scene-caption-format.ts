import type { SceneCaptionData } from './types'

export const CANONICAL_SHOT_SIZES = [
  'extreme wide shot',
  'wide shot',
  'medium-wide shot',
  'medium shot',
  'medium close-up',
  'close-up',
  'extreme close-up',
] as const

export const LFM_SCENE_CAPTION_PROMPT =
  'Analyze this single video frame and return a valid JSON object only.\n\n' +
  'Use this exact schema:\n' +
  '{' +
  '"caption": string, ' +
  '"shotType": string | null, ' +
  '"subjects": string[], ' +
  '"action": string | null, ' +
  '"setting": string | null, ' +
  '"lighting": string | null, ' +
  '"timeOfDay": string | null, ' +
  '"weather": string | null' +
  '}\n\n' +
  'Rules:\n' +
  '- "caption" must be one detailed natural sentence.\n' +
  '- Describe the visible subject, action, setting, lighting, time of day, and weather when clearly visible.\n' +
  `- "shotType" is optional and must be one of: ${CANONICAL_SHOT_SIZES.join(', ')}.\n` +
  '- If shot size is not unmistakable, use null.\n' +
  '- If time of day or weather is unclear, use null.\n' +
  '- Use null for missing scalar fields and [] for missing subjects.\n' +
  '- The first character of the response must be { and the last character must be }.\n' +
  '- Use double quotes around every key and every string value.\n' +
  '- Do not mention camera motion, camera movement, editing, or uncertainty.\n' +
  '- Do not wrap the JSON in markdown fences or prose.'

const LABEL_PREFIX_PATTERN = /^(?:caption|scene|description)\s*:\s*/i
const JSON_LEAD_IN_PATTERN = /^(?:json(?:\s+(?:object|response))?|response|output)\s*[:-]?\s*/i
const SHOT_LABEL_PREFIX_PATTERN = /^shot(?:\s+type)?\s*:\s*/i
const LEAD_IN_PATTERNS = [
  /^(?:this|the)\s+(?:image|frame|scene|shot)\s+(?:shows|depicts|features)\s+/i,
  /^(?:we can see|we see)\s+/i,
] as const
const SHOT_ONLY_PATTERN =
  /^(?:shot(?:\s+type)?\s*:\s*)?(?:extreme wide shot|wide shot|medium-wide shot|medium shot|medium close-up|close-up|extreme close-up)$/i
const UNCERTAIN_ENVIRONMENT_TAIL_PATTERN =
  /(?:,\s*|\s+-\s+|\s+)(?:possibly|maybe|perhaps|likely|apparently|seemingly|it\s+seems\s+to\s+be|it\s+appears\s+to\s+be|appears\s+to\s+be|seems\s+to\s+be)\s+(?:at\s+)?(?:sunrise|dawn|morning|day(?:time)?|afternoon|golden\s+hour|sunset|dusk|night(?:time)?|rain(?:y|ing)?|snow(?:y|ing)?|fog(?:gy)?|mist(?:y)?|overcast|cloudy|sunny|storm(?:y)?|clear(?:\s+sk(?:y|ies))?)\b[^.?!,;:]*$/i
const EMPTY_FIELD_PATTERN = /^(?:null|none|n\/a|unknown|unclear|not visible|not obvious)$/i
const QUOTE_WRAPPER_PATTERN = /^"(.*)"$/s

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function stripOuterQuotes(text: string): string {
  return text.replace(/^[`"']+|[`"']+$/g, '')
}

function stripLeadIns(text: string): string {
  let next = text.trim()
  next = next.replace(/^[\s\-*]+/, '')
  next = next.replace(JSON_LEAD_IN_PATTERN, '')
  next = next.replace(LABEL_PREFIX_PATTERN, '')

  for (const pattern of LEAD_IN_PATTERNS) {
    next = next.replace(pattern, '')
  }

  return next.trim()
}

function stripTerminalPunctuation(text: string): string {
  return text.replace(/[.!?]+$/u, '').trim()
}

function lowerCaseFirst(text: string): string {
  if (text.length === 0) return text
  return text.charAt(0).toLowerCase() + text.slice(1)
}

function upperCaseFirst(text: string): string {
  if (text.length === 0) return text
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function normalizeShotVocabulary(text: string): string {
  let next = text

  const replacements: Array<[RegExp, string]> = [
    [/\bextreme[\s-]+long shot\b/gi, 'extreme wide shot'],
    [/\bextreme[\s-]+wide shot\b/gi, 'extreme wide shot'],
    [/\bmedium[\s-]+wide shot\b/gi, 'medium-wide shot'],
    [/\bmedium[\s-]+close[\s-]*up\b/gi, 'medium close-up'],
    [/\bmedium[\s-]+close shot\b/gi, 'medium close-up'],
    [/\bextreme[\s-]+close[\s-]*up\b/gi, 'extreme close-up'],
    [/\bclose[\s-]*up\b/gi, 'close-up'],
    [/\blong shot\b/gi, 'wide shot'],
    [/\bwide shot\b/gi, 'wide shot'],
    [/\bmedium shot\b/gi, 'medium shot'],
  ]

  for (const [pattern, replacement] of replacements) {
    next = next.replace(pattern, replacement)
  }

  return next
}

function collapseToSingleSentence(text: string): string {
  const fragments = text
    .split(/(?:\r?\n)+|(?<=[.!?])\s+|;\s+/u)
    .map((fragment) => normalizeWhitespace(stripOuterQuotes(fragment)))
    .filter(Boolean)

  if (fragments.length === 0) return ''
  if (fragments.length === 1) return fragments[0]!

  const first = normalizeShotVocabulary(stripTerminalPunctuation(fragments[0]!))
  if (SHOT_ONLY_PATTERN.test(first)) {
    const shot = stripTerminalPunctuation(
      first.replace(SHOT_LABEL_PREFIX_PATTERN, ''),
    ).toLowerCase()
    const followUp = stripTerminalPunctuation(stripLeadIns(fragments[1]!))
    if (followUp.length > 0) {
      return `${shot} in which ${lowerCaseFirst(followUp)}`
    }
  }

  return fragments[0]!
}

function stripUncertainEnvironmentTail(text: string): string {
  return text.replace(UNCERTAIN_ENVIRONMENT_TAIL_PATTERN, '')
}

function stripLeadingShotArticle(text: string): string {
  return text.replace(
    /^(?:a|an)\s+(extreme wide shot|wide shot|medium-wide shot|medium shot|medium close-up|close-up|extreme close-up)\b/i,
    (_, shot: string) => shot.toLowerCase(),
  )
}

function sanitizeScalar(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = normalizeWhitespace(stripOuterQuotes(value))
  if (normalized.length === 0 || EMPTY_FIELD_PATTERN.test(normalized)) return undefined
  return normalized
}

function sanitizeSubjects(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const subjects = value
    .map((entry) => sanitizeScalar(entry))
    .filter((entry): entry is string => Boolean(entry))
  return subjects.length > 0 ? subjects : undefined
}

function normalizeShotType(value: unknown): string | undefined {
  const scalar = sanitizeScalar(value)
  if (!scalar) return undefined
  const compact = stripTerminalPunctuation(scalar).toLowerCase()
  const aliasMap: Record<string, string> = {
    'extreme wide': 'extreme wide shot',
    'extreme wide shot': 'extreme wide shot',
    'extreme long shot': 'extreme wide shot',
    wide: 'wide shot',
    'wide shot': 'wide shot',
    'long shot': 'wide shot',
    'medium wide': 'medium-wide shot',
    'medium wide shot': 'medium-wide shot',
    'medium-wide shot': 'medium-wide shot',
    medium: 'medium shot',
    'medium shot': 'medium shot',
    'medium close': 'medium close-up',
    'medium close up': 'medium close-up',
    'medium close-up': 'medium close-up',
    close: 'close-up',
    'close up': 'close-up',
    'close-up': 'close-up',
    'extreme close': 'extreme close-up',
    'extreme close up': 'extreme close-up',
    'extreme close-up': 'extreme close-up',
  }
  const normalized = aliasMap[compact] ?? normalizeShotVocabulary(compact).toLowerCase()
  return CANONICAL_SHOT_SIZES.find((shot) => shot === normalized)
}

function hasStructuredFields(data: SceneCaptionData): boolean {
  return Boolean(
    data.caption ||
    data.shotType ||
    (data.subjects && data.subjects.length > 0) ||
    data.action ||
    data.setting ||
    data.lighting ||
    data.timeOfDay ||
    data.weather,
  )
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function decodeLooseValue(raw: string): string | null | undefined {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined
  if (/^null$/i.test(trimmed)) return null

  if (/^"(?:\\.|[^"])*"$/s.test(trimmed)) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      return typeof parsed === 'string' ? parsed : undefined
    } catch {
      return stripOuterQuotes(trimmed)
    }
  }

  if (/^'(?:\\.|[^'])*'$/s.test(trimmed)) {
    return stripOuterQuotes(trimmed)
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }

  return trimmed.replace(/[.,;:]+$/u, '').trim()
}

function extractLooseScalar(raw: string, keys: string[]): string | null | undefined {
  const pattern = new RegExp(
    String.raw`(?:["']?(?:${keys.map(escapeRegExp).join('|')})["']?)\s*:\s*(null|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^,\r\n}]+)`,
    'i',
  )
  const match = raw.match(pattern)
  return match?.[1] ? decodeLooseValue(match[1]) : undefined
}

function extractLooseSubjects(raw: string): string[] | undefined {
  const match = raw.match(/(?:["']?subjects["']?)\s*:\s*\[([\s\S]*?)\]/i)
  if (!match) return undefined

  const entries = Array.from((match[1] ?? '').matchAll(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^,\]]+/g))
    .map((entry) => decodeLooseValue(entry[0]))
    .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)

  return entries
}

function parseLooseJsonObject(raw: string): Record<string, unknown> | null {
  const object: Record<string, unknown> = {}
  const normalized = stripLeadIns(raw)

  const caption = extractLooseScalar(normalized, ['caption'])
  if (caption !== undefined) object.caption = caption

  const shotType = extractLooseScalar(normalized, ['shotType', 'shot_type'])
  if (shotType !== undefined) object.shotType = shotType

  const subjects = extractLooseSubjects(normalized)
  if (subjects !== undefined) object.subjects = subjects

  const action = extractLooseScalar(normalized, ['action'])
  if (action !== undefined) object.action = action

  const setting = extractLooseScalar(normalized, ['setting'])
  if (setting !== undefined) object.setting = setting

  const lighting = extractLooseScalar(normalized, ['lighting'])
  if (lighting !== undefined) object.lighting = lighting

  const timeOfDay = extractLooseScalar(normalized, ['timeOfDay', 'time_of_day'])
  if (timeOfDay !== undefined) object.timeOfDay = timeOfDay

  const weather = extractLooseScalar(normalized, ['weather'])
  if (weather !== undefined) object.weather = weather

  return Object.keys(object).length > 0 ? object : null
}

function extractJsonCandidate(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    return fenced[1].trim()
  }

  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return raw.slice(start, end + 1)
  }

  return null
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const candidate = extractJsonCandidate(raw)
  if (!candidate) return null

  try {
    const parsed = JSON.parse(candidate) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function readField(object: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in object) return object[key]
  }
  return undefined
}

export function normalizeSceneCaptionData(object: Record<string, unknown>): SceneCaptionData {
  const sceneData: SceneCaptionData = {
    caption: sanitizeScalar(readField(object, 'caption')),
    shotType: normalizeShotType(readField(object, 'shotType', 'shot_type')),
    subjects: sanitizeSubjects(readField(object, 'subjects')),
    action: sanitizeScalar(readField(object, 'action')),
    setting: sanitizeScalar(readField(object, 'setting')),
    lighting: sanitizeScalar(readField(object, 'lighting')),
    timeOfDay: sanitizeScalar(readField(object, 'timeOfDay', 'time_of_day')),
    weather: sanitizeScalar(readField(object, 'weather')),
  }

  return hasStructuredFields(sceneData) ? sceneData : {}
}

function maybeWrapWithOf(fragment: string): string {
  return /^(?:of|in|on|at)\b/i.test(fragment) ? fragment : `of ${fragment}`
}

export function formatSceneCaption(raw: string): string {
  let next = normalizeWhitespace(stripOuterQuotes(raw))
  if (next.length === 0) return ''

  const quoted = next.match(QUOTE_WRAPPER_PATTERN)
  if (quoted?.[1]) {
    next = quoted[1]
  }

  next = stripLeadIns(next)
  next = collapseToSingleSentence(next)
  next = stripUncertainEnvironmentTail(next)
  next = stripLeadIns(next)
  next = normalizeShotVocabulary(next)
  next = stripLeadingShotArticle(next)
  next = stripTerminalPunctuation(normalizeWhitespace(next))

  if (next.length === 0) return ''

  next = upperCaseFirst(next)
  return /[.!?]$/u.test(next) ? next : `${next}.`
}

export function formatSceneCaptionFromData(data: SceneCaptionData): string {
  const subjectText = data.subjects?.join(', ')
  let body = ''

  if (subjectText && data.action) {
    body = `${subjectText} ${lowerCaseFirst(data.action)}`
  } else if (subjectText) {
    body = subjectText
  } else if (data.action) {
    body = data.action
  } else if (data.setting) {
    body = `scene in ${data.setting}`
  } else if (data.lighting) {
    body = `scene in ${data.lighting}`
  }

  if (data.setting && body && !body.toLowerCase().includes(data.setting.toLowerCase())) {
    body = `${body} in ${data.setting}`
  }

  if (data.weather) {
    body = body ? `${body} in ${data.weather} weather` : `${data.weather} weather`
  }

  if (data.timeOfDay) {
    body = body ? `${body} at ${data.timeOfDay}` : data.timeOfDay
  }

  if (!body && data.caption) {
    body = data.caption
  }

  if (!body) return ''

  if (data.shotType) {
    return formatSceneCaption(`${data.shotType} ${maybeWrapWithOf(body)}`)
  }

  return formatSceneCaption(body)
}

export function parseSceneCaptionResponse(raw: string): {
  text: string
  sceneData?: SceneCaptionData
} {
  const parsed = parseJsonObject(raw) ?? parseLooseJsonObject(raw)
  if (!parsed) {
    const text = formatSceneCaption(raw)
    return text ? { text } : { text: '' }
  }

  const sceneData = normalizeSceneCaptionData(parsed)
  const text = sceneData.caption
    ? formatSceneCaption(sceneData.caption)
    : formatSceneCaptionFromData(sceneData) || formatSceneCaption(raw)

  if (!text) {
    return { text: '' }
  }

  if (!hasStructuredFields(sceneData)) {
    return { text }
  }

  return {
    text,
    sceneData: {
      ...sceneData,
      caption: text,
    },
  }
}
