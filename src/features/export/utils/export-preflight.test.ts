import { describe, expect, it } from 'vite-plus/test'
import type { ExtendedExportSettings, CompositionInputProps } from '@/types/export'
import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { assessExportPreflight } from './export-preflight'

const baseSettings: ExtendedExportSettings = {
  mode: 'video',
  videoContainer: 'mp4',
  codec: 'h264',
  quality: 'high',
  resolution: { width: 1920, height: 1080 },
}

function track(items: TimelineItem[]): TimelineTrack {
  return {
    id: 'track-1',
    name: 'V1',
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 0,
    items,
  }
}

function imageItem(overrides: Partial<Extract<TimelineItem, { type: 'image' }>> = {}) {
  return {
    id: 'image-1',
    trackId: 'track-1',
    type: 'image',
    from: 0,
    durationInFrames: 30,
    label: 'loop.gif',
    src: 'blob://loop.gif',
    ...overrides,
  } satisfies Extract<TimelineItem, { type: 'image' }>
}

function audioItem(overrides: Partial<Extract<TimelineItem, { type: 'audio' }>> = {}) {
  return {
    id: 'audio-1',
    trackId: 'track-1',
    type: 'audio',
    from: 0,
    durationInFrames: 30,
    label: 'voice.wav',
    src: 'blob://voice.wav',
    ...overrides,
  } satisfies Extract<TimelineItem, { type: 'audio' }>
}

function videoItem(overrides: Partial<Extract<TimelineItem, { type: 'video' }>> = {}) {
  return {
    id: 'video-1',
    trackId: 'track-1',
    type: 'video',
    from: 0,
    durationInFrames: 30,
    label: 'clip.mp4',
    mediaId: 'media-video-1',
    src: 'blob://clip.mp4',
    ...overrides,
  } satisfies Extract<TimelineItem, { type: 'video' }>
}

function cinematicImage(id: string, from: number): Extract<TimelineItem, { type: 'image' }> {
  return imageItem({
    id,
    label: `${id}.png`,
    src: `blob://${id}.png`,
    from,
    durationInFrames: 100,
    cinematicDepthRole: 'subject',
  })
}

function cameraKeyframes(itemId: string): ItemKeyframes {
  return cameraKeyframesForDuration(itemId, 100)
}

function cameraKeyframesForDuration(itemId: string, durationInFrames: number): ItemKeyframes {
  const midFrame = Math.round(durationInFrames / 2)
  return {
    itemId,
    properties: [
      {
        property: 'x',
        keyframes: [
          { id: `${itemId}-x-1`, frame: 0, value: 0, easing: 'ease-in-out' },
          { id: `${itemId}-x-2`, frame: midFrame, value: 34, easing: 'ease-in-out' },
          { id: `${itemId}-x-3`, frame: durationInFrames, value: 68, easing: 'ease-in-out' },
        ],
      },
      {
        property: 'y',
        keyframes: [
          { id: `${itemId}-y-1`, frame: 0, value: 0, easing: 'ease-in-out' },
          { id: `${itemId}-y-2`, frame: durationInFrames, value: -42, easing: 'ease-in-out' },
        ],
      },
      {
        property: 'width',
        keyframes: [
          { id: `${itemId}-w-1`, frame: 0, value: 1920, easing: 'ease-in-out' },
          { id: `${itemId}-w-2`, frame: durationInFrames, value: 2200, easing: 'ease-in-out' },
        ],
      },
    ],
  }
}

function sequentialCameraKeyframes(itemId: string): ItemKeyframes {
  return {
    itemId,
    properties: [
      {
        property: 'width',
        keyframes: [
          { id: `${itemId}-w-1`, frame: 0, value: 1920, easing: 'ease-in-out' },
          { id: `${itemId}-w-2`, frame: 50, value: 2200, easing: 'ease-in-out' },
          { id: `${itemId}-w-3`, frame: 100, value: 2200, easing: 'ease-in-out' },
        ],
      },
      {
        property: 'x',
        keyframes: [
          { id: `${itemId}-x-1`, frame: 0, value: 0, easing: 'ease-in-out' },
          { id: `${itemId}-x-2`, frame: 50, value: 0, easing: 'ease-in-out' },
          { id: `${itemId}-x-3`, frame: 100, value: 68, easing: 'ease-in-out' },
        ],
      },
      {
        property: 'y',
        keyframes: [
          { id: `${itemId}-y-1`, frame: 0, value: 0, easing: 'ease-in-out' },
          { id: `${itemId}-y-2`, frame: 50, value: 0, easing: 'ease-in-out' },
          { id: `${itemId}-y-3`, frame: 100, value: -42, easing: 'ease-in-out' },
        ],
      },
    ],
  }
}

