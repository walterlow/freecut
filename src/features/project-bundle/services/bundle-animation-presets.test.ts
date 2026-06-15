/**
 * Round-trip coverage for animation presets travelling inside the project
 * bundle (.freecut.zip). Exercises the real export → import seam in memory:
 * the export collects the presets sidecar + manifest entry, the import
 * validates + sanitizes + restores it.
 */

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { Zip, ZipDeflate } from 'fflate'
import type { AnimationPreset } from '@/infrastructure/storage/workspace-fs/animation-presets'
import { sanitizeAnimationPresets } from '@/infrastructure/storage/workspace-fs/animation-presets'
import type { Project } from '@/types/project'
import { BUNDLE_VERSION } from '../types/bundle'
import { computeBundleManifestChecksum } from './pure-utils'

// ---------------------------------------------------------------------------
// Mocks — storage barrel + media-library deps + file-system service.
// readAnimationPresets is driven per-test; saveAnimationPresets captures the
// restored set. The real sanitizer is used so import validation is genuine.
// ---------------------------------------------------------------------------

const storageMocks = vi.hoisted(() => ({
  readAnimationPresets: vi.fn<(projectId: string) => Promise<AnimationPreset[]>>(),
  saveAnimationPresets:
    vi.fn<(projectId: string, presets: AnimationPreset[]) => Promise<void>>(),
  getProject: vi.fn(),
  getProjectMediaIds: vi.fn(async () => [] as string[]),
  loadProjectThumbnail: vi.fn(async () => null),
  createProject: vi.fn(async () => {}),
  createMedia: vi.fn(async () => {}),
  saveThumbnail: vi.fn(async () => {}),
  saveProjectThumbnail: vi.fn(async () => {}),
  associateMediaWithProject: vi.fn(async () => {}),
  updateProject: vi.fn(async () => {}),
}))

vi.mock('@/infrastructure/storage', () => ({
  ...storageMocks,
  // Use the real sanitizer so the import path's validation is exercised.
  sanitizeAnimationPresets,
}))

vi.mock('@/features/project-bundle/deps/media-library', () => ({
  importMediaLibraryService: vi.fn(async () => ({
    mediaLibraryService: {
      getMedia: vi.fn(async () => null),
      getMediaFile: vi.fn(async () => null),
    },
  })),
  computeContentHashFromBuffer: vi.fn(async () => 'hash'),
  generateThumbnail: vi.fn(async () => new Blob()),
}))

vi.mock('./file-system-service', () => ({
  fileSystemService: {
    getOrCreateSubdirectory: vi.fn(async () => ({}) as FileSystemDirectoryHandle),
    getUniqueFileName: vi.fn(async (_dir: unknown, name: string) => name),
    writeFile: vi.fn(async () => ({}) as FileSystemFileHandle),
  },
}))

import { exportProjectBundleStreaming } from './bundle-export-service'
import { importProjectBundle } from './bundle-import-service'

function makeProject(): Project {
  return {
    id: 'project-a',
    name: 'My Project',
    description: '',
    createdAt: 1,
    updatedAt: 2,
    duration: 0,
    metadata: { width: 1920, height: 1080, fps: 30 },
  } as Project
}

function makePresets(): AnimationPreset[] {
  return [
    {
      id: 'preset-1',
      name: 'Fade In',
      sourceItemType: 'video',
      properties: [
        {
          property: 'opacity',
          keyframes: [
            { id: 'kf-1', frame: 0, value: 0, easing: 'linear' },
            { id: 'kf-2', frame: 30, value: 1, easing: 'ease-out' },
          ],
        },
      ],
      effects: [],
      sourceDurationInFrames: 30,
      createdAt: 100,
    },
  ]
}

/**
 * jsdom's File/Blob does not implement `arrayBuffer()`, which the import
 * service relies on. Wrap raw zip bytes in a minimal File-like that does.
 */
function fileFromBytes(bytes: Uint8Array): File {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return {
    name: 'test.freecut.zip',
    type: 'application/zip',
    arrayBuffer: async () => buffer,
  } as unknown as File
}

/**
 * Drive the streaming export against a fake writable so we capture the raw zip
 * bytes directly — avoids jsdom Blob's missing `arrayBuffer()`.
 */
