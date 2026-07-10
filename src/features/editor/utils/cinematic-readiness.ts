import type { AudiobookSfxCue } from './audiobook-sfx'
import type { MediaTranscript } from '@/types/storage'

export type CinematicReadinessGrade = 'excellent' | 'strong' | 'fair' | 'weak'
export type CinematicReadinessIssueSeverity = 'info' | 'warning' | 'critical'

export interface CinematicReadinessIssue {
  id: string
  severity: CinematicReadinessIssueSeverity
  message: string
}

export interface CinematicReadinessInput {
  narrationDurationSeconds: number
  imageCount: number
  musicBedCount: number
  cues: AudiobookSfxCue[]
  sfxDurationSeconds: number
  matchImages: boolean
  applyCinematicMotion: boolean
  applyTransitions?: boolean
  prepareDepth: boolean
  depthPrepSupported: boolean
  applyFinishing: boolean
  useImportedSfxLibrary: boolean
  libraryMatchedCueCount: number
  libraryMatchedForegroundCueCount: number
  libraryMatchedImpactCueCount: number
  transcript?: MediaTranscript | null
}

export interface CinematicReadinessScore {
  score: number
  grade: CinematicReadinessGrade
  summary: string
  issues: CinematicReadinessIssue[]
  metrics: {
    idealImageCount: number
    minimumImageCount: number
    cueDensityPerMinute: number
    foregroundCueCount: number
    impactCueCount: number
    ambienceCueCount: number
    uniqueCueLabels: number
    dominantCueLabelCount: number
    dominantCueLabelPct: number
    uniqueImpactCueLabels: number
    dominantImpactCueLabelCount: number
    dominantImpactCueLabelPct: number
    depthPrepEnabled: boolean
    depthPrepSupported: boolean
    finishingEnabled: boolean
    transitionsEnabled: boolean
    importedSfxLibraryEnabled: boolean
    libraryMatchedCueCount: number
    libraryMatchedForegroundCueCount: number
    libraryMatchedImpactCueCount: number
    generatedCueCount: number
    storyBeatCount: number
    coveredStoryBeatCount: number
    storyBeatCoveragePct: number
  }
}

interface StoryBeatCoverageMetrics {
  storyBeatCount: number
  coveredStoryBeatCount: number
  storyBeatCoveragePct: number
}

interface CueLabelStats {
  uniqueCueLabels: number
  dominantCueLabelCount: number
  dominantCueLabelPct: number
  uniqueImpactCueLabels: number
  dominantImpactCueLabelCount: number
  dominantImpactCueLabelPct: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10
}

function gradeForScore(score: number): CinematicReadinessGrade {
  if (score >= 8.5) return 'excellent'
  if (score >= 7) return 'strong'
  if (score >= 5.2) return 'fair'
  return 'weak'
}

function summaryForGrade(grade: CinematicReadinessGrade): string {
  switch (grade) {
    case 'excellent':
      return 'Cinematic setup is strong enough for a polished automatic pass.'
    case 'strong':
      return 'Cinematic setup is usable, with a few areas to watch.'
    case 'fair':
      return 'Cinematic setup may work, but it will likely feel thin without adjustments.'
    case 'weak':
      return 'Cinematic setup is not ready for a high-end automatic result yet.'
  }
}

function issue(
  id: string,
  severity: CinematicReadinessIssueSeverity,
  message: string,
): CinematicReadinessIssue {
  return { id, severity, message }
}

