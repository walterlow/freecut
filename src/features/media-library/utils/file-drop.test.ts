import { describe, expect, it, vi } from 'vite-plus/test'
import {
  extractValidMediaFileEntriesFromDataTransfer,
  formatMediaDropRejectionMessage,
} from './file-drop'

function makeItem(handle: FileSystemHandle | null): DataTransferItem {
  return {
    getAsFileSystemHandle: vi.fn().mockResolvedValue(handle),
  } as unknown as DataTransferItem
}

describe('extractValidMediaFileEntriesFromDataTransfer', () => {
  it('reports dropped folders instead of silently ignoring them', async () => {
    const directoryHandle = {
      kind: 'directory',
      name: 'Media Folder',
    } as unknown as FileSystemDirectoryHandle
    const dataTransfer = {
      items: [makeItem(directoryHandle)],
    } as unknown as DataTransfer

    const result = await extractValidMediaFileEntriesFromDataTransfer(dataTransfer)

    expect(result.supported).toBe(true)
    expect(result.entries).toEqual([])
    expect(result.errors).toEqual([
      'Media Folder: folders are not supported yet. Drop media files directly.',
    ])
  })
})

describe('formatMediaDropRejectionMessage', () => {
  it('summarizes rejected drops with examples and an overflow count', () => {
    expect(
      formatMediaDropRejectionMessage([
        'folder: folders are not supported yet. Drop media files directly.',
        'notes.txt: Unsupported file type',
        'archive.zip: Unsupported file type',
        'broken.mp4: Unable to read file',
      ]),
    ).toBe(
      '4 dropped items were rejected: folder: folders are not supported yet. Drop media files directly.; notes.txt: Unsupported file type; archive.zip: Unsupported file type; and 1 more.',
    )
  })
})
