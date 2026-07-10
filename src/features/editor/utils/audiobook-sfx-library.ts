import type { MediaMetadata } from '@/types/storage'
import type { AudiobookSfxCue, AudiobookSfxCueRole } from './audiobook-sfx'

export interface AudiobookSfxLibraryMatch {
  cue: AudiobookSfxCue
  media: MediaMetadata
  score: number
  reasons: string[]
}

export interface AudiobookSfxLibraryMatchOptions {
  excludeMediaIds?: string[]
  minimumScore?: number
  maxUsesPerAsset?: number
}

interface RoleKeywords {
  positive: string[]
  negative: string[]
}

const DEFAULT_MINIMUM_SCORE = 6
const DEFAULT_MAX_USES_PER_ASSET = 2

const STRONG_LIBRARY_TAGS = [
  'sfx',
  'sound-effect',
  'sound effect',
  'foley',
  'cinematic-sfx',
  'studio-sfx',
  'impact',
  'transition',
  'ambience',
  'room-tone',
]

const MUSIC_OR_NARRATION_TERMS = [
  'narration',
  'voiceover',
  'voice over',
  'dialog',
  'dialogue',
  'tts',
  'music',
  'song',
  'score',
  'bed',
  'underscore',
  'podcast',
  'audiobook',
]

const ROLE_KEYWORDS: Record<AudiobookSfxCueRole, RoleKeywords> = {
  ambience: {
    positive: ['ambience', 'amb', 'room tone', 'roomtone', 'atmos', 'atmosphere', 'tone', 'bed'],
    negative: ['hit', 'boom', 'slam', 'sting'],
  },
  foreground: {
    positive: ['foley', 'close', 'detail', 'prop', 'movement', 'rustle', 'click', 'step'],
    negative: ['music', 'score', 'song'],
  },
  impact: {
    positive: [
      'impact',
      'hit',
      'boom',
      'thud',
      'slam',
      'punch',
      'riser',
      'whoosh',
      'sub',
      'trailer',
    ],
    negative: ['ambience', 'room tone', 'music'],
  },
  transition: {
    positive: ['transition', 'sting', 'whoosh', 'riser', 'swell', 'hit', 'chapter', 'title'],
    negative: ['ambience', 'room tone', 'music'],
  },
}

