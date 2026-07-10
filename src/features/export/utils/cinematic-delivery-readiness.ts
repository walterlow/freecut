import { clamp } from '@/shared/utils/math'
import type { CinematicAudioQualityScore } from './cinematic-audio-quality'
import type { CinematicEditReadinessScore } from './cinematic-edit-readiness'
import type { CinematicFrameQualityScore } from './cinematic-frame-quality'
import type { ExportPreflightCheck, ExportPreflightResult } from './export-preflight'

export type CinematicDeliveryReadinessGrade = 'excellent' | 'strong' | 'fair' | 'weak'

export type CinematicDeliveryReadinessSeverity = 'critical' | 'warning' | 'info'

export interface CinematicDeliveryReadinessIssue {
  id: string
  severity: CinematicDeliveryReadinessSeverity
  message: string
}

export interface CinematicDeliveryReadinessMetrics {
  exportPreflightScore: number
  editReadinessScore: number
  frameQualityScore: number
  audioQualityScore: number
  criticalIssueCount: number
  warningIssueCount: number
  infoIssueCount: number
}

export interface CinematicDeliveryReadinessScore {
  score: number
  grade: CinematicDeliveryReadinessGrade
  summary: string
  issues: CinematicDeliveryReadinessIssue[]
  metrics: CinematicDeliveryReadinessMetrics
}

export interface ScoreCinematicDeliveryReadinessInput {
  preflight?: ExportPreflightResult | null
  editReadiness?: CinematicEditReadinessScore | null
  frameQuality?: CinematicFrameQualityScore | null
  audioQuality?: CinematicAudioQualityScore | null
  mode?: 'video' | 'audio'
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10
}

function issue(
  id: string,
  severity: CinematicDeliveryReadinessSeverity,
  message: string,
): CinematicDeliveryReadinessIssue {
  return { id, severity, message }
}

function gradeForScore(score: number): CinematicDeliveryReadinessGrade {
  if (score >= 8.5) return 'excellent'
  if (score >= 7) return 'strong'
  if (score >= 5) return 'fair'
  return 'weak'
}

function summaryForGrade(grade: CinematicDeliveryReadinessGrade): string {
  switch (grade) {
    case 'excellent':
      return 'Final export is ready for cinematic review.'
    case 'strong':
      return 'Final export is strong with only minor delivery concerns.'
    case 'fair':
      return 'Final export needs another polish pass before it feels premium.'
    case 'weak':
      return 'Final export is not yet cinema-ready.'
  }
}

function preflightPenalty(check: ExportPreflightCheck): number {
  if (check.severity === 'error') return 10
  if (check.id === 'cinematic-resolution-below-4k') return 2
  if (check.id === 'cinematic-quality-not-ultra') return 0.9
  if (check.severity === 'warning') return 1.2
  if (check.severity === 'info') return 0.35
  return 0
}

function scorePreflight(preflight?: ExportPreflightResult | null): number {
  if (!preflight) return 6

  const penalty = preflight.checks.reduce((total, check) => total + preflightPenalty(check), 0)
  return roundMetric(clamp(10 - penalty, 0, 10))
}

function preflightMessage(check: ExportPreflightCheck): string {
  switch (check.id) {
    case 'cinematic-resolution-below-4k':
      return 'Export resolution is below the Cinema 4K delivery target.'
    case 'cinematic-quality-not-ultra':
      return 'Export quality is not set to Ultra for the final master.'
    case 'missing-media-blocks-export':
      return 'Some timeline media is missing and will block a reliable export.'
    case 'video-codec-unavailable':
      return 'The selected video codec or container is unavailable in this browser.'
    case 'worker-unavailable-fallback':
      return 'Export may fall back to a slower main-thread render path.'
    case 'large-file-risk':
      return 'The final file may be very large.'
    case 'long-export-risk':
      return 'The export may take a long time to render.'
    default:
      return 'Export preflight reported a delivery concern.'
  }
}

function preflightIssues(
  preflight?: ExportPreflightResult | null,
): CinematicDeliveryReadinessIssue[] {
  if (!preflight) {
    return [
      issue(
        'delivery-preflight-missing',
        'warning',
        'Export preflight was not available for the delivery verdict.',
      ),
    ]
  }

  return preflight.checks
    .filter((check) => check.severity !== 'ok')
    .map((check) =>
      issue(
        `delivery-${check.id}`,
        check.severity === 'error' ? 'critical' : check.severity === 'warning' ? 'warning' : 'info',
        preflightMessage(check),
      ),
    )
}