async function exportToFile(): Promise<File> {
  const written: Uint8Array[] = []
  const writable = {
    write: async (chunk: Uint8Array) => {
      written.push(chunk)
    },
    close: async () => {},
    abort: async () => {},
  }
  const fileHandle = {
    createWritable: async () => writable,
  } as unknown as FileSystemFileHandle

  await exportProjectBundleStreaming('project-a', fileHandle)

  const total = written.reduce((acc, c) => acc + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of written) {
    out.set(c, offset)
    offset += c.length
  }
  return fileFromBytes(out)
}

const destinationDirectory = {} as FileSystemDirectoryHandle

beforeEach(() => {
  vi.clearAllMocks()
  storageMocks.getProject.mockResolvedValue(makeProject())
  storageMocks.getProjectMediaIds.mockResolvedValue([])
  storageMocks.loadProjectThumbnail.mockResolvedValue(null)
})

describe('bundle animation presets round-trip', () => {
  it('exports then imports a project with its animation presets intact', async () => {
    storageMocks.readAnimationPresets.mockResolvedValue(makePresets())

    const file = await exportToFile()
    await importProjectBundle(file, destinationDirectory)

    expect(storageMocks.saveAnimationPresets).toHaveBeenCalledTimes(1)
    const [projectId, restored] = storageMocks.saveAnimationPresets.mock.calls[0]!
    expect(projectId).toEqual(expect.any(String))
    expect(restored).toEqual(makePresets())
  })

  it('imports a bundle with no presets file with an empty preset set', async () => {
    storageMocks.readAnimationPresets.mockResolvedValue([])

    const file = await exportToFile()
    await importProjectBundle(file, destinationDirectory)

    // No sidecar written on export → nothing restored on import.
    expect(storageMocks.saveAnimationPresets).not.toHaveBeenCalled()
  })

  it('sanitizes a malformed presets file instead of crashing', async () => {
    // Build a bundle by hand with a corrupt animation-presets.json and a
    // manifest that references it (checksum recomputed so validation passes).
    const file = await buildBundleWithRawPresets('{ this is not valid json')
    await expect(importProjectBundle(file, destinationDirectory)).resolves.toBeDefined()
    // Unparseable file → caught, nothing persisted.
    expect(storageMocks.saveAnimationPresets).not.toHaveBeenCalled()
  })

  it('drops bad preset entries via the sanitizer on import', async () => {
    // Structurally valid JSON but entries fail per-field validation.
    const malformed = JSON.stringify({
      version: 1,
      presets: [
        { id: 'bad', name: 'no properties' }, // missing properties → dropped
        {
          id: 'ok',
          name: 'good',
          sourceItemType: 'video',
          properties: [
            { property: 'opacity', keyframes: [{ id: 'k', frame: 0, value: 1, easing: 'linear' }] },
          ],
          effects: [],
          sourceDurationInFrames: 10,
          createdAt: 1,
        },
      ],
    })
    const file = await buildBundleWithRawPresets(malformed)
    await importProjectBundle(file, destinationDirectory)

    expect(storageMocks.saveAnimationPresets).toHaveBeenCalledTimes(1)
    const restored = storageMocks.saveAnimationPresets.mock.calls[0]![1]
    expect(restored).toHaveLength(1)
    expect(restored[0]!.id).toBe('ok')
  })
})

/**
 * Hand-build a valid bundle whose animation-presets.json contains arbitrary
 * raw bytes, recomputing the manifest checksum so validation passes.
 */
async function buildBundleWithRawPresets(rawPresets: string): Promise<File> {
  const manifest = {
    version: BUNDLE_VERSION,
    createdAt: Date.now(),
    editorVersion: '1.0.0',
    projectId: 'project-a',
    projectName: 'My Project',
    media: [],
    animationPresets: { relativePath: 'animation-presets.json', count: 1 },
    checksum: '',
  }
  manifest.checksum = await computeBundleManifestChecksum(manifest)

  const project = { ...makeProject(), timeline: undefined }

  const chunks: Uint8Array[] = []
  await new Promise<void>((resolve, reject) => {
    const zip = new Zip((err, chunk, final) => {
      if (err) reject(err)
      else {
        if (chunk) chunks.push(chunk)
        if (final) resolve()
      }
    })
    const enc = new TextEncoder()
    const add = (name: string, text: string) => {
      const f = new ZipDeflate(name)
      zip.add(f)
      f.push(enc.encode(text), true)
    }
    add('project.json', JSON.stringify(project))
    add('animation-presets.json', rawPresets)
    add('manifest.json', JSON.stringify(manifest))
    zip.end()
  })

  const total = chunks.reduce((acc, c) => acc + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return fileFromBytes(out)
}
