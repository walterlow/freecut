import { describe, expect, it } from 'vite-plus/test'
import type { MediaHandleValidation } from '@/infrastructure/storage'
import type { MediaMetadata } from '@/types/storage'
import {
  buildBrokenMediaInfoFromValidation,
  scanWorkspaceMediaHealth,
  summarizeWorkspaceHealthScan,
} from './workspace-health'

function makeMedia(id: string, fileName = `${id}.mp4`): MediaMetadata {
  return {
    id,
    storageType: 'handle',
    fileName,
    fileSize: 1024,
    mimeType: 'video/mp4',
    duration: 5,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    bitrate: 5000,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('workspace health helpers', () => {
  it('maps permission and missing handle validation failures to broken media info', () => {
    const permissionDenied = buildBrokenMediaInfoFromValidation(makeMedia('clip-a', 'clip-a.mov'), {
      kind: 'permission',
    })
    const missing = buildBrokenMediaInfoFromValidation(makeMedia('clip-b', 'clip-b.wav'), {
      kind: 'missing',
    })

    expect(permissionDenied).toEqual({
      mediaId: 'clip-a',
      fileName: 'clip-a.mov',
      errorType: 'permission_denied',
    })
    expect(missing).toEqual({
      mediaId: 'clip-b',
      fileName: 'clip-b.wav',
      errorType: 'file_missing',
    })
  })

  it('does not mark healthy, no-handle, or changed files as broken', () => {
    const validations: MediaHandleValidation[] = [
      { kind: 'ok' },
      { kind: 'no-handle' },
      { kind: 'changed', currentSize: 2048, currentMtime: 2 },
    ]

    expect(
      validations.map((validation) =>
        buildBrokenMediaInfoFromValidation(makeMedia('clip'), validation),
      ),
    ).toEqual([null, null, null])
  })

  it('summarizes a proactive scan with healthy and broken media ids', () => {
    const summary = summarizeWorkspaceHealthScan([
      { media: makeMedia('healthy'), validation: { kind: 'ok' } },
      { media: makeMedia('embedded'), validation: { kind: 'no-handle' } },
      { media: makeMedia('missing'), validation: { kind: 'missing' } },
      { media: makeMedia('denied'), validation: { kind: 'permission' } },
    ])

    expect(summary.healthyIds).toEqual(['healthy'])
    expect(summary.broken).toEqual([
      { mediaId: 'missing', fileName: 'missing.mp4', errorType: 'file_missing' },
      { mediaId: 'denied', fileName: 'denied.mp4', errorType: 'permission_denied' },
    ])
  })

  it('validates each media item and returns a workspace health summary', async () => {
    const validationById = new Map<string, MediaHandleValidation>([
      ['healthy', { kind: 'ok' }],
      ['missing', { kind: 'missing' }],
    ])
    const validatedIds: string[] = []

    const summary = await scanWorkspaceMediaHealth(
      [makeMedia('healthy'), makeMedia('missing')],
      async (mediaId) => {
        validatedIds.push(mediaId)
        return validationById.get(mediaId) ?? { kind: 'no-handle' }
      },
    )

    expect(validatedIds).toEqual(['healthy', 'missing'])
    expect(summary).toEqual({
      healthyIds: ['healthy'],
      broken: [{ mediaId: 'missing', fileName: 'missing.mp4', errorType: 'file_missing' }],
    })
  })
})
