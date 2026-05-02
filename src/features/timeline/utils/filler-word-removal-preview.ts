import type { MediaTranscript, MediaTranscriptWord } from '@/types/storage'
import type { TimelineItem } from '@/types/timeline'
import { mediaTranscriptionService } from '@/features/timeline/deps/media-transcription-service'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineItemOverlayStore } from '@/features/timeline/stores/timeline-item-overlay-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { sourceSecondsToTimelineFrame } from '@/features/timeline/utils/media-item-frames'
import { createLogger } from '@/shared/logging/logger'
import type { AudioSilenceRange } from '@/shared/utils/audio-silence'

const logger = createLogger('FillerWordRemovalPreview')

export const FILLER_REMOVAL_PREVIEW_OVERLAY_ID = 'filler-word-removal-preview'

export const DEFAULT_SIMPLE_FILLER_WORDS = [
  'ah',
  'eh',
  'em',
  'erm',
  'er',
  'hm',
  'hmm',
  'mhm',
  'mm',
  'mmm',
  'uh',
  'uhh',
  'um',
  'uhm',
  'umm',
] as const

export const SUGGESTED_EXTRA_FILLER_WORDS = [
  'actually',
  'basically',
  'like',
  'literally',
  'ok',
  'okay',
  'right',
  'so',
  'well',
] as const

export const DEFAULT_FILLER_PHRASES = [
  'you know',
  'i mean',
  'kind of',
  'sort of',
  'you see',
] as const

export interface FillerRemovalSettings {
  fillerWords: string[]
  fillerPhrases: string[]
  paddingMs: number
  maxSimpleFillerMs: number
  maxPhraseFillerMs: number
}

export type FillerRemovalPresetId = 'conservative' | 'balanced' | 'aggressive'

export interface FillerRemovalPreset {
  id: FillerRemovalPresetId
  label: string
  settings: FillerRemovalSettings
}

export const DEFAULT_FILLER_REMOVAL_SETTINGS: FillerRemovalSettings = {
  fillerWords: [...DEFAULT_SIMPLE_FILLER_WORDS],
  fillerPhrases: [...DEFAULT_FILLER_PHRASES],
  paddingMs: 35,
  maxSimpleFillerMs: 1400,
  maxPhraseFillerMs: 1800,
}

export const FILLER_REMOVAL_PRESETS: FillerRemovalPreset[] = [
  {
    id: 'conservative',
    label: 'Conservative',
    settings: {
      fillerWords: [...DEFAULT_SIMPLE_FILLER_WORDS],
      fillerPhrases: ['you know', 'i mean'],
      paddingMs: 20,
      maxSimpleFillerMs: 900,
      maxPhraseFillerMs: 1300,
    },
  },
  {
    id: 'balanced',
    label: 'Balanced',
    settings: DEFAULT_FILLER_REMOVAL_SETTINGS,
  },
  {
    id: 'aggressive',
    label: 'Aggressive',
    settings: {
      fillerWords: [
        ...DEFAULT_SIMPLE_FILLER_WORDS,
        'actually',
        'basically',
        'like',
        'literally',
        'ok',
        'okay',
        'right',
        'so',
        'well',
      ],
      fillerPhrases: [...DEFAULT_FILLER_PHRASES, 'you know what i mean', 'i guess', 'or whatever'],
      paddingMs: 70,
      maxSimpleFillerMs: 1600,
      maxPhraseFillerMs: 2400,
    },
  },
]

export type FillerRange = AudioSilenceRange & {
  text: string
  audioConfidence?: FillerAudioConfidence
}

export type FillerRangesByMediaId = Record<string, FillerRange[]>

export type FillerAudioConfidenceLevel = 'high' | 'medium' | 'low' | 'unknown'

export interface FillerAudioConfidence {
  level: FillerAudioConfidenceLevel
  score: number
  fillerScore: number
  nonFillerScore: number
  label: string
}

export interface FillerPreviewSummary {
  rangeCount: number
  totalSeconds: number
}

function isAudioVideoItem(item: TimelineItem | undefined): item is TimelineItem & {
  type: 'video' | 'audio'
  mediaId: string
} {
  return (
    item !== undefined &&
    (item.type === 'video' || item.type === 'audio') &&
    typeof item.mediaId === 'string' &&
    item.mediaId.length > 0
  )
}

