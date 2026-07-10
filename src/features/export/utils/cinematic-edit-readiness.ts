import type { CompositionInputProps } from '@/types/export'
import type { AnimatableProperty } from '@/types/keyframe'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { clamp } from '@/shared/utils/math'

export type CinematicEditReadinessGrade = 'excellent' | 'strong' | 'fair' | 'weak'

export type CinematicEditReadinessSeverity = 'critical' | 'warning' | 'info'

export interface CinematicEditReadinessIssue {
  id: string
  severity: CinematicEditReadinessSeverity
  message: string
}

export interface CinematicEditReadinessMetrics {
  durationFrames: number
  stillImageCount: number
  imageCoveragePct: number
  animatedImagePct: number
  multiAxisImagePct: number
  stagedCameraPct: number
  referenceStyleCameraPct: number
  averageImageShotSeconds: number
  imageShotDurationStdDevSeconds: number
  shotRhythmScore: number
  depthPreparedPct: number
  musicBedCount: number
  sfxCount: number
  sfxRoleScore: number
}

export interface CinematicEditReadinessScore {
  score: number
  grade: CinematicEditReadinessGrade
  summary: string
  issues: CinematicEditReadinessIssue[]
  metrics: CinematicEditReadinessMetrics
}

interface ItemMotionProfile {
  animated: boolean
  multiAxis: boolean
  staged: boolean
  referenceStyle: boolean
}

const CAMERA_PROPERTIES: AnimatableProperty[] = ['x', 'y', 'width', 'height', 'rotation']
const POSITION_PROPERTIES = new Set<AnimatableProperty>(['x', 'y'])
const SCALE_PROPERTIES = new Set<AnimatableProperty>(['width', 'height'])
const VALUE_EPSILON = 0.001
const REFERENCE_STYLE_MIN_SIMULTANEOUS_COVERAGE = 0.45
const REFERENCE_STYLE_MIN_SCALE_TRAVEL = 0.06
const REFERENCE_STYLE_MIN_POSITION_TRAVEL = 0.015
const REFERENCE_STYLE_MIN_ROTATION_TRAVEL = 0.8

interface MotionSpan {
  start: number
  end: number
  family: 'position' | 'scale' | 'rotation'
}

interface ReferenceTravel {
  xTravel: number
  yTravel: number
  widthTravel: number
  heightTravel: number
  rotationTravel: number
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10
}

function issue(
  id: string,
  severity: CinematicEditReadinessSeverity,
  message: string,
): CinematicEditReadinessIssue {
  return { id, severity, message }
}

type EditReadinessIssueRule = {
  when: (metrics: CinematicEditReadinessMetrics) => boolean
  issue: CinematicEditReadinessIssue
}

function gradeForScore(score: number): CinematicEditReadinessGrade {
  if (score >= 8.5) return 'excellent'
  if (score >= 7) return 'strong'
  if (score >= 5) return 'fair'
  return 'weak'
}

function summaryForGrade(grade: CinematicEditReadinessGrade): string {
  switch (grade) {
    case 'excellent':
      return 'Timeline edit structure is ready for cinematic export.'
    case 'strong':
      return 'Timeline edit structure is strong with minor automation gaps.'
    case 'fair':
      return 'Timeline edit structure needs more motion, depth, or sound design.'
    case 'weak':
      return 'Timeline edit structure still risks feeling like a slideshow.'
  }
}

function flattenItems(tracks: TimelineTrack[]): TimelineItem[] {
  return tracks.flatMap((track) => track.items ?? [])
}

function getDurationFrames(composition: CompositionInputProps): number {
  if (composition.durationInFrames && composition.durationInFrames > 0) {
    return composition.durationInFrames
  }

  return flattenItems(composition.tracks).reduce(
    (maxFrame, item) => Math.max(maxFrame, item.from + item.durationInFrames),
    0,
  )
}

function overlapFrames(item: TimelineItem, durationFrames: number): number {
  const start = clamp(item.from, 0, durationFrames)
  const end = clamp(item.from + item.durationInFrames, 0, durationFrames)
  return Math.max(0, end - start)
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((total, value) => total + value, 0) / values.length
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0
  const mean = average(values)
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)))
}

