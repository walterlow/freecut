import type { ItemKeyframes, AnimatableProperty } from '@/types/keyframe'
import type { Transition } from '@/types/transition'
import type {
  AudioItem,
  AudiobookSfxRole,
  CinematicDepthRole,
  ImageItem,
  TimelineItem,
  TimelineTrack,
} from '@/types/timeline'
import { sourceSecondsToTimelineFrame } from '../deps/timeline-contract'

export type TimelineCinematicAuditGrade = 'excellent' | 'strong' | 'fair' | 'weak'
export type TimelineCinematicAuditIssueSeverity = 'info' | 'warning' | 'critical'

export interface TimelineCinematicAuditIssue {
  id: string
  severity: TimelineCinematicAuditIssueSeverity
  message: string
}

export interface TimelineCinematicAuditInput {
  items: TimelineItem[]
  tracks: TimelineTrack[]
  keyframes: ItemKeyframes[]
  transitions?: Transition[]
  fps: number
  narrationItemId?: string | null
  selectedImageIds?: string[]
}

export interface TimelineCinematicAuditScore {
  score: number
  grade: TimelineCinematicAuditGrade
  summary: string
  issues: TimelineCinematicAuditIssue[]
  metrics: {
    storyDurationSeconds: number
    imageCount: number
    imageCoveragePct: number
    animatedImageCount: number
    multiAxisImageCount: number
    stagedCameraImageCount: number
    imageCutCount: number
    directedTransitionCutCount: number
    directedTransitionCoveragePct: number
    narrationCount: number
    musicBedCount: number
    sfxCount: number
    duckedMusicBedCount: number
    stemMixScore: number
    narrationGainDb: number | null
    musicUnderNarrationDb: number | null
    foregroundSfxToNarrationDb: number | null
    ambienceSfxToNarrationDb: number | null
    foregroundSfxCount: number
    impactSfxCount: number
    ambienceSfxCount: number
    depthPreparedImageCount: number
    depthPreparedImagePct: number
    parallaxLayerCount: number
    depthLayerGroupCount: number
    depthReadinessScore: number
    averageDepthQuality: number | null
    lowQualityDepthLayerCount: number
    averageImageShotSeconds: number
    imageShotDurationStdDevSeconds: number
    transcriptAlignedCutPct: number
    shotRhythmScore: number
    imageStoryMatchedCount: number
    imageStoryMeasurableCount: number
    imageStoryMatchPct: number
    storyBeatCount: number
    storyBeatSfxCoveredCount: number
    storyBeatSfxCoveragePct: number
    referenceReadinessScore: number
  }
}

interface StorySpan {
  startFrame: number
  endFrame: number
}

interface StemMixMetrics {
  stemMixScore: number
  narrationGainDb: number | null
  musicUnderNarrationDb: number | null
  foregroundSfxToNarrationDb: number | null
  ambienceSfxToNarrationDb: number | null
  foregroundSfxCount: number
  impactSfxCount: number
  ambienceSfxCount: number
}

interface DepthPrepMetrics {
  depthPreparedImageCount: number
  depthPreparedImagePct: number
  parallaxLayerCount: number
  depthLayerGroupCount: number
  depthReadinessScore: number
  averageDepthQuality: number | null
  lowQualityDepthLayerCount: number
}

interface ShotRhythmMetrics {
  averageImageShotSeconds: number
  imageShotDurationStdDevSeconds: number
  transcriptAlignedCutPct: number
  shotRhythmScore: number
  hasTranscriptCutTargets: boolean
  internalImageCutCount: number
}

interface TransitionDirectionMetrics {
  imageCutCount: number
  directedTransitionCutCount: number
  directedTransitionCoveragePct: number
}

interface StoryBeatSfxCoverageMetrics {
  storyBeatCount: number
  storyBeatSfxCoveredCount: number
  storyBeatSfxCoveragePct: number
}

interface ImageStoryMatchMetrics {
  imageStoryMatchedCount: number
  imageStoryMeasurableCount: number
  imageStoryMatchPct: number
}

const CAMERA_PROPERTIES: AnimatableProperty[] = ['x', 'y', 'width', 'height', 'rotation']
const STORY_BEAT_TERMS = [
  'truth',
  'choice',
  'decision',
  'danger',
  'secret',
  'hidden',
  'silence',
  'warning',
  'power',
  'promise',
  'broken',
  'betrayal',
  'fear',
  'heart',
  'alone',
  'never',
  'always',
  'finally',
  'suddenly',
  'only',
  'but',
  'however',
  'first',
  'last',
  'named',
  'reveal',
  'cover',
  'leverage',
  'privacy',
  'discretion',
  'agency',
  'judge',
  'senator',
  'forbes',
]
const STORY_MATCH_MIN_SCORE = 1.5
const STORY_MATCH_STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'onto',
  'over',
  'under',
  'then',
  'when',
  'where',
  'while',
  'about',
  'through',
  'scene',
  'shot',
  'still',
  'image',
  'photo',
  'frame',
  'clip',
  'slide',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'file',
  'media',
])
const DEPTH_ROLE_MATCHERS: Array<{
  pattern: RegExp
  role: CinematicDepthRole
}> = [
  { pattern: /depth[-_\s]?map|depth plate|z[-_\s]?depth/, role: 'depth-map' },
  { pattern: /subject|person|character|hero|cutout/, role: 'subject' },
  { pattern: /foreground|\bfg\b|front layer/, role: 'foreground' },
  { pattern: /midground|\bmg\b|middle layer/, role: 'midground' },
  { pattern: /background|\bbg\b|back layer/, role: 'background' },
  { pattern: /flat|flattened|single plate/, role: 'flat' },
]

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10
}

function gradeForScore(score: number): TimelineCinematicAuditGrade {
  if (score >= 8.5) return 'excellent'
  if (score >= 7) return 'strong'
  if (score >= 5.2) return 'fair'
  return 'weak'
}

function summaryForGrade(grade: TimelineCinematicAuditGrade): string {
  switch (grade) {
    case 'excellent':
      return 'Timeline is ready for a high-end cinematic render pass.'
    case 'strong':
      return 'Timeline is close to cinematic, with minor risks to review.'
    case 'fair':
      return 'Timeline has cinematic pieces, but the render may still feel uneven.'
    case 'weak':
      return 'Timeline is missing key cinematic automation before export.'
  }
}

function issue(
  id: string,
  severity: TimelineCinematicAuditIssueSeverity,
  message: string,
): TimelineCinematicAuditIssue {
  return { id, severity, message }
}

function isAudioItem(item: TimelineItem): item is AudioItem {
  return item.type === 'audio'
}

function isStillImage(item: TimelineItem): item is ImageItem {
  return item.type === 'image' && !/\.gif$/i.test(item.label ?? '')
}

function overlaps(item: TimelineItem, span: StorySpan): boolean {
  return item.from < span.endFrame && item.from + item.durationInFrames > span.startFrame
}

function trackById(tracks: TimelineTrack[]): Map<string, TimelineTrack> {
  return new Map(tracks.map((track) => [track.id, track]))
}

function isSfxAudio(item: AudioItem, track?: TimelineTrack): boolean {
  const label = `${item.label ?? ''} ${track?.name ?? ''}`
  return /sfx|sound\s*effect|foley|audiobook\s*sfx/i.test(label)
}

