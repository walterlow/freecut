import type { MediaTranscript, MediaTranscriptSegment } from '@/types/storage'
import type { StudioAudioSceneAnalysis } from '@/types/studio-audio'

interface SceneSignal {
  label: string
  terms: string[]
}

const LOCATIONS: SceneSignal[] = [
  { label: 'forest', terms: ['forest', 'woods', 'trees', 'clearing'] },
  { label: 'city street', terms: ['street', 'traffic', 'sidewalk', 'city'] },
  {
    label: 'interior room',
    terms: ['room', 'hall', 'house', 'office', 'workshop'],
  },
  { label: 'waterfront', terms: ['river', 'lake', 'harbor', 'shore', 'water'] },
]
const WEATHER: SceneSignal[] = [
  { label: 'rain', terms: ['rain', 'storm', 'thunder', 'wet'] },
  { label: 'wind', terms: ['wind', 'breeze', 'gust'] },
  { label: 'snow', terms: ['snow', 'frost', 'ice'] },
]
const MOODS: SceneSignal[] = [
  {
    label: 'suspense',
    terms: ['secret', 'danger', 'shadow', 'fear', 'warning'],
  },
  { label: 'wonder', terms: ['wonder', 'glow', 'moon', 'magic', 'beautiful'] },
  { label: 'sadness', terms: ['sad', 'lost', 'alone', 'grief', 'tears'] },
  { label: 'relief', terms: ['safe', 'relief', 'home', 'smiled', 'returned'] },
]
const ACTIONS: SceneSignal[] = [
  { label: 'footsteps', terms: ['walked', 'steps', 'footsteps', 'approached'] },
  { label: 'door', terms: ['door', 'opened', 'closed', 'knocked'] },
  {
    label: 'mechanism',
    terms: ['clock', 'gear', 'key', 'machine', 'mechanical'],
  },
  { label: 'flight', terms: ['flew', 'wings', 'bird', 'flight'] },
]
const TIMES_OF_DAY: SceneSignal[] = [
  { label: 'night', terms: ['night', 'moon', 'midnight', 'dark'] },
  { label: 'morning', terms: ['morning', 'dawn', 'sunrise'] },
]

function includesTerm(text: string, signal: SceneSignal): boolean {
  return signal.terms.some((term) => text.includes(term))
}

function matchingLabels(text: string, signals: SceneSignal[]): string[] {
  return signals.filter((signal) => includesTerm(text, signal)).map((signal) => signal.label)
}

function firstLabel(text: string, signals: SceneSignal[], fallback: string): string {
  return signals.find((signal) => includesTerm(text, signal))?.label ?? fallback
}

function shouldSplitScene(
  current: MediaTranscriptSegment[],
  next: MediaTranscriptSegment,
): boolean {
  const previous = current.at(-1)
  if (!previous) return false
  return next.start - previous.end >= 1.8 || next.end - current[0]!.start >= 42
}

function groupTranscriptScenes(segments: MediaTranscriptSegment[]): MediaTranscriptSegment[][] {
  const groups: MediaTranscriptSegment[][] = []
  for (const segment of segments) {
    const current = groups.at(-1)
    if (!current || shouldSplitScene(current, segment)) groups.push([segment])
    else current.push(segment)
  }
  return groups
}

function labelsOrFallback(labels: string[], fallback: string): string[] {
  return labels.length > 0 ? labels : [fallback]
}

function sceneBounds(segments: MediaTranscriptSegment[]): {
  start: number
  end: number
} {
  const first = segments[0]
  const last = segments.at(-1)
  return { start: first?.start ?? 0, end: last?.end ?? first?.end ?? 0 }
}

function sceneConfidence(location: string): number {
  return location === 'unspecified environment' ? 0.68 : 0.88
}

function analyzeScene(segments: MediaTranscriptSegment[], index: number): StudioAudioSceneAnalysis {
  const text = segments
    .map((segment) => segment.text)
    .join(' ')
    .trim()
  const normalized = text.toLowerCase()
  const moods = matchingLabels(normalized, MOODS)
  const actions = matchingLabels(normalized, ACTIONS)
  const location = firstLabel(normalized, LOCATIONS, 'unspecified environment')
  const weather = firstLabel(normalized, WEATHER, 'unspecified')
  const timeOfDay = firstLabel(normalized, TIMES_OF_DAY, 'unspecified')
  const silenceRecommended = /silence|held her breath|listened|nothing moved/.test(normalized)
  const bounds = sceneBounds(segments)
  return {
    id: `scene-${index + 1}`,
    chapterIndex: Math.floor(bounds.start / 300),
    startSeconds: bounds.start,
    endSeconds: bounds.end,
    title: `Scene ${index + 1}: ${location}`,
    summary: text.slice(0, 240),
    location,
    timeOfDay,
    weather,
    moods: labelsOrFallback(moods, 'neutral'),
    actions,
    ambienceKeywords: [...new Set([location, weather, ...actions])].filter(
      (value) => value !== 'unspecified',
    ),
    musicMood: labelsOrFallback(moods, 'restrained cinematic')[0]!,
    silenceRecommended,
    confidence: sceneConfidence(location),
  }
}

export function analyzeStudioAudioScenes(transcript: MediaTranscript): StudioAudioSceneAnalysis[] {
  return groupTranscriptScenes(transcript.segments).map(analyzeScene)
}