function imagePenalty(params: {
  imageCount: number
  idealImageCount: number
  minimumImageCount: number
  matchImages: boolean
  applyCinematicMotion: boolean
  applyTransitions: boolean
}): { penalty: number; issues: CinematicReadinessIssue[] } {
  const issues: CinematicReadinessIssue[] = []
  let penalty = 0

  if (params.imageCount === 0) {
    penalty += 2.4
    issues.push(issue('no-images', 'critical', 'No still images are selected for the story pass.'))
    return { penalty, issues }
  }

  if (params.imageCount < params.minimumImageCount) {
    penalty += params.imageCount < params.minimumImageCount / 2 ? 1.7 : 1
    issues.push(
      issue(
        'few-images',
        'warning',
        `Only ${params.imageCount} still images are selected; aim for at least ${params.minimumImageCount}.`,
      ),
    )
  }

  if (!params.matchImages && params.imageCount > 1) {
    penalty += 0.6
    issues.push(
      issue('image-match-off', 'info', 'Image-to-narration matching is off, so pacing may drift.'),
    )
  }

  if (!params.applyCinematicMotion) {
    penalty += 1.2
    issues.push(
      issue(
        'motion-off',
        'warning',
        'Cinematic image motion is off, so the result will read more like a slideshow.',
      ),
    )
  }

  if (!params.applyTransitions && params.imageCount > 1) {
    penalty += 0.3
    issues.push(
      issue(
        'cut-direction-off',
        'info',
        'Story-directed cut effects are off, so every image change will use a hard cut.',
      ),
    )
  }

  return { penalty, issues }
}

function finishingPenalty(applyFinishing: boolean): {
  penalty: number
  issues: CinematicReadinessIssue[]
} {
  if (applyFinishing) return { penalty: 0, issues: [] }

  return {
    penalty: 0.7,
    issues: [
      issue(
        'finishing-off',
        'info',
        'Cinematic finishing is off, so the result may look softer or less polished.',
      ),
    ],
  }
}

function depthPrepPenalty(params: {
  imageCount: number
  prepareDepth: boolean
  depthPrepSupported: boolean
}): {
  penalty: number
  issues: CinematicReadinessIssue[]
} {
  if (params.imageCount === 0) return { penalty: 0, issues: [] }

  if (!params.depthPrepSupported) {
    return {
      penalty: 1,
      issues: [
        issue(
          'depth-prep-unsupported',
          'warning',
          'Depth-map parallax prep is not available in this browser, so stills may stay flat.',
        ),
      ],
    }
  }

  if (!params.prepareDepth) {
    return {
      penalty: 1.1,
      issues: [
        issue(
          'depth-prep-off',
          'warning',
          'Depth-map parallax layers are off, so the result may not match the 3D reference style.',
        ),
      ],
    }
  }

  return { penalty: 0, issues: [] }
}

function importedSfxSourcePenalty(params: {
  cueCount: number
  foregroundCueCount: number
  impactCueCount: number
  useImportedSfxLibrary: boolean
  libraryMatchedCueCount: number
  libraryMatchedForegroundCueCount: number
  libraryMatchedImpactCueCount: number
}): { penalty: number; issues: CinematicReadinessIssue[] } {
  if (params.cueCount === 0) return { penalty: 0, issues: [] }

  if (!params.useImportedSfxLibrary) {
    return {
      penalty: 0.9,
      issues: [
        issue(
          'imported-sfx-off',
          'warning',
          'Imported studio SFX matching is off, so the mix may rely on generated effects that sound demo-grade.',
        ),
      ],
    }
  }

  if (params.libraryMatchedCueCount === 0) {
    return {
      penalty: 1.2,
      issues: [
        issue(
          'no-imported-sfx-matches',
          'warning',
          'No imported studio SFX matched this cue plan; generated source quality may still sound thin or synthetic.',
        ),
      ],
    }
  }

  const dramaticCueCount = params.foregroundCueCount + params.impactCueCount
  const dramaticMatchCount =
    params.libraryMatchedForegroundCueCount + params.libraryMatchedImpactCueCount

  if (dramaticCueCount > 0 && dramaticMatchCount === 0) {
    return {
      penalty: 0.9,
      issues: [
        issue(
          'no-imported-dramatic-sfx',
          'warning',
          'Imported SFX only matched background cues; foreground and impact moments still rely on generated audio.',
        ),
      ],
    }
  }

  if (params.cueCount >= 4 && params.libraryMatchedCueCount / params.cueCount < 0.35) {
    return {
      penalty: 0.5,
      issues: [
        issue(
          'low-imported-sfx-coverage',
          'info',
          `Only ${params.libraryMatchedCueCount}/${params.cueCount} planned SFX matched imported studio assets.`,
        ),
      ],
    }
  }

  return { penalty: 0, issues: [] }
}

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

