import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createMediabunnyInputSource } from './mediabunny-input-source'
import { clearObjectUrlRegistry, registerObjectUrl } from './object-url-registry'

class MockBlobSource {
  constructor(public readonly blob: Blob) {}
}

class MockStreamSource {
  constructor(
    public readonly options: {
      getSize: () => Promise<number> | number
      read: (
        start: number,
        end: number,
      ) =>
        | Promise<Uint8Array | ReadableStream<Uint8Array>>
        | Uint8Array
        | ReadableStream<Uint8Array>
      prefetchProfile?: 'none' | 'fileSystem' | 'network'
    },
  ) {}
}

class MockUrlSource {
  constructor(public readonly url: string) {}
}

const mockMediabunny = {
  BlobSource: MockBlobSource,
  StreamSource: MockStreamSource,
  UrlSource: MockUrlSource,
} as unknown as typeof import('mediabunny')

function createMockBlob(text: string): Blob {
  const bytes = new TextEncoder().encode(text)
  return {
    size: bytes.length,
    slice: (start?: number, end?: number) => {
      const chunk = bytes.slice(start ?? 0, end ?? bytes.length)
      return {
        arrayBuffer: async () =>
          chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength),
      }
    },
  } as unknown as Blob
}

async function readChunkText(chunk: Uint8Array | ReadableStream<Uint8Array>): Promise<string> {
  if (chunk instanceof Uint8Array) {
    return new TextDecoder().decode(chunk)
  }
  return new Response(chunk).text()
}

beforeEach(() => {
  clearObjectUrlRegistry()
  vi.unstubAllGlobals()
})

describe('createMediabunnyInputSource', () => {
  it('prefers direct file access for registered file handles', async () => {
    const file = createMockBlob('abcdef')
    const fileHandle = {
      getFile: vi.fn().mockResolvedValue(file),
    } as unknown as FileSystemFileHandle

    registerObjectUrl('blob:file-handle', new Blob(['fallback']), {
      storageType: 'handle',
      fileHandle,
      fileSize: file.size,
    })

    const source = createMediabunnyInputSource(mockMediabunny, 'blob:file-handle')
    expect(source).toBeInstanceOf(MockStreamSource)

    const streamSource = source as unknown as MockStreamSource
    expect(await streamSource.options.getSize()).toBe(file.size)
    expect(streamSource.options.prefetchProfile).toBe('fileSystem')

    const chunk = await streamSource.options.read(1, 4)
    const text = await readChunkText(chunk as Uint8Array | ReadableStream<Uint8Array>)
    expect(text).toBe('bcd')
    expect(fileHandle.getFile).toHaveBeenCalledTimes(1)
  })

  it('resolves OPFS paths through navigator.storage and reads ranges', async () => {
    const file = createMockBlob('hello world')
    const getDirectoryHandle = vi.fn()
    const getFileHandle = vi.fn().mockResolvedValue({
      getFile: vi.fn().mockResolvedValue(file),
    })

    getDirectoryHandle
      .mockResolvedValueOnce({
        getDirectoryHandle,
        getFileHandle,
      })
      .mockResolvedValueOnce({
        getDirectoryHandle,
        getFileHandle,
      })

    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: vi.fn().mockResolvedValue({
          getDirectoryHandle,
        }),
      },
    })

    registerObjectUrl('blob:opfs', new Blob(['fallback']), {
      storageType: 'opfs',
      opfsPath: 'content/aa/proxy.mp4',
      fileSize: file.size,
    })

    const source = createMediabunnyInputSource(mockMediabunny, 'blob:opfs')
    expect(source).toBeInstanceOf(MockStreamSource)

    const streamSource = source as unknown as MockStreamSource
    const chunk = await streamSource.options.read(6, 11)
    const text = await readChunkText(chunk as Uint8Array | ReadableStream<Uint8Array>)
    expect(text).toBe('world')
  })

  it('falls back to BlobSource for registered blobs without direct file metadata', () => {
    const blob = new Blob(['blob-data'])
    registerObjectUrl('blob:memory', blob)

    const source = createMediabunnyInputSource(mockMediabunny, 'blob:memory')
    expect(source).toBeInstanceOf(MockBlobSource)
    expect((source as unknown as MockBlobSource).blob).toBe(blob)
  })

  it('falls back to UrlSource for unregistered URLs', () => {
    const source = createMediabunnyInputSource(mockMediabunny, 'https://example.com/video.mp4')
    expect(source).toBeInstanceOf(MockUrlSource)
    expect((source as unknown as MockUrlSource).url).toBe('https://example.com/video.mp4')
  })
})
