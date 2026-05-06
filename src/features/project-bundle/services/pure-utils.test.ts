import { describe, expect, it } from 'vite-plus/test'

import {
  computeBundleManifestChecksum,
  computeSnapshotChecksum,
  getUniqueBundleFileName,
  sanitizeBundleDirectoryName,
  sanitizeBundleFileName,
  sanitizeDownloadFilename,
} from './pure-utils'
import type { BundleManifest } from '../types/bundle'
import type { ProjectSnapshot } from '../types/snapshot'

describe('project bundle pure utilities', () => {
  it('preserves file-system sanitizer golden outputs', () => {
    expect(sanitizeBundleDirectoryName('  My Project: Cut?/Final  ')).toBe(
      '_My_Project__Cut__Final_',
    )
    expect(sanitizeBundleDirectoryName('')).toBe('untitled')
    expect(sanitizeBundleDirectoryName('x'.repeat(120))).toBe('x'.repeat(100))

    expect(sanitizeBundleFileName('  clip:01?.mp4  ')).toBe('clip_01_.mp4')
    expect(sanitizeBundleFileName('')).toBe('unnamed')
    expect(sanitizeBundleFileName('x'.repeat(220))).toBe('x'.repeat(200))
  })

  it('preserves download filename sanitizer golden outputs and fallback behavior', () => {
    expect(sanitizeDownloadFilename('My Project: Cut?/Final')).toBe('My_Project__Cut__Final')
    expect(sanitizeDownloadFilename('  spaced   project  ')).toBe('_spaced_project_')
    expect(sanitizeDownloadFilename('', { fallback: 'untitled' })).toBe('untitled')
    expect(sanitizeDownloadFilename('', { fallback: '' })).toBe('')
    expect(sanitizeDownloadFilename('x'.repeat(120))).toBe('x'.repeat(100))
  })

  it('preserves unique bundle filename generation for duplicate hash/name pairs', () => {
    const used = new Set(['hash-a/clip.mp4', 'hash-a/clip_1.mp4', 'hash-a/raw'])

    expect(getUniqueBundleFileName(used, 'hash-a', 'clip.mp4')).toBe('clip_2.mp4')
    expect(getUniqueBundleFileName(used, 'hash-a', 'raw')).toBe('raw_1')
    expect(getUniqueBundleFileName(used, 'hash-b', 'clip.mp4')).toBe('clip.mp4')
  })

  it('preserves snapshot checksum golden output', async () => {
    const snapshot = {
      version: '1.0',
      exportedAt: '2026-01-02T03:04:05.000Z',
      editorVersion: '1.0.0',
      project: {
        id: 'project-1',
        name: 'Golden Project',
        duration: 120,
        fps: 30,
        width: 1920,
        height: 1080,
        createdAt: 1,
        updatedAt: 2,
      },
      mediaReferences: [
        {
          id: 'media-1',
          fileName: 'clip.mp4',
          fileSize: 3,
          mimeType: 'video/mp4',
        },
      ],
      checksum: 'ignored-existing-checksum',
    } as unknown as ProjectSnapshot

    expect(await computeSnapshotChecksum(snapshot)).toBe(
      '1c2ec83c618a3613358a9bf4136863005699d3ee9ff6d7e55ad2c2a4c743ea46',
    )
  })

  it('preserves manifest order and checksum golden output', async () => {
    const manifest: BundleManifest = {
      version: '1.0',
      createdAt: 1700000000000,
      editorVersion: '1.0.0',
      projectId: 'project-1',
      projectName: 'Golden Project',
      media: [
        {
          originalId: 'media-b',
          relativePath: 'media/hash-b/b.mp4',
          fileName: 'b.mp4',
          fileSize: 2,
          sha256: 'hash-b',
          mimeType: 'video/mp4',
          metadata: {
            duration: 2,
            width: 1920,
            height: 1080,
            fps: 30,
            codec: 'h264',
            bitrate: 2000,
          },
        },
        {
          originalId: 'media-a',
          relativePath: 'media/hash-a/a.mp4',
          fileName: 'a.mp4',
          fileSize: 1,
          sha256: 'hash-a',
          mimeType: 'video/mp4',
          metadata: {
            duration: 1,
            width: 1280,
            height: 720,
            fps: 24,
            codec: 'h265',
            bitrate: 1000,
          },
        },
      ],
      checksum: 'ignored-existing-checksum',
    }

    expect(manifest.media.map((entry) => entry.originalId)).toEqual(['media-b', 'media-a'])
    expect(await computeBundleManifestChecksum(manifest)).toBe(
      '68199f97eee3d0ba81524ee855fffb27ebd6fd0a7a21a428195ca3e5b79c2921',
    )
  })
})
