import type { MediaTranscript, MediaTranscriptSegment } from '@/types/storage'
import type { PixabayBrollBeat } from '@/types/studio-audio'

const STOP_WORDS = new Set(
  'a an and are as at be been but by for from had has have he her his i in into is it its me my of on or our she that the their them then there they this to was we were what when where which who will with you your'.split(
    ' ',
  ),
)

const VISUAL_HINTS = [
  'city',
  'forest',
  'ocean',
  'mountain',
  'street',
  'house',
  'workshop',
  'lighthouse',
  'storm',
  'night',
  'sunrise',
  'clock',
  'train',
  'river',
  'sky',
  'fire',
  'rain',
  'snow',
  'door',
  'window',
  'road',
  'harbor',
]

const CINEMATIC_COVERAGE_MODIFIERS = [
  'wide establishing cinematic',
  'medium subject cinematic',
  'close up detail cinematic',
  'macro texture cinematic',
  'silhouette dramatic cinematic',
  'foreground depth cinematic',
]

function visualQuery(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
  const hints = VISUAL_HINTS.filter((word) => words.includes(word))
  const ranked = [...new Set([...hints, ...words])].slice(0, 6)
  return ranked.join(' ') || 'cinematic landscape'
}

function createBeat(
  index: number,
  segments: MediaTranscriptSegment[],
  coverageStyle: 'standard' | 'cinematic',
): PixabayBrollBeat {
  const text = segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ')
  return {
    id: `pixabay-beat-${index + 1}`,
    startSeconds: Math.max(0, segments[0]?.start ?? 0),
    endSeconds: Math.max(segments[0]?.start ?? 0, segments.at(-1)?.end ?? 0),
    text,
    query:
      coverageStyle === 'cinematic'
        ? `${visualQuery(text)} ${CINEMATIC_COVERAGE_MODIFIERS[index % CINEMATIC_COVERAGE_MODIFIERS.length]}`
        : visualQuery(text),
  }
}

function splitLongSegment(
  segment: MediaTranscriptSegment,
  maxBeatSeconds: number,
): MediaTranscriptSegment[] {
  const duration = segment.end - segment.start
  const partCount = Math.max(1, Math.ceil(duration / maxBeatSeconds))
  if (partCount === 1) return [segment]

  const words = segment.text.trim().split(/\s+/).filter(Boolean)
  return Array.from({ length: partCount }, (_, index) => {
    const startRatio = index / partCount
    const endRatio = (index + 1) / partCount
    const wordStart = Math.floor(words.length * startRatio)
    const wordEnd = index === partCount - 1 ? words.length : Math.floor(words.length * endRatio)
    return {
      ...segment,
      start: segment.start + duration * startRatio,
      end: segment.start + duration * endRatio,
      text: words.slice(wordStart, wordEnd).join(' ') || segment.text,
    }
  })
}

export function planPixabayBroll(
  transcript: MediaTranscript,
  options: {
    maxBeatSeconds?: number
    maxBeats?: number
    coverageStyle?: 'standard' | 'cinematic'
  } = {},
): PixabayBrollBeat[] {
  const maxBeatSeconds = Math.max(2.4, options.maxBeatSeconds ?? 7.5)
  const maxBeats = Math.max(1, options.maxBeats ?? 10)
  const coverageStyle = options.coverageStyle ?? 'standard'
  const beats: PixabayBrollBeat[] = []
  let group: MediaTranscriptSegment[] = []
  const segments = transcript.segments
    .filter((entry) => entry.end > entry.start)
    .flatMap((segment) => splitLongSegment(segment, maxBeatSeconds))

  for (const segment of segments) {
    const proposedDuration = segment.end - (group[0]?.start ?? segment.start)
    if (group.length > 0 && proposedDuration > maxBeatSeconds) {
      beats.push(createBeat(beats.length, group, coverageStyle))
      group = []
      if (beats.length >= maxBeats) break
    }
    group.push(segment)
  }
  if (group.length > 0 && beats.length < maxBeats) {
    beats.push(createBeat(beats.length, group, coverageStyle))
  }
  return beats
}