function resolveNarrationItems(
  items: TimelineItem[],
  narrationItemId?: string | null,
): AudioItem[] {
  const audioItems = items.filter(isAudioItem)
  if (narrationItemId) {
    const selected = audioItems.find((item) => item.id === narrationItemId)
    if (selected) return [selected]
  }

  const transcriptAudio = audioItems.filter(
    (item) => (item.transcriptCaptions?.cues.length ?? 0) > 0,
  )
  if (transcriptAudio.length > 0) return transcriptAudio

  const longest = audioItems.sort(
    (left, right) => right.durationInFrames - left.durationInFrames,
  )[0]
  return longest ? [longest] : []
}

function getStorySpan(narrationItems: AudioItem[]): StorySpan | null {
  if (narrationItems.length === 0) return null

  const startFrame = Math.min(...narrationItems.map((item) => item.from))
  const endFrame = Math.max(...narrationItems.map((item) => item.from + item.durationInFrames))
  return endFrame > startFrame ? { startFrame, endFrame } : null
}

function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  const sorted = intervals.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []

  for (const [start, end] of sorted) {
    const previous = merged[merged.length - 1]
    if (!previous || start > previous[1]) {
      merged.push([start, end])
      continue
    }
    previous[1] = Math.max(previous[1], end)
  }

  return merged
}

function coveragePct(items: TimelineItem[], span: StorySpan): number {
  const intervals = mergeIntervals(
    items.map((item) => [
      Math.max(span.startFrame, item.from),
      Math.min(span.endFrame, item.from + item.durationInFrames),
    ]),
  )
  const coveredFrames = intervals.reduce(
    (total, [start, end]) => total + Math.max(0, end - start),
    0,
  )
  return span.endFrame > span.startFrame ? coveredFrames / (span.endFrame - span.startFrame) : 0
}

function getEditorialImages(images: ImageItem[]): ImageItem[] {
  return images.filter(
    (item) =>
      !item.cinematicDepthRole ||
      item.cinematicDepthRole === 'flat' ||
      item.cinematicDepthRole === 'background',
  )
}

function getTrackImageCuts(images: ImageItem[]): Set<number> {
  const byTrack = new Map<string, ImageItem[]>()

  for (const image of images) {
    const trackImages = byTrack.get(image.trackId) ?? []
    trackImages.push(image)
    byTrack.set(image.trackId, trackImages)
  }

  const cuts = new Set<number>()
  for (const trackImages of byTrack.values()) {
    const sorted = trackImages.toSorted(
      (left, right) => left.from - right.from || left.id.localeCompare(right.id),
    )
    for (let index = 1; index < sorted.length; index += 1) {
      const left = sorted[index - 1]!
      const right = sorted[index]!
      if (Math.abs(left.from + left.durationInFrames - right.from) <= 1) cuts.add(right.from)
    }
  }
  return cuts
}

function getDirectedTransitionCuts(params: {
  items: TimelineItem[]
  transitions: Transition[]
  cuts: Set<number>
}): Set<number> {
  const imageById = new Map(params.items.filter(isStillImage).map((item) => [item.id, item]))
  const directedCuts = new Set<number>()

  for (const transition of params.transitions) {
    const left = imageById.get(transition.leftClipId)
    const right = imageById.get(transition.rightClipId)
    if (!left || !right) continue
    if (!params.cuts.has(right.from)) continue
    directedCuts.add(right.from)
  }
  return directedCuts
}

function calculateTransitionDirectionMetrics(params: {
  images: ImageItem[]
  items: TimelineItem[]
  transitions: Transition[]
}): TransitionDirectionMetrics {
  const cuts = getTrackImageCuts(getEditorialImages(params.images))
  const directedCuts = getDirectedTransitionCuts({
    items: params.items,
    transitions: params.transitions,
    cuts,
  })

  return {
    imageCutCount: cuts.size,
    directedTransitionCutCount: directedCuts.size,
    directedTransitionCoveragePct:
      cuts.size > 0 ? roundToTenth((directedCuts.size / cuts.size) * 100) : 0,
  }
}

function getItemKeyframes(keyframes: ItemKeyframes[], itemId: string): ItemKeyframes | undefined {
  return keyframes.find((entry) => entry.itemId === itemId)
}

function hasAnimatedProperty(
  itemKeyframes: ItemKeyframes | undefined,
  property: AnimatableProperty,
): boolean {
  const propertyKeyframes = itemKeyframes?.properties.find((group) => group.property === property)
  if (!propertyKeyframes || propertyKeyframes.keyframes.length < 2) return false

  const values = new Set(
    propertyKeyframes.keyframes.map((keyframe) => roundToTenth(keyframe.value)),
  )
  return values.size > 1
}

function hasStagedAnimatedProperty(
  itemKeyframes: ItemKeyframes | undefined,
  property: AnimatableProperty,
): boolean {
  const propertyKeyframes = itemKeyframes?.properties.find((group) => group.property === property)
  if (!propertyKeyframes || propertyKeyframes.keyframes.length < 3) return false
  return hasAnimatedProperty(itemKeyframes, property)
}

function getAnimatedCameraProperties(
  image: ImageItem,
  keyframes: ItemKeyframes[],
): AnimatableProperty[] {
  const itemKeyframes = getItemKeyframes(keyframes, image.id)
  return CAMERA_PROPERTIES.filter((property) => hasAnimatedProperty(itemKeyframes, property))
}

function hasStagedZoomAndMove(image: ImageItem, keyframes: ItemKeyframes[]): boolean {
  const itemKeyframes = getItemKeyframes(keyframes, image.id)
  const hasStagedZoom =
    hasStagedAnimatedProperty(itemKeyframes, 'width') ||
    hasStagedAnimatedProperty(itemKeyframes, 'height')
  const hasStagedMove =
    hasStagedAnimatedProperty(itemKeyframes, 'x') ||
    hasStagedAnimatedProperty(itemKeyframes, 'y') ||
    hasStagedAnimatedProperty(itemKeyframes, 'rotation')
  return hasStagedZoom && hasStagedMove
}

function hasZoomAndMove(animatedProperties: AnimatableProperty[]): boolean {
  const hasZoom = animatedProperties.includes('width') || animatedProperties.includes('height')
  const hasMove =
    animatedProperties.includes('x') ||
    animatedProperties.includes('y') ||
    animatedProperties.includes('rotation')
  return hasZoom && hasMove
}

function getCameraMotionProfile(image: ImageItem, keyframes: ItemKeyframes[]) {
  const animatedProperties = getAnimatedCameraProperties(image, keyframes)
  const multiAxis = animatedProperties.length >= 2 && hasZoomAndMove(animatedProperties)
  return {
    animated: animatedProperties.length > 0,
    multiAxis,
    staged: multiAxis && hasStagedZoomAndMove(image, keyframes),
  }
}

function countProfiles<T>(profiles: T[], predicate: (profile: T) => boolean): number {
  return profiles.filter(predicate).length
}

function cameraMotionStats(
  images: ImageItem[],
  keyframes: ItemKeyframes[],
): {
  animatedImageCount: number
  multiAxisImageCount: number
  stagedCameraImageCount: number
} {
  const profiles = images.map((image) => getCameraMotionProfile(image, keyframes))

  return {
    animatedImageCount: countProfiles(profiles, (profile) => profile.animated),
    multiAxisImageCount: countProfiles(profiles, (profile) => profile.multiAxis),
    stagedCameraImageCount: countProfiles(profiles, (profile) => profile.staged),
  }
}

function isPreparedDepthRole(role: CinematicDepthRole | null): boolean {
  return role != null && role !== 'flat'
}

function inferDepthRole(image: ImageItem, track?: TimelineTrack): CinematicDepthRole | null {
  if (image.cinematicDepthRole) return image.cinematicDepthRole

  const label = `${image.label ?? ''} ${track?.name ?? ''}`.toLowerCase()
  return DEPTH_ROLE_MATCHERS.find(({ pattern }) => pattern.test(label))?.role ?? null
}