function getMotionPropertyGroups(
  groups: NonNullable<CompositionInputProps['keyframes']>[number]['properties'],
) {
  return groups.filter(
    (group) => CAMERA_PROPERTIES.includes(group.property) && group.keyframes.length >= 2,
  )
}

function familyForProperty(property: AnimatableProperty): MotionSpan['family'] | null {
  if (POSITION_PROPERTIES.has(property)) return 'position'
  if (SCALE_PROPERTIES.has(property)) return 'scale'
  if (property === 'rotation') return 'rotation'
  return null
}

function getKeyframeValueRange(keyframes: Array<{ value: number }>): number {
  if (keyframes.length === 0) return 0
  const values = keyframes.map((keyframe) => keyframe.value)
  return Math.max(...values) - Math.min(...values)
}

function getReferenceTravel(
  activeProperties: ReturnType<typeof getMotionPropertyGroups>,
  composition: CompositionInputProps,
) {
  const compositionWidth = composition.width ?? 1920
  const compositionHeight = composition.height ?? 1080
  const travel: ReferenceTravel = {
    xTravel: 0,
    yTravel: 0,
    widthTravel: 0,
    heightTravel: 0,
    rotationTravel: 0,
  }

  for (const group of activeProperties) {
    applyReferenceTravel(travel, group, compositionWidth, compositionHeight)
  }

  const shortEdge = Math.max(1, Math.min(compositionWidth, compositionHeight))
  return {
    positionTravel: Math.hypot(travel.xTravel, travel.yTravel) / shortEdge,
    scaleTravel: Math.max(travel.widthTravel, travel.heightTravel),
    rotationTravel: travel.rotationTravel,
  }
}

function applyReferenceTravel(
  travel: ReferenceTravel,
  group: ReturnType<typeof getMotionPropertyGroups>[number],
  compositionWidth: number,
  compositionHeight: number,
): void {
  const range = getKeyframeValueRange(group.keyframes)
  if (group.property === 'x') travel.xTravel = Math.max(travel.xTravel, range)
  if (group.property === 'y') travel.yTravel = Math.max(travel.yTravel, range)
  if (group.property === 'rotation') travel.rotationTravel = Math.max(travel.rotationTravel, range)
  if (group.property === 'width') {
    travel.widthTravel = Math.max(
      travel.widthTravel,
      getScaleTravelRatio(group.keyframes, range, compositionWidth),
    )
  }
  if (group.property === 'height') {
    travel.heightTravel = Math.max(
      travel.heightTravel,
      getScaleTravelRatio(group.keyframes, range, compositionHeight),
    )
  }
}

function getScaleTravelRatio(
  keyframes: Array<{ value: number }>,
  range: number,
  compositionSize: number,
): number {
  const baseline =
    average(keyframes.map((keyframe) => Math.abs(keyframe.value))) || Math.max(1, compositionSize)
  return range / Math.max(1, baseline)
}

function collectMotionSpans(
  activeProperties: ReturnType<typeof getMotionPropertyGroups>,
  durationInFrames: number,
): MotionSpan[] {
  const spans: MotionSpan[] = []

  for (const group of activeProperties) {
    const family = familyForProperty(group.property)
    if (!family) continue
    const keyframes = [...group.keyframes].sort((left, right) => left.frame - right.frame)

    for (let index = 1; index < keyframes.length; index += 1) {
      const previous = keyframes[index - 1]!
      const current = keyframes[index]!
      const start = clamp(previous.frame, 0, durationInFrames)
      const end = clamp(current.frame, 0, durationInFrames)
      if (end <= start || Math.abs(current.value - previous.value) <= VALUE_EPSILON) continue
      spans.push({ start, end, family })
    }
  }

  return spans
}

function calculateSimultaneousReferenceCoverage(
  spans: MotionSpan[],
  durationInFrames: number,
): number {
  if (durationInFrames <= 0 || spans.length < 2) return 0
  const points = Array.from(
    new Set([0, durationInFrames, ...spans.flatMap((span) => [span.start, span.end])]),
  ).sort((left, right) => left - right)
  let coveredFrames = 0

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!
    const end = points[index]!
    if (end <= start) continue
    const midpoint = (start + end) / 2
    const activeFamilies = new Set(
      spans
        .filter((span) => span.start < midpoint && span.end > midpoint)
        .map((span) => span.family),
    )
    const hasReferencePair =
      activeFamilies.has('scale') &&
      (activeFamilies.has('position') || activeFamilies.has('rotation'))

    if (hasReferencePair) coveredFrames += end - start
  }

  return coveredFrames / durationInFrames
}

