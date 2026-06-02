import { describe, expect, it } from 'vite-plus/test'
import type { ExtendedExportSettings, CompositionInputProps } from '@/types/export'
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

function composition(items: TimelineItem[] = []): CompositionInputProps {
  return {
    fps: 30,
    durationInFrames: 300,
    width: 1920,
    height: 1080,
    tracks: [track(items)],
  }
}

describe('assessExportPreflight', () => {
  it('reports a ready video export when the selected codec is supported', async () => {
    const result = await assessExportPreflight({
      settings: baseSettings,
      fps: 30,
      composition: composition(),
      durationFrames: 300,
      supportedVideoCodecs: ['avc'],
      workerAvailable: true,
      offlineAudioContextAvailable: true,
    })

    expect(result.canExport).toBe(true)
    expect(result.resolvedSettings?.codec).toBe('avc')
    expect(result.resolvedSettings?.container).toBe('mp4')
    expect(result.checks.map((check) => check.id)).toContain('video-codec-supported')
    expect(result.checks.some((check) => check.severity === 'error')).toBe(false)
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