function depthSourceId(image: ImageItem): string {
  return image.cinematicDepthSourceId ?? image.originId ?? image.mediaId ?? image.id
}

function calculateDepthReadinessScore(params: {
  imageCount: number
  depthPreparedImageCount: number
  depthLayerGroupCount: number
  parallaxLayerCount: number
  averageDepthQuality: number | null
  lowQualityDepthLayerCount: number
}): number {
  if (params.imageCount === 0) return 0
  const preparedRatio = params.depthPreparedImageCount / params.imageCount
  const baseScore = getDepthPrepBaseScore({
    preparedRatio,
    depthLayerGroupCount: params.depthLayerGroupCount,
    parallaxLayerCount: params.parallaxLayerCount,
  })

  if (params.averageDepthQuality == null) return baseScore

  const lowQualityRatio =
    params.lowQualityDepthLayerCount / Math.max(1, params.depthPreparedImageCount)
  const averageQualityPenalty = getDepthQualityPenalty(params.averageDepthQuality)
  return roundToTenth(clamp(baseScore - averageQualityPenalty - lowQualityRatio * 1.6, 0, 10))
}

function getDepthPrepBaseScore(params: {
  preparedRatio: number
  depthLayerGroupCount: number
  parallaxLayerCount: number
}): number {
  if (params.depthLayerGroupCount > 0 && params.preparedRatio >= 0.75) return 9
  if (params.depthLayerGroupCount > 0 && params.preparedRatio >= 0.5) return 8
  if (params.depthLayerGroupCount > 0) return 7
  return params.parallaxLayerCount > 0 ? 5.5 : 3
}

function getDepthQualityPenalty(averageDepthQuality: number): number {
  if (averageDepthQuality < 0.45) return 3.4
  if (averageDepthQuality < 0.6) return 1.8
  if (averageDepthQuality < 0.72) return 0.6
  return 0
}

function calculateDepthPrepMetrics(
  images: ImageItem[],
  tracks: Map<string, TimelineTrack>,
): DepthPrepMetrics {
  const preparedLayers = images
    .map((image) => ({
      image,
      role: inferDepthRole(image, tracks.get(image.trackId)),
    }))
    .filter(({ role }) => isPreparedDepthRole(role))
  const groups = new Map<string, Set<CinematicDepthRole>>()

  for (const { image, role } of preparedLayers) {
    if (!role) continue
    const roles = groups.get(depthSourceId(image)) ?? new Set<CinematicDepthRole>()
    roles.add(role)
    groups.set(depthSourceId(image), roles)
  }

  const depthLayerGroupCount = [...groups.values()].filter(
    (roles) => roles.has('depth-map') || roles.size >= 2,
  ).length
  const depthPreparedImageCount = preparedLayers.length
  const depthQualityValues = preparedLayers
    .map(({ image }) => image.cinematicDepthQuality)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const averageDepthQuality =
    depthQualityValues.length > 0
      ? roundToTenth(
          (depthQualityValues.reduce((total, value) => total + value, 0) /
            depthQualityValues.length) *
            10,
        ) / 10
      : null
  const lowQualityDepthLayerCount = depthQualityValues.filter((value) => value < 0.55).length
  const depthPreparedImagePct =
    images.length > 0 ? roundToTenth((depthPreparedImageCount / images.length) * 100) : 0

  return {
    depthPreparedImageCount,
    depthPreparedImagePct,
    parallaxLayerCount: preparedLayers.length,
    depthLayerGroupCount,
    depthReadinessScore: calculateDepthReadinessScore({
      imageCount: images.length,
      depthPreparedImageCount,
      depthLayerGroupCount,
      parallaxLayerCount: preparedLayers.length,
      averageDepthQuality,
      lowQualityDepthLayerCount,
    }),
    averageDepthQuality,
    lowQualityDepthLayerCount,
  }
}

function calculateSfxRoleCoverageScore(stemMix: StemMixMetrics, sfxCount: number): number {
  if (sfxCount === 0) return 0

  const foregroundScore = stemMix.foregroundSfxCount > 0 ? 0.42 : 0
  const impactScore = stemMix.impactSfxCount > 0 ? 0.32 : 0
  const ambienceScore = stemMix.ambienceSfxCount > 0 ? 0.18 : 0
  const densityScore = sfxCount >= 3 ? 0.08 : 0
  return clamp(foregroundScore + impactScore + ambienceScore + densityScore, 0, 1)
}

function calculateReferenceReadinessScore(params: {
  imageCount: number
  imageCoveragePct: number
  multiAxisImageCount: number
  stagedCameraImageCount: number
  musicBedCount: number
  duckedMusicBedCount: number
  sfxCount: number
  stemMix: StemMixMetrics
  depthPrep: DepthPrepMetrics
  shotRhythm: ShotRhythmMetrics
  imageStoryMatch: ImageStoryMatchMetrics
  storyBeatSfxCoverage: StoryBeatSfxCoverageMetrics
}): number {
  if (params.imageCount === 0) return 0

  const multiAxisRatio = clamp(params.multiAxisImageCount / params.imageCount, 0, 1)
  const stagedRatio = clamp(params.stagedCameraImageCount / params.imageCount, 0, 1)
  const musicScore = params.musicBedCount === 0 ? 0 : params.duckedMusicBedCount > 0 ? 1 : 0.55
  const depthQualityFactor =
    params.depthPrep.averageDepthQuality == null
      ? 1
      : clamp((params.depthPrep.averageDepthQuality - 0.35) / 0.37, 0, 1)
  const depthScore = clamp(params.depthPrep.depthReadinessScore / 10, 0, 1) * depthQualityFactor
  const stemScore = clamp(params.stemMix.stemMixScore / 10, 0, 1)
  const sfxRoleScore = calculateSfxRoleCoverageScore(params.stemMix, params.sfxCount)
  const shotRhythmScore = clamp(params.shotRhythm.shotRhythmScore / 10, 0, 1)
  const imageStoryMatchScore =
    params.imageStoryMatch.imageStoryMeasurableCount < 2
      ? 1
      : clamp(params.imageStoryMatch.imageStoryMatchPct / 100, 0, 1)
  const storyBeatSfxScore =
    params.storyBeatSfxCoverage.storyBeatCount === 0
      ? 1
      : clamp(params.storyBeatSfxCoverage.storyBeatSfxCoveragePct / 100, 0, 1)

  return roundToTenth(
    (params.imageCoveragePct * 0.1 +
      multiAxisRatio * 0.11 +
      stagedRatio * 0.14 +
      depthScore * 0.16 +
      stemScore * 0.14 +
      shotRhythmScore * 0.09 +
      sfxRoleScore * 0.07 +
      storyBeatSfxScore * 0.09 +
      imageStoryMatchScore * 0.04 +
      musicScore * 0.06) *
      10,
  )
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((total, value) => total + value, 0) / values.length
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0
  const mean = average(values)
  const variance = average(values.map((value) => (value - mean) ** 2))
  return Math.sqrt(variance)
}

function normalizeStoryText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isStoryBeatText(text: string): boolean {
  const normalized = normalizeStoryText(text)
  if (!normalized) return false

  return STORY_BEAT_TERMS.some((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(normalized)
  })
}

function storyMatchTokens(value: string): Set<string> {
  return new Set(
    normalizeStoryText(value)
      .split(' ')
      .map((token) => token.trim())
      .filter(
        (token) => token.length >= 3 && !/^\d+$/.test(token) && !STORY_MATCH_STOP_WORDS.has(token),
      ),
  )
}

