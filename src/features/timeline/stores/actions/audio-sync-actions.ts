import type { AudioItem, TimelineItem } from '@/types/timeline'
import type { KeyframeAddPayload } from '../keyframes-store'
import type { AudioDuckingResult, ImageAudioMatchResult } from '../../types'
import { useSelectionStore } from '@/shared/state/selection'
import { useItemsStore } from '../items-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { execute, applyTransitionRepairs, canAddKeyframeAtFrame, warnIfOverlapping } from './shared'
import { sourceSecondsToTimelineFrame } from '../../utils/media-item-frames'

interface AudioDuckingOptions {
  duckDb?: number
  attackSeconds?: number
  releaseSeconds?: number
}

const DEFAULT_DUCK_DB = -18
const DEFAULT_DUCK_ATTACK_SECONDS = 0.15
const DEFAULT_DUCK_RELEASE_SECONDS = 0.35
const TRANSCRIPT_CUT_MIN_SPACING_SECONDS = 2.2
const CINEMATIC_FALLBACK_RHYTHM_WEIGHTS = [1, 1.18, 0.86, 1.08, 0.92, 1.24, 0.8, 1.05]
const TRANSCRIPT_STORY_CUT_TERMS = [
  'truth',
  'choice',
  'decision',
  'danger',
  'dangerous',
  'secret',
  'hidden',
  'warning',
  'power',
  'promise',
  'broken',
  'betrayal',
  'fear',
  'heart',
  'alone',
  'never',
  'finally',
  'suddenly',
  'only',
  'but',
  'however',
  'first',
  'last',
  'reveal',
  'leverage',
  'privacy',
  'judge',
  'senator',
]
const TRANSCRIPT_STORY_CUT_TERM_SET = new Set(TRANSCRIPT_STORY_CUT_TERMS)
const STORY_MATCH_MIN_SCORE = 1.5
const STORY_MATCH_STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'then',
  'when',
  'where',
  'were',
  'was',
  'are',
  'but',
  'into',
  'onto',
  'over',
  'under',
  'through',
  'image',
  'photo',
  'still',
  'scene',
  'shot',
  'chatgpt',
  'png',
  'jpg',
  'jpeg',
  'webp',
])

interface TranscriptCutCandidate {
  frame: number
  priority: number
}

interface ImageStoryProfile {
  item: TimelineItem
  tokens: Set<string>
}

function selectedIdsOrStore(selectedItemIds?: string[]): string[] {
  return selectedItemIds ?? useSelectionStore.getState().selectedItemIds
}

function selectedTrackIdsOrStore(): string[] {
  return useSelectionStore.getState().selectedTrackIds
}

function sortByTrackThenTime(items: TimelineItem[]): TimelineItem[] {
  const tracks = useItemsStore.getState().tracks
  const trackOrderById = new Map(tracks.map((track, index) => [track.id, track.order ?? index]))
  return [...items].sort((a, b) => {
    const trackDelta = (trackOrderById.get(a.trackId) ?? 0) - (trackOrderById.get(b.trackId) ?? 0)
    if (trackDelta !== 0) return trackDelta
    if (a.from !== b.from) return a.from - b.from
    return a.id.localeCompare(b.id)
  })
}

function isStillImage(item: TimelineItem): boolean {
  return item.type === 'image' && !/\.gif$/i.test(item.label ?? '')
}

function isAudioItem(item: TimelineItem): item is AudioItem {
  return item.type === 'audio'
}

function resolveSelectedAudioItems(items: TimelineItem[], selectedItemIds: string[]): AudioItem[] {
  const selectedIdSet = new Set(selectedItemIds)
  const selectedAudio = items.filter(
    (item): item is AudioItem => selectedIdSet.has(item.id) && isAudioItem(item),
  )
  if (selectedAudio.length > 0) return selectedAudio

  const selectedTrackIds = new Set(selectedTrackIdsOrStore())
  if (selectedTrackIds.size === 0) return []

  return items.filter(
    (item): item is AudioItem => isAudioItem(item) && selectedTrackIds.has(item.trackId),
  )
}