function hasReferenceStyleCameraMotion(
  item: TimelineItem,
  composition: CompositionInputProps,
  activeProperties: ReturnType<typeof getMotionPropertyGroups>,
): boolean {
  if (item.durationInFrames <= 0 || activeProperties.length < 2) return false
  const staged =
    activeProperties.some((group) => group.keyframes.length >= 3) || activeProperties.length >= 3
  const { positionTravel, scaleTravel, rotationTravel } = getReferenceTravel(
    activeProperties,
    composition,
  )
  const simultaneousCoverage = calculateSimultaneousReferenceCoverage(
    collectMotionSpans(activeProperties, item.durationInFrames),
    item.durationInFrames,
  )

  return (
    staged &&
    simultaneousCoverage >= REFERENCE_STYLE_MIN_SIMULTANEOUS_COVERAGE &&
    scaleTravel >= REFERENCE_STYLE_MIN_SCALE_TRAVEL &&
    (positionTravel >= REFERENCE_STYLE_MIN_POSITION_TRAVEL ||
      rotationTravel >= REFERENCE_STYLE_MIN_ROTATION_TRAVEL)
  )
}

function getMotionProfile(
  item: TimelineItem,
  composition: CompositionInputProps,
): ItemMotionProfile {
  const groups = composition.keyframes?.find((entry) => entry.itemId === item.id)?.properties ?? []
  const activeProperties = getMotionPropertyGroups(groups)
  const movementFamilies = new Set<string>()

  for (const group of activeProperties) {
    if (POSITION_PROPERTIES.has(group.property)) movementFamilies.add('position')
    else if (SCALE_PROPERTIES.has(group.property)) movementFamilies.add('scale')
    else movementFamilies.add(group.property)
  }

  return {
    animated: activeProperties.length > 0,
    multiAxis: movementFamilies.size >= 2,
    staged:
      activeProperties.some((group) => group.keyframes.length >= 3) || activeProperties.length >= 3,
    referenceStyle: hasReferenceStyleCameraMotion(item, composition, activeProperties),
  }
}

function isDepthPrepared(item: TimelineItem): boolean {
  return (
    item.cinematicDepthRole === 'subject' ||
    item.cinematicDepthRole === 'foreground' ||
    item.cinematicDepthRole === 'midground' ||
    item.cinematicDepthRole === 'background' ||
    item.cinematicDepthRole === 'depth-map'
  )
}

function isMusicBed(item: TimelineItem): boolean {
  if (item.type !== 'audio' && item.type !== 'video') return false
  if (item.audiobookSfxRole) return false

  return /\b(music|score|underscore|bed|song|soundtrack)\b/i.test(item.label)
}

function isSfxItem(item: TimelineItem): boolean {
  if (item.audiobookSfxRole) return true
  if (item.type !== 'audio' && item.type !== 'video') return false

  return /\b(sfx|foley|impact|whoosh|sting|ambience|transition)\b/i.test(item.label)
}

function calculateSfxRoleScore(items: TimelineItem[]): number {
  const sfxItems = items.filter(isSfxItem)
  const roles = new Set(sfxItems.map((item) => item.audiobookSfxRole).filter(Boolean))
  if (sfxItems.length === 0) return 0

  let score = 2.5
  if (roles.has('ambience')) score += 2
  if (roles.has('foreground')) score += 2.4
  if (roles.has('impact') || roles.has('transition')) score += 3.1
  return roundMetric(clamp(score, 0, 10))
}

function calculateShotDurationScore(averageShotSeconds: number): number {
  if (averageShotSeconds <= 0) return 0
  if (averageShotSeconds >= 2.6 && averageShotSeconds <= 7.5) return 1
  if (averageShotSeconds >= 2 && averageShotSeconds <= 9.5) return 0.82
  if (averageShotSeconds < 2) return clamp(averageShotSeconds / 2, 0, 0.65)
  return clamp(9.5 / averageShotSeconds, 0, 0.62)
}