function storyTokenWeight(token: string): number {
  if (STORY_BEAT_TERMS.some((term) => token === term || token.startsWith(term))) return 1.9
  if (token.length >= 7) return 1.35
  return 1
}

function imageStoryText(item: ImageItem): string {
  const sourceName = item.src.split(/[\\/]/).pop() ?? item.src
  return [item.label, sourceName, item.mediaId].filter(Boolean).join(' ')
}

function imageSegmentStoryScore(imageTokens: Set<string>, transcriptTokens: Set<string>): number {
  let score = 0
  for (const token of imageTokens) {
    if (transcriptTokens.has(token)) {
      score += storyTokenWeight(token)
    }
  }
  return score
}

function transcriptCueTimelineRange(
  item: AudioItem,
  cue: NonNullable<AudioItem['transcriptCaptions']>['cues'][number],
  fps: number,
): { startFrame: number; endFrame: number } {
  const startFrame = sourceSecondsToTimelineFrame(item, cue.startSeconds, fps)
  const endFrame = Math.max(startFrame + 1, sourceSecondsToTimelineFrame(item, cue.endSeconds, fps))
  return { startFrame, endFrame }
}

function transcriptTextForImage(
  image: ImageItem,
  narrationItems: AudioItem[],
  fps: number,
): string {
  const imageStart = image.from
  const imageEnd = image.from + image.durationInFrames
  const overlappingTexts = narrationItems.flatMap((item) =>
    (item.transcriptCaptions?.cues ?? [])
      .filter((cue) => {
        const range = transcriptCueTimelineRange(item, cue, fps)
        return range.startFrame < imageEnd && range.endFrame > imageStart
      })
      .map((cue) => cue.text),
  )

  return overlappingTexts.join(' ')
}

function calculateImageStoryMatchMetrics(params: {
  images: ImageItem[]
  narrationItems: AudioItem[]
  fps: number
}): ImageStoryMatchMetrics {
  let imageStoryMatchedCount = 0
  let imageStoryMeasurableCount = 0

  for (const image of params.images) {
    const imageTokens = storyMatchTokens(imageStoryText(image))
    if (imageTokens.size === 0) continue

    const transcriptTokens = storyMatchTokens(
      transcriptTextForImage(image, params.narrationItems, params.fps),
    )
    if (transcriptTokens.size === 0) continue

    imageStoryMeasurableCount += 1
    if (imageSegmentStoryScore(imageTokens, transcriptTokens) >= STORY_MATCH_MIN_SCORE) {
      imageStoryMatchedCount += 1
    }
  }

  return {
    imageStoryMatchedCount,
    imageStoryMeasurableCount,
    imageStoryMatchPct:
      imageStoryMeasurableCount > 0
        ? roundToTenth((imageStoryMatchedCount / imageStoryMeasurableCount) * 100)
        : 0,
  }
}

function calculateShotDurationScore(averageShotSeconds: number): number {
  if (averageShotSeconds <= 0) return 0
  if (averageShotSeconds >= 3.5 && averageShotSeconds <= 8) return 1
  if (averageShotSeconds >= 2.2 && averageShotSeconds <= 12) return 0.78
  if (averageShotSeconds < 2.2) return clamp(averageShotSeconds / 2.2, 0, 0.65)
  return clamp(12 / averageShotSeconds, 0, 0.65)
}

function calculateShotVariationScore(
  stdDevSeconds: number,
  hasTranscriptCutTargets: boolean,
): number {
  if (stdDevSeconds >= 0.85) return 1
  if (stdDevSeconds >= 0.45) return 0.85
  if (stdDevSeconds >= 0.2) return 0.7
  return hasTranscriptCutTargets ? 0.55 : 0.65
}

function transcriptCutTargets(narrationItems: AudioItem[], span: StorySpan, fps: number): number[] {
  const edgeTolerance = Math.round(0.65 * fps)
  return narrationItems
    .flatMap((item) =>
      (item.transcriptCaptions?.cues ?? []).map((cue) =>
        sourceSecondsToTimelineFrame(item, cue.startSeconds, fps),
      ),
    )
    .filter(
      (frame) => frame > span.startFrame + edgeTolerance && frame < span.endFrame - edgeTolerance,
    )
    .sort((a, b) => a - b)
}

function internalImageCutFrames(images: ImageItem[], span: StorySpan, fps: number): number[] {
  const edgeTolerance = Math.round(0.3 * fps)
  return [...new Set(images.map((image) => image.from))]
    .filter(
      (frame) => frame > span.startFrame + edgeTolerance && frame < span.endFrame - edgeTolerance,
    )
    .sort((a, b) => a - b)
}

function transcriptAlignedCutPct(cutFrames: number[], targetFrames: number[], fps: number): number {
  if (cutFrames.length === 0 || targetFrames.length === 0) return 0
  const toleranceFrames = Math.round(0.45 * fps)
  const matchedCount = cutFrames.filter((cutFrame) =>
    targetFrames.some((targetFrame) => Math.abs(targetFrame - cutFrame) <= toleranceFrames),
  ).length
  return (matchedCount / cutFrames.length) * 100
}

function collectTimelineStoryBeatFrames(
  narrationItems: AudioItem[],
  span: StorySpan,
  fps: number,
): number[] {
  const rawFrames = narrationItems
    .flatMap((item) =>
      (item.transcriptCaptions?.cues ?? [])
        .filter((cue) => isStoryBeatText(cue.text))
        .map((cue) => sourceSecondsToTimelineFrame(item, cue.startSeconds, fps)),
    )
    .filter((frame) => frame >= span.startFrame && frame <= span.endFrame)
    .sort((left, right) => left - right)

  const spacedFrames: number[] = []
  const minSpacingFrames = Math.round(10 * fps)
  for (const frame of rawFrames) {
    const previousFrame = spacedFrames[spacedFrames.length - 1]
    if (previousFrame == null || frame - previousFrame >= minSpacingFrames) {
      spacedFrames.push(frame)
    }
  }

  return spacedFrames
}

function sfxCoversStoryBeatFrame(
  item: AudioItem,
  beatFrame: number,
  fps: number,
  track?: TimelineTrack,
): boolean {
  const role = inferSfxRole(item, track)
  if (role === 'ambience') return false

  const startFrame = item.from
  const endFrame = item.from + item.durationInFrames
  return (
    startFrame <= beatFrame + Math.round(8 * fps) && endFrame >= beatFrame - Math.round(4 * fps)
  )
}

function calculateStoryBeatSfxCoverage(params: {
  narrationItems: AudioItem[]
  sfxItems: AudioItem[]
  tracks: Map<string, TimelineTrack>
  span: StorySpan
  fps: number
}): StoryBeatSfxCoverageMetrics {
  const beatFrames = collectTimelineStoryBeatFrames(params.narrationItems, params.span, params.fps)
  if (beatFrames.length === 0) {
    return {
      storyBeatCount: 0,
      storyBeatSfxCoveredCount: 0,
      storyBeatSfxCoveragePct: 0,
    }
  }

  const storyBeatSfxCoveredCount = beatFrames.filter((beatFrame) =>
    params.sfxItems.some((item) =>
      sfxCoversStoryBeatFrame(item, beatFrame, params.fps, params.tracks.get(item.trackId)),
    ),
  ).length

  return {
    storyBeatCount: beatFrames.length,
    storyBeatSfxCoveredCount,
    storyBeatSfxCoveragePct: roundToTenth((storyBeatSfxCoveredCount / beatFrames.length) * 100),
  }
}

