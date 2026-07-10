import { describe, expect, it } from 'vitest'
import type { CinematicAudioQualityScore } from './cinematic-audio-quality'
import type { CinematicEditReadinessScore } from './cinematic-edit-readiness'
import type { CinematicFrameQualityScore } from './cinematic-frame-quality'
import type { ExportPreflightResult } from './export-preflight'
import { scoreCinematicDeliveryReadiness } from './cinematic-delivery-readiness'

function preflight(
  checks: ExportPreflightResult['checks'] = [
    {
      id: 'export-range-ready',
      severity: 'ok',
      titleKey: 'ok',
      detailKey: 'ok',
    },
  ],
): ExportPreflightResult {
  return {
    canExport: !checks.some((check) => check.severity === 'error'),
    checks,
    predictedRenderPath: 'worker',
    estimatedDurationSeconds: 120,
    resolvedSettings: {
      mode: 'video',
      codec: 'avc',
      container: 'mp4',
      quality: 'ultra',
      resolution: { width: 3840, height: 2160 },
      fps: 30,
      videoBitrate: 35_000_000,
    },
  }
}

function frameQuality(
  overrides: Partial<CinematicFrameQualityScore> = {},
): CinematicFrameQualityScore {
  return {
    score: 9.1,
    grade: 'excellent',
    summary: 'Rendered frames look sharp, balanced, and cinematic.',
    issues: [],
    metrics: {
      sampleCount: 6,
      averageLuma: 92,
      lumaStdDev: 48,
      crushedBlackRatio: 0.08,
      darkRatio: 0.18,
      highlightRatio: 0.03,
      averageSharpness: 12.5,
      averageFrameDelta: 18,
      frameDeltaStdDev: 10.5,
      averageMotionMagnitude: 2.4,
      motionAxisBalance: 0.72,
      motionDirectionChangeRatio: 0.5,
      referenceMotionScore: 8.6,
    },
    ...overrides,
  }
}

function editReadiness(
  overrides: Partial<CinematicEditReadinessScore> = {},
): CinematicEditReadinessScore {
  return {
    score: 9.2,
    grade: 'excellent',
    summary: 'Timeline edit structure is ready for cinematic export.',
    issues: [],
    metrics: {
      durationFrames: 3600,
      stillImageCount: 16,
      imageCoveragePct: 100,
      animatedImagePct: 100,
      multiAxisImagePct: 100,
      stagedCameraPct: 92,
      referenceStyleCameraPct: 92,
      averageImageShotSeconds: 4.8,
      imageShotDurationStdDevSeconds: 1.1,
      shotRhythmScore: 9.2,
      depthPreparedPct: 88,
      musicBedCount: 1,
      sfxCount: 18,
      sfxRoleScore: 10,
    },
    ...overrides,
  }
}

function audioQuality(
  overrides: Partial<CinematicAudioQualityScore> = {},
): CinematicAudioQualityScore {
  return {
    score: 8.8,
    grade: 'excellent',
    summary: 'Exported audio is loud, controlled, and cinematic.',
    issues: [],
    metrics: {
      durationSeconds: 120,
      channelCount: 2,
      peakDb: -1.3,
      rmsDb: -15.5,
      dynamicRangeDb: 11,
      silenceRatio: 0.01,
      clippedRatio: 0,
      stereoSpread: 0.22,
    },
    ...overrides,
  }
}

describe('scoreCinematicDeliveryReadiness', () => {
  it('rates a clean 4K visual and audio export as excellent', () => {
    const score = scoreCinematicDeliveryReadiness({
      preflight: preflight(),
      editReadiness: editReadiness(),
      frameQuality: frameQuality(),
      audioQuality: audioQuality(),
    })

    expect(score.grade).toBe('excellent')
    expect(score.score).toBeGreaterThanOrEqual(8.8)
    expect(score.metrics.exportPreflightScore).toBe(10)
    expect(score.issues).toHaveLength(0)
  })

  it('penalizes exports that look and sound good but are below Cinema 4K delivery', () => {
    const score = scoreCinematicDeliveryReadiness({
      preflight: preflight([
        {
          id: 'export-range-ready',
          severity: 'ok',
          titleKey: 'ok',
          detailKey: 'ok',
        },
        {
          id: 'cinematic-resolution-below-4k',
          severity: 'warning',
          titleKey: 'resolution',
          detailKey: 'resolution',
        },
      ]),
      editReadiness: editReadiness(),
      frameQuality: frameQuality(),
      audioQuality: audioQuality(),
    })

    expect(score.metrics.exportPreflightScore).toBe(8)
    expect(score.issues.map((issue) => issue.id)).toContain(
      'delivery-cinematic-resolution-below-4k',
    )
    expect(score.score).toBeLessThan(9)
  })

  it('does not call a video delivery ready when rendered-frame sampling fails', () => {
    const score = scoreCinematicDeliveryReadiness({
      preflight: preflight(),
      editReadiness: editReadiness(),
      frameQuality: null,
      audioQuality: audioQuality(),
    })

    expect(score.grade).toBe('weak')
    expect(score.issues.map((issue) => issue.id)).toContain('delivery-frame-quality-missing')
    expect(score.metrics.criticalIssueCount).toBe(1)
  })

  it('surfaces weak rendered audio inside the combined delivery verdict', () => {
    const score = scoreCinematicDeliveryReadiness({
      preflight: preflight(),
      editReadiness: editReadiness(),
      frameQuality: frameQuality(),
      audioQuality: audioQuality({
        score: 4.6,
        grade: 'weak',
        summary: 'Exported audio risks sounding unfinished.',
        issues: [
          {
            id: 'too-quiet',
            severity: 'critical',
            message: 'The final mix is too quiet for a cinematic export.',
          },
        ],
      }),
    })

    expect(score.grade).toBe('fair')
    expect(score.issues.map((issue) => issue.id)).toContain('delivery-too-quiet')
    expect(score.metrics.audioQualityScore).toBe(4.6)
  })

  it('penalizes a valid export when the edit is still slideshow-like', () => {
    const score = scoreCinematicDeliveryReadiness({
      preflight: preflight(),
      editReadiness: editReadiness({
        score: 3.6,
        grade: 'weak',
        summary: 'Timeline edit structure still risks feeling like a slideshow.',
        issues: [
          {
            id: 'edit-motion-too-simple',
            severity: 'warning',
            message: 'Too few stills have two-axis camera motion.',
          },
          {
            id: 'edit-depth-underprepared',
            severity: 'warning',
            message: 'Too few stills have subject/background or depth-map prep.',
          },
        ],
      }),
      frameQuality: frameQuality(),
      audioQuality: audioQuality(),
    })

    expect(score.grade).toBe('strong')
    expect(score.score).toBeLessThan(8.5)
    expect(score.metrics.editReadinessScore).toBe(3.6)
    expect(score.issues.map((issue) => issue.id)).toContain('delivery-edit-motion-too-simple')
  })
})
