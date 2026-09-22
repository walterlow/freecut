// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { ExportPreflightCheck, ExportPreflightResult } from './export-preflight'
import type { VideoCodecOption, VideoContainerOption } from './export-options'
import {
  areExportActionsDisabled,
  doesPreflightBlockExport,
  resolveFallbackCodec,
  resolveSupportedContainer,
} from './export-capabilities'

function containerOption(value: VideoContainerOption['value'], supported: boolean) {
  return { value, label: value, description: value, supported } satisfies VideoContainerOption
}

function codecOption(value: VideoCodecOption['value'], supported: boolean) {
  return { value, label: value, supported } satisfies VideoCodecOption
}

function preflight(checks: ExportPreflightCheck[]): ExportPreflightResult {
  return {
    canExport: !checks.some((check) => check.severity === 'error'),
    checks,
    predictedRenderPath: 'worker',
    estimatedDurationSeconds: 10,
  }
}

function check(severity: ExportPreflightCheck['severity']): ExportPreflightCheck {
  return { id: severity, severity, titleKey: 'title', detailKey: 'detail' }
}

describe('resolveSupportedContainer', () => {
  const options = [
    containerOption('mp4', false),
    containerOption('mov', false),
    containerOption('webm', true),
    containerOption('mkv', true),
  ]

  it('keeps the current container while the probe still supports it', () => {
    expect(resolveSupportedContainer(options, 'mkv')).toBeNull()
  })

  it('falls back to the first container the probe supports', () => {
    expect(resolveSupportedContainer(options, 'mp4')).toBe('webm')
  })

  it('leaves the container alone when nothing is supported', () => {
    expect(resolveSupportedContainer(options.map((o) => ({ ...o, supported: false })), 'mp4')).toBe(
      null,
    )
  })

  it('keeps the current container before the probe reports', () => {
    expect(
      resolveSupportedContainer(options.map((o) => ({ ...o, supported: true })), 'mov'),
    ).toBeNull()
  })
})

describe('resolveFallbackCodec', () => {
  const options = [
    codecOption('vp9', true),
    codecOption('vp8', false),
    codecOption('av1', true),
  ]

  it('keeps a codec the probe can encode', () => {
    expect(resolveFallbackCodec(options, 'vp9')).toBeNull()
    expect(resolveFallbackCodec(options, 'av1')).toBeNull()
  })

  it('falls back to the first encodable codec, not the container default', () => {
    expect(resolveFallbackCodec(options, 'h264')).toBe('vp9')
  })

  it('falls back to the container default when the probe rejected everything', () => {
    expect(resolveFallbackCodec([codecOption('vp8', false), codecOption('vp9', false)], 'h264')).toBe(
      'vp8',
    )
  })

  it('has nothing to fall back to without options', () => {
    expect(resolveFallbackCodec([], 'h264')).toBeNull()
  })
})

describe('doesPreflightBlockExport', () => {
  it('blocks only on preflight errors', () => {
    expect(doesPreflightBlockExport(preflight([check('error')]))).toBe(true)
    expect(doesPreflightBlockExport(preflight([check('warning'), check('info')]))).toBe(false)
    expect(doesPreflightBlockExport(preflight([]))).toBe(false)
  })

  it('does not block before the preflight has run', () => {
    expect(doesPreflightBlockExport(null)).toBe(false)
  })
})

describe('areExportActionsDisabled', () => {
  const base = {
    exportMode: 'video',
    smartCopyWillRun: false,
    hasSupportedVideoPath: true,
    isCheckingVideoSupport: false,
    preflightBlocksExport: false,
  } as const

  it('enables video export with a supported codec path', () => {
    expect(areExportActionsDisabled(base)).toBe(false)
  })

  it('disables video export while the probe is running or found no encodable path', () => {
    expect(areExportActionsDisabled({ ...base, isCheckingVideoSupport: true })).toBe(true)
    expect(areExportActionsDisabled({ ...base, hasSupportedVideoPath: false })).toBe(true)
  })

  it('keeps video export enabled when smart copy passes the source through', () => {
    expect(
      areExportActionsDisabled({
        ...base,
        smartCopyWillRun: true,
        hasSupportedVideoPath: false,
        isCheckingVideoSupport: true,
      }),
    ).toBe(false)
  })

  it('disables both actions when the preflight reports an error', () => {
    expect(areExportActionsDisabled({ ...base, preflightBlocksExport: true })).toBe(true)
    expect(
      areExportActionsDisabled({
        ...base,
        exportMode: 'audio',
        preflightBlocksExport: true,
      }),
    ).toBe(true)
  })

  it('never gates audio export on video codec support', () => {
    expect(
      areExportActionsDisabled({
        ...base,
        exportMode: 'audio',
        hasSupportedVideoPath: false,
        isCheckingVideoSupport: true,
      }),
    ).toBe(false)
  })
})
