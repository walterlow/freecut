import { describe, expect, it, vi } from 'vite-plus/test'

import { recoverDevVitePreload } from './vite-preload-recovery'

describe('recoverDevVitePreload', () => {
  it('reloads after the project saves successfully', async () => {
    const reload = vi.fn()
    const onSaveFailure = vi.fn()

    await expect(
      recoverDevVitePreload({
        save: async () => true,
        reload,
        onSaveFailure,
      }),
    ).resolves.toBe(true)
    expect(reload).toHaveBeenCalledOnce()
    expect(onSaveFailure).not.toHaveBeenCalled()
  })

  it('reports a save failure without navigating', async () => {
    const reload = vi.fn()
    const onSaveFailure = vi.fn()

    await expect(
      recoverDevVitePreload({
        save: async () => false,
        reload,
        onSaveFailure,
      }),
    ).resolves.toBe(false)
    expect(reload).not.toHaveBeenCalled()
    expect(onSaveFailure).toHaveBeenCalledOnce()
  })
})
