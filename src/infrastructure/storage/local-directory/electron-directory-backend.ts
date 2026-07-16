import type {
  ElectronDirectoryGrant,
  ElectronLocalDirectoryBridge,
  LocalDirectoryBackend,
  LocalDirectoryChangeEvent,
  LocalDirectoryEntry,
  LocalDirectoryPath,
  ImportedLocalFile,
  LocalFileStat,
  LocalReadUrl,
} from './types'

export class ElectronDirectoryBackend implements LocalDirectoryBackend {
  readonly kind = 'electron-directory' as const
  readonly grantId: string
  readonly name: string
  readonly #bridge: ElectronLocalDirectoryBridge

  constructor(bridge: ElectronLocalDirectoryBridge, grant: ElectronDirectoryGrant) {
    this.#bridge = bridge
    this.grantId = grant.grantId
    this.name = grant.name
  }

  async readFile(path: LocalDirectoryPath): Promise<Blob | null> {
    const result = await this.#bridge.readFile({ grantId: this.grantId, path })
    return result ? new Blob([result.data.slice().buffer as ArrayBuffer]) : null
  }

  getReadUrl(path: LocalDirectoryPath): Promise<LocalReadUrl> {
    return this.#bridge.createReadUrl({ grantId: this.grantId, path })
  }

  writeFile(
    path: LocalDirectoryPath,
    data: Blob | ArrayBuffer | Uint8Array | string,
  ): Promise<LocalFileStat> {
    return this.writeFileAtomic(path, data)
  }

  async writeFileAtomic(
    path: LocalDirectoryPath,
    data: Blob | ArrayBuffer | Uint8Array | string,
    options: { expectedEtag?: string } = {},
  ): Promise<LocalFileStat> {
    const serialized =
      typeof data === 'string'
        ? data
        : data instanceof Blob
          ? new Uint8Array(await data.arrayBuffer())
          : data instanceof Uint8Array
            ? data
            : new Uint8Array(data)
    return this.#bridge.writeFileAtomic({
      grantId: this.grantId,
      path,
      data: serialized,
      ...(options.expectedEtag ? { expectedEtag: options.expectedEtag } : {}),
    })
  }

  listDirectory(path: LocalDirectoryPath): Promise<LocalDirectoryEntry[]> {
    return this.#bridge.listDirectory({ grantId: this.grantId, path })
  }

  createDirectory(path: LocalDirectoryPath): Promise<void> {
    return this.#bridge.createDirectory({ grantId: this.grantId, path })
  }

  exists(path: LocalDirectoryPath): Promise<boolean> {
    return this.#bridge.exists({ grantId: this.grantId, path })
  }

  stat(path: LocalDirectoryPath): Promise<LocalFileStat | null> {
    return this.#bridge.stat({ grantId: this.grantId, path })
  }

  move(from: LocalDirectoryPath, to: LocalDirectoryPath): Promise<void> {
    return this.#bridge.move({ grantId: this.grantId, from, to })
  }

  remove(path: LocalDirectoryPath, options: { recursive?: boolean } = {}): Promise<void> {
    return this.#bridge.remove({
      grantId: this.grantId,
      path,
      ...(options.recursive === undefined ? {} : { recursive: options.recursive }),
    })
  }

  selectAndCopyFiles(destination: LocalDirectoryPath): Promise<ImportedLocalFile[]> {
    return this.#bridge.selectAndCopyFiles({ grantId: this.grantId, destination })
  }

  subscribe(listener: (event: LocalDirectoryChangeEvent) => void): () => void {
    return this.#bridge.onDidChange((event) => {
      if (event.grantId === this.grantId) listener(event)
    })
  }
}

export function getElectronLocalDirectoryBridge(): ElectronLocalDirectoryBridge | null {
  if (typeof window === 'undefined') return null
  const bridge = window.electronLocalDirectory
  return bridge?.runtime === 'electron' && bridge.version === 1 ? bridge : null
}