function cinematicComposition(): CompositionInputProps {
  const images = [
    cinematicImage('image-1', 0),
    cinematicImage('image-2', 100),
    cinematicImage('image-3', 200),
  ]
  const sfx = [
    audioItem({ id: 'score', label: 'Audiobook score bed', durationInFrames: 300 }),
    audioItem({
      id: 'ambience',
      label: 'Audiobook SFX ambience',
      durationInFrames: 300,
      audiobookSfxRole: 'ambience',
    }),
    audioItem({
      id: 'foley',
      label: 'Audiobook SFX foley',
      durationInFrames: 300,
      audiobookSfxRole: 'foreground',
    }),
    audioItem({
      id: 'impact',
      label: 'Audiobook SFX impact',
      durationInFrames: 300,
      audiobookSfxRole: 'impact',
    }),
  ]

  return {
    fps: 30,
    durationInFrames: 300,
    width: 3840,
    height: 2160,
    tracks: [track(images), { ...track(sfx), id: 'track-2', kind: 'audio', order: 1 }],
    keyframes: images.map((item) => cameraKeyframes(item.id)),
  }
}

function longFlatCinematicComposition(): CompositionInputProps {
  const shotFrames = 360
  const images = Array.from({ length: 4 }, (_, index) =>
    imageItem({
      id: `image-${index + 1}`,
      label: `image-${index + 1}.png`,
      src: `blob://image-${index + 1}.png`,
      from: index * shotFrames,
      durationInFrames: shotFrames,
      cinematicDepthRole: 'subject',
    }),
  )
  const durationInFrames = shotFrames * images.length
  const sfx = [
    audioItem({ id: 'score', label: 'Audiobook score bed', durationInFrames }),
    audioItem({
      id: 'ambience',
      label: 'Audiobook SFX ambience',
      durationInFrames,
      audiobookSfxRole: 'ambience',
    }),
    audioItem({
      id: 'foley',
      label: 'Audiobook SFX foley',
      durationInFrames,
      audiobookSfxRole: 'foreground',
    }),
    audioItem({
      id: 'impact',
      label: 'Audiobook SFX impact',
      durationInFrames,
      audiobookSfxRole: 'impact',
    }),
  ]

  return {
    fps: 30,
    durationInFrames,
    width: 3840,
    height: 2160,
    tracks: [track(images), { ...track(sfx), id: 'track-2', kind: 'audio', order: 1 }],
    keyframes: images.map((item) => cameraKeyframesForDuration(item.id, shotFrames)),
  }
}

function composition(
  items: TimelineItem[] = [],
  overrides: Partial<CompositionInputProps> = {},
): CompositionInputProps {
  return {
    fps: 30,
    durationInFrames: 300,
    width: 1920,
    height: 1080,
    tracks: [track(items)],
    ...overrides,
  }
}