function resolveAudioItemsForMatching(
  items: TimelineItem[],
  selectedItemIds: string[],
): AudioItem[] {
  const selectedAudio = resolveSelectedAudioItems(items, selectedItemIds)
  return selectedAudio.length > 0 ? selectedAudio : items.filter(isAudioItem)
}

function resolveAudioSpan(audioItems: AudioItem[]): [number, number] | null {
  if (audioItems.length === 0) return null

  const start = Math.min(...audioItems.map((item) => item.from))
  const end = Math.max(...audioItems.map((item) => item.from + item.durationInFrames))
  return end > start ? [start, end] : null
}

function transcriptCueStartFrame(item: AudioItem, cueStartSeconds: number, fps: number): number {
  return sourceSecondsToTimelineFrame(item, cueStartSeconds, fps)
}

function transcriptCutMinSpacingFrames(
  totalFrames: number,
  imageCount: number,
  fps: number,
): number {
  return Math.max(
    1,
    Math.min(
      Math.round(TRANSCRIPT_CUT_MIN_SPACING_SECONDS * fps),
      Math.floor(totalFrames / Math.max(1, imageCount * 2)),
    ),
  )
}

function normalizeTranscriptText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function storyMatchTokens(text: string): Set<string> {
  const normalized = normalizeTranscriptText(text)
  if (!normalized) return new Set()

  return new Set(
    normalized
      .split(' ')
      .map((token) => token.trim())
      .filter(
        (token) => token.length >= 3 && !/^\d+$/.test(token) && !STORY_MATCH_STOP_WORDS.has(token),
      ),
  )
}

function transcriptStoryCutPriority(text: string): number {
  const normalized = normalizeTranscriptText(text)
  if (!normalized) return 0

  let priority = 0
  if (
    TRANSCRIPT_STORY_CUT_TERMS.some((term) => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(normalized)
    })
  ) {
    priority += 2.4
  }
  if (/[?!:]|--/.test(text)) priority += 0.45
  if (/^(but|however|then|suddenly|finally|only|never|first|last)\b/i.test(text.trim())) {
    priority += 0.75
  }

  return priority
}

function collectTranscriptCutCandidates(
  audioItems: AudioItem[],
  audioSpan: [number, number],
  imageCount: number,
  fps: number,
): TranscriptCutCandidate[] {
  const [audioStartFrame, audioEndFrame] = audioSpan
  const totalFrames = audioEndFrame - audioStartFrame
  const minSpacingFrames = transcriptCutMinSpacingFrames(totalFrames, imageCount, fps)
  const candidates = audioItems
    .flatMap((item) =>
      (item.transcriptCaptions?.cues ?? []).map((cue) => ({
        frame: transcriptCueStartFrame(item, cue.startSeconds, fps),
        priority: transcriptStoryCutPriority(cue.text),
      })),
    )
    .filter(
      (candidate) =>
        candidate.frame > audioStartFrame + minSpacingFrames &&
        candidate.frame < audioEndFrame - minSpacingFrames,
    )
    .sort((a, b) => a.frame - b.frame)

  const spaced: TranscriptCutCandidate[] = []
  for (const candidate of candidates) {
    const previous = spaced[spaced.length - 1]
    if (previous == null || candidate.frame - previous.frame >= minSpacingFrames) {
      spaced.push(candidate)
    } else if (candidate.priority > previous.priority + 0.2) {
      spaced[spaced.length - 1] = candidate
    }
  }

  return spaced
}