function storyBeatAnchorSeconds(segment: MediaTranscript['segments'][number]): number {
  return Number.isFinite(segment.start) ? Math.max(0, segment.start) : 0
}

function collectStoryBeatAnchors(
  transcript: MediaTranscript | null | undefined,
  narrationDurationSeconds: number,
): number[] {
  if (!transcript?.segments.length) return []

  const maxSeconds = Math.max(0, narrationDurationSeconds)
  const rawAnchors = transcript.segments
    .filter((segment) => isStoryBeatText(segment.text))
    .map(storyBeatAnchorSeconds)
    .filter((seconds) => seconds <= maxSeconds || maxSeconds === 0)
    .sort((left, right) => left - right)

  const spaced: number[] = []
  for (const anchor of rawAnchors) {
    const previous = spaced[spaced.length - 1]
    if (previous == null || anchor - previous >= 10) {
      spaced.push(roundToTenth(anchor))
    }
  }

  return spaced
}

function cueCoversStoryBeat(cue: AudiobookSfxCue, beatSeconds: number): boolean {
  if (cue.role === 'ambience') return false
  const cueStart = Math.max(0, cue.startSeconds)
  const cueEnd = Math.max(cueStart, cue.endSeconds)
  return cueStart <= beatSeconds + 8 && cueEnd >= beatSeconds - 4
}

function calculateStoryBeatCoverage(params: {
  transcript?: MediaTranscript | null
  narrationDurationSeconds: number
  cues: AudiobookSfxCue[]
}): StoryBeatCoverageMetrics {
  const anchors = collectStoryBeatAnchors(params.transcript, params.narrationDurationSeconds)
  if (anchors.length === 0) {
    return {
      storyBeatCount: 0,
      coveredStoryBeatCount: 0,
      storyBeatCoveragePct: 0,
    }
  }

  const coveredStoryBeatCount = anchors.filter((anchor) =>
    params.cues.some((cue) => cueCoversStoryBeat(cue, anchor)),
  ).length

  return {
    storyBeatCount: anchors.length,
    coveredStoryBeatCount,
    storyBeatCoveragePct: roundToTenth((coveredStoryBeatCount / anchors.length) * 100),
  }
}

function cueDensityPenalty(cueDensityPerMinute: number): {
  penalty: number
  issues: CinematicReadinessIssue[]
} {
  if (cueDensityPerMinute < 2) {
    return {
      penalty: 1.2,
      issues: [
        issue(
          'sfx-sparse',
          'warning',
          'Sound-effect coverage is sparse for a cinematic audiobook scene.',
        ),
      ],
    }
  }
  if (cueDensityPerMinute > 8) {
    return {
      penalty: 0.8,
      issues: [
        issue(
          'sfx-crowded',
          'warning',
          'Sound-effect coverage is dense enough that it may clutter the narration.',
        ),
      ],
    }
  }
  return { penalty: 0, issues: [] }
}

function expectedImpactCueCount(narrationDurationSeconds: number, cueCount: number): number {
  if (narrationDurationSeconds < 45 || cueCount < 4) return 0
  return clamp(Math.ceil(narrationDurationSeconds / 55), 2, Math.min(8, Math.floor(cueCount / 2)))
}

function normalizedCueLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, ' ').trim()
}

function maxCount(counts: Map<string, number>): number {
  return counts.size > 0 ? Math.max(...counts.values()) : 0
}

