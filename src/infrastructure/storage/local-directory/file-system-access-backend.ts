import type {
  LocalDirectoryBackend,
  LocalDirectoryChangeEvent,
  LocalDirectoryEntry,
  LocalDirectoryPath,
  ImportedLocalFile,
  LocalFileStat,
  LocalReadUrl,
} from './types'

type MovableHandle = FileSystemFileHandle & {
  move?: (parent: FileSystemDirectoryHandle, newName: string) => Promise<void>
}

const rootsRejectingMove = new WeakSet<FileSystemDirectoryHandle>()

export class FileSystemAccessDirectoryBackend implements LocalDirectoryBackend {
  readonly kind = 'file-system-access' as const
  readonly grantId: string
  readonly name: string
  readonly #root: FileSystemDirectoryHandle

  constructor(root: FileSystemDirectoryHandle) {
    this.#root = root
    this.name = root.name
    this.grantId = `fsa:${root.name}`
  }

  async readFile(path: LocalDirectoryPath): Promise<Blob | null> {
    try {
      const { parent, fileName } = await this.#resolveFileParent(path, false)
      const handle = await parent.getFileHandle(fileName, { create: false })
      return await handle.getFile()
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async getReadUrl(path: LocalDirectoryPath): Promise<LocalReadUrl> {
    const blob = await this.readFile(path)
    if (!blob) throw new DOMException('File not found', 'NotFoundError')
    return {
      url: URL.createObjectURL(blob),
      expiresAt: Number.MAX_SAFE_INTEGER,
      stat: fileStat(blob),
    }
  }

  async writeFile(
    path: LocalDirectoryPath,
    data: Blob | ArrayBuffer | Uint8Array | string,
  ): Promise<LocalFileStat> {
    const { parent, fileName } = await this.#resolveFileParent(path, true)
    const handle = await parent.getFileHandle(fileName, { create: true })
    const writable = await handle.createWritable()
    await writable.write(data as FileSystemWriteChunkType)
    await writable.close()
    return fileStat(await handle.getFile())
  }

  async writeFileAtomic(
    path: LocalDirectoryPath,
    data: Blob | ArrayBuffer | Uint8Array | string,
    options: { expectedEtag?: string } = {},
  ): Promise<LocalFileStat> {
    const { parent, fileName } = await this.#resolveFileParent(path, true)
    if (options.expectedEtag) {
      const current = await this.stat(path)
      if (!current || current.etag !== options.expectedEtag) {
        throw new Error('LOCAL_DIRECTORY_ETAG_CONFLICT')
      }
    }
    const tmpName = `${fileName}.tmp`
    const tmpHandle = await parent.getFileHandle(tmpName, { create: true })
    const writable = await tmpHandle.createWritable()
    await writable.write(data as FileSystemWriteChunkType)
    await writable.close()

    const movable = tmpHandle as MovableHandle
    if (!rootsRejectingMove.has(this.#root) && typeof movable.move === 'function') {
      try {
        await movable.move(parent, fileName)
        const target = await parent.getFileHandle(fileName)
        return fileStat(await target.getFile())
      } catch (error) {
        if (!isNotSupported(error)) throw error
        rootsRejectingMove.add(this.#root)
      }
    }

    // The completed tmp file is the recovery journal for filesystems that
    // cannot rename. Copy from those staged bytes and only remove the journal
    // after the live target has closed successfully. If the page or browser
    // dies mid-copy, bootstrap will replay the still-complete tmp file.
    const staged = await tmpHandle.getFile()
    const target = await parent.getFileHandle(fileName, { create: true })
    const targetWritable = await target.createWritable()
    await targetWritable.write(staged)
    await targetWritable.close()
    await parent.removeEntry(tmpName).catch((error) => {
      if (!isNotFound(error)) throw error
    })
    return fileStat(await target.getFile())
  }

  async listDirectory(path: LocalDirectoryPath): Promise<LocalDirectoryEntry[]> {
    try {
      const directory = await this.#resolveDirectory(path, false)
      const entries: LocalDirectoryEntry[] = []
      for await (const entry of directory.values()) {
        entries.push({ name: entry.name, kind: entry.kind })
      }
      return entries
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
  }

  async createDirectory(path: LocalDirectoryPath): Promise<void> {
    await this.#resolveDirectory(path, true)
  }

  async exists(path: LocalDirectoryPath): Promise<boolean> {
    if (path.length === 0) return true
    try {
      const { parent, fileName } = await this.#resolveFileParent(path, false)
      try {
        await parent.getFileHandle(fileName, { create: false })
        return true
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
      try {
        await parent.getDirectoryHandle(fileName, { create: false })
        return true
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
      return false
    } catch (error) {
      if (isNotFound(error)) return false
      throw error
    }
  }

  async stat(path: LocalDirectoryPath): Promise<LocalFileStat | null> {
    if (path.length === 0) {
      return { kind: 'directory', size: 0, modifiedAt: 0, etag: 'directory-root' }
    }
    try {
      const { parent, fileName } = await this.#resolveFileParent(path, false)
      try {
        const handle = await parent.getFileHandle(fileName, { create: false })
        return fileStat(await handle.getFile())
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
      try {
        await parent.getDirectoryHandle(fileName, { create: false })
        return { kind: 'directory', size: 0, modifiedAt: 0, etag: `directory:${path.join('/')}` }
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
      return null
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async move(from: LocalDirectoryPath, to: LocalDirectoryPath): Promise<void> {
    const blob = await this.readFile(from)
    if (!blob) return
    await this.writeFileAtomic(to, blob)
    await this.remove(from)
  }

  async remove(path: LocalDirectoryPath, options: { recursive?: boolean } = {}): Promise<void> {
    if (path.length === 0) throw new Error('refusing to remove directory root')
    try {
      const { parent, fileName } = await this.#resolveFileParent(path, false)
      await parent.removeEntry(fileName, { recursive: options.recursive ?? false })
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
  }

  async selectAndCopyFiles(destination: LocalDirectoryPath): Promise<ImportedLocalFile[]> {
    const handles = await window.showOpenFilePicker({ multiple: true })
    const imported: ImportedLocalFile[] = []
    for (const handle of handles) {
      const file = await handle.getFile()
      const target = [...destination, file.name]
      imported.push({
        name: file.name,
        path: target,
        stat: await this.writeFileAtomic(target, file),
      })
    }
    return imported
  }

  subscribe(_listener: (event: LocalDirectoryChangeEvent) => void): () => void {
    return () => undefined
  }

  async #resolveDirectory(
    path: LocalDirectoryPath,
    create: boolean,
  ): Promise<FileSystemDirectoryHandle> {
    let directory = this.#root
    for (const segment of path) {
      directory = await directory.getDirectoryHandle(segment, { create })
    }
    return directory
  }

  async #resolveFileParent(
    path: LocalDirectoryPath,
    create: boolean,
  ): Promise<{ parent: FileSystemDirectoryHandle; fileName: string }> {
    if (path.length === 0) throw new Error('local directory file path is empty')
    return {
      parent: await this.#resolveDirectory(path.slice(0, -1), create),
      fileName: path.at(-1)!,
    }
  }
}

function fileStat(file: File | Blob): LocalFileStat {
  const modifiedAt = file instanceof File ? file.lastModified : 0
  return {
    kind: 'file',
    size: file.size,
    modifiedAt,
    etag: `${file.size}-${Math.trunc(modifiedAt)}`,
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError'
}

function isNotSupported(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotSupportedError'
}