function chooseTranscriptBoundaries(
  audioItems: AudioItem[],
  audioSpan: [number, number],
  imageCount: number,
  fps: number,
): number[] | null {
  if (imageCount < 2) return null

  const [audioStartFrame, audioEndFrame] = audioSpan
  const totalFrames = audioEndFrame - audioStartFrame
  const minSpacingFrames = transcriptCutMinSpacingFrames(totalFrames, imageCount, fps)
  const candidates = collectTranscriptCutCandidates(audioItems, audioSpan, imageCount, fps)
  if (candidates.length < imageCount - 1) return null

  const chosen: number[] = []
  for (let index = 1; index < imageCount; index += 1) {
    const targetFrame = audioStartFrame + Math.round((index * totalFrames) / imageCount)
    const minFrame =
      index === 1 ? audioStartFrame + minSpacingFrames : chosen[index - 2]! + minSpacingFrames
    const maxFrame = audioEndFrame - (imageCount - index) * minSpacingFrames
    const remainingCutsAfterThis = imageCount - index - 1
    const bestCandidate = candidates
      .filter(
        (candidate) =>
          candidate.frame >= minFrame &&
          candidate.frame <= maxFrame &&
          !chosen.includes(candidate.frame) &&
          candidates.filter(
            (later) =>
              !chosen.includes(later.frame) &&
              later.frame >= candidate.frame + minSpacingFrames &&
              later.frame <= audioEndFrame - minSpacingFrames,
          ).length >= remainingCutsAfterThis,
      )
      .sort((left, right) => {
        const storyPullFrames = minSpacingFrames * 0.85
        const leftScore = Math.abs(left.frame - targetFrame) - left.priority * storyPullFrames
        const rightScore = Math.abs(right.frame - targetFrame) - right.priority * storyPullFrames
        return leftScore - rightScore
      })[0]

    if (bestCandidate == null) return null
    chosen.push(bestCandidate.frame)
  }

  return [audioStartFrame, ...chosen, audioEndFrame]
}

function transcriptCueEndFrame(item: AudioItem, cueEndSeconds: number, fps: number): number {
  return sourceSecondsToTimelineFrame(item, cueEndSeconds, fps)
}

function transcriptTextForSegment(
  audioItems: AudioItem[],
  segmentStartFrame: number,
  segmentEndFrame: number,
  fps: number,
): string {
  return audioItems
    .flatMap((item) =>
      (item.transcriptCaptions?.cues ?? []).flatMap((cue) => {
        const cueStart = transcriptCueStartFrame(item, cue.startSeconds, fps)
        const cueEnd = transcriptCueEndFrame(item, cue.endSeconds, fps)
        return cueStart < segmentEndFrame && cueEnd > segmentStartFrame ? [cue.text] : []
      }),
    )
    .join(' ')
}

type MediaLibraryItem = NonNullable<
  ReturnType<typeof useMediaLibraryStore.getState>['mediaById'][string]
>
type MediaAiCaption = NonNullable<MediaLibraryItem['aiCaptions']>[number]

function formatMediaCaptionText(caption: MediaAiCaption): string {
  const sceneData = caption.sceneData
  if (!sceneData) return caption.text

  return [
    caption.text,
    sceneData.caption,
    sceneData.shotType,
    ...(sceneData.subjects ?? []),
    sceneData.action,
    sceneData.setting,
    sceneData.lighting,
    sceneData.timeOfDay,
    sceneData.weather,
  ]
    .filter(Boolean)
    .join(' ')
}

function imageStoryText(item: TimelineItem): string {
  const media = item.mediaId ? useMediaLibraryStore.getState().mediaById[item.mediaId] : undefined
  const mediaCaptionText = media?.aiCaptions?.map(formatMediaCaptionText).join(' ') ?? ''
  return [item.label, media?.fileName, ...(media?.tags ?? []), mediaCaptionText]
    .filter(Boolean)
    .join(' ')
}

function storyTokenWeight(token: string): number {
  return TRANSCRIPT_STORY_CUT_TERM_SET.has(token) ? 2.2 : 1
}

function imageSegmentStoryScore(imageTokens: Set<string>, segmentTokens: Set<string>): number {
  let score = 0
  for (const token of imageTokens) {
    if (segmentTokens.has(token)) score += storyTokenWeight(token)
  }
  return score
}