function frameIssues(
  frameQuality: CinematicFrameQualityScore | null | undefined,
  mode: 'video' | 'audio',
): CinematicDeliveryReadinessIssue[] {
  if (mode === 'audio') return []
  if (!frameQuality) {
    return [
      issue(
        'delivery-frame-quality-missing',
        'critical',
        'Rendered-frame quality could not be sampled for the delivery verdict.',
      ),
    ]
  }

  return frameQuality.issues.map((frameIssue) =>
    issue(`delivery-${frameIssue.id}`, frameIssue.severity, frameIssue.message),
  )
}

function editIssues(
  editReadiness: CinematicEditReadinessScore | null | undefined,
  mode: 'video' | 'audio',
): CinematicDeliveryReadinessIssue[] {
  if (mode === 'audio') return []
  if (!editReadiness) {
    return [
      issue(
        'delivery-edit-readiness-missing',
        'warning',
        'Timeline edit readiness was not available for the delivery verdict.',
      ),
    ]
  }

  return editReadiness.issues.map((editIssue) =>
    issue(`delivery-${editIssue.id}`, editIssue.severity, editIssue.message),
  )
}

function audioIssues(
  audioQuality: CinematicAudioQualityScore | null | undefined,
): CinematicDeliveryReadinessIssue[] {
  if (!audioQuality) {
    return [
      issue(
        'delivery-audio-quality-missing',
        'warning',
        'Rendered audio quality could not be sampled for the delivery verdict.',
      ),
    ]
  }

  return audioQuality.issues.map((audioIssue) =>
    issue(`delivery-${audioIssue.id}`, audioIssue.severity, audioIssue.message),
  )
}

function severityCounts(issues: CinematicDeliveryReadinessIssue[]) {
  return {
    criticalIssueCount: issues.filter((item) => item.severity === 'critical').length,
    warningIssueCount: issues.filter((item) => item.severity === 'warning').length,
    infoIssueCount: issues.filter((item) => item.severity === 'info').length,
  }
}

function calculateScore(params: {
  mode: 'video' | 'audio'
  preflightScore: number
  editScore: number
  frameScore: number
  audioScore: number
  issues: CinematicDeliveryReadinessIssue[]
}): number {
  const { mode, preflightScore, editScore, frameScore, audioScore, issues } = params
  const weighted =
    mode === 'video'
      ? frameScore * 0.34 + audioScore * 0.26 + editScore * 0.22 + preflightScore * 0.18
      : audioScore * 0.65 + preflightScore * 0.35
  const criticalPenalty = issues.some((item) => item.severity === 'critical') ? 2 : 0

  return roundMetric(clamp(weighted - criticalPenalty, 0, 10))
}

export function scoreCinematicDeliveryReadiness({
  preflight,
  editReadiness,
  frameQuality,
  audioQuality,
  mode = 'video',
}: ScoreCinematicDeliveryReadinessInput): CinematicDeliveryReadinessScore {
  const exportPreflightScore = scorePreflight(preflight)
  const editReadinessScore = mode === 'video' ? (editReadiness?.score ?? 6) : 10
  const frameQualityScore = mode === 'video' ? (frameQuality?.score ?? 0) : 10
  const audioQualityScore = audioQuality?.score ?? 6
  const issues = [
    ...preflightIssues(preflight),
    ...editIssues(editReadiness, mode),
    ...frameIssues(frameQuality, mode),
    ...audioIssues(audioQuality),
  ]
  const counts = severityCounts(issues)
  const score = calculateScore({
    mode,
    preflightScore: exportPreflightScore,
    editScore: editReadinessScore,
    frameScore: frameQualityScore,
    audioScore: audioQualityScore,
    issues,
  })
  const grade = gradeForScore(score)

  return {
    score,
    grade,
    summary: summaryForGrade(grade),
    issues,
    metrics: {
      exportPreflightScore,
      editReadinessScore: roundMetric(editReadinessScore),
      frameQualityScore: roundMetric(frameQualityScore),
      audioQualityScore: roundMetric(audioQualityScore),
      ...counts,
    },
  }
}
