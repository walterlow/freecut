import type { Transition, TransitionPresentation } from '@/types/transition'
import type { AudioItem, TimelineItem, TimelineTranscriptCaptionCue } from '@/types/timeline'
import type { CinematicEditingProfile } from './cinematic-editing-profile'

export interface CinematicStoryTransitionPlanItem {
  leftClipId: string
  rightClipId: string
  presentation: TransitionPresentation
  durationInFrames: number
  alignment: number
  cutFrame: number
  emphasis: 'story' | 'fantasy' | 'continuity' | 'documentary'
}

export interface CinematicStoryTransitionPlanInput {
  items: TimelineItem[]
  selectedImageIds: string[]
  existingTransitions: Transition[]
  narrationItem?: AudioItem | null
  fps: number
  profile?: CinematicEditingProfile
}

interface ImageCutPair {
  left: TimelineItem
  right: TimelineItem
  cutFrame: number
}

interface CutDirection {
  presentation: TransitionPresentation
  durationInFrames: number
  emphasis: CinematicStoryTransitionPlanItem['emphasis']
}

const DRAMATIC_CUT_PATTERN =
  /\b(truth|choice|decision|danger|secret|hidden|warning|power|promise|betrayal|fear|finally|suddenly|reveal|leverage|judge|senator|death|escape|discover|turn|changed|broke)\b/i
const FANTASY_CUT_PATTERN =
  /\b(magic|moon|dream|wonder|light|spark|star|enchanted|mystery|spell|miracle|wish|flying|sky)\b/i
const DOCUMENTARY_TRANSITION_PATTERN =
  /\b(?:17|18|19|20)\d{2}\b|\b(then|however|until|yet|but|instead|chapter|part|finally|revealed|secret|truth|power|empire|fortune)\b/i

function isSelectedVisualStill(item: TimelineItem, selectedIds: Set<string>): boolean {
  return (
    selectedIds.has(item.id) &&
    item.type === 'image' &&
    item.cinematicDepthRole !== 'depth-map' &&
    !/\.gif$/i.test(item.label ?? '')
  )
}

function collectImageCutPairs(items: TimelineItem[], selectedImageIds: string[]): ImageCutPair[] {
  const selectedIds = new Set(selectedImageIds)
  const byTrack = new Map<string, TimelineItem[]>()

  for (const item of items) {
    if (!isSelectedVisualStill(item, selectedIds)) continue
    const trackItems = byTrack.get(item.trackId) ?? []
    trackItems.push(item)
    byTrack.set(item.trackId, trackItems)
  }

  const pairs: ImageCutPair[] = []
  for (const trackItems of byTrack.values()) {
    const sorted = trackItems.toSorted(
      (left, right) => left.from - right.from || left.id.localeCompare(right.id),
    )
    for (let index = 1; index < sorted.length; index += 1) {
      const left = sorted[index - 1]!
      const right = sorted[index]!
      const leftEnd = left.from + left.durationInFrames
      if (Math.abs(leftEnd - right.from) > 1) continue
      pairs.push({ left, right, cutFrame: right.from })
    }
  }

  return pairs
}

function cueTimelineFrame(
  narrationItem: AudioItem,
  cue: TimelineTranscriptCaptionCue,
  fps: number,
): number {
  const sourceFps = narrationItem.sourceFps ?? fps
  const sourceStartSeconds = (narrationItem.sourceStart ?? 0) / sourceFps
  const speed = Math.max(0.01, narrationItem.speed ?? 1)
  return narrationItem.from + Math.round(((cue.startSeconds - sourceStartSeconds) / speed) * fps)
}

function storyTextNearCut(
  narrationItem: AudioItem | null | undefined,
  cutFrame: number,
  fps: number,
): string {
  if (!narrationItem) return ''
  const toleranceFrames = Math.max(1, Math.round(fps * 0.65))
  return (narrationItem.transcriptCaptions?.cues ?? [])
    .filter(
      (cue) => Math.abs(cueTimelineFrame(narrationItem, cue, fps) - cutFrame) <= toleranceFrames,
    )
    .map((cue) => cue.text)
    .join(' ')
}

interface CutDirectionParams {
  cutFrame: number
  cutIndex: number
  cutCount: number
  narrationItem?: AudioItem | null
  fps: number
  profile: CinematicEditingProfile
}