function calculateShotVariationScore(
  stdDevSeconds: number,
  stillImageCount: number,
  averageShotSeconds: number,
): number {
  if (stillImageCount < 4) return 1
  if (stdDevSeconds >= 0.85) return 1
  if (stdDevSeconds >= 0.45) return 0.86
  if (stdDevSeconds >= 0.2) return 0.72
  return averageShotSeconds <= 3.2 ? 0.82 : 0.52
}

function calculateShotRhythmScore(params: {
  averageShotSeconds: number
  stdDevSeconds: number
  stillImageCount: number
}): number {
  const durationScore = calculateShotDurationScore(params.averageShotSeconds)
  const variationScore = calculateShotVariationScore(
    params.stdDevSeconds,
    params.stillImageCount,
    params.averageShotSeconds,
  )

  return roundMetric((durationScore * 0.62 + variationScore * 0.38) * 10)
}

function calculateMetrics(composition: CompositionInputProps): CinematicEditReadinessMetrics {
  const durationFrames = getDurationFrames(composition)
  const fps = composition.fps > 0 ? composition.fps : 30
  const items = flattenItems(composition.tracks)
  const stillImages = items.filter((item) => item.type === 'image')
  const imageCoverageFrames = stillImages.reduce(
    (total, item) => total + overlapFrames(item, durationFrames),
    0,
  )
  const shotDurationsSeconds = stillImages
    .map((item) => overlapFrames(item, durationFrames) / fps)
    .filter((seconds) => seconds > 0)
  const averageImageShotSeconds = average(shotDurationsSeconds)
  const imageShotDurationStdDevSeconds = standardDeviation(shotDurationsSeconds)
  const motionProfiles = stillImages.map((item) => getMotionProfile(item, composition))
  const depthPreparedCount = stillImages.filter(isDepthPrepared).length
  const sfxItems = items.filter(isSfxItem)

  return {
    durationFrames,
    stillImageCount: stillImages.length,
    imageCoveragePct:
      durationFrames > 0 ? roundMetric((imageCoverageFrames / durationFrames) * 100) : 0,
    animatedImagePct:
      stillImages.length > 0
        ? roundMetric(
            (motionProfiles.filter((profile) => profile.animated).length / stillImages.length) *
              100,
          )
        : 0,
    multiAxisImagePct:
      stillImages.length > 0
        ? roundMetric(
            (motionProfiles.filter((profile) => profile.multiAxis).length / stillImages.length) *
              100,
          )
        : 0,
    stagedCameraPct:
      stillImages.length > 0
        ? roundMetric(
            (motionProfiles.filter((profile) => profile.staged).length / stillImages.length) * 100,
          )
        : 0,
    referenceStyleCameraPct:
      stillImages.length > 0
        ? roundMetric(
            (motionProfiles.filter((profile) => profile.referenceStyle).length /
              stillImages.length) *
              100,
          )
        : 0,
    averageImageShotSeconds: roundMetric(averageImageShotSeconds),
    imageShotDurationStdDevSeconds: roundMetric(imageShotDurationStdDevSeconds),
    shotRhythmScore: calculateShotRhythmScore({
      averageShotSeconds: averageImageShotSeconds,
      stdDevSeconds: imageShotDurationStdDevSeconds,
      stillImageCount: stillImages.length,
    }),
    depthPreparedPct:
      stillImages.length > 0 ? roundMetric((depthPreparedCount / stillImages.length) * 100) : 0,
    musicBedCount: items.filter(isMusicBed).length,
    sfxCount: sfxItems.length,
    sfxRoleScore: calculateSfxRoleScore(items),
  }
}

function pctScore(value: number): number {
  return clamp(value / 100, 0, 1)
}

