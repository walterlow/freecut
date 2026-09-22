// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { ExportSettings } from '@/types/export'
import {
  EXPORT_PRESETS,
  findActivePresetId,
  getResolutionOptions,
  getVideoCodecOptions,
  getVideoContainerOptions,
  scaledResolution,
} from './export-options'

// Reproduces the key/params shape the dialog passes in, so label assertions pin
// which translation the option builders resolve.
function t(key: string, options?: Record<string, unknown>) {
  return options ? `${key} ${JSON.stringify(options)}` : key
}

function settings(overrides: Partial<ExportSettings> = {}): ExportSettings {
  return {
    codec: 'h264',
    quality: 'medium',
    resolution: { width: 1920, height: 1080 },
    rateControl: 'auto',
    ...overrides,
  }
}

describe('getResolutionOptions', () => {
  it('offers project scale plus the two downscaled steps at even dimensions', () => {
    expect(getResolutionOptions(1920, 1080, t).map((option) => option.value)).toEqual([
      '1920x1080',
      '1280x720',
      '960x540',
    ])
  })

  it('rounds a scaled dimension up when it lands on an odd pixel count', () => {
    expect(getResolutionOptions(1921, 1081, t).map((option) => option.value)).toEqual([
      '1922x1082',
      '1280x720',
      '962x542',
    ])
  })

  it('labels the project-scale option as same-as-project and the rest as scaled', () => {
    const [sameAsProject, scaled] = getResolutionOptions(1920, 1080, t)

    expect(sameAsProject?.label).toBe(
      'export.settings.resolutionSameAsProject {"width":1920,"height":1080}',
    )
    expect(scaled?.label).toBe(
      'export.settings.resolutionScaled {"p":720,"width":1280,"height":720}',
    )
  })
})

describe('getVideoContainerOptions', () => {
  it('keeps every container selectable until the capability probe reports', () => {
    const options = getVideoContainerOptions(null, t)

    expect(options.map((option) => option.value)).toEqual(['mp4', 'mov', 'webm', 'mkv'])
    expect(options.every((option) => option.supported)).toBe(true)
  })

  it('disables containers no probed client codec can serve', () => {
    const options = getVideoContainerOptions(['vp9'], t)

    expect(options.filter((option) => option.supported).map((option) => option.value)).toEqual([
      'webm',
      'mkv',
    ])
  })

  it('translates the QuickTime label and uppercases the other container ids', () => {
    expect(getVideoContainerOptions(null, t).map((option) => option.label)).toEqual([
      'MP4',
      'export.settings.quicktimeMov',
      'WEBM',
      'MKV',
    ])
  })
})

describe('getVideoCodecOptions', () => {
  it('lists the codecs the container can mux and marks probed support', () => {
    expect(
      getVideoCodecOptions(['vp9', 'av1'], 'webm').map((option) => [
        option.value,
        option.supported,
      ]),
    ).toEqual([
      ['vp9', true],
      ['vp8', false],
      ['av1', true],
    ])
  })

  it('labels known codecs', () => {
    expect(getVideoCodecOptions(null, 'mkv').map((option) => option.label)).toEqual([
      'H.264',
      'H.265/HEVC',
      'VP9',
      'VP8',
      'AV1',
    ])
  })

  it('offers no supported codec for a container the probe cannot serve', () => {
    expect(
      getVideoCodecOptions(['avc', 'hevc'], 'webm').map((option) => [
        option.value,
        option.supported,
      ]),
    ).toEqual([
      ['vp9', false],
      ['vp8', false],
      ['av1', false],
    ])
  })
})

describe('findActivePresetId', () => {
  it('matches every preset from the settings that preset produces', () => {
    for (const preset of EXPORT_PRESETS) {
      const resolution = scaledResolution(1920, 1080, preset.scale)

      expect(
        findActivePresetId(
          preset.container,
          settings({ codec: preset.codec, quality: preset.quality, resolution }),
          1920,
          1080,
        ),
      ).toBe(preset.id)
    }
  })

  it('treats an unset rate control as auto', () => {
    expect(
      findActivePresetId(
        'mp4',
        { codec: 'h264', quality: 'medium', resolution: { width: 1920, height: 1080 } },
        1920,
        1080,
      ),
    ).toBe('recommended')
  })

  it('reports custom when any pinned field differs from the preset', () => {
    expect(findActivePresetId('mp4', settings({ rateControl: 'variable' }), 1920, 1080)).toBeNull()
    expect(findActivePresetId('mp4', settings({ quality: 'high' }), 1920, 1080)).toBeNull()
    expect(findActivePresetId('mp4', settings({ codec: 'h265' }), 1920, 1080)).toBeNull()
    expect(findActivePresetId('webm', settings({ codec: 'vp9' }), 1920, 1080)).toBeNull()
    expect(
      findActivePresetId('mp4', settings({ resolution: { width: 1000, height: 800 } }), 1920, 1080),
    ).toBeNull()
    expect(
      findActivePresetId('mp4', settings({ resolution: { width: 1920, height: 1080 } }), 3840, 2160),
    ).toBeNull()
  })

  it('is unaffected by unpinned settings such as a manual bitrate', () => {
    expect(findActivePresetId('mp4', settings({ videoBitrate: 12_000_000 }), 1920, 1080)).toBe(
      'recommended',
    )
  })
})
