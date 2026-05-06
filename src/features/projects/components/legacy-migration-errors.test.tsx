import { describe, it, expect, beforeEach, vi } from 'vite-plus/test'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { LegacyMigrationErrors } from './legacy-migration-errors'
import type { MigrationReport } from '@/infrastructure/storage/legacy-idb'

const getMigrationErrorsMock = vi.fn()
const migrateFromLegacyIDBMock = vi.fn()

vi.mock('@/infrastructure/storage/legacy-idb', () => ({
  getMigrationErrors: (...args: unknown[]) => getMigrationErrorsMock(...args),
  migrateFromLegacyIDB: (...args: unknown[]) => migrateFromLegacyIDBMock(...args),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function emptyReport(overrides: Partial<MigrationReport> = {}): MigrationReport {
  return {
    projects: 0,
    media: 0,
    thumbnails: 0,
    associations: 0,
    transcripts: 0,
    gifFrames: 0,
    waveformRecords: 0,
    decodedAudioRecords: 0,
    errors: [],
    durationMs: 0,
    ...overrides,
  }
}

describe('LegacyMigrationErrors', () => {
  it('renders nothing when there are no persisted errors', async () => {
    getMigrationErrorsMock.mockResolvedValue([])
    const { container } = render(<LegacyMigrationErrors />)
    await waitFor(() => {
      expect(container).toBeEmptyDOMElement()
    })
  })

  it('shows a grouped count when persisted errors exist', async () => {
    getMigrationErrorsMock.mockResolvedValue([
      { store: 'media', id: 'm1', error: 'boom' },
      { store: 'media', id: 'm2', error: 'boom' },
      { store: 'thumbnails', id: 't1', error: 'boom' },
    ])

    render(<LegacyMigrationErrors />)

    expect(await screen.findByText('3 items failed to migrate')).toBeInTheDocument()
    expect(screen.getByText(/2 media, 1 thumbnails/i)).toBeInTheDocument()
  })

  it('singular "item" when only one failure', async () => {
    getMigrationErrorsMock.mockResolvedValue([{ store: 'media', id: 'm1', error: 'boom' }])
    render(<LegacyMigrationErrors />)
    expect(await screen.findByText('1 item failed to migrate')).toBeInTheDocument()
  })

  it('retry success clears the banner', async () => {
    getMigrationErrorsMock.mockResolvedValue([{ store: 'media', id: 'm1', error: 'boom' }])
    migrateFromLegacyIDBMock.mockResolvedValue(emptyReport())

    const { container } = render(<LegacyMigrationErrors />)
    await screen.findByText('1 item failed to migrate')

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement()
    })
    expect(migrateFromLegacyIDBMock).toHaveBeenCalledTimes(1)
  })

  it('retry with remaining failures updates the grouped count in place', async () => {
    getMigrationErrorsMock.mockResolvedValue([
      { store: 'media', id: 'm1', error: 'first-boom' },
      { store: 'media', id: 'm2', error: 'first-boom' },
    ])
    migrateFromLegacyIDBMock.mockResolvedValue(
      emptyReport({
        errors: [{ store: 'media', id: 'm1', error: 'second-boom' }],
      }),
    )

    render(<LegacyMigrationErrors />)
    await screen.findByText('2 items failed to migrate')

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => {
      expect(screen.getByText('1 item failed to migrate')).toBeInTheDocument()
    })
  })

  it('details toggle reveals per-error lines', async () => {
    getMigrationErrorsMock.mockResolvedValue([
      { store: 'media', id: 'media-42', error: 'disk full' },
    ])

    render(<LegacyMigrationErrors />)
    await screen.findByText('1 item failed to migrate')

    expect(screen.queryByText('disk full')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /show details/i }))

    expect(screen.getByText(/media-42/)).toBeInTheDocument()
    expect(screen.getByText(/disk full/)).toBeInTheDocument()
  })

  it('dismiss hides the banner until the next mount', async () => {
    getMigrationErrorsMock.mockResolvedValue([{ store: 'media', id: 'm1', error: 'boom' }])

    const { container } = render(<LegacyMigrationErrors />)
    await screen.findByText('1 item failed to migrate')

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(container).toBeEmptyDOMElement()
  })

  it('fires onRetried after retry finishes', async () => {
    const onRetried = vi.fn()
    getMigrationErrorsMock.mockResolvedValue([{ store: 'media', id: 'm1', error: 'boom' }])
    migrateFromLegacyIDBMock.mockResolvedValue(emptyReport())

    render(<LegacyMigrationErrors onRetried={onRetried} />)
    await screen.findByText('1 item failed to migrate')

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => {
      expect(onRetried).toHaveBeenCalledTimes(1)
    })
  })
})