function scoreMetrics(metrics: CinematicEditReadinessMetrics): number {
  const musicScore = metrics.musicBedCount > 0 ? 1 : 0
  const sfxScore = metrics.sfxRoleScore / 10
  const score =
    pctScore(metrics.imageCoveragePct) * 0.2 +
    pctScore(metrics.multiAxisImagePct) * 0.12 +
    pctScore(metrics.stagedCameraPct) * 0.1 +
    pctScore(metrics.referenceStyleCameraPct) * 0.15 +
    pctScore(metrics.depthPreparedPct) * 0.14 +
    pctScore(metrics.shotRhythmScore * 10) * 0.1 +
    sfxScore * 0.11 +
    musicScore * 0.08
  const rhythmPenalty =
    (metrics.averageImageShotSeconds > 9.5 ? 0.8 : 0) +
    (metrics.stillImageCount >= 4 &&
    metrics.imageShotDurationStdDevSeconds < 0.25 &&
    metrics.averageImageShotSeconds > 3.2
      ? 0.6
      : 0)
  const referenceCameraPenalty = metrics.referenceStyleCameraPct < 70 ? 0.6 : 0

  return roundMetric(clamp(score * 10 - rhythmPenalty - referenceCameraPenalty, 0, 10))
}

const EDIT_READINESS_ISSUE_RULES: EditReadinessIssueRule[] = [
  {
    when: (metrics) => metrics.durationFrames <= 0,
    issue: issue('edit-empty', 'critical', 'Timeline has no exportable duration.'),
  },
  {
    when: (metrics) => metrics.stillImageCount === 0,
    issue: issue(
      'edit-no-images',
      'critical',
      'No still images are present for the automatic cinematic edit.',
    ),
  },
  {
    when: (metrics) => metrics.imageCoveragePct < 90,
    issue: issue(
      'edit-image-coverage-low',
      'warning',
      'Still images do not cover enough of the export range.',
    ),
  },
  {
    when: (metrics) => metrics.multiAxisImagePct < 70,
    issue: issue(
      'edit-motion-too-simple',
      'warning',
      'Too few stills have two-axis camera motion.',
    ),
  },
  {
    when: (metrics) => metrics.stagedCameraPct < 55,
    issue: issue(
      'edit-camera-not-staged',
      'warning',
      'Too few stills have staged three-beat camera keyframes.',
    ),
  },
  {
    when: (metrics) => metrics.referenceStyleCameraPct < 70,
    issue: issue(
      'edit-reference-camera-low',
      'warning',
      'Too few stills have simultaneous zoom-plus-pan/tilt camera movement for the reference style.',
    ),
  },
  {
    when: (metrics) => metrics.averageImageShotSeconds > 9.5,
    issue: issue(
      'edit-shot-too-long',
      'warning',
      'Average still-image shot length is too long for reference-style parallax pacing.',
    ),
  },
  {
    when: (metrics) =>
      metrics.stillImageCount >= 4 &&
      metrics.imageShotDurationStdDevSeconds < 0.25 &&
      metrics.averageImageShotSeconds > 3.2,
    issue: issue(
      'edit-shot-rhythm-flat',
      'warning',
      'Still-image shot durations are too even, so the edit may feel mechanically paced.',
    ),
  },
  {
    when: (metrics) => metrics.depthPreparedPct < 55,
    issue: issue(
      'edit-depth-underprepared',
      'warning',
      'Too few stills have subject/background or depth-map prep.',
    ),
  },
  {
    when: (metrics) => metrics.sfxRoleScore < 7,
    issue: issue(
      'edit-sfx-thin',
      'warning',
      'Sound design lacks a balanced ambience, foley, and impact stack.',
    ),
  },
  {
    when: (metrics) => metrics.musicBedCount === 0,
    issue: issue('edit-no-score-bed', 'info', 'No music or score bed is present under the edit.'),
  },
]

function buildIssues(metrics: CinematicEditReadinessMetrics): CinematicEditReadinessIssue[] {
  return EDIT_READINESS_ISSUE_RULES.filter((rule) => rule.when(metrics)).map((rule) => rule.issue)
}

export function scoreCinematicEditReadiness(
  composition: CompositionInputProps,
): CinematicEditReadinessScore {
  const metrics = calculateMetrics(composition)
  const score = scoreMetrics(metrics)
  const grade = gradeForScore(score)

  return {
    score,
    grade,
    summary: summaryForGrade(grade),
    issues: buildIssues(metrics),
    metrics,
  }
}