function calculateShotRhythmMetrics(params: {
  images: ImageItem[]
  narrationItems: AudioItem[]
  span: StorySpan
  fps: number
}): ShotRhythmMetrics {
  const sortedImages = [...params.images].sort((left, right) => left.from - right.from)
  const shotDurationsSeconds = sortedImages.map((image) => {
    const start = Math.max(params.span.startFrame, image.from)
    const end = Math.min(params.span.endFrame, image.from + image.durationInFrames)
    return Math.max(0, end - start) / Math.max(1, params.fps)
  })
  const averageImageShotSeconds = average(shotDurationsSeconds)
  const imageShotDurationStdDevSeconds = standardDeviation(shotDurationsSeconds)
  const cutFrames = internalImageCutFrames(sortedImages, params.span, params.fps)
  const targetFrames = transcriptCutTargets(params.narrationItems, params.span, params.fps)
  const hasTranscriptCutTargets = targetFrames.length > 0
  const alignedCutPct = transcriptAlignedCutPct(cutFrames, targetFrames, params.fps)
  const alignmentScore = hasTranscriptCutTargets ? alignedCutPct / 100 : 0.72
  const durationScore = calculateShotDurationScore(averageImageShotSeconds)
  const variationScore = calculateShotVariationScore(
    imageShotDurationStdDevSeconds,
    hasTranscriptCutTargets,
  )

  return {
    averageImageShotSeconds: roundToTenth(averageImageShotSeconds),
    imageShotDurationStdDevSeconds: roundToTenth(imageShotDurationStdDevSeconds),
    transcriptAlignedCutPct: roundToTenth(alignedCutPct),
    shotRhythmScore: roundToTenth(
      clamp((durationScore * 0.45 + variationScore * 0.2 + alignmentScore * 0.35) * 10, 0, 10),
    ),
    hasTranscriptCutTargets,
    internalImageCutCount: cutFrames.length,
  }
}

function hasDuckingKeyframes(item: AudioItem, keyframes: ItemKeyframes[]): boolean {
  const baseVolume = item.volume ?? 0
  const volumeKeyframes = getItemKeyframes(keyframes, item.id)?.properties.find(
    (group) => group.property === 'volume',
  )?.keyframes
  if (!volumeKeyframes || volumeKeyframes.length < 2) return false

  return Math.min(...volumeKeyframes.map((keyframe) => keyframe.value)) <= baseVolume - 3
}

function volumeKeyframesForItem(item: AudioItem, keyframes: ItemKeyframes[]) {
  return getItemKeyframes(keyframes, item.id)?.properties.find(
    (group) => group.property === 'volume',
  )?.keyframes
}

function weightedAverageDb(
  items: AudioItem[],
  tracks: Map<string, TimelineTrack>,
  resolveVolumeDb: (item: AudioItem, track?: TimelineTrack) => number,
): number | null {
  if (items.length === 0) return null

  let weightedSum = 0
  let totalWeight = 0
  for (const item of items) {
    const weight = Math.max(1, item.durationInFrames)
    weightedSum += resolveVolumeDb(item, tracks.get(item.trackId)) * weight
    totalWeight += weight
  }

  return totalWeight > 0 ? weightedSum / totalWeight : null
}

function effectiveStaticVolumeDb(item: AudioItem, track?: TimelineTrack): number {
  return (item.volume ?? 0) + (track?.volume ?? 0)
}

function effectiveDuckedVolumeDb(
  item: AudioItem,
  keyframes: ItemKeyframes[],
  track?: TimelineTrack,
): number {
  const volumeKeyframes = volumeKeyframesForItem(item, keyframes)
  if (!volumeKeyframes || volumeKeyframes.length === 0) {
    return effectiveStaticVolumeDb(item, track)
  }

  return Math.min(...volumeKeyframes.map((keyframe) => keyframe.value)) + (track?.volume ?? 0)
}

function inferSfxRole(item: AudioItem, track?: TimelineTrack): AudiobookSfxRole {
  if (item.audiobookSfxRole) return item.audiobookSfxRole

  const label = `${item.label ?? ''} ${track?.name ?? ''}`.toLowerCase()
  if (/chapter|sting|transition|title/.test(label)) return 'transition'
  if (/impact|hit|reveal|power|decision|secrecy|pulse/.test(label)) return 'impact'
  if (/ambience|ambient|scene bed|room tone|town|city|wind|water|fire|newsroom/.test(label)) {
    return 'ambience'
  }
  if (effectiveStaticVolumeDb(item, track) <= -2.5) return 'ambience'
  return 'foreground'
}

function musicMixPenalty(musicUnderNarrationDb: number | null): number {
  if (musicUnderNarrationDb == null) return 0
  if (musicUnderNarrationDb > -8) return 1.2
  if (musicUnderNarrationDb < -32) return 0.4
  return 0
}

function foregroundSfxMixPenalty(foregroundSfxToNarrationDb: number | null): number {
  if (foregroundSfxToNarrationDb == null) return 0
  if (foregroundSfxToNarrationDb < 5) return 1.4
  if (foregroundSfxToNarrationDb > 15) return 0.8
  return 0
}

function ambienceSfxMixPenalty(ambienceSfxToNarrationDb: number | null): number {
  if (ambienceSfxToNarrationDb == null) return 0
  if (ambienceSfxToNarrationDb > -3) return 0.6
  if (ambienceSfxToNarrationDb < -16) return 0.3
  return 0
}

function sfxPresenceMixPenalty(params: {
  sfxCount: number
  foregroundSfxCount: number
  impactSfxCount: number
}): number {
  const foregroundPenalty = params.sfxCount > 0 && params.foregroundSfxCount === 0 ? 1 : 0
  const impactPenalty = params.sfxCount >= 3 && params.impactSfxCount === 0 ? 0.6 : 0
  return foregroundPenalty + impactPenalty
}

function stemMixPenalty(params: {
  sfxCount: number
  musicUnderNarrationDb: number | null
  foregroundSfxToNarrationDb: number | null
  ambienceSfxToNarrationDb: number | null
  foregroundSfxCount: number
  impactSfxCount: number
}): number {
  return (
    musicMixPenalty(params.musicUnderNarrationDb) +
    foregroundSfxMixPenalty(params.foregroundSfxToNarrationDb) +
    ambienceSfxMixPenalty(params.ambienceSfxToNarrationDb) +
    sfxPresenceMixPenalty(params)
  )
}

function calculateStemMixMetrics(params: {
  narrationItems: AudioItem[]
  musicBeds: AudioItem[]
  sfxItems: AudioItem[]
  tracks: Map<string, TimelineTrack>
  keyframes: ItemKeyframes[]
}): StemMixMetrics {
  const { narrationItems, musicBeds, sfxItems, tracks, keyframes } = params
  const narrationGainDb = weightedAverageDb(narrationItems, tracks, effectiveStaticVolumeDb)
  const effectiveNarrationDb = narrationGainDb ?? 0
  const musicUnderNarrationGainDb = weightedAverageDb(musicBeds, tracks, (item, track) =>
    effectiveDuckedVolumeDb(item, keyframes, track),
  )
  const roles = sfxItems.map((item) => ({
    item,
    role: inferSfxRole(item, tracks.get(item.trackId)),
  }))
  const foregroundSfx = roles.filter(({ role }) => role !== 'ambience').map(({ item }) => item)
  const ambienceSfx = roles.filter(({ role }) => role === 'ambience').map(({ item }) => item)
  const impactSfxCount = roles.filter(
    ({ role }) => role === 'impact' || role === 'transition',
  ).length
  const foregroundSfxGainDb = weightedAverageDb(foregroundSfx, tracks, effectiveStaticVolumeDb)
  const ambienceSfxGainDb = weightedAverageDb(ambienceSfx, tracks, effectiveStaticVolumeDb)
  const musicUnderNarrationDb =
    musicUnderNarrationGainDb == null
      ? null
      : roundToTenth(musicUnderNarrationGainDb - effectiveNarrationDb)
  const foregroundSfxToNarrationDb =
    foregroundSfxGainDb == null ? null : roundToTenth(foregroundSfxGainDb - effectiveNarrationDb)
  const ambienceSfxToNarrationDb =
    ambienceSfxGainDb == null ? null : roundToTenth(ambienceSfxGainDb - effectiveNarrationDb)
  const penalty = stemMixPenalty({
    sfxCount: sfxItems.length,
    musicUnderNarrationDb,
    foregroundSfxToNarrationDb,
    ambienceSfxToNarrationDb,
    foregroundSfxCount: foregroundSfx.length,
    impactSfxCount,
  })

  return {
    stemMixScore: roundToTenth(clamp(10 - penalty, 0, 10)),
    narrationGainDb: narrationGainDb == null ? null : roundToTenth(narrationGainDb),
    musicUnderNarrationDb,
    foregroundSfxToNarrationDb,
    ambienceSfxToNarrationDb,
    foregroundSfxCount: foregroundSfx.length,
    impactSfxCount,
    ambienceSfxCount: ambienceSfx.length,
  }
}