function magnatesDirection(params: CutDirectionParams, storyText: string): CutDirection {
  const isImpact = DRAMATIC_CUT_PATTERN.test(storyText) || FANTASY_CUT_PATTERN.test(storyText)
  return {
    presentation: isImpact && params.cutIndex % 2 === 1 ? 'lensWarpZoom' : 'sceneOrbit',
    durationInFrames: Math.max(7, Math.round(params.fps * (isImpact ? 0.46 : 0.38))),
    emphasis: 'story',
  }
}

function documentaryDirection(params: CutDirectionParams, storyText: string): CutDirection | null {
  // Documentary rhythm is mostly hard cuts. A very short blend is reserved
  // for chapter turns, dates, and major factual reveals.
  if (!DOCUMENTARY_TRANSITION_PATTERN.test(storyText)) return null
  return {
    presentation: 'smoothCut',
    durationInFrames: Math.max(3, Math.round(params.fps * 0.14)),
    emphasis: 'documentary',
  }
}

function storyDirection(params: CutDirectionParams, storyText: string): CutDirection | null {
  if (FANTASY_CUT_PATTERN.test(storyText)) {
    return {
      presentation: 'lightLeakBurn',
      durationInFrames: Math.max(5, Math.round(params.fps * 0.3)),
      emphasis: 'fantasy',
    }
  }
  if (DRAMATIC_CUT_PATTERN.test(storyText)) {
    return {
      presentation: 'lensWarpZoom',
      durationInFrames: Math.max(5, Math.round(params.fps * 0.26)),
      emphasis: 'story',
    }
  }
  const isContinuityCut = params.cutCount === 1 || params.cutIndex % 3 === 1
  if (!isContinuityCut) return null
  return {
    presentation: 'smoothCut',
    durationInFrames: Math.max(4, Math.round(params.fps * 0.2)),
    emphasis: 'continuity',
  }
}

function directionForCut(params: CutDirectionParams): CutDirection | null {
  const storyText = storyTextNearCut(params.narrationItem, params.cutFrame, params.fps)
  if (params.profile === 'magnates-3d') return magnatesDirection(params, storyText)
  if (params.profile === 'documentary') return documentaryDirection(params, storyText)
  return storyDirection(params, storyText)
}

export function planCinematicStoryTransitions(
  input: CinematicStoryTransitionPlanInput,
): CinematicStoryTransitionPlanItem[] {
  const pairs = collectImageCutPairs(input.items, input.selectedImageIds)
  if (pairs.length === 0) return []

  const existingPairs = new Set(
    input.existingTransitions.map(
      (transition) => `${transition.leftClipId}->${transition.rightClipId}`,
    ),
  )
  const cutFrames = [...new Set(pairs.map((pair) => pair.cutFrame))].sort(
    (left, right) => left - right,
  )
  const directionByCut = new Map<number, CutDirection>()

  cutFrames.forEach((cutFrame, cutIndex) => {
    const direction = directionForCut({
      cutFrame,
      cutIndex,
      cutCount: cutFrames.length,
      narrationItem: input.narrationItem,
      fps: input.fps,
      profile: input.profile ?? 'story',
    })
    if (direction) directionByCut.set(cutFrame, direction)
  })

  if (directionByCut.size === 0 && (input.profile ?? 'story') !== 'documentary') {
    const middleCut = cutFrames[Math.floor(cutFrames.length / 2)]!
    directionByCut.set(middleCut, {
      presentation: 'smoothCut',
      durationInFrames: Math.max(4, Math.round(input.fps * 0.2)),
      emphasis: 'continuity',
    })
  }

  return pairs.flatMap((pair) => {
    const pairKey = `${pair.left.id}->${pair.right.id}`
    const direction = directionByCut.get(pair.cutFrame)
    if (!direction || existingPairs.has(pairKey)) return []

    return [
      {
        leftClipId: pair.left.id,
        rightClipId: pair.right.id,
        presentation: direction.presentation,
        durationInFrames: Math.min(
          direction.durationInFrames,
          Math.max(1, pair.left.durationInFrames - 1),
          Math.max(1, pair.right.durationInFrames - 1),
        ),
        alignment: 0.5,
        cutFrame: pair.cutFrame,
        emphasis: direction.emphasis,
      },
    ]
  })
}
