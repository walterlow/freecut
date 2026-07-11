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

function createBeat(index: number, segments: MediaTranscriptSegment[]): PixabayBrollBeat {
  const text = segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ')
  return {
    id: `pixabay-beat-${index + 1}`,
    startSeconds: Math.max(0, segments[0]?.start ?? 0),
    endSeconds: Math.max(segments[0]?.start ?? 0, segments.at(-1)?.end ?? 0),
    text,
    query: visualQuery(text),
  }
}

export function planPixabayBroll(
  transcript: MediaTranscript,
  options: { maxBeatSeconds?: number; maxBeats?: number } = {},
): PixabayBrollBeat[] {
  const maxBeatSeconds = Math.max(4, options.maxBeatSeconds ?? 7.5)
  const maxBeats = Math.max(1, options.maxBeats ?? 10)
  const beats: PixabayBrollBeat[] = []
  let group: MediaTranscriptSegment[] = []

  for (const segment of transcript.segments.filter((entry) => entry.end > entry.start)) {
    const proposedDuration = segment.end - (group[0]?.start ?? segment.start)
    if (group.length > 0 && proposedDuration > maxBeatSeconds) {
      beats.push(createBeat(beats.length, group))
      group = []
      if (beats.length >= maxBeats) break
    }
    group.push(segment)
  }
  if (group.length > 0 && beats.length < maxBeats) beats.push(createBeat(beats.length, group))
  return beats
}