function selectedOrOverlappingImages(params: {
  items: TimelineItem[]
  span: StorySpan
  selectedImageIds?: string[]
}): ImageItem[] {
  const selectedIds = new Set(params.selectedImageIds ?? [])
  const selectedImages = params.items.filter(
    (item): item is ImageItem => selectedIds.has(item.id) && isStillImage(item),
  )
  if (selectedImages.length > 0) return selectedImages

  return params.items.filter(
    (item): item is ImageItem => isStillImage(item) && overlaps(item, params.span),
  )
}

function auditResult(
  penalty: number,
  auditIssue: TimelineCinematicAuditIssue,
): { penalty: number; issues: TimelineCinematicAuditIssue[] } {
  return { penalty, issues: [auditIssue] }
}

function noAuditIssue(): { penalty: number; issues: TimelineCinematicAuditIssue[] } {
  return { penalty: 0, issues: [] }
}

function imageCountIssue(imageCount: number, minimumImages: number) {
  if (imageCount >= minimumImages) return noAuditIssue()

  return auditResult(
    imageCount === 0 ? 2.2 : 1,
    issue(
      'timeline-few-images',
      'warning',
      `Timeline has ${imageCount} still images; aim for at least ${minimumImages}.`,
    ),
  )
}

function imageCoverageIssue(imageCoveragePct: number) {
  if (imageCoveragePct >= 0.85) return noAuditIssue()

  return auditResult(
    1,
    issue(
      'timeline-image-gaps',
      'warning',
      'Still images do not cover most of the narration span.',
    ),
  )
}

function cameraMotionIssue(imageCount: number, multiAxisImageCount: number) {
  if (imageCount === 0 || multiAxisImageCount / imageCount >= 0.75) return noAuditIssue()

  return auditResult(
    1.4,
    issue(
      'timeline-motion-thin',
      'warning',
      'Most still images do not have multi-axis cinematic camera motion.',
    ),
  )
}

function stagedCameraMotionIssue(imageCount: number, stagedCameraImageCount: number) {
  if (imageCount === 0 || stagedCameraImageCount / imageCount >= 0.75) return noAuditIssue()

  return auditResult(
    0.8,
    issue(
      'timeline-motion-not-staged',
      'warning',
      'Most still images do not have staged zoom-plus-pan camera beats, so movement may feel too soft.',
    ),
  )
}

function depthPrepIssue(imageCount: number, depthPrep: DepthPrepMetrics) {
  if (imageCount === 0) return noAuditIssue()
  if (depthPrep.depthPreparedImageCount === 0) {
    return auditResult(
      1.2,
      issue(
        'timeline-depth-flat',
        'warning',
        'Still images have no subject/background or depth-map prep, so parallax may read flat.',
      ),
    )
  }
  if (depthPrep.depthLayerGroupCount === 0) {
    return auditResult(
      0.6,
      issue(
        'timeline-depth-no-layer-groups',
        'warning',
        'Depth prep exists, but no layered subject/background or depth-map group is detected.',
      ),
    )
  }
  if (
    depthPrep.averageDepthQuality != null &&
    (depthPrep.averageDepthQuality < 0.6 || depthPrep.lowQualityDepthLayerCount > 0)
  ) {
    return auditResult(
      0.7,
      issue(
        'timeline-depth-low-quality',
        'warning',
        'Depth prep exists, but mask quality is low enough that parallax may look cut-out or ghosted.',
      ),
    )
  }
  if (depthPrep.depthPreparedImagePct < 50) {
    return auditResult(
      0.4,
      issue(
        'timeline-depth-low-coverage',
        'info',
        'Only a small portion of stills are depth-prepared for 2.5D parallax.',
      ),
    )
  }

  return noAuditIssue()
}

function musicBedIssue(musicBedCount: number) {
  if (musicBedCount > 0) return noAuditIssue()

  return auditResult(
    0.7,
    issue('timeline-no-music', 'info', 'No music bed overlaps the narration span.'),
  )
}

function sfxIssue(sfxCount: number) {
  if (sfxCount > 0) return noAuditIssue()

  return auditResult(
    1,
    issue('timeline-no-sfx', 'warning', 'No audiobook SFX clips overlap the narration span.'),
  )
}

function duckingIssue(musicBedCount: number, duckedMusicBedCount: number) {
  if (musicBedCount === 0 || duckedMusicBedCount > 0) return noAuditIssue()

  return auditResult(
    1.2,
    issue(
      'timeline-no-ducking',
      'warning',
      'Music beds do not have dialogue ducking volume keyframes.',
    ),
  )
}

function conditionalAuditIssue(
  condition: boolean,
  penalty: number,
  auditIssue: TimelineCinematicAuditIssue,
): { penalty: number; issues: TimelineCinematicAuditIssue[] } {
  return condition ? auditResult(penalty, auditIssue) : noAuditIssue()
}

function musicTooHotIssue(musicUnderNarrationDb: number | null) {
  return conditionalAuditIssue(
    musicUnderNarrationDb != null && musicUnderNarrationDb > -8,
    0.8,
    issue(
      'timeline-music-too-hot',
      'warning',
      'Music is likely too loud under narration for a cinematic audiobook mix.',
    ),
  )
}

function musicBuriedIssue(musicUnderNarrationDb: number | null) {
  return conditionalAuditIssue(
    musicUnderNarrationDb != null && musicUnderNarrationDb < -32,
    0.2,
    issue('timeline-music-buried', 'info', 'Music is ducked so low it may vanish.'),
  )
}

function noForegroundSfxIssue(stemMix: StemMixMetrics, sfxCount: number) {
  return conditionalAuditIssue(
    sfxCount > 0 && stemMix.foregroundSfxCount === 0,
    0.8,
    issue('timeline-no-foreground-sfx', 'warning', 'SFX are all ambience with no foreground cue.'),
  )
}

function faintForegroundSfxIssue(foregroundSfxToNarrationDb: number | null) {
  return conditionalAuditIssue(
    foregroundSfxToNarrationDb != null && foregroundSfxToNarrationDb < 5,
    0.8,
    issue(
      'timeline-sfx-too-faint',
      'warning',
      'Foreground SFX are present but not forward enough to feel cinematic under narration.',
    ),
  )
}