function orderImagesForStorySegments(
  images: TimelineItem[],
  audioItems: AudioItem[],
  boundaries: number[],
  fps: number,
): TimelineItem[] {
  if (images.length < 2 || boundaries.length !== images.length + 1) return images

  const imageProfiles: ImageStoryProfile[] = images.map((item) => ({
    item,
    tokens: storyMatchTokens(imageStoryText(item)),
  }))
  if (imageProfiles.every((profile) => profile.tokens.size === 0)) return images

  const segmentTokens = images.map((_, index) =>
    storyMatchTokens(
      transcriptTextForSegment(audioItems, boundaries[index]!, boundaries[index + 1]!, fps),
    ),
  )
  if (segmentTokens.every((tokens) => tokens.size === 0)) return images

  const unused = new Set(imageProfiles.map((profile) => profile.item.id))
  const assignments = new Map<number, ImageStoryProfile>()

  for (let segmentIndex = 0; segmentIndex < segmentTokens.length; segmentIndex += 1) {
    const tokens = segmentTokens[segmentIndex]!
    const best = imageProfiles
      .filter((profile) => unused.has(profile.item.id))
      .map((profile) => ({
        profile,
        score: imageSegmentStoryScore(profile.tokens, tokens),
      }))
      .filter((candidate) => candidate.score >= STORY_MATCH_MIN_SCORE)
      .sort((left, right) => right.score - left.score)[0]

    if (best) {
      assignments.set(segmentIndex, best.profile)
      unused.delete(best.profile.item.id)
    }
  }

  if (assignments.size === 0) return images

  const remaining = images.filter((image) => unused.has(image.id))
  let remainingIndex = 0
  return images.map((image, index) => {
    const assigned = assignments.get(index)
    if (assigned) return assigned.item
    return remaining[remainingIndex++] ?? image
  })
}

function evenImageBoundaries(audioSpan: [number, number], imageCount: number): number[] {
  const [audioStartFrame, audioEndFrame] = audioSpan
  const totalFrames = audioEndFrame - audioStartFrame
  return Array.from(
    { length: imageCount + 1 },
    (_, index) => audioStartFrame + Math.round((index * totalFrames) / imageCount),
  )
}

function cinematicFallbackImageBoundaries(
  audioSpan: [number, number],
  imageCount: number,
): number[] {
  if (imageCount < 3) return evenImageBoundaries(audioSpan, imageCount)

  const [audioStartFrame, audioEndFrame] = audioSpan
  const totalFrames = audioEndFrame - audioStartFrame
  if (totalFrames <= imageCount) return evenImageBoundaries(audioSpan, imageCount)

  const averageFrames = totalFrames / imageCount
  const minimumFrames = Math.max(1, Math.floor(averageFrames * 0.58))
  const weights = Array.from(
    { length: imageCount },
    (_, index) =>
      CINEMATIC_FALLBACK_RHYTHM_WEIGHTS[index % CINEMATIC_FALLBACK_RHYTHM_WEIGHTS.length]!,
  )
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  let remainingFrames = totalFrames
  let remainingWeight = totalWeight
  const durations: number[] = []

  for (let index = 0; index < imageCount; index += 1) {
    const remainingItems = imageCount - index
    if (remainingItems === 1) {
      durations.push(Math.max(1, remainingFrames))
      break
    }

    const rawDuration = Math.round((remainingFrames * weights[index]!) / remainingWeight)
    const maxDuration = remainingFrames - minimumFrames * (remainingItems - 1)
    const duration = Math.min(Math.max(minimumFrames, rawDuration), Math.max(1, maxDuration))
    durations.push(duration)
    remainingFrames -= duration
    remainingWeight -= weights[index]!
  }

  const boundaries = [audioStartFrame]
  for (const duration of durations) {
    boundaries.push(boundaries[boundaries.length - 1]! + duration)
  }
  boundaries[boundaries.length - 1] = audioEndFrame
  return boundaries
}

function buildImageAudioMatchUpdates(
  images: TimelineItem[],
  audioItems: AudioItem[],
  audioSpan: [number, number],
  fps: number,
) {
  const boundaries =
    chooseTranscriptBoundaries(audioItems, audioSpan, images.length, fps) ??
    cinematicFallbackImageBoundaries(audioSpan, images.length)
  const orderedImages = orderImagesForStorySegments(images, audioItems, boundaries, fps)

  return orderedImages.map((item, index) => ({
    item,
    from: boundaries[index]!,
    durationInFrames: Math.max(1, boundaries[index + 1]! - boundaries[index]!),
  }))
}