function cueLabelStats(cues: AudiobookSfxCue[]): CueLabelStats {
  const labelCounts = new Map<string, number>()
  const impactLabelCounts = new Map<string, number>()

  for (const cue of cues) {
    const label = normalizedCueLabel(cue.label)
    if (!label) continue
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1)
    if (cue.role === 'impact' || cue.role === 'transition') {
      impactLabelCounts.set(label, (impactLabelCounts.get(label) ?? 0) + 1)
    }
  }

  const dominantCueLabelCount = maxCount(labelCounts)
  const dominantImpactCueLabelCount = maxCount(impactLabelCounts)

  return {
    uniqueCueLabels: labelCounts.size,
    dominantCueLabelCount,
    dominantCueLabelPct:
      cues.length > 0 ? roundToTenth((dominantCueLabelCount / cues.length) * 100) : 0,
    uniqueImpactCueLabels: impactLabelCounts.size,
    dominantImpactCueLabelCount,
    dominantImpactCueLabelPct:
      impactLabelCounts.size > 0
        ? roundToTenth(
            (dominantImpactCueLabelCount /
              Array.from(impactLabelCounts.values()).reduce((total, count) => total + count, 0)) *
              100,
          )
        : 0,
  }
}

function cueVarietyPenalty(
  cueCount: number,
  uniqueCueLabels: number,
): {
  penalty: number
  issues: CinematicReadinessIssue[]
} {
  if (cueCount < 4 || uniqueCueLabels >= 3) return { penalty: 0, issues: [] }

  return {
    penalty: 0.7,
    issues: [
      issue('sfx-repetitive', 'warning', 'Cue variety is low, so the sound design may repeat.'),
    ],
  }
}

function repeatedCueLabelPenalty(cues: AudiobookSfxCue[]): {
  penalty: number
  issues: CinematicReadinessIssue[]
} {
  if (cues.length < 6) return { penalty: 0, issues: [] }

  const dominantCount = cueLabelStats(cues).dominantCueLabelCount
  if (dominantCount <= Math.max(3, Math.ceil(cues.length * 0.35))) {
    return { penalty: 0, issues: [] }
  }

  return {
    penalty: 0.5,
    issues: [
      issue(
        'sfx-overrepeated',
        'warning',
        'One sound-effect type dominates the plan, so the scene may feel repetitive.',
      ),
    ],
  }
}

function repeatedImpactCuePenalty(params: {
  impactCueCount: number
  uniqueImpactCueLabels: number
  dominantImpactCueLabelPct: number
}): { penalty: number; issues: CinematicReadinessIssue[] } {
  if (params.impactCueCount < 4) return { penalty: 0, issues: [] }

  const minimumImpactLabels = Math.min(3, params.impactCueCount)
  if (
    params.uniqueImpactCueLabels >= minimumImpactLabels &&
    params.dominantImpactCueLabelPct <= 55
  ) {
    return { penalty: 0, issues: [] }
  }

  return {
    penalty: 0.6,
    issues: [
      issue(
        'sfx-impact-repetitive',
        'warning',
        'Dramatic impact cues repeat too much, so story turns may feel like the same hit.',
      ),
    ],
  }
}

function missingForegroundCuePenalty(foregroundCueCount: number): {
  penalty: number
  issues: CinematicReadinessIssue[]
} {
  if (foregroundCueCount > 0) return { penalty: 0, issues: [] }

  return {
    penalty: 1,
    issues: [issue('no-foreground-sfx', 'warning', 'No foreground SFX accents were planned.')],
  }
}

function missingImpactCuePenalty(
  cueCount: number,
  impactCueCount: number,
): {
  penalty: number
  issues: CinematicReadinessIssue[]
} {
  if (cueCount < 4 || impactCueCount > 0) return { penalty: 0, issues: [] }

  return {
    penalty: 0.6,
    issues: [
      issue('no-impact-sfx', 'warning', 'No dramatic impact or transition SFX were planned.'),
    ],
  }
}

