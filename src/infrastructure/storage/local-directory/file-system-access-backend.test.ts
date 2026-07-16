// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  asHandle,
  createRoot,
  readFileText,
} from '@/infrastructure/storage/workspace-fs/__tests__/in-memory-handle'
import { FileSystemAccessDirectoryBackend } from './file-system-access-backend'

describe('FileSystemAccessDirectoryBackend', () => {
  it('serializes the ETag check and replacement for the same path', async () => {
    const root = createRoot()
    const backend = new FileSystemAccessDirectoryBackend(asHandle(root))
    const initial = await backend.writeFileAtomic(['project.json'], 'initial')

    const results = await Promise.allSettled([
      backend.writeFileAtomic(['project.json'], 'first', { expectedEtag: initial.etag }),
      backend.writeFileAtomic(['project.json'], 'second', { expectedEtag: initial.etag }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(await readFileText(root, 'project.json')).toBe('first')
  })

  it('does not overwrite or delete a pre-existing filename.tmp sibling', async () => {
    const root = createRoot()
    const backend = new FileSystemAccessDirectoryBackend(asHandle(root))
    await backend.writeFile(['project.json.tmp'], 'user file')

    await backend.writeFileAtomic(['project.json'], 'project')

    expect(await readFileText(root, 'project.json')).toBe('project')
    expect(await readFileText(root, 'project.json.tmp')).toBe('user file')
  })

  it('throws NotFoundError when a move source is missing', async () => {
    const backend = new FileSystemAccessDirectoryBackend(asHandle(createRoot()))

    await expect(backend.move(['missing'], ['target'])).rejects.toMatchObject({
      name: 'NotFoundError',
    })
  })
})
