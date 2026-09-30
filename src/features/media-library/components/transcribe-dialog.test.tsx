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

vi.mock('@/shared/state/editor', () => ({
  useEditorStore: (selector: (state: typeof editorStoreState) => unknown) =>
    selector(editorStoreState),
}))

vi.mock('@/shared/state/playback', () => ({
  usePlaybackStore: {
    getState: () => playbackStoreState,
  },
}))

vi.mock('../transcription/registry', () => ({
  getMediaTranscriptionModelOptions: () => [
    { value: 'parakeet-tdt-v3', label: 'Parakeet (fast)' },
    { value: 'whisper-base', label: 'Whisper Base' },
    { value: 'whisper-large', label: 'Whisper Large v3 Turbo' },
  ],
}))

vi.mock('@/shared/utils/whisper-settings', () => ({
  getWhisperLanguageSelectValue: (value: string) => value || 'auto',
  getWhisperLanguageSettingValue: (value: string) => (value === 'auto' ? '' : value),
  normalizeSelectableWhisperModel: (value: string) => value,
  WHISPER_AUTO_LANGUAGE_VALUE: 'auto',
  WHISPER_LANGUAGE_OPTIONS: [
    { value: 'auto', label: 'Auto-detect' },
    { value: 'zh', label: 'Chinese' },
  ],
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
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}))

vi.mock('@/components/ui/combobox', () => ({
  Combobox: ({
    id,
    value,
    onValueChange,
    disabled,
  }: {
    id?: string
    value: string
    onValueChange: (value: string) => void
    disabled?: boolean
  }) => (
    <input
      id={id}
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
  Cpu: () => <span aria-hidden="true">cpu</span>,
  Zap: () => <span aria-hidden="true">zap</span>,
  Captions: () => <span aria-hidden="true">captions</span>,
  Server: () => <span aria-hidden="true">server</span>,
  Cloud: () => <span aria-hidden="true">cloud</span>,
  RefreshCw: () => <span aria-hidden="true">refresh</span>,
  Sparkles: () => <span aria-hidden="true">sparkles</span>,
  Key: () => <span aria-hidden="true">key</span>,
  CheckCircle2: () => <span aria-hidden="true">check</span>,
  AlertCircle: () => <span aria-hidden="true">alert</span>,
  ExternalLink: () => <span aria-hidden="true">external-link</span>,
  FileText: () => <span aria-hidden="true">file-text</span>,
  Trash2: () => <span aria-hidden="true">trash</span>,
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
    settingsStoreState.defaultWhisperModel = 'whisper-base'
    settingsStoreState.defaultWhisperQuantization = 'hybrid'
    settingsStoreState.defaultWhisperLanguage = ''
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

  it('shows Parakeet language coverage instead of a language selector', () => {
    settingsStoreState.defaultWhisperModel = 'parakeet-tdt-v3'
    settingsStoreState.defaultWhisperLanguage = 'zh'
    const onStart = vi.fn()

    render(
      <TranscribeDialog
        open
        onOpenChange={vi.fn()}
        fileName="clip.mp4"
        hasTranscript={false}
        isRunning={false}
        progressPercent={null}
        progressLabel="Idle"
        onStart={onStart}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText('Automatically detects 25 European languages.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'For Chinese, Japanese, Korean, and other languages, choose a Whisper model.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Language')).not.toBeInTheDocument()
    expect(screen.queryByText('Quantization')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(onStart).toHaveBeenCalledWith({
      model: 'parakeet-tdt-v3',
      quantization: 'hybrid',
      language: '',
    })
  })

  it('clears a Whisper-only language when switching to Parakeet', () => {
    settingsStoreState.defaultWhisperLanguage = 'zh'

    render(
      <TranscribeDialog
        open
        onOpenChange={vi.fn()}
        fileName="clip.mp4"
        hasTranscript={false}
        isRunning={false}
        progressPercent={null}
        progressLabel="Idle"
        onStart={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Language')).toHaveValue('zh')
    const modelAndQuantizationSelects = screen.getAllByRole('combobox')
    expect(modelAndQuantizationSelects).toHaveLength(2)
    fireEvent.change(modelAndQuantizationSelects[0]!, {
      target: { value: 'parakeet-tdt-v3' },
    })

    expect(screen.queryByLabelText('Language')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'whisper-large' } })
    expect(screen.getByLabelText('Language')).toHaveValue('auto')
  })

  it('allows selecting Whisper Local GPU and selecting model', () => {
    const onStart = vi.fn()
    render(
      <TranscribeDialog
        open
        onOpenChange={vi.fn()}
        fileName="clip.mp4"
        hasTranscript={false}
        isRunning={false}
        progressPercent={null}
        progressLabel="Idle"
        onStart={onStart}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('Whisper GPU'))
    expect(screen.getByText(/Ciclo de vida On-Demand/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(onStart).toHaveBeenCalledWith({
      model: 'whisper-local:turbo',
      quantization: 'hybrid',
      language: '',
    })
  })

  it('allows selecting ComfyUI for transcription', () => {
    const onStart = vi.fn()
    render(
      <TranscribeDialog
        open
        onOpenChange={vi.fn()}
        fileName="clip.mp4"
        hasTranscript={false}
        isRunning={false}
        progressPercent={null}
        progressLabel="Idle"
        onStart={onStart}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('ComfyUI'))
    expect(screen.getByText(/Workflow activo/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(onStart).toHaveBeenCalledWith({
      model: 'comfyui:transcription',
      quantization: 'hybrid',
      language: '',
    })
  })

  it('allows selecting Cloud provider and entering custom model', () => {
    const onStart = vi.fn()
    render(
      <TranscribeDialog
        open
        onOpenChange={vi.fn()}
        fileName="clip.mp4"
        hasTranscript={false}
        isRunning={false}
        progressPercent={null}
        progressLabel="Idle"
        onStart={onStart}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('Cloud'))
    expect(screen.getByText('Groq (Whisper)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'OpenAI' }))
    const customInput = screen.getByLabelText(/O escribe cualquier modelo/i)
    fireEvent.change(customInput, { target: { value: 'custom-whisper' } })

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(onStart).toHaveBeenCalledWith({
      model: 'openai:custom-whisper',
      quantization: 'hybrid',
      language: '',
    })
  })

  it('renders retranscribe button and allows deleting existing transcript', async () => {
    const onStart = vi.fn()
    const onDelete = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <TranscribeDialog
        open
        onOpenChange={onOpenChange}
        fileName="clip.mp4"
        hasTranscript={true}
        isRunning={false}
        progressPercent={null}
        progressLabel="Idle"
        onStart={onStart}
        onCancel={vi.fn()}
        onDelete={onDelete}
      />,
    )

    expect(screen.getByText(/Este medio ya tiene una transcripción/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Volver a transcribir/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Limpiar transcripción/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Limpiar transcripción/i }))
    expect(onDelete).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })
})