function fewImpactCuePenalty(params: {
  narrationDurationSeconds: number
  cueCount: number
  impactCueCount: number
}): { penalty: number; issues: CinematicReadinessIssue[] } {
  const targetImpactCueCount = expectedImpactCueCount(
    params.narrationDurationSeconds,
    params.cueCount,
  )

  if (
    targetImpactCueCount === 0 ||
    params.impactCueCount === 0 ||
    params.impactCueCount >= targetImpactCueCount
  ) {
    return { penalty: 0, issues: [] }
  }

  return {
    penalty: 0.5,
    issues: [
      issue(
        'few-impact-sfx',
        'warning',
        `Only ${params.impactCueCount} impact/transition SFX were planned; aim for at least ${targetImpactCueCount}.`,
      ),
    ],
  }
}

function backgroundHeavyCuePenalty(params: {
  cueCount: number
  ambienceCueCount: number
  foregroundCueCount: number
}): { penalty: number; issues: CinematicReadinessIssue[] } {
  if (params.cueCount < 4 || params.ambienceCueCount <= params.foregroundCueCount) {
    return { penalty: 0, issues: [] }
  }

  return {
    penalty: 0.5,
    issues: [
      issue(
        'sfx-background-heavy',
        'warning',
        'The sound design is weighted toward ambience and may not feel pronounced.',
      ),
    ],
  }
}

function missingAmbienceBedPenalty(
  narrationDurationSeconds: number,
  ambienceCueCount: number,
): { penalty: number; issues: CinematicReadinessIssue[] } {
  if (narrationDurationSeconds < 75 || ambienceCueCount > 0) return { penalty: 0, issues: [] }

  return {
    penalty: 0.6,
    issues: [
      issue('no-ambience-bed', 'info', 'No ambience beds were planned for the longer narration.'),
    ],
  }
}

function cueMixPenalty(params: {
  narrationDurationSeconds: number
  foregroundCueCount: number
  impactCueCount: number
  ambienceCueCount: number
  cueCount: number
}): { penalty: number; issues: CinematicReadinessIssue[] } {
  const results = [
    missingForegroundCuePenalty(params.foregroundCueCount),
    missingImpactCuePenalty(params.cueCount, params.impactCueCount),
    fewImpactCuePenalty(params),
    backgroundHeavyCuePenalty(params),
    missingAmbienceBedPenalty(params.narrationDurationSeconds, params.ambienceCueCount),
  ]

  return {
    penalty: results.reduce((total, result) => total + result.penalty, 0),
    issues: results.flatMap((result) => result.issues),
  }
}

function cueDurationPenalty(sfxDurationSeconds: number): {
  penalty: number
  issues: CinematicReadinessIssue[]
} {
  if (sfxDurationSeconds >= 4) return { penalty: 0, issues: [] }

  return {
    penalty: 0.5,
    issues: [issue('short-sfx', 'info', 'Short SFX generations can feel abrupt after mastering.')],
  }
}

function cueTimingPenalty(
  cues: AudiobookSfxCue[],
  narrationDurationSeconds: number,
): {
  penalty: number
  issues: CinematicReadinessIssue[]
} {
  const issues: CinematicReadinessIssue[] = []
  let penalty = 0
  const firstCueStart = Math.min(...cues.map((cue) => cue.startSeconds))
  const lastCueStart = Math.max(...cues.map((cue) => cue.startSeconds))

  if (firstCueStart > Math.max(12, narrationDurationSeconds * 0.22)) {
    penalty += 0.4
    issues.push(issue('late-first-cue', 'info', 'The first SFX cue arrives late in the scene.'))
  }
  if (narrationDurationSeconds >= 90 && lastCueStart < narrationDurationSeconds * 0.55) {
    penalty += 0.4
    issues.push(issue('early-last-cue', 'info', 'The SFX plan fades out early in the narration.'))
  }

  return { penalty, issues }
}

