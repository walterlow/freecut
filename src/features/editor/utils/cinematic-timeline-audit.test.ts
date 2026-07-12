import { describe, expect, it } from 'vitest'
import type { ItemKeyframes } from '@/types/keyframe'
import type { Transition } from '@/types/transition'
import type {
  AudioItem,
  AudiobookSfxRole,
  CinematicDepthRole,
  ImageItem,
  TimelineItem,
  TimelineTrack,
} from '@/types/timeline'
import { scoreCinematicTimelineAudit } from './cinematic-timeline-audit'

const FPS = 30

function track(id: string, name: string, kind: TimelineTrack['kind']): TimelineTrack {
  return {
    id,
    name,
    kind,
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 0,
    items: [],
  }
}

function audio(
  id: string,
  trackId: string,
  label: string,
  from: number,
  duration: number,
  options: {
    volume?: number
    audiobookSfxRole?: AudiobookSfxRole
    transcriptCaptions?: AudioItem['transcriptCaptions']
  } = {},
): AudioItem {
  return {
    id,
    type: 'audio',
    trackId,
    label,
    from,
    durationInFrames: duration,
    src: `${id}.wav`,
    volume: options.volume,
    audiobookSfxRole: options.audiobookSfxRole,
    transcriptCaptions: options.transcriptCaptions,
  }
}

function image(
  id: string,
  from: number,
  duration: number,
  options: {
    label?: string
    cinematicDepthRole?: CinematicDepthRole
    cinematicDepthSourceId?: string
    cinematicDepthQuality?: number
    mediaId?: string
  } = {},
): ImageItem {
  return {
    id,
    type: 'image',
    trackId: 'video',
    label: options.label ?? `${id}.png`,
    from,
    durationInFrames: duration,
    src: `${id}.png`,
    cinematicDepthRole: options.cinematicDepthRole,
    cinematicDepthSourceId: options.cinematicDepthSourceId,
    cinematicDepthQuality: options.cinematicDepthQuality,
    mediaId: options.mediaId,
  }
}

function cameraKeyframes(itemId: string): ItemKeyframes {
  return {
    itemId,
    properties: [
      {
        property: 'width',
        keyframes: [
          { id: `${itemId}-w0`, frame: 0, value: 1920, easing: 'ease-in-out' },
          { id: `${itemId}-w1`, frame: 89, value: 2300, easing: 'ease-in-out' },
        ],
      },
      {
        property: 'x',
        keyframes: [
          { id: `${itemId}-x0`, frame: 0, value: 0, easing: 'ease-in-out' },
          { id: `${itemId}-x1`, frame: 89, value: -80, easing: 'ease-in-out' },
        ],
      },
    ],
  }
}

function stagedCameraKeyframes(itemId: string): ItemKeyframes {
  return {
    itemId,
    properties: [
      {
        property: 'width',
        keyframes: [
          { id: `${itemId}-w0`, frame: 0, value: 1920, easing: 'ease-in-out' },
          { id: `${itemId}-w1`, frame: 32, value: 2120, easing: 'ease-in-out' },
          { id: `${itemId}-w2`, frame: 89, value: 2380, easing: 'ease-in-out' },
        ],
      },
      {
        property: 'x',
        keyframes: [
          { id: `${itemId}-x0`, frame: 0, value: 0, easing: 'ease-in-out' },
          { id: `${itemId}-x1`, frame: 32, value: -12, easing: 'ease-in-out' },
          { id: `${itemId}-x2`, frame: 89, value: -86, easing: 'ease-in-out' },
        ],
      },
      {
        property: 'y',
        keyframes: [
          { id: `${itemId}-y0`, frame: 0, value: 0, easing: 'ease-in-out' },
          { id: `${itemId}-y1`, frame: 32, value: 8, easing: 'ease-in-out' },
          { id: `${itemId}-y2`, frame: 89, value: 52, easing: 'ease-in-out' },
        ],
      },
    ],
  }
}

function duckingKeyframes(itemId: string): ItemKeyframes {
  return {
    itemId,
    properties: [
      {
        property: 'volume',
        keyframes: [
          { id: `${itemId}-v0`, frame: 0, value: 0, easing: 'linear' },
          { id: `${itemId}-v1`, frame: 15, value: -18, easing: 'linear' },
          { id: `${itemId}-v2`, frame: 5000, value: -18, easing: 'linear' },
        ],
      },
    ],
  }
}