function hotForegroundSfxIssue(foregroundSfxToNarrationDb: number | null) {
  return conditionalAuditIssue(
    foregroundSfxToNarrationDb != null && foregroundSfxToNarrationDb > 15,
    0.5,
    issue(
      'timeline-sfx-too-hot',
      'warning',
      'Foreground SFX are likely too loud compared with narration.',
    ),
  )
}

function noImpactSfxIssue(stemMix: StemMixMetrics, sfxCount: number) {
  return conditionalAuditIssue(
    sfxCount >= 3 && stemMix.impactSfxCount === 0,
    0.5,
    issue(
      'timeline-no-impact-sfx',
      'info',
      'No impact or transition SFX are present for dramatic story beats.',
    ),
  )
}

function hotAmbienceSfxIssue(ambienceSfxToNarrationDb: number | null) {
  return conditionalAuditIssue(
    ambienceSfxToNarrationDb != null && ambienceSfxToNarrationDb > -3,
    0.4,
    issue('timeline-ambience-too-hot', 'info', 'Ambience beds may be too loud against narration.'),
  )
}

function buriedAmbienceSfxIssue(ambienceSfxToNarrationDb: number | null) {
  return conditionalAuditIssue(
    ambienceSfxToNarrationDb != null && ambienceSfxToNarrationDb < -16,
    0.2,
    issue('timeline-ambience-buried', 'info', 'Ambience beds may be too quiet to create space.'),
  )
}

function stemMixIssue(stemMix: StemMixMetrics, sfxCount: number) {
  const results = [
    musicTooHotIssue(stemMix.musicUnderNarrationDb),
    musicBuriedIssue(stemMix.musicUnderNarrationDb),
    noForegroundSfxIssue(stemMix, sfxCount),
    faintForegroundSfxIssue(stemMix.foregroundSfxToNarrationDb),
    hotForegroundSfxIssue(stemMix.foregroundSfxToNarrationDb),
    noImpactSfxIssue(stemMix, sfxCount),
    hotAmbienceSfxIssue(stemMix.ambienceSfxToNarrationDb),
    buriedAmbienceSfxIssue(stemMix.ambienceSfxToNarrationDb),
  ]

  return {
    penalty: results.reduce((total, result) => total + result.penalty, 0),
    issues: results.flatMap((result) => result.issues),
  }
}

function storyBeatSfxCoverageIssue(storyBeatSfxCoverage: StoryBeatSfxCoverageMetrics) {
  if (storyBeatSfxCoverage.storyBeatCount === 0) return noAuditIssue()

  if (storyBeatSfxCoverage.storyBeatSfxCoveragePct < 45) {
    return auditResult(
      0.8,
      issue(
        'timeline-story-beats-undercovered',
        'warning',
        `Only ${storyBeatSfxCoverage.storyBeatSfxCoveredCount}/${storyBeatSfxCoverage.storyBeatCount} dramatic narration beats have foreground or impact SFX nearby.`,
      ),
    )
  }

  if (storyBeatSfxCoverage.storyBeatSfxCoveragePct < 65) {
    return auditResult(
      0.4,
      issue(
        'timeline-story-beats-thin',
        'info',
        `Only ${storyBeatSfxCoverage.storyBeatSfxCoveredCount}/${storyBeatSfxCoverage.storyBeatCount} dramatic narration beats have foreground or impact SFX nearby.`,
      ),
    )
  }

  return noAuditIssue()
}

function imageStoryMatchIssue(imageStoryMatch: ImageStoryMatchMetrics) {
  if (imageStoryMatch.imageStoryMeasurableCount < 2) return noAuditIssue()

  if (imageStoryMatch.imageStoryMatchPct < 35) {
    return auditResult(
      1.1,
      issue(
        'timeline-image-story-mismatch',
        'critical',
        `Only ${imageStoryMatch.imageStoryMatchedCount}/${imageStoryMatch.imageStoryMeasurableCount} labeled stills match their overlapping narration cues.`,
      ),
    )
  }

  if (imageStoryMatch.imageStoryMatchPct < 60) {
    return auditResult(
      0.7,
      issue(
        'timeline-image-story-mismatch',
        'warning',
        `Only ${imageStoryMatch.imageStoryMatchedCount}/${imageStoryMatch.imageStoryMeasurableCount} labeled stills match their overlapping narration cues.`,
      ),
    )
  }

  return noAuditIssue()
}

function referenceReadinessIssue(referenceReadinessScore: number) {
  return conditionalAuditIssue(
    referenceReadinessScore < 8.2,
    0.8,
    issue(
      'timeline-reference-not-ready',
      'warning',
      'Timeline has some cinematic pieces, but the combined motion, depth, SFX, music, and mix are not reference-ready yet.',
    ),
  )
}

function shotRhythmIssue(imageCount: number, shotRhythm: ShotRhythmMetrics) {
  return conditionalAuditIssue(
    imageCount > 1 && shotRhythm.shotRhythmScore < 6,
    0.6,
    issue(
      'timeline-shot-rhythm-weak',
      'warning',
      'Still-image shot rhythm is weak; vary timing and cut closer to story beats.',
    ),
  )
}

function longShotIssue(imageCount: number, averageImageShotSeconds: number) {
  return conditionalAuditIssue(
    imageCount > 1 && averageImageShotSeconds > 12,
    0.8,
    issue(
      'timeline-shots-too-long',
      'warning',
      'Average still-image shot length is long enough to feel like a slideshow.',
    ),
  )
}

function shortShotIssue(imageCount: number, averageImageShotSeconds: number) {
  return conditionalAuditIssue(
    imageCount > 2 && averageImageShotSeconds > 0 && averageImageShotSeconds < 2.2,
    0.5,
    issue(
      'timeline-shots-too-short',
      'info',
      'Average still-image shot length is very short; cinematic parallax may not have time to land.',
    ),
  )
}

function transcriptCutAlignmentIssue(shotRhythm: ShotRhythmMetrics) {
  return conditionalAuditIssue(
    shotRhythm.hasTranscriptCutTargets &&
      shotRhythm.internalImageCutCount > 0 &&
      shotRhythm.transcriptAlignedCutPct < 50,
    0.7,
    issue(
      'timeline-cuts-not-transcript-aligned',
      'warning',
      'Most still-image cuts miss transcript cue starts, so image timing may not feel narrated.',
    ),
  )
}

function shotRhythmIssues(imageCount: number, shotRhythm: ShotRhythmMetrics) {
  const results = [
    shotRhythmIssue(imageCount, shotRhythm),
    longShotIssue(imageCount, shotRhythm.averageImageShotSeconds),
    shortShotIssue(imageCount, shotRhythm.averageImageShotSeconds),
    transcriptCutAlignmentIssue(shotRhythm),
  ]

  return {
    penalty: results.reduce((total, result) => total + result.penalty, 0),
    issues: results.flatMap((result) => result.issues),
  }
}