function storyBeatCoveragePenalty(metrics: StoryBeatCoverageMetrics): {
  penalty: number
  issues: CinematicReadinessIssue[]
} {
  if (metrics.storyBeatCount < 2) return { penalty: 0, issues: [] }

  if (metrics.storyBeatCoveragePct < 45) {
    return {
      penalty: 1,
      issues: [
        issue(
          'sfx-story-beats-undercovered',
          'warning',
          `Only ${metrics.coveredStoryBeatCount}/${metrics.storyBeatCount} dramatic narration beats have foreground or impact SFX nearby.`,
        ),
      ],
    }
  }

  if (metrics.storyBeatCoveragePct < 65) {
    return {
      penalty: 0.5,
      issues: [
        issue(
          'sfx-story-beats-thin',
          'info',
          `Only ${metrics.coveredStoryBeatCount}/${metrics.storyBeatCount} dramatic narration beats have foreground or impact SFX nearby.`,
        ),
      ],
    }
  }

  return { penalty: 0, issues: [] }
}

function cuePenalty(params: {
  cues: AudiobookSfxCue[]
  narrationDurationSeconds: number
  sfxDurationSeconds: number
  cueDensityPerMinute: number
  foregroundCueCount: number
  impactCueCount: number
  ambienceCueCount: number
  uniqueCueLabels: number
  uniqueImpactCueLabels: number
  dominantImpactCueLabelPct: number
  storyBeatCoverage: StoryBeatCoverageMetrics
}): { penalty: number; issues: CinematicReadinessIssue[] } {
  if (params.cues.length === 0) {
    return {
      penalty: 2.2,
      issues: [issue('no-sfx', 'critical', 'No story sound-effect cues were planned.')],
    }
  }

  const results = [
    cueDensityPenalty(params.cueDensityPerMinute),
    cueVarietyPenalty(params.cues.length, params.uniqueCueLabels),
    repeatedCueLabelPenalty(params.cues),
    repeatedImpactCuePenalty({
      impactCueCount: params.impactCueCount,
      uniqueImpactCueLabels: params.uniqueImpactCueLabels,
      dominantImpactCueLabelPct: params.dominantImpactCueLabelPct,
    }),
    cueMixPenalty({
      narrationDurationSeconds: params.narrationDurationSeconds,
      foregroundCueCount: params.foregroundCueCount,
      impactCueCount: params.impactCueCount,
      ambienceCueCount: params.ambienceCueCount,
      cueCount: params.cues.length,
    }),
    cueDurationPenalty(params.sfxDurationSeconds),
    cueTimingPenalty(params.cues, params.narrationDurationSeconds),
    storyBeatCoveragePenalty(params.storyBeatCoverage),
  ]

  return {
    penalty: results.reduce((total, result) => total + result.penalty, 0),
    issues: results.flatMap((result) => result.issues),
  }
}

