export type LocalDirectoryPath = readonly string[]
export type LocalDirectoryKind = 'file-system-access' | 'electron-directory'

export interface LocalDirectoryEntry {
  name: string
  kind: 'file' | 'directory'
}

export interface LocalFileStat {
  kind: 'file' | 'directory'
  size: number
  modifiedAt: number
  etag: string
}

export interface LocalReadUrl {
  url: string
  expiresAt: number
  stat: LocalFileStat
}

export interface ImportedLocalFile {
  name: string
  path: LocalDirectoryPath
  stat: LocalFileStat
}

export interface LocalDirectoryChangeEvent {
  grantId: string
  eventId: string
  kind: 'created' | 'modified' | 'removed' | 'renamed'
  paths: LocalDirectoryPath[]
  timestamp: number
  writerId?: string
}

export interface LocalDirectoryBackend {
  readonly kind: LocalDirectoryKind
  readonly grantId: string
  readonly name: string

  readFile(path: LocalDirectoryPath): Promise<Blob | null>
  getReadUrl(path: LocalDirectoryPath): Promise<LocalReadUrl>
  writeFile(
    path: LocalDirectoryPath,
    data: Blob | ArrayBuffer | Uint8Array | string,
  ): Promise<LocalFileStat>
  writeFileAtomic(
    path: LocalDirectoryPath,
    data: Blob | ArrayBuffer | Uint8Array | string,
    options?: { expectedEtag?: string },
  ): Promise<LocalFileStat>
  listDirectory(path: LocalDirectoryPath): Promise<LocalDirectoryEntry[]>
  createDirectory(path: LocalDirectoryPath): Promise<void>
  exists(path: LocalDirectoryPath): Promise<boolean>
  stat(path: LocalDirectoryPath): Promise<LocalFileStat | null>
  move(from: LocalDirectoryPath, to: LocalDirectoryPath): Promise<void>
  remove(path: LocalDirectoryPath, options?: { recursive?: boolean }): Promise<void>
  selectAndCopyFiles(destination: LocalDirectoryPath): Promise<ImportedLocalFile[]>
  subscribe(listener: (event: LocalDirectoryChangeEvent) => void): () => void
}

export interface ElectronDirectoryGrant {
  grantId: string
  name: string
  mode: 'read' | 'readwrite'
  capabilities: {
    atomicWrite: true
    readUrl: true
    watch: true
  }
}

export interface ElectronLocalDirectoryBridge {
  readonly runtime: 'electron'
  readonly version: 1
  pickDirectory(input?: { mode?: 'read' | 'readwrite' }): Promise<ElectronDirectoryGrant | null>
  restoreGrant(grantId: string): Promise<ElectronDirectoryGrant | null>
  listGrants(): Promise<Array<ElectronDirectoryGrant & { lastUsedAt: number }>>
  revokeGrant(grantId: string): Promise<void>
  readFile(input: {
    grantId: string
    path: LocalDirectoryPath
  }): Promise<{ data: Uint8Array; stat: LocalFileStat } | null>
  createReadUrl(input: { grantId: string; path: LocalDirectoryPath }): Promise<LocalReadUrl>
  writeFileAtomic(input: {
    grantId: string
    path: LocalDirectoryPath
    data: string | Uint8Array
    expectedEtag?: string
  }): Promise<LocalFileStat>
  listDirectory(input: {
    grantId: string
    path: LocalDirectoryPath
  }): Promise<LocalDirectoryEntry[]>
  createDirectory(input: { grantId: string; path: LocalDirectoryPath }): Promise<void>
  exists(input: { grantId: string; path: LocalDirectoryPath }): Promise<boolean>
  stat(input: { grantId: string; path: LocalDirectoryPath }): Promise<LocalFileStat | null>
  move(input: { grantId: string; from: LocalDirectoryPath; to: LocalDirectoryPath }): Promise<void>
  remove(input: { grantId: string; path: LocalDirectoryPath; recursive?: boolean }): Promise<void>
  selectAndCopyFiles(input: {
    grantId: string
    destination: LocalDirectoryPath
  }): Promise<ImportedLocalFile[]>
  onDidChange(listener: (event: LocalDirectoryChangeEvent) => void): () => void
}