describe('assessExportPreflight', () => {
  it('reports a ready video export when the selected codec is supported', async () => {
    const result = await assessExportPreflight({
      settings: {
        ...baseSettings,
        quality: 'ultra',
        resolution: { width: 3840, height: 2160 },
      },
      fps: 30,
      composition: cinematicComposition(),
      durationFrames: 300,
      supportedVideoCodecs: ['avc'],
      workerAvailable: true,
      offlineAudioContextAvailable: true,
    })

    expect(result.canExport).toBe(true)
    expect(result.resolvedSettings?.codec).toBe('avc')
    expect(result.resolvedSettings?.container).toBe('mp4')
    expect(result.checks.map((check) => check.id)).toContain('video-codec-supported')
    expect(result.checks.map((check) => check.id)).not.toContain('cinematic-resolution-below-4k')
    expect(result.checks.map((check) => check.id)).not.toContain('cinematic-quality-not-ultra')
    expect(result.checks.map((check) => check.id)).not.toContain('cinematic-edit-readiness-weak')
    expect(result.checks.map((check) => check.id)).not.toContain('cinematic-reference-camera-gap')
    expect(result.checks.map((check) => check.id)).not.toContain('cinematic-shot-rhythm-gap')
    expect(result.checks.some((check) => check.severity === 'error')).toBe(false)
  })

  it('warns when video export settings are below cinematic delivery targets', async () => {
    const result = await assessExportPreflight({
      settings: { ...baseSettings, quality: 'high', resolution: { width: 1920, height: 1080 } },
      fps: 30,
      composition: composition(),
      durationFrames: 300,
      supportedVideoCodecs: ['avc'],
      workerAvailable: true,
      offlineAudioContextAvailable: true,
    })

    expect(result.canExport).toBe(true)
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'cinematic-resolution-below-4k',
        severity: 'warning',
      }),
    )
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'cinematic-quality-not-ultra',
        severity: 'info',
      }),
    )
  })

  it('warns before export when the timeline edit is still slideshow-like', async () => {
    const result = await assessExportPreflight({
      settings: {
        ...baseSettings,
        quality: 'ultra',
        resolution: { width: 3840, height: 2160 },
      },
      fps: 30,
      composition: composition([imageItem({ label: 'still.png', src: 'blob://still.png' })]),
      durationFrames: 300,
      supportedVideoCodecs: ['avc'],
      workerAvailable: true,
      offlineAudioContextAvailable: true,
    })

    expect(result.canExport).toBe(true)
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'cinematic-edit-readiness-weak',
        severity: 'warning',
      }),
    )
  })

  it('surfaces fair cinematic edit readiness as a pre-export info check', async () => {
    const images = [
      imageItem({
        id: 'image-1',
        label: 'image-1.png',
        src: 'blob://image-1.png',
        from: 0,
        durationInFrames: 100,
      }),
      imageItem({
        id: 'image-2',
        label: 'image-2.png',
        src: 'blob://image-2.png',
        from: 100,
        durationInFrames: 100,
      }),
      imageItem({
        id: 'image-3',
        label: 'image-3.png',
        src: 'blob://image-3.png',
        from: 200,
        durationInFrames: 100,
      }),
    ]
    const result = await assessExportPreflight({
      settings: {
        ...baseSettings,
        quality: 'ultra',
        resolution: { width: 3840, height: 2160 },
      },
      fps: 30,
      composition: composition(images, {
        width: 3840,
        height: 2160,
        keyframes: images.map((item) => ({
          itemId: item.id,
          properties: [
            {
              property: 'x',
              keyframes: [
                { id: `${item.id}-x-1`, frame: 0, value: 0, easing: 'ease-in-out' },
                { id: `${item.id}-x-2`, frame: 100, value: 52, easing: 'ease-in-out' },
              ],
            },
            {
              property: 'y',
              keyframes: [
                { id: `${item.id}-y-1`, frame: 0, value: 0, easing: 'ease-in-out' },
                { id: `${item.id}-y-2`, frame: 100, value: -30, easing: 'ease-in-out' },
              ],
            },
            {
              property: 'width',
              keyframes: [
                { id: `${item.id}-w-1`, frame: 0, value: 1920, easing: 'ease-in-out' },
                { id: `${item.id}-w-2`, frame: 100, value: 2150, easing: 'ease-in-out' },
              ],
            },
          ],
        })),
      }),
      durationFrames: 300,
      supportedVideoCodecs: ['avc'],
      workerAvailable: true,
      offlineAudioContextAvailable: true,
    })

    expect(result.canExport).toBe(true)
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'cinematic-edit-readiness-fair',
        severity: 'info',
      }),
    )
  })

  it('warns when keyframed stills do not overlap zoom and directional camera movement', async () => {
    const base = cinematicComposition()
    const result = await assessExportPreflight({
      settings: {
        ...baseSettings,
        quality: 'ultra',
        resolution: { width: 3840, height: 2160 },
      },
      fps: 30,
      composition: {
        ...base,
        keyframes: base.keyframes?.map((entry) => sequentialCameraKeyframes(entry.itemId)),
      },
      durationFrames: 300,
      supportedVideoCodecs: ['avc'],
      workerAvailable: true,
      offlineAudioContextAvailable: true,
    })

    expect(result.canExport).toBe(true)
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'cinematic-reference-camera-gap',
        severity: 'warning',
      }),
    )
  })

  it('warns when still-image pacing is too slow and evenly timed for the reference style', async () => {
    const result = await assessExportPreflight({
      settings: {
        ...baseSettings,
        quality: 'ultra',
        resolution: { width: 3840, height: 2160 },
      },
      fps: 30,
      composition: longFlatCinematicComposition(),
      durationFrames: 1440,
      supportedVideoCodecs: ['avc'],
      workerAvailable: true,
      offlineAudioContextAvailable: true,
    })

    expect(result.canExport).toBe(true)
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'cinematic-shot-rhythm-gap',
        severity: 'warning',
      }),
    )
  })

  it('warns when the selected codec falls back inside the chosen container', async () => {
    const result = await assessExportPreflight({
      settings: { ...baseSettings, codec: 'h265' },
      fps: 30,
      composition: composition(),
      durationFrames: 300,
      supportedVideoCodecs: ['avc'],
      workerAvailable: true,
      offlineAudioContextAvailable: true,
    })

    expect(result.canExport).toBe(true)
    expect(result.resolvedSettings?.codec).toBe('avc')
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'video-codec-fallback',
        severity: 'warning',
      }),
    )
  })

  it('blocks export when the requested container has no supported video codec', async () => {
    const result = await assessExportPreflight({
      settings: { ...baseSettings, videoContainer: 'webm', codec: 'vp9' },
      fps: 30,
      composition: composition(),
      durationFrames: 300,
      supportedVideoCodecs: ['avc'],
      workerAvailable: true,
      offlineAudioContextAvailable: true,
    })

    expect(result.canExport).toBe(false)
    expect(result.resolvedSettings).toBeUndefined()
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'video-codec-unavailable',
        severity: 'error',
      }),
    )
  })

  it('warns when animated images force main-thread video rendering', async () => {
    const result = await assessExportPreflight({
      settings: baseSettings,
      fps: 30,
      composition: composition([imageItem()]),
      durationFrames: 300,
      supportedVideoCodecs: ['avc'],
      workerAvailable: true,
      offlineAudioContextAvailable: true,
    })

    expect(result.canExport).toBe(true)
    expect(result.predictedRenderPath).toBe('main-thread')
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'worker-animated-image-fallback',
        severity: 'warning',
      }),
    )
  })

  it('warns when audio needs main-thread fallback without OfflineAudioContext in workers', async () => {
    const result = await assessExportPreflight({
      settings: baseSettings,
      fps: 30,
      composition: composition([audioItem()]),
      durationFrames: 300,
      supportedVideoCodecs: ['avc'],
      workerAvailable: true,
      offlineAudioContextAvailable: false,
    })

    expect(result.canExport).toBe(true)
    expect(result.predictedRenderPath).toBe('main-thread')
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'worker-audio-context-fallback',
        severity: 'info',
      }),
    )
  })

  it('skips video codec checks for audio-only export', async () => {
    const result = await assessExportPreflight({
      settings: {
        ...baseSettings,
        mode: 'audio',
        videoContainer: undefined,
        audioContainer: 'mp3',
      },
      fps: 30,
      composition: composition([audioItem()]),
      durationFrames: 300,
      supportedVideoCodecs: [],
      workerAvailable: true,
      offlineAudioContextAvailable: true,
    })

    expect(result.canExport).toBe(true)
    expect(result.resolvedSettings?.mode).toBe('audio')
    expect(result.checks.map((check) => check.id)).toContain('audio-export-ready')
    expect(result.checks.map((check) => check.id)).not.toContain('video-codec-unavailable')
  })

  it('blocks export when the composition references broken media', async () => {
    const result = await assessExportPreflight({
      settings: baseSettings,
      fps: 30,
      composition: composition([videoItem({ mediaId: 'missing-media' })]),
      durationFrames: 300,
      supportedVideoCodecs: ['avc'],
      workerAvailable: true,
      offlineAudioContextAvailable: true,
      brokenMediaIds: ['missing-media', 'unused-media'],
    })

    expect(result.canExport).toBe(false)
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'missing-media-blocks-export',
        severity: 'error',
        detailParams: { count: 1 },
      }),
    )
  })

  it('warns when the estimated export file size is very large', async () => {
    const result = await assessExportPreflight({
      settings: { ...baseSettings, quality: 'ultra' },
      fps: 30,
      composition: composition([videoItem()]),
      durationFrames: 30 * 60 * 30,
      supportedVideoCodecs: ['avc'],
      workerAvailable: true,
      offlineAudioContextAvailable: true,
    })

    expect(result.estimatedFileSizeBytes).toBeGreaterThan(2 * 1024 * 1024 * 1024)
    expect(result.canExport).toBe(true)
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'large-file-risk',
        severity: 'warning',
      }),
    )
  })

  it('warns when the export duration is long enough to be risky', async () => {
    const result = await assessExportPreflight({
      settings: baseSettings,
      fps: 30,
      composition: composition([videoItem()]),
      durationFrames: 30 * 31 * 60,
      supportedVideoCodecs: ['avc'],
      workerAvailable: true,
      offlineAudioContextAvailable: true,
    })

    expect(result.canExport).toBe(true)
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'long-export-risk',
        severity: 'warning',
      }),
    )
  })
})