export function scoreCinematicReadiness(input: CinematicReadinessInput): CinematicReadinessScore {
  const duration = Math.max(0, input.narrationDurationSeconds)
  const durationMinutes = Math.max(duration / 60, 1 / 60)
  const idealImageCount = clamp(Math.ceil(duration / 8), 1, 48)
  const minimumImageCount = clamp(Math.ceil(duration / 18), 1, idealImageCount)
  const foregroundCueCount = input.cues.filter((cue) =>
    cue.role ? cue.role !== 'ambience' : cue.mixVolumeDb > -6,
  ).length
  const impactCueCount = input.cues.filter(
    (cue) => cue.role === 'impact' || cue.role === 'transition',
  ).length
  const ambienceCueCount = input.cues.length - foregroundCueCount
  const labelStats = cueLabelStats(input.cues)
  const cueDensityPerMinute = input.cues.length / durationMinutes
  const storyBeatCoverage = calculateStoryBeatCoverage({
    transcript: input.transcript,
    narrationDurationSeconds: duration,
    cues: input.cues,
  })
  const libraryMatchedCueCount = clamp(
    Math.floor(input.libraryMatchedCueCount),
    0,
    input.cues.length,
  )
  const libraryMatchedForegroundCueCount = clamp(
    Math.floor(input.libraryMatchedForegroundCueCount),
    0,
    foregroundCueCount,
  )
  const libraryMatchedImpactCueCount = clamp(
    Math.floor(input.libraryMatchedImpactCueCount),
    0,
    impactCueCount,
  )
  const issues: CinematicReadinessIssue[] = []
  let penalty = 0

  if (duration < 1) {
    penalty += 2.5
    issues.push(issue('no-narration-duration', 'critical', 'Narration duration is unavailable.'))
  }

  const imageResult = imagePenalty({
    imageCount: input.imageCount,
    idealImageCount,
    minimumImageCount,
    matchImages: input.matchImages,
    applyCinematicMotion: input.applyCinematicMotion,
    applyTransitions: input.applyTransitions !== false,
  })
  penalty += imageResult.penalty
  issues.push(...imageResult.issues)

  const depthResult = depthPrepPenalty({
    imageCount: input.imageCount,
    prepareDepth: input.prepareDepth,
    depthPrepSupported: input.depthPrepSupported,
  })
  penalty += depthResult.penalty
  issues.push(...depthResult.issues)

  const finishResult = finishingPenalty(input.applyFinishing)
  penalty += finishResult.penalty
  issues.push(...finishResult.issues)

  const sourceResult = importedSfxSourcePenalty({
    cueCount: input.cues.length,
    foregroundCueCount,
    impactCueCount,
    useImportedSfxLibrary: input.useImportedSfxLibrary,
    libraryMatchedCueCount,
    libraryMatchedForegroundCueCount,
    libraryMatchedImpactCueCount,
  })
  penalty += sourceResult.penalty
  issues.push(...sourceResult.issues)

  const cueResult = cuePenalty({
    cues: input.cues,
    narrationDurationSeconds: duration,
    sfxDurationSeconds: input.sfxDurationSeconds,
    cueDensityPerMinute,
    foregroundCueCount,
    impactCueCount,
    ambienceCueCount,
    uniqueCueLabels: labelStats.uniqueCueLabels,
    uniqueImpactCueLabels: labelStats.uniqueImpactCueLabels,
    dominantImpactCueLabelPct: labelStats.dominantImpactCueLabelPct,
    storyBeatCoverage,
  })
  penalty += cueResult.penalty
  issues.push(...cueResult.issues)

  if (input.musicBedCount === 0) {
    penalty += 0.8
    issues.push(issue('no-music-bed', 'info', 'No music bed is present yet for the cinematic mix.'))
  }

  const score = roundToTenth(clamp(10 - penalty, 0, 10))
  const grade = gradeForScore(score)

  return {
    score,
    grade,
    summary: summaryForGrade(grade),
    issues,
    metrics: {
      idealImageCount,
      minimumImageCount,
      cueDensityPerMinute: roundToTenth(cueDensityPerMinute),
      foregroundCueCount,
      impactCueCount,
      ambienceCueCount,
      uniqueCueLabels: labelStats.uniqueCueLabels,
      dominantCueLabelCount: labelStats.dominantCueLabelCount,
      dominantCueLabelPct: labelStats.dominantCueLabelPct,
      uniqueImpactCueLabels: labelStats.uniqueImpactCueLabels,
      dominantImpactCueLabelCount: labelStats.dominantImpactCueLabelCount,
      dominantImpactCueLabelPct: labelStats.dominantImpactCueLabelPct,
      depthPrepEnabled: input.prepareDepth,
      depthPrepSupported: input.depthPrepSupported,
      finishingEnabled: input.applyFinishing,
      transitionsEnabled: input.applyTransitions !== false,
      importedSfxLibraryEnabled: input.useImportedSfxLibrary,
      libraryMatchedCueCount,
      libraryMatchedForegroundCueCount,
      libraryMatchedImpactCueCount,
      generatedCueCount: input.cues.length - libraryMatchedCueCount,
      storyBeatCount: storyBeatCoverage.storyBeatCount,
      coveredStoryBeatCount: storyBeatCoverage.coveredStoryBeatCount,
      storyBeatCoveragePct: storyBeatCoverage.storyBeatCoveragePct,
    },
  }
}