const LABEL_KEYWORDS: Array<{ pattern: RegExp; terms: string[] }> = [
  { pattern: /chapter|opening|title/i, terms: ['chapter', 'title', 'sting', 'transition'] },
  { pattern: /folder|paper/i, terms: ['folder', 'paper', 'page', 'rustle', 'desk'] },
  { pattern: /phone|keyboard|keys/i, terms: ['phone', 'keyboard', 'typing', 'key', 'click'] },
  {
    pattern: /public|power|reveal|name|decision|secrecy|story|scene/i,
    terms: ['impact', 'hit', 'reveal', 'thriller', 'boom', 'sting'],
  },
  { pattern: /storm/i, terms: ['storm', 'rain', 'thunder', 'lightning'] },
  { pattern: /door/i, terms: ['door', 'creak', 'knock', 'slam'] },
  { pattern: /footstep/i, terms: ['footstep', 'steps', 'walk', 'shoe'] },
  { pattern: /clock/i, terms: ['clock', 'tick', 'tock', 'chime'] },
  { pattern: /magic/i, terms: ['magic', 'shimmer', 'sparkle', 'spell'] },
  { pattern: /wind/i, terms: ['wind', 'breeze', 'air'] },
  { pattern: /water/i, terms: ['water', 'river', 'rain', 'wave'] },
  { pattern: /fire/i, terms: ['fire', 'flame', 'crackle', 'ember'] },
  { pattern: /metal/i, terms: ['metal', 'gear', 'chain', 'mechanical'] },
  { pattern: /town|city/i, terms: ['town', 'city', 'street', 'crowd'] },
]

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_./\\()[\]{}-]+/g, ' ')
    .replace(/[^\w\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasTerm(haystack: string, term: string): boolean {
  const normalizedTerm = normalizeText(term)
  if (!normalizedTerm) return false
  return new RegExp(`(^|\\s)${normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(
    haystack,
  )
}

function mediaSearchText(media: MediaMetadata): string {
  return normalizeText(`${media.fileName} ${(media.tags ?? []).join(' ')}`)
}

function cueSearchTerms(cue: AudiobookSfxCue): string[] {
  const labelTerms = LABEL_KEYWORDS.find((entry) => entry.pattern.test(cue.label))?.terms ?? []
  return [
    cue.label,
    cue.role,
    ...ROLE_KEYWORDS[cue.role].positive,
    ...labelTerms,
    ...cue.sourceText.split(/\s+/).slice(0, 8),
  ]
}

function isAudioMedia(media: MediaMetadata): boolean {
  return (
    media.mimeType.startsWith('audio/') ||
    /\.(wav|mp3|m4a|aac|aif|aiff|flac|ogg)$/i.test(media.fileName)
  )
}

function isLikelyLibrarySfx(searchText: string): boolean {
  return STRONG_LIBRARY_TAGS.some((term) => hasTerm(searchText, term))
}

const DURATION_RULES: Record<
  AudiobookSfxCueRole | 'default',
  Array<{ min?: number; max?: number; score: number }>
> = {
  ambience: [{ min: 8, max: 90, score: 1.4 }, { min: 3, score: 0.5 }, { score: -1.4 }],
  impact: [{ min: 0.4, max: 6, score: 1.2 }, { max: 12, score: 0.4 }, { score: -1.2 }],
  transition: [{ min: 0.4, max: 6, score: 1.2 }, { max: 12, score: 0.4 }, { score: -1.2 }],
  foreground: [{ min: 0.3, max: 8, score: 1 }, { max: 14, score: 0.2 }, { score: -0.8 }],
  default: [{ min: 0.3, max: 8, score: 1 }, { max: 14, score: 0.2 }, { score: -0.8 }],
}

function matchesDurationRule(duration: number, rule: { min?: number; max?: number }): boolean {
  const aboveMin = rule.min == null || duration >= rule.min
  const belowMax = rule.max == null || duration <= rule.max
  return aboveMin && belowMax
}

function scoreDuration(media: MediaMetadata, role: AudiobookSfxCueRole): number {
  const duration = media.duration
  if (!Number.isFinite(duration) || duration <= 0) return 0.4
  return (DURATION_RULES[role] ?? DURATION_RULES.default).find((rule) =>
    matchesDurationRule(duration, rule),
  )!.score
}

function scoreLibraryIdentity(searchText: string): { score: number; reasons: string[] } {
  if (isLikelyLibrarySfx(searchText)) return { score: 3, reasons: ['library-tag'] }
  if (MUSIC_OR_NARRATION_TERMS.some((term) => hasTerm(searchText, term))) {
    return { score: -4, reasons: ['likely-not-sfx'] }
  }
  return { score: 0, reasons: [] }
}

function scoreCueTerms(
  cue: AudiobookSfxCue,
  searchText: string,
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []
  for (const term of cueSearchTerms(cue)) {
    if (!hasTerm(searchText, term)) continue
    score += term === cue.label ? 3 : 0.8
    reasons.push(`term:${normalizeText(term)}`)
  }
  return { score, reasons }
}

function scoreRoleMismatches(
  cue: AudiobookSfxCue,
  searchText: string,
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []
  for (const term of ROLE_KEYWORDS[cue.role].negative) {
    if (!hasTerm(searchText, term)) continue
    score -= 1.4
    reasons.push(`role-mismatch:${normalizeText(term)}`)
  }
  return { score, reasons }
}

function scoreImpactStyleBonus(cue: AudiobookSfxCue, searchText: string): number {
  if (cue.role !== 'impact' && cue.role !== 'transition') return 0
  return hasTerm(searchText, 'cinematic') || hasTerm(searchText, 'trailer') ? 1.4 : 0
}

function scoreMediaForCue(
  cue: AudiobookSfxCue,
  media: MediaMetadata,
): { score: number; reasons: string[] } {
  const searchText = mediaSearchText(media)
  if (!isAudioMedia(media)) return { score: Number.NEGATIVE_INFINITY, reasons: [] }

  const identity = scoreLibraryIdentity(searchText)
  const cueTerms = scoreCueTerms(cue, searchText)
  const roleMismatches = scoreRoleMismatches(cue, searchText)

  const durationScore = scoreDuration(media, cue.role)
  const reasons = [...identity.reasons, ...cueTerms.reasons, ...roleMismatches.reasons]
  if (durationScore > 0) reasons.push('duration-fit')
  if (durationScore < 0) reasons.push('duration-risk')

  const score =
    identity.score +
    cueTerms.score +
    roleMismatches.score +
    durationScore +
    scoreImpactStyleBonus(cue, searchText)

  return { score: Math.round(score * 10) / 10, reasons }
}

function sortedCuesByLibraryPriority(cues: AudiobookSfxCue[]): AudiobookSfxCue[] {
  const roleWeight: Record<AudiobookSfxCueRole, number> = {
    transition: 0,
    impact: 1,
    foreground: 2,
    ambience: 3,
  }
  return [...cues].sort((left, right) => {
    const roleDelta = roleWeight[left.role] - roleWeight[right.role]
    if (roleDelta !== 0) return roleDelta
    return left.startSeconds - right.startSeconds
  })
}

export function findAudiobookSfxLibraryMatch(
  cue: AudiobookSfxCue,
  mediaItems: readonly MediaMetadata[],
  options: AudiobookSfxLibraryMatchOptions = {},
): AudiobookSfxLibraryMatch | null {
  const excluded = new Set(options.excludeMediaIds ?? [])
  const minimumScore = options.minimumScore ?? DEFAULT_MINIMUM_SCORE
  const best = mediaItems
    .filter((media) => !excluded.has(media.id))
    .map((media) => ({ media, ...scoreMediaForCue(cue, media) }))
    .filter((candidate) => candidate.score >= minimumScore)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      return left.media.fileName.localeCompare(right.media.fileName)
    })[0]

  return best ? { cue, media: best.media, score: best.score, reasons: best.reasons } : null
}

export function matchAudiobookSfxLibraryAssets(
  cues: readonly AudiobookSfxCue[],
  mediaItems: readonly MediaMetadata[],
  options: AudiobookSfxLibraryMatchOptions = {},
): AudiobookSfxLibraryMatch[] {
  const maxUsesPerAsset = Math.max(1, options.maxUsesPerAsset ?? DEFAULT_MAX_USES_PER_ASSET)
  const usage = new Map<string, number>()
  const matches: AudiobookSfxLibraryMatch[] = []

  for (const cue of sortedCuesByLibraryPriority([...cues])) {
    const excluded = new Set(options.excludeMediaIds ?? [])
    for (const [mediaId, count] of usage.entries()) {
      if (count >= maxUsesPerAsset && cue.role !== 'ambience') {
        excluded.add(mediaId)
      }
    }

    const match = findAudiobookSfxLibraryMatch(cue, mediaItems, {
      ...options,
      excludeMediaIds: [...excluded],
    })
    if (!match) continue

    usage.set(match.media.id, (usage.get(match.media.id) ?? 0) + 1)
    matches.push(match)
  }

  return matches.sort((left, right) => left.cue.startSeconds - right.cue.startSeconds)
}
