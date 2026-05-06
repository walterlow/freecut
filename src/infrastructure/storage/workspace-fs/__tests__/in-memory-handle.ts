/**
 * In-memory FileSystemDirectoryHandle / FileSystemFileHandle / FileSystemWritableFileStream
 * implementation for unit tests in workspace-fs.
 *
 * Covers the subset the storage modules use:
 *  - getDirectoryHandle({ create })
 *  - getFileHandle({ create })
 *  - values() async iterator yielding { name, kind }
 *  - removeEntry(name, { recursive })
 *  - file.getFile() returning Blob-like with text() + arrayBuffer()
 *  - writable.write(string | ArrayBuffer | Uint8Array | Blob) / close()
 */

type Bytes = Uint8Array

class MemFile {
  kind = 'file' as const
  constructor(
    public name: string,
    public data: Bytes = new Uint8Array(),
  ) {}
}

export class MemDir {
  kind = 'directory' as const
  private entries: Map<string, MemDir | MemFile> = new Map()
  constructor(public name: string) {}

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<MemDir> {
    const existing = this.entries.get(name)
    if (existing) {
      if (existing.kind !== 'directory') {
        throw new DOMException('TypeMismatchError', 'TypeMismatchError')
      }
      return existing as MemDir
    }
    if (!options.create) {
      throw new DOMException('Not found', 'NotFoundError')
    }
    const dir = new MemDir(name)
    this.entries.set(name, dir)
    return dir
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<MemFileHandle> {
    const existing = this.entries.get(name)
    if (existing) {
      if (existing.kind !== 'file') {
        throw new DOMException('TypeMismatchError', 'TypeMismatchError')
      }
      return new MemFileHandle(existing as MemFile, this)
    }
    if (!options.create) {
      throw new DOMException('Not found', 'NotFoundError')
    }
    const file = new MemFile(name)
    this.entries.set(name, file)
    return new MemFileHandle(file, this)
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.entries.has(name)) {
      throw new DOMException('Not found', 'NotFoundError')
    }
    this.entries.delete(name)
  }

  async *values(): AsyncIterableIterator<{ name: string; kind: 'file' | 'directory' }> {
    for (const entry of this.entries.values()) {
      if (entry.kind === 'directory') {
        yield entry as MemDir
      } else {
        const file = entry as MemFile
        yield { name: file.name, kind: 'file' }
      }
    }
  }

  /** Test helper: internal rename support for move() */
  __rename(oldName: string, newName: string): void {
    const entry = this.entries.get(oldName)
    if (!entry) return
    this.entries.delete(oldName)
    if (entry instanceof MemDir) {
      entry.name = newName
    } else {
      ;(entry as MemFile).name = newName
    }
    this.entries.set(newName, entry)
  }
}

export class MemFileHandle {
  kind = 'file' as const

  constructor(
    private file: MemFile,
    private parent: MemDir,
  ) {}

  get name(): string {
    return this.file.name
  }

  async createWritable(): Promise<MemWritable> {
    return new MemWritable(this.file)
  }

  async getFile(): Promise<BlobLike> {
    const data = this.file.data
    return {
      size: data.byteLength,
      async text() {
        return new TextDecoder().decode(data)
      },
      async arrayBuffer() {
        const copy = new ArrayBuffer(data.byteLength)
        new Uint8Array(copy).set(data)
        return copy
      },
    }
  }

  /** Chromium-only move() — exercises the atomic-write happy path in tests. */
  async move(newParent: MemDir, newName: string): Promise<void> {
    if (newParent !== this.parent) {
      throw new Error('Cross-parent move not supported in mock')
    }
    this.parent.__rename(this.file.name, newName)
  }
}

interface BlobLike {
  size: number
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}

export class MemWritable {
  private chunks: Bytes[] = []

  constructor(private file: MemFile) {}

  async write(data: unknown): Promise<void> {
    if (typeof data === 'string') {
      this.chunks.push(new TextEncoder().encode(data))
      return
    }
    if (data instanceof Uint8Array) {
      this.chunks.push(data)
      return
    }
    if (data instanceof ArrayBuffer) {
      this.chunks.push(new Uint8Array(data))
      return
    }
    // Blob-like: prefer arrayBuffer(), fall back to text() for jsdom quirks.
    const blobLike = data as {
      arrayBuffer?: () => Promise<ArrayBuffer>
      text?: () => Promise<string>
    }
    if (typeof blobLike.arrayBuffer === 'function') {
      const buf = await blobLike.arrayBuffer()
      this.chunks.push(new Uint8Array(buf))
      return
    }
    if (typeof blobLike.text === 'function') {
      this.chunks.push(new TextEncoder().encode(await blobLike.text()))
      return
    }
    throw new TypeError('MemWritable.write: unsupported data type')
  }

  async close(): Promise<void> {
    const total = this.chunks.reduce((sum, c) => sum + c.byteLength, 0)
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of this.chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    this.file.data = merged
  }
}

export function createRoot(name = 'workspace'): MemDir {
  return new MemDir(name)
}

/** Cast a MemDir to FileSystemDirectoryHandle. The mock is API-compatible. */
export function asHandle(dir: MemDir): FileSystemDirectoryHandle {
  return dir as unknown as FileSystemDirectoryHandle
}

/** Read a file's text from the in-memory tree. Null if missing. */
export async function readFileText(root: MemDir, ...segments: string[]): Promise<string | null> {
  let dir = root
  for (let i = 0; i < segments.length - 1; i++) {
    try {
      dir = await dir.getDirectoryHandle(segments[i]!)
    } catch {
      return null
    }
  }
  try {
    const fh = await dir.getFileHandle(segments[segments.length - 1]!)
    return (await fh.getFile()).text()
  } catch {
    return null
  }
}
