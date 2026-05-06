import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { fireEvent, render, screen } from '@testing-library/react'
import { useSelectionStore } from '@/shared/state/selection'
import { ItemContextMenu } from './item-context-menu'

const { mockGetSceneVerificationModelOptions } = vi.hoisted(() => ({
  mockGetSceneVerificationModelOptions: vi.fn(() => [
    { value: 'gemma', label: 'Gemma Turbo' },
    { value: 'lfm', label: 'Liquid Vision' },
  ]),
}))

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  ContextMenuSeparator: () => null,
  ContextMenuShortcut: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  ContextMenuSub: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuSubTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuSubContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/features/timeline/deps/analysis', () => ({
  getSceneVerificationModelOptions: mockGetSceneVerificationModelOptions,
}))

vi.mock('@/features/timeline/deps/settings', () => ({
  useResolvedHotkeys: () => ({}),
}))

vi.mock('@/config/hotkeys', () => ({
  formatHotkeyBinding: () => '',
}))

function renderContextMenu(overrides: Partial<ComponentProps<typeof ItemContextMenu>> = {}) {
  const onDetectScenes = vi.fn()

  render(
    <ItemContextMenu
      trackLocked={false}
      isSelected
      canJoinSelected={false}
      hasJoinableLeft={false}
      hasJoinableRight={false}
      closerEdge={null}
      onJoinSelected={() => {}}
      onJoinLeft={() => {}}
      onJoinRight={() => {}}
      onRippleDelete={() => {}}
      onDelete={() => {}}
      canDetectScenes
      isDetectingScenes={false}
      onDetectScenes={onDetectScenes}
      {...overrides}
    >
      <div>Clip</div>
    </ItemContextMenu>,
  )

  fireEvent.contextMenu(screen.getByText('Clip'))

  return { onDetectScenes }
}

describe('ItemContextMenu scene detection', () => {
  beforeEach(() => {
    mockGetSceneVerificationModelOptions.mockClear()
    useSelectionStore.setState({
      selectedItemIds: [],
      selectedMarkerId: null,
      selectedTransitionId: null,
      selectedTrackId: null,
      selectedTrackIds: [],
      activeTrackId: null,
      selectionType: null,
    })
  })

  it('renders scene verification submenu labels from shared options', () => {
    renderContextMenu()

    expect(mockGetSceneVerificationModelOptions).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Detect Scenes & Split')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fast (Histogram)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AI (Gemma Turbo)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AI (Liquid Vision)' })).toBeInTheDocument()
  })

  it('dispatches the selected verification model when a scene detection option is clicked', () => {
    const { onDetectScenes } = renderContextMenu()

    fireEvent.click(screen.getByRole('button', { name: 'AI (Liquid Vision)' }))

    expect(onDetectScenes).toHaveBeenCalledWith('optical-flow', 'lfm')
  })
})

describe('ItemContextMenu captions', () => {
  it('shows a single "Generate Captions" item when no transcript exists', () => {
    const onOpenCaptionDialog = vi.fn()

    renderContextMenu({
      canManageCaptions: true,
      hasCaptions: false,
      hasTranscript: false,
      onOpenCaptionDialog,
    })

    const item = screen.getByRole('button', { name: 'Generate Captions' })
    expect(item).toBeInTheDocument()
    expect(screen.queryByText('Captions')).not.toBeInTheDocument()
    fireEvent.click(item)
    expect(onOpenCaptionDialog).toHaveBeenCalledTimes(1)
  })

  it('shows a Captions submenu with Insert + Generate when a transcript already exists', () => {
    const onOpenCaptionDialog = vi.fn()
    const onApplyCaptionsFromTranscript = vi.fn()

    renderContextMenu({
      canManageCaptions: true,
      hasCaptions: false,
      hasTranscript: true,
      onOpenCaptionDialog,
      onApplyCaptionsFromTranscript,
    })

    expect(screen.getByText('Captions')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Insert Existing Captions' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate Captions' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Insert Existing Captions' }))
    expect(onApplyCaptionsFromTranscript).toHaveBeenCalledTimes(1)
  })

  it('labels the generate item "Regenerate Captions" when the clip already has captions', () => {
    renderContextMenu({
      canManageCaptions: true,
      hasCaptions: true,
      hasTranscript: true,
      onOpenCaptionDialog: vi.fn(),
      onApplyCaptionsFromTranscript: vi.fn(),
    })

    expect(screen.getByRole('button', { name: 'Regenerate Captions' })).toBeInTheDocument()
  })
})
