// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'

vi.mock('@/shared/logging/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    event: vi.fn(),
    startEvent: () => ({ set: vi.fn(), merge: vi.fn(), success: vi.fn(), failure: vi.fn() }),
    child: vi.fn(),
    setLevel: vi.fn(),
  }),
  createOperationId: () => 'op-test',
}))

import { bootstrapWorkspace } from './bootstrap'
import { asHandle, createRoot, readFileText } from './__tests__/in-memory-handle'

async function writeRawText(
  root: ReturnType<typeof createRoot>,
  segments: string[],
  text: string,
): Promise<void> {
  let directory = root
  for (const segment of segments.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(segment, { create: true })
  }
  const handle = await directory.getFileHandle(segments.at(-1)!, { create: true })
  const writable = await handle.createWritable()
  await writable.write(text)
  await writable.close()
}

describe('bootstrapWorkspace atomic recovery', () => {
  it('replays a complete tmp journal before reading workspace metadata', async () => {
    const root = createRoot('workspace', 'NotSupportedError')
    await writeRawText(root, ['.freecut-workspace.json'], '{broken')
    await writeRawText(
      root,
      ['.freecut-workspace.json.tmp'],
      JSON.stringify({ schemaVersion: '2.0', createdAt: 1 }),
    )
    await writeRawText(root, ['projects', 'p1', 'project.json'], '{partial')
    await writeRawText(
      root,
      ['projects', 'p1', 'project.json.tmp'],
      JSON.stringify({ id: 'p1', name: 'Recovered' }),
    )

    await bootstrapWorkspace(asHandle(root))

    expect(await readFileText(root, '.freecut-workspace.json')).toContain('"schemaVersion":"2.0"')
    expect(await readFileText(root, '.freecut-workspace.json.tmp')).toBeNull()
    expect(await readFileText(root, 'projects', 'p1', 'project.json')).toContain(
      '"name":"Recovered"',
    )
    expect(await readFileText(root, 'projects', 'p1', 'project.json.tmp')).toBeNull()
  })
})