export function matchSelectedImagesToAudio(selectedItemIds?: string[]): ImageAudioMatchResult {
  const selection = selectedIdsOrStore(selectedItemIds)
  const items = useItemsStore.getState().items
  const selectedIdSet = new Set(selection)
  const images = sortByTrackThenTime(
    items.filter((item) => selectedIdSet.has(item.id) && isStillImage(item)),
  )

  if (images.length === 0) {
    return { status: 'no-images', imageCount: 0 }
  }

  const audioItems = resolveAudioItemsForMatching(items, selection)
  const audioSpan = resolveAudioSpan(audioItems)
  if (!audioSpan) {
    return { status: 'no-audio', imageCount: images.length }
  }

  const [audioStartFrame, audioEndFrame] = audioSpan
  const fps = useTimelineSettingsStore.getState().fps
  const updates = buildImageAudioMatchUpdates(images, audioItems, audioSpan, fps)

  execute(
    'MATCH_IMAGES_TO_AUDIO',
    () => {
      const itemStore = useItemsStore.getState()
      const keyframesStore = useKeyframesStore.getState()
      for (const update of updates) {
        itemStore._updateItem(update.item.id, {
          from: update.from,
          durationInFrames: update.durationInFrames,
        })
        keyframesStore._scaleKeyframesForItem(
          update.item.id,
          update.item.durationInFrames,
          update.durationInFrames,
        )
      }
      applyTransitionRepairs(updates.map((update) => update.item.id))
      useTimelineSettingsStore.getState().markDirty()
      warnIfOverlapping('matchSelectedImagesToAudio')
    },
    { count: updates.length },
  )

  return {
    status: 'matched',
    imageCount: updates.length,
    audioStartFrame,
    audioEndFrame,
  }
}

function mergeIntervals(
  intervals: Array<[number, number]>,
  proximityFrames: number,
): Array<[number, number]> {
  if (intervals.length === 0) return []

  const sorted = [...intervals].filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0])

  const merged: Array<[number, number]> = []
  for (const [start, end] of sorted) {
    const previous = merged[merged.length - 1]
    if (!previous || start > previous[1] + proximityFrames) {
      merged.push([start, end])
      continue
    }
    previous[1] = Math.max(previous[1], end)
  }
  return merged
}

function buildDialogueIntervals(item: TimelineItem, fps: number): Array<[number, number]> {
  const itemStart = item.from
  const itemEnd = item.from + item.durationInFrames
  const cues = item.transcriptCaptions?.cues ?? []

  if (cues.length === 0 || item.isReversed) {
    return [[itemStart, itemEnd]]
  }

  const sourceFps = item.sourceFps ?? fps
  const sourceStartSeconds = (item.sourceStart ?? 0) / sourceFps
  const speed = Math.max(0.01, item.speed ?? 1)

  return cues.flatMap((cue): Array<[number, number]> => {
    const localStartSeconds = (cue.startSeconds - sourceStartSeconds) / speed
    const localEndSeconds = (cue.endSeconds - sourceStartSeconds) / speed
    const start = Math.max(itemStart, itemStart + Math.round(localStartSeconds * fps))
    const end = Math.min(itemEnd, itemStart + Math.round(localEndSeconds * fps))
    return end > start ? [[start, end]] : []
  })
}