function normalizeWord(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

function canonicalFillerWord(text: string): string {
  const normalized = normalizeWord(text)
  if (/^u+h+$/.test(normalized)) return 'uh'
  if (/^u+m+$/.test(normalized)) return 'um'
  if (/^u+h+m+$/.test(normalized)) return 'uhm'
  if (/^a+h+$/.test(normalized)) return 'ah'
  if (/^h+m+$/.test(normalized)) return 'hmm'
  if (/^m+$/.test(normalized)) return normalized.length > 1 ? 'mm' : 'm'
  return normalized
}

function normalizePhrase(text: string): string[] {
  return text.split(/\s+/).map(normalizeWord).filter(Boolean)
}

function normalizeFillerSettings(settings: FillerRemovalSettings): {
  fillerWords: Set<string>
  fillerPhrases: string[][]
  paddingSec: number
  maxSimpleFillerMs: number
  maxPhraseFillerMs: number
} {
  return {
    fillerWords: new Set(settings.fillerWords.map(canonicalFillerWord).filter(Boolean)),
    fillerPhrases: settings.fillerPhrases
      .map(normalizePhrase)
      .filter((phrase) => phrase.length > 0)
      .toSorted((left, right) => right.length - left.length),
    paddingSec: Math.max(0, settings.paddingMs) / 1000,
    maxSimpleFillerMs: Math.max(0, settings.maxSimpleFillerMs),
    maxPhraseFillerMs: Math.max(0, settings.maxPhraseFillerMs),
  }
}

function collectWords(transcript: MediaTranscript): MediaTranscriptWord[] {
  return transcript.segments
    .flatMap((segment) => segment.words ?? [])
    .filter((word) => word.end > word.start)
    .toSorted((left, right) => left.start - right.start)
}

function getPhraseMatchLength(
  words: readonly MediaTranscriptWord[],
  index: number,
  normalizedWords: readonly string[],
  phraseFillers: readonly string[][],
  maxPhraseFillerMs: number,
): number {
  for (const phrase of phraseFillers) {
    if (index + phrase.length > normalizedWords.length) continue
    const matches = phrase.every((part, offset) => normalizedWords[index + offset] === part)
    if (!matches) continue

    const first = words[index]
    const last = words[index + phrase.length - 1]
    if (!first || !last) continue
    if ((last.end - first.start) * 1000 <= maxPhraseFillerMs) {
      return phrase.length
    }
  }
  return 0
}

export function detectFillerRangesFromTranscript(
  transcript: MediaTranscript,
  settings: FillerRemovalSettings = DEFAULT_FILLER_REMOVAL_SETTINGS,
): FillerRange[] {
  const normalizedSettings = normalizeFillerSettings(settings)
  const words = collectWords(transcript)
  const normalizedWords = words.map((word) => canonicalFillerWord(word.text))
  const ranges: FillerRange[] = []

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    const normalized = normalizedWords[index]
    if (!word || !normalized) continue

    if (
      normalizedSettings.fillerWords.has(normalized) &&
      (word.end - word.start) * 1000 <= normalizedSettings.maxSimpleFillerMs
    ) {
      ranges.push({
        start: Math.max(0, word.start - normalizedSettings.paddingSec),
        end: word.end + normalizedSettings.paddingSec,
        text: word.text.trim(),
      })
      continue
    }

    const phraseLength = getPhraseMatchLength(
      words,
      index,
      normalizedWords,
      normalizedSettings.fillerPhrases,
      normalizedSettings.maxPhraseFillerMs,
    )
    if (phraseLength === 0) continue

    const first = words[index]
    const last = words[index + phraseLength - 1]
    if (!first || !last) continue
    ranges.push({
      start: Math.max(0, first.start - normalizedSettings.paddingSec),
      end: last.end + normalizedSettings.paddingSec,
      text: words
        .slice(index, index + phraseLength)
        .map((matchedWord) => matchedWord.text.trim())
        .filter(Boolean)
        .join(' '),
    })
    index += phraseLength - 1
  }

  return mergeCloseRanges(ranges)
}

function mergeCloseRanges(ranges: readonly FillerRange[]): FillerRange[] {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .toSorted((left, right) => left.start - right.start)
  const merged: FillerRange[] = []

  for (const range of sorted) {
    const previous = merged.at(-1)
    if (previous && range.start - previous.end <= 0.08) {
      previous.end = Math.max(previous.end, range.end)
      previous.text = `${previous.text} ${range.text}`.trim()
      continue
    }
    merged.push({ ...range })
  }

  return merged
}

const wordTranscriptCache = new Map<string, Promise<MediaTranscript>>()

