import type { ReactNode } from 'react'
import { useContext } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const settingsStoreState = vi.hoisted(() => ({
  defaultWhisperModel: 'whisper-base',
  defaultWhisperQuantization: 'hybrid',
  defaultWhisperLanguage: '',
}))

const editorStoreState = vi.hoisted(() => ({
  clearMediaSkimPreview: vi.fn(),
  clearCompoundClipSkimPreview: vi.fn(),
  beginTranscriptionDialog: vi.fn(),
  endTranscriptionDialog: vi.fn(),
}))

const playbackStoreState = vi.hoisted(() => ({
  setPreviewFrame: vi.fn(),
  pause: vi.fn(),
}))

vi.mock('@/features/media-library/deps/settings-contract', () => ({
  useSettingsStore: (selector: (state: typeof settingsStoreState) => unknown) =>
    selector(settingsStoreState),
}))

vi.mock('@/app/state/editor', () => ({
  useEditorStore: (selector: (state: typeof editorStoreState) => unknown) =>
    selector(editorStoreState),
}))

vi.mock('@/shared/state/playback', () => ({
  usePlaybackStore: {
    getState: () => playbackStoreState,
  },
}))

vi.mock('../transcription/registry', () => ({
  getMediaTranscriptionModelOptions: () => [{ value: 'whisper-base', label: 'Whisper Base' }],
}))

vi.mock('@/shared/utils/whisper-settings', () => ({
  getWhisperLanguageSelectValue: (value: string) => value,
  getWhisperLanguageSettingValue: (value: string) => value,
  normalizeSelectableWhisperModel: (value: string) => value,
  WHISPER_LANGUAGE_OPTIONS: [{ value: '', label: 'Auto-detect' }],
  WHISPER_QUANTIZATION_OPTIONS: [{ value: 'hybrid', label: 'Hybrid' }],
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children }: { children: ReactNode }) => <label>{children}</label>,
}))

vi.mock('@/components/ui/combobox', () => ({
  Combobox: ({
    value,
    onValueChange,
    disabled,
  }: {
    value: string
    onValueChange: (value: string) => void
    disabled?: boolean
  }) => (
    <input
      aria-label="Language"
      disabled={disabled}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    />
  ),
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: ReactNode
    value: string
    onValueChange: (value: string) => void
    disabled?: boolean
  }) => (
    <select
      aria-label="Select"
      disabled={disabled}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
}))

vi.mock('lucide-react', () => ({
  Loader2: () => <span aria-hidden="true">loader</span>,
  Square: () => <span aria-hidden="true">square</span>,
}))

vi.mock('@/components/ui/dialog', async () => {
  const ReactModule = await import('react')
  const DialogContext = ReactModule.createContext<{
    open: boolean
    onOpenChange: (open: boolean) => void
  }>({
    open: false,
    onOpenChange: () => {},
  })

  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean
      onOpenChange: (open: boolean) => void
      children: ReactNode
    }) => (
      <DialogContext.Provider value={{ open, onOpenChange }}>
        {open ? (
          <div>
            <button type="button" data-testid="dialog-dismiss" onClick={() => onOpenChange(false)}>
              request close
            </button>
            {children}
          </div>
        ) : null}
      </DialogContext.Provider>
    ),
    DialogContent: ({
      children,
      hideCloseButton,
    }: {
      children: ReactNode
      hideCloseButton?: boolean
    }) => {
      const { open, onOpenChange } = useContext(DialogContext)
      if (!open) return null
      return (
        <div data-testid="transcribe-dialog">
          {!hideCloseButton && (
            <button type="button" aria-label="Close" onClick={() => onOpenChange(false)}>
              close
            </button>
          )}
          {children}
        </div>
      )
    },
    DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
    DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  }
})

import { TranscribeDialog } from './transcribe-dialog'

describe('TranscribeDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears background skim and scrub previews when opened', () => {
    render(
      <TranscribeDialog
        open
        onOpenChange={vi.fn()}
        fileName="clip.mp4"
        hasTranscript={false}
        isRunning={false}
        progressPercent={null}
        progressLabel="Queued..."
        onStart={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(editorStoreState.clearMediaSkimPreview).toHaveBeenCalledTimes(1)
    expect(editorStoreState.clearCompoundClipSkimPreview).toHaveBeenCalledTimes(1)
    expect(editorStoreState.beginTranscriptionDialog).toHaveBeenCalledTimes(1)
    expect(playbackStoreState.setPreviewFrame).toHaveBeenCalledWith(null)
    expect(playbackStoreState.pause).toHaveBeenCalledTimes(1)
  })

  it('requires stopping before the dialog can close mid-transcription', () => {
    const onOpenChange = vi.fn()
    const onCancel = vi.fn()

    render(
      <TranscribeDialog
        open
        onOpenChange={onOpenChange}
        fileName="clip.mp4"
        hasTranscript
        isRunning
        progressPercent={42}
        progressLabel="Transcribing... (42%)"
        onStart={vi.fn()}
        onCancel={onCancel}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(screen.queryByText('Close')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('dialog-dismiss'))
    expect(onOpenChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('allows closing again once transcription is idle', () => {
    const onOpenChange = vi.fn()

    render(
      <TranscribeDialog
        open
        onOpenChange={onOpenChange}
        fileName="clip.mp4"
        hasTranscript={false}
        isRunning={false}
        progressPercent={null}
        progressLabel="Idle"
        onStart={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