describe('scoreCinematicTimelineAudit', () => {
  it('reports story-directed cut coverage without double-counting depth layers', () => {
    const baseA = image('base-a', 0, 90, { cinematicDepthRole: 'background' })
    const baseB = image('base-b', 90, 90, { cinematicDepthRole: 'background' })
    const subjectA = {
      ...image('subject-a', 0, 90, { cinematicDepthRole: 'subject' }),
      trackId: 'subject',
    }
    const subjectB = {
      ...image('subject-b', 90, 90, { cinematicDepthRole: 'subject' }),
      trackId: 'subject',
    }
    const transitions: Transition[] = [
      {
        id: 'base-transition',
        type: 'crossfade',
        presentation: 'smoothCut',
        timing: 'linear',
        leftClipId: baseA.id,
        rightClipId: baseB.id,
        trackId: 'video',
        durationInFrames: 6,
      },
      {
        id: 'subject-transition',
        type: 'crossfade',
        presentation: 'smoothCut',
        timing: 'linear',
        leftClipId: subjectA.id,
        rightClipId: subjectB.id,
        trackId: 'subject',
        durationInFrames: 6,
      },
    ]
    const narrationItem = audio('narration', 'narration', 'Narration', 0, 180)

    const result = scoreCinematicTimelineAudit({
      items: [baseA, baseB, subjectA, subjectB, narrationItem],
      tracks: [
        track('video', 'Video', 'video'),
        track('subject', 'Subject', 'video'),
        track('narration', 'Narration', 'audio'),
      ],
      keyframes: [],
      transitions,
      fps: FPS,
      narrationItemId: narrationItem.id,
      selectedImageIds: [baseA.id, baseB.id, subjectA.id, subjectB.id],
    })

    expect(result.metrics.imageCutCount).toBe(1)
    expect(result.metrics.directedTransitionCutCount).toBe(1)
    expect(result.metrics.directedTransitionCoveragePct).toBe(100)
  })

  const tracks = [
    track('video', 'Video', 'video'),
    track('narration', 'Narration', 'audio'),
    track('music', 'Music', 'audio'),
    track('sfx', 'Audiobook SFX', 'audio'),
  ]

  it('rates a covered, animated, ducked timeline as strong', () => {
    const duration = 180 * FPS
    const images = Array.from({ length: 18 }, (_, index) =>
      image(`image-${index}`, index * 300, 300, {
        cinematicDepthRole: index % 2 === 0 ? 'background' : 'subject',
        cinematicDepthSourceId: `scene-${Math.floor(index / 2)}`,
      }),
    )
    const items: TimelineItem[] = [
      audio('narration', 'narration', 'Narration', 0, duration),
      audio('music', 'music', 'Score bed', 0, duration),
      audio('sfx-1', 'sfx', 'Name reveal', 400, 240, {
        volume: 8,
        audiobookSfxRole: 'impact',
      }),
      audio('sfx-2', 'sfx', 'Folder foley', 2400, 240, {
        volume: 7,
        audiobookSfxRole: 'foreground',
      }),
      ...images,
    ]
    const keyframes = [
      ...images.map((item) => stagedCameraKeyframes(item.id)),
      duckingKeyframes('music'),
    ]

    const audit = scoreCinematicTimelineAudit({
      items,
      tracks,
      keyframes,
      fps: FPS,
      narrationItemId: 'narration',
    })

    expect(audit.score).toBeGreaterThanOrEqual(8)
    expect(audit.metrics.multiAxisImageCount).toBe(images.length)
    expect(audit.metrics.stagedCameraImageCount).toBe(images.length)
    expect(audit.metrics.depthPreparedImageCount).toBe(images.length)
    expect(audit.metrics.depthLayerGroupCount).toBeGreaterThanOrEqual(8)
    expect(audit.metrics.depthReadinessScore).toBeGreaterThanOrEqual(8)
    expect(audit.metrics.referenceReadinessScore).toBeGreaterThanOrEqual(9)
    expect(audit.metrics.duckedMusicBedCount).toBe(1)
    expect(audit.metrics.stemMixScore).toBeGreaterThanOrEqual(8)
    expect(audit.metrics.musicUnderNarrationDb).toBeLessThanOrEqual(-12)
  })

  it('flags missing motion, music, and SFX on a slideshow-like timeline', () => {
    const items: TimelineItem[] = [
      audio('narration', 'narration', 'Narration', 0, 120 * FPS),
      image('image-1', 0, 120 * FPS),
    ]

    const audit = scoreCinematicTimelineAudit({
      items,
      tracks,
      keyframes: [],
      fps: FPS,
      narrationItemId: 'narration',
    })

    expect(audit.grade).toMatch(/fair|weak/)
    expect(audit.issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining([
        'timeline-few-images',
        'timeline-motion-thin',
        'timeline-depth-flat',
        'timeline-no-sfx',
        'timeline-reference-not-ready',
      ]),
    )
  })

  it('flags repeated crops when coverage relies on too few distinct visual sources', () => {
    const duration = 48 * FPS
    const images = Array.from({ length: 8 }, (_, index) =>
      image(`coverage-${index}`, index * 180, 180, {
        mediaId: `source-${index % 2}`,
      }),
    )

    const audit = scoreCinematicTimelineAudit({
      items: [audio('narration', 'narration', 'Narration', 0, duration), ...images],
      tracks,
      keyframes: [],
      fps: FPS,
      narrationItemId: 'narration',
    })

    expect(audit.metrics.visualCoverageShotCount).toBe(8)
    expect(audit.metrics.uniqueVisualSourceCount).toBe(2)
    expect(audit.metrics.visualSourceReusePct).toBe(75)
    expect(audit.metrics.visualSourceDiversityScore).toBeLessThan(7)
    expect(audit.issues.map((issue) => issue.id)).toContain(
      'timeline-visual-sources-repetitive',
    )
  })

  it('flags flat multi-axis camera moves without depth-prepared parallax layers', () => {
    const duration = 120 * FPS
    const images = Array.from({ length: 10 }, (_, index) =>
      image(`image-${index}`, index * 360, 360),
    )
    const items: TimelineItem[] = [
      audio('narration', 'narration', 'Narration', 0, duration),
      audio('music', 'music', 'Score bed', 0, duration),
      audio('sfx-1', 'sfx', 'Scene turn hit', 400, 240, {
        volume: 8,
        audiobookSfxRole: 'impact',
      }),
      ...images,
    ]
    const keyframes = [...images.map((item) => cameraKeyframes(item.id)), duckingKeyframes('music')]

    const audit = scoreCinematicTimelineAudit({
      items,
      tracks,
      keyframes,
      fps: FPS,
      narrationItemId: 'narration',
    })

    expect(audit.metrics.multiAxisImageCount).toBe(images.length)
    expect(audit.metrics.stagedCameraImageCount).toBe(0)
    expect(audit.metrics.depthPreparedImageCount).toBe(0)
    expect(audit.metrics.depthReadinessScore).toBeLessThan(5)
    expect(audit.metrics.referenceReadinessScore).toBeLessThan(8.2)
    expect(audit.issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining([
        'timeline-depth-flat',
        'timeline-motion-not-staged',
        'timeline-reference-not-ready',
      ]),
    )
  })

  it('flags plain two-keyframe camera motion as not staged enough for the reference style', () => {
    const duration = 90 * FPS
    const images = Array.from({ length: 8 }, (_, index) =>
      image(`image-${index}`, index * 330, 330, {
        cinematicDepthRole: index % 2 === 0 ? 'background' : 'subject',
        cinematicDepthSourceId: `scene-${Math.floor(index / 2)}`,
      }),
    )
    const items: TimelineItem[] = [
      audio('narration', 'narration', 'Narration', 0, duration),
      audio('music', 'music', 'Score bed', 0, duration),
      audio('sfx-1', 'sfx', 'Scene turn hit', 400, 240, {
        volume: 8,
        audiobookSfxRole: 'impact',
      }),
      ...images,
    ]
    const keyframes = [...images.map((item) => cameraKeyframes(item.id)), duckingKeyframes('music')]

    const audit = scoreCinematicTimelineAudit({
      items,
      tracks,
      keyframes,
      fps: FPS,
      narrationItemId: 'narration',
    })

    expect(audit.metrics.multiAxisImageCount).toBe(images.length)
    expect(audit.metrics.stagedCameraImageCount).toBe(0)
    expect(audit.metrics.referenceReadinessScore).toBeLessThan(8.2)
    expect(audit.issues.map((issue) => issue.id)).toContain('timeline-motion-not-staged')
    expect(audit.issues.map((issue) => issue.id)).toContain('timeline-reference-not-ready')
  })

  it('penalizes low-quality depth masks even when parallax layers exist', () => {
    const duration = 60 * FPS
    const images = Array.from({ length: 6 }, (_, index) =>
      image(`image-${index}`, index * 300, 300, {
        cinematicDepthRole: index % 2 === 0 ? 'background' : 'subject',
        cinematicDepthSourceId: `scene-${Math.floor(index / 2)}`,
        cinematicDepthQuality: 0.38,
      }),
    )
    const items: TimelineItem[] = [
      audio('narration', 'narration', 'Narration', 0, duration),
      audio('music', 'music', 'Score bed', 0, duration),
      audio('sfx-1', 'sfx', 'Scene turn hit', 400, 240, {
        volume: 8,
        audiobookSfxRole: 'impact',
      }),
      ...images,
    ]
    const keyframes = [
      ...images.map((item) => stagedCameraKeyframes(item.id)),
      duckingKeyframes('music'),
    ]

    const audit = scoreCinematicTimelineAudit({
      items,
      tracks,
      keyframes,
      fps: FPS,
      narrationItemId: 'narration',
    })

    expect(audit.metrics.depthLayerGroupCount).toBeGreaterThan(0)
    expect(audit.metrics.averageDepthQuality).toBe(0.38)
    expect(audit.metrics.lowQualityDepthLayerCount).toBe(images.length)
    expect(audit.metrics.depthReadinessScore).toBeLessThan(8)
    expect(audit.metrics.referenceReadinessScore).toBeLessThan(8.2)
    expect(audit.issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining(['timeline-depth-low-quality', 'timeline-reference-not-ready']),
    )
  })

  it('scores transcript-aligned still-image cuts as strong shot rhythm', () => {
    const narration = audio('narration', 'narration', 'Narration', 0, 300, {
      transcriptCaptions: {
        type: 'transcript',
        mediaId: 'narration-media',
        enabled: true,
        updatedAt: 1,
        cues: [
          { id: 'cue-1', startSeconds: 0.1, endSeconds: 1.8, text: 'Opening line' },
          { id: 'cue-2', startSeconds: 3.1, endSeconds: 4.9, text: 'Second beat' },
          { id: 'cue-3', startSeconds: 6.2, endSeconds: 7.8, text: 'Third beat' },
        ],
      },
    })
    const images = [image('image-1', 0, 93), image('image-2', 93, 93), image('image-3', 186, 114)]

    const audit = scoreCinematicTimelineAudit({
      items: [narration, ...images],
      tracks,
      keyframes: [],
      fps: FPS,
      narrationItemId: 'narration',
    })

    expect(audit.metrics.transcriptAlignedCutPct).toBe(100)
    expect(audit.metrics.averageImageShotSeconds).toBeCloseTo(3.3)
    expect(audit.metrics.shotRhythmScore).toBeGreaterThanOrEqual(8)
    expect(audit.issues.map((issue) => issue.id)).not.toContain(
      'timeline-cuts-not-transcript-aligned',
    )
  })

  it('flags still-image cuts that miss narration transcript beats', () => {
    const narration = audio('narration', 'narration', 'Narration', 0, 300, {
      transcriptCaptions: {
        type: 'transcript',
        mediaId: 'narration-media',
        enabled: true,
        updatedAt: 1,
        cues: [
          { id: 'cue-1', startSeconds: 2, endSeconds: 3.2, text: 'First story beat' },
          { id: 'cue-2', startSeconds: 5, endSeconds: 6.5, text: 'Second story beat' },
        ],
      },
    })
    const images = [
      image('image-1', 0, 100),
      image('image-2', 100, 100),
      image('image-3', 200, 100),
    ]

    const audit = scoreCinematicTimelineAudit({
      items: [narration, ...images],
      tracks,
      keyframes: [],
      fps: FPS,
      narrationItemId: 'narration',
    })

    expect(audit.metrics.transcriptAlignedCutPct).toBe(0)
    expect(audit.metrics.shotRhythmScore).toBeLessThan(6)
    expect(audit.issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining(['timeline-shot-rhythm-weak', 'timeline-cuts-not-transcript-aligned']),
    )
  })

  it('scores labeled stills that match their overlapping narration cues', () => {
    const narration = audio('narration', 'narration', 'Narration', 0, 30 * FPS, {
      transcriptCaptions: {
        type: 'transcript',
        mediaId: 'narration',
        enabled: true,
        updatedAt: 1,
        cues: [
          { id: 'cue-1', startSeconds: 0, endSeconds: 10, text: 'Silver moon over the city.' },
          {
            id: 'cue-2',
            startSeconds: 10,
            endSeconds: 20,
            text: 'A manila folder slid across the desk.',
          },
          {
            id: 'cue-3',
            startSeconds: 20,
            endSeconds: 30,
            text: 'The senator and judge kept the secret hidden.',
          },
        ],
      },
    })
    const items: TimelineItem[] = [
      narration,
      image('moon-image', 0, 10 * FPS, { label: 'silver moon city.png' }),
      image('folder-image', 10 * FPS, 10 * FPS, { label: 'manila folder desk.png' }),
      image('secret-image', 20 * FPS, 10 * FPS, { label: 'senator judge secret.png' }),
    ]

    const audit = scoreCinematicTimelineAudit({
      items,
      tracks,
      keyframes: [],
      fps: FPS,
      narrationItemId: 'narration',
    })

    expect(audit.metrics.imageStoryMeasurableCount).toBe(3)
    expect(audit.metrics.imageStoryMatchedCount).toBe(3)
    expect(audit.metrics.imageStoryMatchPct).toBe(100)
    expect(audit.issues.map((issue) => issue.id)).not.toContain('timeline-image-story-mismatch')
  })

  it('flags labeled stills that are out of order against narration cues', () => {
    const narration = audio('narration', 'narration', 'Narration', 0, 30 * FPS, {
      transcriptCaptions: {
        type: 'transcript',
        mediaId: 'narration',
        enabled: true,
        updatedAt: 1,
        cues: [
          { id: 'cue-1', startSeconds: 0, endSeconds: 10, text: 'Silver moon over the city.' },
          {
            id: 'cue-2',
            startSeconds: 10,
            endSeconds: 20,
            text: 'A manila folder slid across the desk.',
          },
          {
            id: 'cue-3',
            startSeconds: 20,
            endSeconds: 30,
            text: 'The senator and judge kept the secret hidden.',
          },
        ],
      },
    })
    const items: TimelineItem[] = [
      narration,
      image('folder-image', 0, 10 * FPS, { label: 'manila folder desk.png' }),
      image('secret-image', 10 * FPS, 10 * FPS, { label: 'senator judge secret.png' }),
      image('moon-image', 20 * FPS, 10 * FPS, { label: 'silver moon city.png' }),
    ]

    const audit = scoreCinematicTimelineAudit({
      items,
      tracks,
      keyframes: [],
      fps: FPS,
      narrationItemId: 'narration',
    })

    expect(audit.metrics.imageStoryMeasurableCount).toBe(3)
    expect(audit.metrics.imageStoryMatchedCount).toBe(0)
    expect(audit.metrics.imageStoryMatchPct).toBe(0)
    expect(audit.issues.map((issue) => issue.id)).toContain('timeline-image-story-mismatch')
    expect(audit.metrics.referenceReadinessScore).toBeLessThan(8.2)
  })

  it('passes timeline story-beat SFX coverage when cues land near narration beats', () => {
    const duration = 160 * FPS
    const narration = audio('narration', 'narration', 'Narration', 0, duration, {
      transcriptCaptions: {
        type: 'transcript',
        mediaId: 'narration-media',
        enabled: true,
        updatedAt: 1,
        cues: [
          { id: 'beat-1', startSeconds: 20, endSeconds: 21, text: 'The hidden truth arrived' },
          { id: 'beat-2', startSeconds: 72, endSeconds: 73, text: 'A dangerous decision' },
          {
            id: 'beat-3',
            startSeconds: 130,
            endSeconds: 131,
            text: 'Only the first promise broke',
          },
        ],
      },
    })
    const items: TimelineItem[] = [
      narration,
      audio('sfx-1', 'sfx', 'Story hit', 18 * FPS, 4 * FPS, {
        audiobookSfxRole: 'impact',
      }),
      audio('sfx-2', 'sfx', 'Folder foley', 70 * FPS, 4 * FPS, {
        audiobookSfxRole: 'foreground',
      }),
      audio('sfx-3', 'sfx', 'Scene turn hit', 128 * FPS, 4 * FPS, {
        audiobookSfxRole: 'impact',
      }),
      image('image-1', 0, duration),
    ]

    const audit = scoreCinematicTimelineAudit({
      items,
      tracks,
      keyframes: [],
      fps: FPS,
      narrationItemId: 'narration',
    })

    expect(audit.metrics.storyBeatCount).toBe(3)
    expect(audit.metrics.storyBeatSfxCoveredCount).toBe(3)
    expect(audit.metrics.storyBeatSfxCoveragePct).toBe(100)
    expect(audit.issues.map((issue) => issue.id)).not.toContain('timeline-story-beats-undercovered')
  })

  it('flags timeline story beats without foreground or impact SFX support', () => {
    const duration = 160 * FPS
    const narration = audio('narration', 'narration', 'Narration', 0, duration, {
      transcriptCaptions: {
        type: 'transcript',
        mediaId: 'narration-media',
        enabled: true,
        updatedAt: 1,
        cues: [
          { id: 'beat-1', startSeconds: 20, endSeconds: 21, text: 'The hidden truth arrived' },
          { id: 'beat-2', startSeconds: 72, endSeconds: 73, text: 'A dangerous decision' },
          {
            id: 'beat-3',
            startSeconds: 130,
            endSeconds: 131,
            text: 'Only the first promise broke',
          },
        ],
      },
    })
    const items: TimelineItem[] = [
      narration,
      audio('sfx-1', 'sfx', 'Scene ambience', 18 * FPS, 8 * FPS, {
        audiobookSfxRole: 'ambience',
      }),
      audio('sfx-2', 'sfx', 'Folder foley', 42 * FPS, 4 * FPS, {
        audiobookSfxRole: 'foreground',
      }),
      image('image-1', 0, duration),
    ]

    const audit = scoreCinematicTimelineAudit({
      items,
      tracks,
      keyframes: [],
      fps: FPS,
      narrationItemId: 'narration',
    })

    expect(audit.metrics.storyBeatCount).toBe(3)
    expect(audit.metrics.storyBeatSfxCoveredCount).toBe(0)
    expect(audit.metrics.storyBeatSfxCoveragePct).toBe(0)
    expect(audit.metrics.referenceReadinessScore).toBeLessThan(8.2)
    expect(audit.issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining(['timeline-story-beats-undercovered']),
    )
  })

  it('detects music beds without dialogue ducking', () => {
    const items: TimelineItem[] = [
      audio('narration', 'narration', 'Narration', 0, 90 * FPS),
      audio('music', 'music', 'Score bed', 0, 90 * FPS),
      audio('sfx-1', 'sfx', 'Door', 500, 120),
      image('image-1', 0, 90 * FPS),
    ]

    const audit = scoreCinematicTimelineAudit({
      items,
      tracks,
      keyframes: [cameraKeyframes('image-1')],
      fps: FPS,
      narrationItemId: 'narration',
    })

    expect(audit.metrics.musicBedCount).toBe(1)
    expect(audit.metrics.duckedMusicBedCount).toBe(0)
    expect(audit.issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining(['timeline-no-ducking', 'timeline-music-too-hot']),
    )
  })

  it('flags SFX that exist but are too faint or missing dramatic impacts', () => {
    const duration = 120 * FPS
    const images = Array.from({ length: 10 }, (_, index) =>
      image(`image-${index}`, index * 360, 360),
    )
    const items: TimelineItem[] = [
      audio('narration', 'narration', 'Narration', 0, duration),
      audio('music', 'music', 'Score bed', 0, duration),
      audio('sfx-1', 'sfx', 'Door', 400, 240, {
        volume: -8,
        audiobookSfxRole: 'foreground',
      }),
      audio('sfx-2', 'sfx', 'Folder foley', 2400, 240, {
        volume: -7,
        audiobookSfxRole: 'foreground',
      }),
      audio('sfx-3', 'sfx', 'Scene ambience', 3000, 360, {
        volume: -6,
        audiobookSfxRole: 'ambience',
      }),
      ...images,
    ]
    const keyframes = [...images.map((item) => cameraKeyframes(item.id)), duckingKeyframes('music')]

    const audit = scoreCinematicTimelineAudit({
      items,
      tracks,
      keyframes,
      fps: FPS,
      narrationItemId: 'narration',
    })

    expect(audit.metrics.foregroundSfxCount).toBe(2)
    expect(audit.metrics.impactSfxCount).toBe(0)
    expect(audit.metrics.foregroundSfxToNarrationDb).toBeLessThan(-2)
    expect(audit.issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining(['timeline-sfx-too-faint', 'timeline-no-impact-sfx']),
    )
  })
})
