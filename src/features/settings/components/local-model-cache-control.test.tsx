import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { LocalModelCacheControl } from './local-model-cache-control'

const mocks = vi.hoisted(() => ({
  inspectAllLocalModelCaches: vi.fn(),
  clearLocalModelCache: vi.fn(),
  supportsLocalModelCacheInspection: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/shared/utils/local-model-cache', () => ({
  inspectAllLocalModelCaches: mocks.inspectAllLocalModelCaches,
  clearLocalModelCache: mocks.clearLocalModelCache,
  supportsLocalModelCacheInspection: mocks.supportsLocalModelCacheInspection,
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

vi.mock('@/shared/logging/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}))

describe('LocalModelCacheControl', () => {
  beforeEach(() => {
    mocks.supportsLocalModelCacheInspection.mockReturnValue(true)
    mocks.clearLocalModelCache.mockResolvedValue(true)
    mocks.inspectAllLocalModelCaches.mockResolvedValue([
      {
        id: 'whisper',
        label: 'Whisper',
        description: 'Whisper ONNX model files and tokenizers.',
        cacheName: 'transformers-cache',
        supported: true,
        exists: true,
        downloaded: true,
        entryCount: 2,
        totalBytes: 12 * 1024 * 1024,
        sizeStatus: 'partial',
        inspectionState: 'ready',
      },
    ])
  })

  it('exits checking state after async inspection in StrictMode and displays cache data', async () => {
    render(
      <StrictMode>
        <LocalModelCacheControl />
      </StrictMode>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
    })

    expect(screen.getByText('Whisper')).toBeInTheDocument()
    expect(screen.getByText('Approx. 12.0 MB')).toBeInTheDocument()
  })
})