function buildAuditIssues(params: {
  storyDurationSeconds: number
  imageCount: number
  imageCoveragePct: number
  animatedImageCount: number
  multiAxisImageCount: number
  stagedCameraImageCount: number
  musicBedCount: number
  sfxCount: number
  duckedMusicBedCount: number
  stemMix: StemMixMetrics
  depthPrep: DepthPrepMetrics
  shotRhythm: ShotRhythmMetrics
  imageStoryMatch: ImageStoryMatchMetrics
  storyBeatSfxCoverage: StoryBeatSfxCoverageMetrics
  referenceReadinessScore: number
}): { penalty: number; issues: TimelineCinematicAuditIssue[] } {
  const minimumImages = clamp(Math.ceil(params.storyDurationSeconds / 18), 1, 48)
  const results = [
    imageCountIssue(params.imageCount, minimumImages),
    imageCoverageIssue(params.imageCoveragePct),
    cameraMotionIssue(params.imageCount, params.multiAxisImageCount),
    stagedCameraMotionIssue(params.imageCount, params.stagedCameraImageCount),
    depthPrepIssue(params.imageCount, params.depthPrep),
    musicBedIssue(params.musicBedCount),
    sfxIssue(params.sfxCount),
    duckingIssue(params.musicBedCount, params.duckedMusicBedCount),
    stemMixIssue(params.stemMix, params.sfxCount),
    shotRhythmIssues(params.imageCount, params.shotRhythm),
    imageStoryMatchIssue(params.imageStoryMatch),
    storyBeatSfxCoverageIssue(params.storyBeatSfxCoverage),
    referenceReadinessIssue(params.referenceReadinessScore),
  ]

  return {
    penalty: results.reduce((total, result) => total + result.penalty, 0),
    issues: results.flatMap((result) => result.issues),
  }
}

export function scoreCinematicTimelineAudit(
  input: TimelineCinematicAuditInput,
): TimelineCinematicAuditScore {
  const narrationItems = resolveNarrationItems(input.items, input.narrationItemId)
  const span = getStorySpan(narrationItems)
  const tracks = trackById(input.tracks)

  if (!span) {
    return {
      score: 0,
      grade: 'weak',
      summary: 'Timeline is missing narration for the cinematic story audit.',
      issues: [issue('timeline-no-narration', 'critical', 'No narration audio is available.')],
      metrics: {
        storyDurationSeconds: 0,
        imageCount: 0,
        imageCoveragePct: 0,
        animatedImageCount: 0,
        multiAxisImageCount: 0,
        stagedCameraImageCount: 0,
        imageCutCount: 0,
        directedTransitionCutCount: 0,
        directedTransitionCoveragePct: 0,
        narrationCount: 0,
        musicBedCount: 0,
        sfxCount: 0,
        duckedMusicBedCount: 0,
        stemMixScore: 0,
        narrationGainDb: null,
        musicUnderNarrationDb: null,
        foregroundSfxToNarrationDb: null,
        ambienceSfxToNarrationDb: null,
        foregroundSfxCount: 0,
        impactSfxCount: 0,
        ambienceSfxCount: 0,
        depthPreparedImageCount: 0,
        depthPreparedImagePct: 0,
        parallaxLayerCount: 0,
        depthLayerGroupCount: 0,
        depthReadinessScore: 0,
        averageDepthQuality: null,
        lowQualityDepthLayerCount: 0,
        averageImageShotSeconds: 0,
        imageShotDurationStdDevSeconds: 0,
        transcriptAlignedCutPct: 0,
        shotRhythmScore: 0,
        imageStoryMatchedCount: 0,
        imageStoryMeasurableCount: 0,
        imageStoryMatchPct: 0,
        storyBeatCount: 0,
        storyBeatSfxCoveredCount: 0,
        storyBeatSfxCoveragePct: 0,
        referenceReadinessScore: 0,
      },
    }
  }

  const narrationIds = new Set(narrationItems.map((item) => item.id))
  const storyDurationSeconds = (span.endFrame - span.startFrame) / Math.max(1, input.fps)
  const images = selectedOrOverlappingImages({
    items: input.items,
    span,
    selectedImageIds: input.selectedImageIds,
  })
  const audioItems = input.items.filter(
    (item): item is AudioItem => isAudioItem(item) && overlaps(item, span),
  )
  const sfxItems = audioItems.filter((item) => isSfxAudio(item, tracks.get(item.trackId)))
  const musicBeds = audioItems.filter(
    (item) => !narrationIds.has(item.id) && !isSfxAudio(item, tracks.get(item.trackId)),
  )
  const motionStats = cameraMotionStats(images, input.keyframes)
  const depthPrep = calculateDepthPrepMetrics(images, tracks)
  const shotRhythm = calculateShotRhythmMetrics({
    images,
    narrationItems,
    span,
    fps: input.fps,
  })
  const transitionDirection = calculateTransitionDirectionMetrics({
    images,
    items: input.items,
    transitions: input.transitions ?? [],
  })
  const imageStoryMatch = calculateImageStoryMatchMetrics({
    images,
    narrationItems,
    fps: input.fps,
  })
  const imageCoveragePct = coveragePct(images, span)
  const duckedMusicBedCount = musicBeds.filter((item) =>
    hasDuckingKeyframes(item, input.keyframes),
  ).length
  const stemMix = calculateStemMixMetrics({
    narrationItems,
    musicBeds,
    sfxItems,
    tracks,
    keyframes: input.keyframes,
  })
  const storyBeatSfxCoverage = calculateStoryBeatSfxCoverage({
    narrationItems,
    sfxItems,
    tracks,
    span,
    fps: input.fps,
  })
  const referenceReadinessScore = calculateReferenceReadinessScore({
    imageCount: images.length,
    imageCoveragePct,
    multiAxisImageCount: motionStats.multiAxisImageCount,
    stagedCameraImageCount: motionStats.stagedCameraImageCount,
    musicBedCount: musicBeds.length,
    duckedMusicBedCount,
    sfxCount: sfxItems.length,
    stemMix,
    depthPrep,
    shotRhythm,
    imageStoryMatch,
    storyBeatSfxCoverage,
  })
  const audit = buildAuditIssues({
    storyDurationSeconds,
    imageCount: images.length,
    imageCoveragePct,
    animatedImageCount: motionStats.animatedImageCount,
    multiAxisImageCount: motionStats.multiAxisImageCount,
    stagedCameraImageCount: motionStats.stagedCameraImageCount,
    musicBedCount: musicBeds.length,
    sfxCount: sfxItems.length,
    duckedMusicBedCount,
    stemMix,
    depthPrep,
    shotRhythm,
    imageStoryMatch,
    storyBeatSfxCoverage,
    referenceReadinessScore,
  })
  const score = roundToTenth(clamp(10 - audit.penalty, 0, 10))
  const grade = gradeForScore(score)

  return {
    score,
    grade,
    summary: summaryForGrade(grade),
    issues: audit.issues,
    metrics: {
      storyDurationSeconds: roundToTenth(storyDurationSeconds),
      imageCount: images.length,
      imageCoveragePct: roundToTenth(imageCoveragePct * 100),
      animatedImageCount: motionStats.animatedImageCount,
      multiAxisImageCount: motionStats.multiAxisImageCount,
      stagedCameraImageCount: motionStats.stagedCameraImageCount,
      ...transitionDirection,
      narrationCount: narrationItems.length,
      musicBedCount: musicBeds.length,
      sfxCount: sfxItems.length,
      duckedMusicBedCount,
      ...stemMix,
      ...depthPrep,
      averageImageShotSeconds: shotRhythm.averageImageShotSeconds,
      imageShotDurationStdDevSeconds: shotRhythm.imageShotDurationStdDevSeconds,
      transcriptAlignedCutPct: shotRhythm.transcriptAlignedCutPct,
      shotRhythmScore: shotRhythm.shotRhythmScore,
      imageStoryMatchedCount: imageStoryMatch.imageStoryMatchedCount,
      imageStoryMeasurableCount: imageStoryMatch.imageStoryMeasurableCount,
      imageStoryMatchPct: imageStoryMatch.imageStoryMatchPct,
      storyBeatCount: storyBeatSfxCoverage.storyBeatCount,
      storyBeatSfxCoveredCount: storyBeatSfxCoverage.storyBeatSfxCoveredCount,
      storyBeatSfxCoveragePct: storyBeatSfxCoverage.storyBeatSfxCoveragePct,
      referenceReadinessScore,
    },
  }
}
