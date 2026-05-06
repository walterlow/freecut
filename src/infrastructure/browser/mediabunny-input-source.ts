import {
  getObjectUrlBlob,
  getObjectUrlSourceMetadata,
  type ObjectUrlSourceMetadata,
} from './object-url-registry'

type MediabunnyModule = typeof import('mediabunny')

interface MediabunnyInputSourceOptions {
  metadata?: ObjectUrlSourceMetadata | null
  fallbackBlob?: Blob | null
}

type MediabunnyInputSource =
  | InstanceType<MediabunnyModule['BlobSource']>
  | InstanceType<MediabunnyModule['StreamSource']>
  | InstanceType<MediabunnyModule['UrlSource']>

function canUseDirectFileAccess(
  metadata: ObjectUrlSourceMetadata | null,
): metadata is ObjectUrlSourceMetadata &
  ({ fileHandle: FileSystemFileHandle } | { opfsPath: string }) {
  if (!metadata) {
    return false
  }

  return Boolean(metadata.fileHandle || metadata.opfsPath)
}

async function getOpfsFileHandle(path: string): Promise<FileSystemFileHandle> {
  const root = await navigator.storage.getDirectory()
  const parts = path.split('/').filter((part) => part)

  if (parts.length === 0) {
    throw new Error('Invalid OPFS path')
  }

  let dir = root
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index]
    if (!part) {
      continue
    }
    dir = await dir.getDirectoryHandle(part)
  }

  const fileName = parts[parts.length - 1]
  if (!fileName) {
    throw new Error('Invalid OPFS path: missing filename')
  }

  return dir.getFileHandle(fileName)
}

function createBrowserFileStreamSource(
  mb: MediabunnyModule,
  metadata: ObjectUrlSourceMetadata & ({ fileHandle: FileSystemFileHandle } | { opfsPath: string }),
  fallbackBlob?: Blob | null,
): InstanceType<MediabunnyModule['StreamSource']> {
  let filePromise: Promise<Blob> | null = null

  const loadFile = async (): Promise<Blob> => {
    if (!filePromise) {
      filePromise = (async () => {
        if (metadata.fileHandle) {
          return metadata.fileHandle.getFile()
        }

        if (metadata.opfsPath) {
          const handle = await getOpfsFileHandle(metadata.opfsPath)
          return handle.getFile()
        }

        throw new Error('Missing file-backed source metadata')
      })()
    }

    try {
      return await filePromise
    } catch (error) {
      if (fallbackBlob) {
        return fallbackBlob
      }
      throw error
    }
  }

  return new mb.StreamSource({
    getSize: async () => metadata.fileSize ?? (await loadFile()).size,
    read: async (start, end) => {
      const slice = (await loadFile()).slice(start, end)
      if ('stream' in slice && typeof slice.stream === 'function') {
        return slice.stream() as ReadableStream<Uint8Array>
      }
      return new Uint8Array(await slice.arrayBuffer())
    },
    prefetchProfile: 'fileSystem',
  })
}

export function createMediabunnyInputSource(
  mb: MediabunnyModule,
  src: string | Blob,
  options: MediabunnyInputSourceOptions = {},
): MediabunnyInputSource {
  if (src instanceof Blob) {
    return new mb.BlobSource(src)
  }

  const registeredBlob = options.fallbackBlob ?? getObjectUrlBlob(src)
  const metadata = options.metadata ?? getObjectUrlSourceMetadata(src)

  if (canUseDirectFileAccess(metadata)) {
    return createBrowserFileStreamSource(mb, metadata, registeredBlob)
  }

  if (registeredBlob) {
    return new mb.BlobSource(registeredBlob)
  }

  return new mb.UrlSource(src)
}