function buildDuckingKeyframesForTarget(
  target: AudioItem,
  dialogueItems: TimelineItem[],
  fps: number,
  options: Required<AudioDuckingOptions>,
): KeyframeAddPayload[] {
  const targetStart = target.from
  const targetEnd = target.from + target.durationInFrames
  const attackFrames = Math.max(1, Math.round(options.attackSeconds * fps))
  const releaseFrames = Math.max(1, Math.round(options.releaseSeconds * fps))

  const overlappingIntervals = dialogueItems.flatMap((dialogueItem) =>
    buildDialogueIntervals(dialogueItem, fps).flatMap(([dialogueStart, dialogueEnd]) => {
      const start = Math.max(targetStart, dialogueStart)
      const end = Math.min(targetEnd, dialogueEnd)
      return end > start ? ([[start, end]] as Array<[number, number]>) : []
    }),
  )

  const intervals = mergeIntervals(overlappingIntervals, attackFrames + releaseFrames)
  if (intervals.length === 0) return []

  const baseVolumeDb = target.volume ?? 0
  const duckedVolumeDb = Math.max(-60, baseVolumeDb + options.duckDb)
  const keyframeByFrame = new Map<number, KeyframeAddPayload>()

  function add(frame: number, value: number, easing: KeyframeAddPayload['easing'] = 'linear') {
    const localFrame = Math.min(
      Math.max(0, frame - targetStart),
      Math.max(0, target.durationInFrames - 1),
    )
    keyframeByFrame.set(localFrame, {
      itemId: target.id,
      property: 'volume',
      frame: localFrame,
      value,
      easing,
    })
  }

  for (const [start, end] of intervals) {
    add(start - attackFrames, baseVolumeDb, 'ease-in-out')
    add(start, duckedVolumeDb, 'linear')
    add(end, duckedVolumeDb, 'ease-in-out')
    if (end + releaseFrames < targetEnd) {
      add(end + releaseFrames, baseVolumeDb, 'linear')
    }
  }

  return Array.from(keyframeByFrame.values())
    .filter((payload) => canAddKeyframeAtFrame(payload.itemId, payload.frame))
    .sort((a, b) => a.frame - b.frame)
}

export function applySelectedAudioDucking(
  selectedItemIds?: string[],
  options: AudioDuckingOptions = {},
): AudioDuckingResult {
  const selection = selectedIdsOrStore(selectedItemIds)
  const items = useItemsStore.getState().items
  const targets = sortByTrackThenTime(resolveSelectedAudioItems(items, selection)) as AudioItem[]

  if (targets.length === 0) {
    return { status: 'no-targets', targetCount: 0, dialogueCount: 0, keyframeCount: 0 }
  }

  const targetIds = new Set(targets.map((item) => item.id))
  const dialogueItems = items.filter((item) => isAudioItem(item) && !targetIds.has(item.id))
  if (dialogueItems.length === 0) {
    return {
      status: 'no-dialogue',
      targetCount: targets.length,
      dialogueCount: 0,
      keyframeCount: 0,
    }
  }

  const fps = useTimelineSettingsStore.getState().fps
  const resolvedOptions: Required<AudioDuckingOptions> = {
    duckDb: options.duckDb ?? DEFAULT_DUCK_DB,
    attackSeconds: options.attackSeconds ?? DEFAULT_DUCK_ATTACK_SECONDS,
    releaseSeconds: options.releaseSeconds ?? DEFAULT_DUCK_RELEASE_SECONDS,
  }
  const payloads = targets.flatMap((target) =>
    buildDuckingKeyframesForTarget(target, dialogueItems, fps, resolvedOptions),
  )

  if (payloads.length === 0) {
    return {
      status: 'no-dialogue',
      targetCount: targets.length,
      dialogueCount: dialogueItems.length,
      keyframeCount: 0,
    }
  }

  const payloadTargetIds = new Set(payloads.map((payload) => payload.itemId))
  const duckedTargets = targets.filter((target) => payloadTargetIds.has(target.id))

  execute(
    'APPLY_AUDIO_DUCKING',
    () => {
      const keyframesStore = useKeyframesStore.getState()
      for (const target of duckedTargets) {
        keyframesStore._removeKeyframesForProperty(target.id, 'volume')
      }
      keyframesStore._addKeyframes(payloads)
      useTimelineSettingsStore.getState().markDirty()
    },
    { count: duckedTargets.length, keyframes: payloads.length },
  )

  return {
    status: 'ducked',
    targetCount: duckedTargets.length,
    dialogueCount: dialogueItems.length,
    keyframeCount: payloads.length,
  }
}
