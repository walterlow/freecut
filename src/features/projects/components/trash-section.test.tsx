import { describe, it, expect, beforeEach, vi } from 'vite-plus/test'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TrashedProjectEntry } from '@/infrastructure/storage'
import { TrashSection } from './trash-section'

const listTrashedProjectsMock = vi.fn<() => Promise<TrashedProjectEntry[]>>()

vi.mock('@/infrastructure/storage', () => ({
  listTrashedProjects: (...args: unknown[]) => listTrashedProjectsMock(...(args as [])),
}))

const restoreProjectMock =
  vi.fn<(id: string) => Promise<{ success: boolean; error: string | null }>>()
const permanentlyDeleteProjectMock =
  vi.fn<(id: string) => Promise<{ success: boolean; error: string | null }>>()

vi.mock('../hooks/use-project-actions', () => ({
  useRestoreProject: () => restoreProjectMock,
  usePermanentlyDeleteProject: () => permanentlyDeleteProjectMock,
}))

// Minimal store mock — TrashSection only consumes `projects` to re-trigger
// the trash fetch when the live list changes.
let storeProjects: unknown[] = []
vi.mock('../stores/project-store', () => ({
  useProjectStore: (selector: (s: { projects: unknown[] }) => unknown) =>
    selector({ projects: storeProjects }),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

function entry(id: string, name: string, deletedAt = Date.now()): TrashedProjectEntry {
  return { id, marker: { deletedAt, originalName: name } }
}

async function expandTrash() {
  fireEvent.click(screen.getByTestId('trash-toggle'))
  // Radix Collapsible sets `hidden` on its content until the trigger is
  // clicked, after which `data-state="open"` is set and `hidden` removed.
  // Wait for the Empty trash button (only rendered when `open`) to appear.
  await waitFor(() => {
    expect(screen.queryByTestId('trash-empty-all')).toBeTruthy()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  storeProjects = []
  listTrashedProjectsMock.mockResolvedValue([])
  restoreProjectMock.mockResolvedValue({ success: true, error: null })
  permanentlyDeleteProjectMock.mockResolvedValue({ success: true, error: null })
})

describe('TrashSection', () => {
  it('renders nothing when the trash is empty', async () => {
    const { container } = render(<TrashSection />)
    await waitFor(() => {
      expect(listTrashedProjectsMock).toHaveBeenCalled()
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a count badge and hides row content until expanded', async () => {
    listTrashedProjectsMock.mockResolvedValue([entry('a', 'Alpha'), entry('b', 'Beta')])

    render(<TrashSection />)

    // Header with the count badge is visible immediately.
    expect(await screen.findByTestId('trash-toggle')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()

    // Collapsed state: the Empty trash button is hidden and row names
    // aren't rendered yet.
    expect(screen.queryByTestId('trash-empty-all')).toBeNull()
    expect(screen.queryByText('Alpha')).toBeNull()

    // Expanding surfaces rows and the Empty trash button.
    await expandTrash()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByTestId('trash-empty-all')).toBeInTheDocument()
  })

  it('restores a project and toasts on success', async () => {
    listTrashedProjectsMock.mockResolvedValue([entry('a', 'Alpha')])

    render(<TrashSection />)
    await screen.findByTestId('trash-toggle')
    await expandTrash()

    await act(async () => {
      fireEvent.click(screen.getByTestId('trash-restore-a'))
    })

    expect(restoreProjectMock).toHaveBeenCalledWith('a')
    expect(toastSuccess).toHaveBeenCalledWith('Restored "Alpha"')
  })

  it('confirms and permanently deletes a single entry, then refreshes the list', async () => {
    listTrashedProjectsMock
      .mockResolvedValueOnce([entry('a', 'Alpha'), entry('b', 'Beta')])
      .mockResolvedValueOnce([entry('b', 'Beta')])

    render(<TrashSection />)
    await screen.findByTestId('trash-toggle')
    await expandTrash()

    // Per-row "Delete forever" opens the confirm dialog.
    fireEvent.click(screen.getByTestId('trash-delete-a'))

    await act(async () => {
      fireEvent.click(await screen.findByTestId('trash-confirm-action'))
    })

    expect(permanentlyDeleteProjectMock).toHaveBeenCalledWith('a')
    // Manual refresh after permanent delete — expect at least one extra
    // listTrashedProjects call beyond the initial mount read.
    await waitFor(() => {
      expect(listTrashedProjectsMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
    expect(toastSuccess).toHaveBeenCalledWith('Deleted "Alpha" forever')
  })

  it('empties the entire trash in one confirm', async () => {
    listTrashedProjectsMock
      .mockResolvedValueOnce([entry('a', 'Alpha'), entry('b', 'Beta')])
      .mockResolvedValueOnce([])

    render(<TrashSection />)
    await screen.findByTestId('trash-toggle')
    await expandTrash()

    fireEvent.click(screen.getByTestId('trash-empty-all'))

    // Confirm dialog mentions the count.
    expect(await screen.findByText(/permanently delete 2 project\(s\)/i)).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTestId('trash-confirm-action'))
    })

    expect(permanentlyDeleteProjectMock).toHaveBeenCalledWith('a')
    expect(permanentlyDeleteProjectMock).toHaveBeenCalledWith('b')
    expect(permanentlyDeleteProjectMock).toHaveBeenCalledTimes(2)
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('Emptied trash (2 projects deleted)')
    })
  })

  it('surfaces a failure toast when restore fails', async () => {
    listTrashedProjectsMock.mockResolvedValue([entry('a', 'Alpha')])
    restoreProjectMock.mockResolvedValue({
      success: false,
      error: 'permission denied',
    })

    render(<TrashSection />)
    await screen.findByTestId('trash-toggle')
    await expandTrash()

    await act(async () => {
      fireEvent.click(screen.getByTestId('trash-restore-a'))
    })

    expect(toastError).toHaveBeenCalledWith('Failed to restore project', {
      description: 'permission denied',
    })
  })
})