async function getTranscriptWithWords(mediaId: string): Promise<MediaTranscript> {
  const cached = wordTranscriptCache.get(mediaId)
  if (cached) {
    return cached
  }

  const promise = (async () => {
    const existing = await mediaTranscriptionService.getTranscript(mediaId).catch(() => null)
    if (existing?.segments.some((segment) => (segment.words?.length ?? 0) > 0)) {
      return existing
    }

    return mediaTranscriptionService.transcribeMedia(mediaId)
  })()

  wordTranscriptCache.set(mediaId, promise)
  try {
    return await promise
  } catch (error) {
    wordTranscriptCache.delete(mediaId)
    throw error
  }
}

export async function analyzeFillerWordsForItems(
  itemIds: readonly string[],
  settings: FillerRemovalSettings = DEFAULT_FILLER_REMOVAL_SETTINGS,
): Promise<FillerRangesByMediaId> {
  const itemsById = useItemsStore.getState().itemById
  const mediaIds = Array.from(
    new Set(
      itemIds
        .map((id) => itemsById[id])
        .filter(isAudioVideoItem)
        .map((item) => item.mediaId),
    ),
  )
  const rangesByMediaId: FillerRangesByMediaId = {}

  const results = await Promise.allSettled(
    mediaIds.map(async (mediaId) => {
      const transcript = await getTranscriptWithWords(mediaId)
      return { mediaId, ranges: detectFillerRangesFromTranscript(transcript, settings) }
    }),
  )

  let succeeded = 0
  for (const result of results) {
    if (result.status === 'fulfilled') {
      succeeded += 1
      if (result.value.ranges.length > 0) {
        rangesByMediaId[result.value.mediaId] = result.value.ranges
      }
    } else {
      logger.warn('Filler word detection failed for media', { reason: result.reason })
    }
  }

  if (succeeded === 0 && mediaIds.length > 0) {
    throw new Error('Could not generate word-timestamp transcript for filler detection')
  }

  return rangesByMediaId
}

function getItemPreviewRanges(
  item: TimelineItem,
  ranges: readonly AudioSilenceRange[],
  timelineFps: number,
): Array<{ startRatio: number; endRatio: number; seconds: number }> {
  return ranges.flatMap((range) => {
    const startFrame = sourceSecondsToTimelineFrame(item, range.start, timelineFps)
    const endFrame = sourceSecondsToTimelineFrame(item, range.end, timelineFps)
    const startRatio = Math.max(0, Math.min(1, (startFrame - item.from) / item.durationInFrames))
    const endRatio = Math.max(0, Math.min(1, (endFrame - item.from) / item.durationInFrames))
    if (endRatio <= startRatio) return []
    return [
      {
        startRatio,
        endRatio,
        seconds: ((endRatio - startRatio) * item.durationInFrames) / timelineFps,
      },
    ]
  })
}

export function clearFillerPreviewOverlays(itemIds: readonly string[]): void {
  const overlayStore = useTimelineItemOverlayStore.getState()
  for (const itemId of itemIds) {
    overlayStore.removeOverlay(itemId, FILLER_REMOVAL_PREVIEW_OVERLAY_ID)
  }
}

export function applyFillerPreviewOverlays(
  itemIds: readonly string[],
  rangesByMediaId: FillerRangesByMediaId,
): FillerPreviewSummary {
  const timelineFps = useTimelineSettingsStore.getState().fps
  const itemsById = useItemsStore.getState().itemById
  const overlayStore = useTimelineItemOverlayStore.getState()
  let rangeCount = 0
  let totalSeconds = 0

  for (const itemId of itemIds) {
    const item = itemsById[itemId]
    if (!isAudioVideoItem(item)) {
      overlayStore.removeOverlay(itemId, FILLER_REMOVAL_PREVIEW_OVERLAY_ID)
      continue
    }

    const ranges = rangesByMediaId[item.mediaId] ?? []
    const previewRanges = getItemPreviewRanges(item, ranges, timelineFps)
    if (previewRanges.length === 0) {
      overlayStore.removeOverlay(itemId, FILLER_REMOVAL_PREVIEW_OVERLAY_ID)
      continue
    }

    rangeCount += previewRanges.length
    totalSeconds += previewRanges.reduce((sum, range) => sum + range.seconds, 0)
    overlayStore.upsertOverlay(itemId, {
      id: FILLER_REMOVAL_PREVIEW_OVERLAY_ID,
      label: `${previewRanges.length} filler range${previewRanges.length === 1 ? '' : 's'}`,
      tone: 'warning',
      ranges: previewRanges.map((range) => ({
        startRatio: range.startRatio,
        endRatio: range.endRatio,
      })),
    })
  }

  return { rangeCount, totalSeconds }
}
