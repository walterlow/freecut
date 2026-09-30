import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Loader2,
  Cpu,
  Zap,
  Cloud,
  RefreshCw,
  Key,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Captions,
  FileText,
  Trash2,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Combobox } from '@/components/ui/combobox'
import { cn } from '@/shared/ui/cn'
import { useEditorStore } from '@/shared/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSettingsStore } from '@/features/media-library/deps/settings-contract'
import { useAiSettingsStore } from '@/shared/state/ai-settings-store'
import { useComfyWorkflowStore } from '@/infrastructure/comfyui/workflow-store'
import { getMediaTranscriptionModelOptions } from '../transcription/registry'
import {
  isParakeetModel,
  PARAKEET_SUPPORTED_LANGUAGES,
} from '../transcription/transcription-engine'
import {
  getWhisperLanguageSelectValue,
  getWhisperLanguageSettingValue,
  normalizeSelectableWhisperModel,
  WHISPER_AUTO_LANGUAGE_VALUE,
  WHISPER_LANGUAGE_OPTIONS,
  WHISPER_QUANTIZATION_OPTIONS,
} from '@/shared/utils/whisper-settings'
import type { MediaTranscriptModel, MediaTranscriptQuantization } from '@/types/storage'

export interface TranscribeDialogValues {
  model: MediaTranscriptModel
  quantization: MediaTranscriptQuantization
  language: string
}

interface TranscribeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fileName: string
  hasTranscript: boolean
  isRunning: boolean
  /** Progress within the current stage, not across the whole job. */
  progressPercent: number | null
  /** Set while a stage reports no progress (ONNX graph compile) — render a moving bar, not a stalled one. */
  progressIndeterminate?: boolean
  progressLabel: string
  /** Secondary line: a byte counter while downloading, prose while compiling. */
  progressDetail?: string | null
  errorMessage?: string | null
  onStart: (values: TranscribeDialogValues) => void
  onCancel: () => void
  onDelete?: () => void | Promise<void>
}

type ProviderType = 'browser' | 'whisper_local' | 'comfyui' | 'cloud'
type CloudProvider = 'groq' | 'openai' | 'gemini'

const WHISPER_LOCAL_MODELS = [
  {
    value: 'turbo',
    label: 'Whisper Large v3 Turbo (Recomendado - 8x más rápido, misma calidad)',
  },
  {
    value: 'large-v3',
    label: 'Whisper Large v3 (HuggingFace openai/whisper-large-v3 - Máxima precisión)',
  },
  {
    value: 'medium',
    label: 'Whisper Medium (Equilibrio rápido y preciso)',
  },
  {
    value: 'small',
    label: 'Whisper Small (Ligero)',
  },
  {
    value: 'base',
    label: 'Whisper Base (Ultrarrápido)',
  },
  {
    value: 'tiny',
    label: 'Whisper Tiny (Mínimo consumo)',
  },
]

const CLOUD_MODEL_PRESETS: Record<CloudProvider, Array<{ value: string; label: string }>> = {
  groq: [
    { value: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo (Ultrarrápido ~0.5s)' },
    { value: 'whisper-large-v3', label: 'Whisper Large v3 (Máxima precisión)' },
    { value: 'distil-whisper-large-v3-en', label: 'Distil-Whisper Large v3 (Inglés ligero)' },
  ],
  openai: [
    { value: 'whisper-1', label: 'OpenAI Whisper-1 (Estándar oficial)' },
    { value: 'gpt-4o-audio-preview', label: 'GPT-4o Audio Preview' },
  ],
  gemini: [
    { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (Recomendado 2026)' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-3.5-pro', label: 'Gemini 3.5 Pro' },
  ],
}

export function TranscribeDialog({
  open,
  onOpenChange,
  fileName,
  hasTranscript,
  isRunning,
  progressPercent,
  progressIndeterminate = false,
  progressLabel,
  progressDetail = null,
  errorMessage,
  onStart,
  onCancel,
  onDelete,
}: TranscribeDialogProps) {
  const { t } = useTranslation()
  const defaultModel = useSettingsStore((s) => s.defaultWhisperModel)
  const defaultQuantization = useSettingsStore((s) => s.defaultWhisperQuantization)
  const defaultLanguage = useSettingsStore((s) => s.defaultWhisperLanguage)
  const clearMediaSkimPreview = useEditorStore((s) => s.clearMediaSkimPreview)
  const clearCompoundClipSkimPreview = useEditorStore((s) => s.clearCompoundClipSkimPreview)
  const beginTranscriptionDialog = useEditorStore((s) => s.beginTranscriptionDialog)
  const endTranscriptionDialog = useEditorStore((s) => s.endTranscriptionDialog)

  const modelOptions = useMemo(() => getMediaTranscriptionModelOptions(), [])

  // AI Store & ComfyUI
  const aiProviders = useAiSettingsStore((s) => s.providers)
  const setProviderConfig = useAiSettingsStore((s) => s.setProviderConfig)
  const comfyUiConfig = useAiSettingsStore((s) => s.comfyui)
  const comfyTranscriptionSlot = useComfyWorkflowStore((s) => s.slots.transcription)

  // Determine initial provider type based on model prefix
  const [providerType, setProviderType] = useState<ProviderType>(() => {
    if (defaultModel?.startsWith('whisper-local:')) return 'whisper_local'
    if (defaultModel?.startsWith('comfyui:')) return 'comfyui'
    if (
      defaultModel?.startsWith('groq:') ||
      defaultModel?.startsWith('openai:') ||
      defaultModel?.startsWith('gemini:')
    ) {
      return 'cloud'
    }
    if (
      defaultModel === 'parakeet-tdt-v3' ||
      defaultModel?.startsWith('whisper-')
    ) {
      return 'browser'
    }
    return 'whisper_local' // Default to Whisper Local GPU
  })

  // Browser Whisper state
  const [model, setModel] = useState<MediaTranscriptModel>(() =>
    normalizeSelectableWhisperModel(defaultModel),
  )
  const [quantization, setQuantization] = useState<MediaTranscriptQuantization>(defaultQuantization)
  const [languageValue, setLanguageValue] = useState<string>(() =>
    getWhisperLanguageSelectValue(defaultLanguage),
  )

  // Whisper Local GPU state
  const [whisperLocalModel, setWhisperLocalModel] = useState<string>('turbo')
  const [whisperLocalDevice, setWhisperLocalDevice] = useState<'auto' | 'cuda' | 'cpu'>('cuda')
  const [whisperLocalStatus, setWhisperLocalStatus] = useState<{
    available: boolean
    cuda: boolean
    gpuName?: string
    isBusy: boolean
  } | null>(null)
  const [isCheckingWhisper, setIsCheckingWhisper] = useState(false)

  // ComfyUI state
  const [comfyOnline, setComfyOnline] = useState<boolean | null>(null)
  const [isCheckingComfy, setIsCheckingComfy] = useState(false)

  // Cloud state
  const [cloudProvider, setCloudProvider] = useState<CloudProvider>(() => {
    if (defaultModel?.startsWith('openai:')) return 'openai'
    if (defaultModel?.startsWith('gemini:')) return 'gemini'
    return 'groq'
  })
  const [cloudModel, setCloudModel] = useState<string>(() => {
    if (defaultModel?.startsWith('groq:')) return defaultModel.slice(5)
    if (defaultModel?.startsWith('openai:')) return defaultModel.slice(7)
    if (defaultModel?.startsWith('gemini:')) return defaultModel.slice(7)
    return 'whisper-large-v3-turbo'
  })
  const [customCloudModel, setCustomCloudModel] = useState('')
  const [cloudApiKeyInput, setCloudApiKeyInput] = useState('')

  // Sync Cloud API key input
  useEffect(() => {
    setCloudApiKeyInput(aiProviders[cloudProvider]?.apiKey || '')
  }, [cloudProvider, aiProviders])

  // Check Whisper Local Status
  const checkWhisperStatus = useCallback(async () => {
    setIsCheckingWhisper(true)
    try {
      const res = await fetch('/api/whisper/status', {
        signal: AbortSignal.timeout(3000),
      })
      if (res.ok) {
        const data = await res.json()
        setWhisperLocalStatus(data)
      } else {
        setWhisperLocalStatus(null)
      }
    } catch {
      setWhisperLocalStatus(null)
    } finally {
      setIsCheckingWhisper(false)
    }
  }, [])

  // Check ComfyUI Status
  const checkComfyStatus = useCallback(async () => {
    setIsCheckingComfy(true)
    const baseUrl = (comfyUiConfig.baseUrl || 'http://127.0.0.1:8188').replace(/\/+$/, '')
    try {
      const res = await fetch(`${baseUrl}/system_stats`, {
        signal: AbortSignal.timeout(3000),
      })
      setComfyOnline(res.ok)
    } catch {
      setComfyOnline(false)
    } finally {
      setIsCheckingComfy(false)
    }
  }, [comfyUiConfig.baseUrl])

  useEffect(() => {
    if (!open) return
    const nextModel = normalizeSelectableWhisperModel(defaultModel)
    setModel(nextModel)
    setQuantization(defaultQuantization)
    setLanguageValue(
      isParakeetModel(nextModel)
        ? WHISPER_AUTO_LANGUAGE_VALUE
        : getWhisperLanguageSelectValue(defaultLanguage),
    )

    void checkWhisperStatus()
    if (providerType === 'comfyui') {
      void checkComfyStatus()
    }
  }, [open, defaultLanguage, defaultModel, defaultQuantization, checkWhisperStatus, checkComfyStatus, providerType])

  useEffect(() => {
    if (!open) return
    beginTranscriptionDialog()
    clearMediaSkimPreview()
    clearCompoundClipSkimPreview()
    usePlaybackStore.getState().setPreviewFrame(null)
    usePlaybackStore.getState().pause()

    return () => {
      endTranscriptionDialog()
    }
  }, [
    beginTranscriptionDialog,
    clearCompoundClipSkimPreview,
    clearMediaSkimPreview,
    endTranscriptionDialog,
    open,
  ])

  const handleStart = () => {
    let finalModel: MediaTranscriptModel = model
    const lang =
      providerType === 'browser' && isParakeetModel(model)
        ? getWhisperLanguageSettingValue(WHISPER_AUTO_LANGUAGE_VALUE)
        : getWhisperLanguageSettingValue(languageValue)

    if (providerType === 'whisper_local') {
      finalModel = `whisper-local:${whisperLocalModel}`
    } else if (providerType === 'comfyui') {
      finalModel = `comfyui:transcription`
    } else if (providerType === 'cloud') {
      const chosen =
        customCloudModel.trim() || cloudModel.trim() || CLOUD_MODEL_PRESETS[cloudProvider][0]!.value
      finalModel = `${cloudProvider}:${chosen}`

      // Save API key if updated
      if (cloudApiKeyInput.trim()) {
        setProviderConfig(cloudProvider, { apiKey: cloudApiKeyInput.trim() })
      }
    }

    onStart({
      model: finalModel,
      quantization,
      language: lang,
    })
  }

  const handleModelChange = (value: string) => {
    const nextModel = value as MediaTranscriptModel
    setModel(nextModel)
    if (isParakeetModel(nextModel)) {
      setLanguageValue(WHISPER_AUTO_LANGUAGE_VALUE)
    }
  }

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (isRunning && !nextOpen) {
        return
      }
      onOpenChange(nextOpen)
    },
    [isRunning, onOpenChange],
  )

  const title = hasTranscript
    ? t('media.transcribe.refreshTitle')
    : t('media.transcribe.generateTitle')

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} modal>
      <DialogContent
        className="sm:max-w-lg"
        hideCloseButton={isRunning}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (isRunning) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="truncate">{fileName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {hasTranscript && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 min-w-0">
                <FileText className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="font-medium leading-tight">
                  Este medio ya tiene una transcripción. Puedes volver a generarla con otro modelo/idioma o eliminarla.
                </span>
              </div>
              {onDelete && !isRunning && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs gap-1.5 shrink-0"
                  onClick={async () => {
                    await onDelete()
                    onOpenChange(false)
                  }}
                  title="Eliminar transcripción actual y limpiar datos"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Limpiar</span>
                </Button>
              )}
            </div>
          )}

          {/* Provider Source Tabs */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Motor de Transcripción
            </Label>
            <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted/60 p-1 text-xs font-medium">
              <button
                type="button"
                disabled={isRunning}
                onClick={() => setProviderType('whisper_local')}
                className={cn(
                  'flex items-center justify-center gap-1.5 py-2 rounded-md transition-all',
                  providerType === 'whisper_local'
                    ? 'bg-background shadow-xs text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                title="Whisper en tu tarjeta gráfica local con auto-apagado"
              >
                <Zap className="w-3.5 h-3.5 text-emerald-500" />
                <span>Whisper GPU</span>
              </button>

              <button
                type="button"
                disabled={isRunning}
                onClick={() => {
                  setProviderType('comfyui')
                  void checkComfyStatus()
                }}
                className={cn(
                  'flex items-center justify-center gap-1.5 py-2 rounded-md transition-all',
                  providerType === 'comfyui'
                    ? 'bg-background shadow-xs text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                title="Workflow de ComfyUI"
              >
                <Captions className="w-3.5 h-3.5 text-purple-500" />
                <span>ComfyUI</span>
              </button>

              <button
                type="button"
                disabled={isRunning}
                onClick={() => setProviderType('browser')}
                className={cn(
                  'flex items-center justify-center gap-1.5 py-2 rounded-md transition-all',
                  providerType === 'browser'
                    ? 'bg-background shadow-xs text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                title="Modelos ligeros integrados en el navegador"
              >
                <Cpu className="w-3.5 h-3.5 text-blue-500" />
                <span>Navegador</span>
              </button>

              <button
                type="button"
                disabled={isRunning}
                onClick={() => setProviderType('cloud')}
                className={cn(
                  'flex items-center justify-center gap-1.5 py-2 rounded-md transition-all',
                  providerType === 'cloud'
                    ? 'bg-background shadow-xs text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                title="Groq, OpenAI y Gemini"
              >
                <Cloud className="w-3.5 h-3.5 text-indigo-500" />
                <span>Cloud</span>
              </button>
            </div>
          </div>

          {/* TAB 1: WHISPER LOCAL GPU (ON-DEMAND) */}
          {providerType === 'whisper_local' && (
            <div className="space-y-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <Zap className="w-3.5 h-3.5" />
                  <span>
                    {whisperLocalStatus?.cuda
                      ? `Aceleración GPU: ${whisperLocalStatus.gpuName || 'NVIDIA CUDA'}`
                      : 'Whisper Local Standalone (CPU)'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>0 MB VRAM residual</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isCheckingWhisper || isRunning}
                    onClick={() => void checkWhisperStatus()}
                    className="h-6 w-6 p-0"
                    title="Verificar estado de Whisper"
                  >
                    <RefreshCw className={cn('w-3 h-3', isCheckingWhisper && 'animate-spin')} />
                  </Button>
                </div>
              </div>

              {/* Model selection */}
              <div className="space-y-1.5">
                <Label htmlFor="whisper-local-model" className="text-sm">
                  Modelo Whisper (HuggingFace)
                </Label>
                <Select
                  value={whisperLocalModel}
                  onValueChange={setWhisperLocalModel}
                  disabled={isRunning}
                >
                  <SelectTrigger id="whisper-local-model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WHISPER_LOCAL_MODELS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Compute device */}
              <div className="space-y-1.5">
                <Label htmlFor="whisper-local-device" className="text-xs text-muted-foreground">
                  Dispositivo de cómputo
                </Label>
                <Select
                  value={whisperLocalDevice}
                  onValueChange={(val) => setWhisperLocalDevice(val as 'auto' | 'cuda' | 'cpu')}
                  disabled={isRunning}
                >
                  <SelectTrigger id="whisper-local-device" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cuda">NVIDIA CUDA (GPU RTX 3090 - Ultrarrápido)</SelectItem>
                    <SelectItem value="auto">Automático (Detectar GPU)</SelectItem>
                    <SelectItem value="cpu">CPU (Todos los núcleos)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-md border border-emerald-500/20 bg-background/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">Ciclo de vida On-Demand:</span> El motor
                se enciende únicamente durante la transcripción y se apaga de inmediato al terminar,
                liberando el 100% de la memoria RAM y VRAM de tu PC.
              </div>
            </div>
          )}

          {/* TAB 2: COMFYUI WORKFLOW */}
          {providerType === 'comfyui' && (
            <div className="space-y-3 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-600 dark:text-purple-400">
                  <Captions className="w-3.5 h-3.5" />
                  <span>Servidor ComfyUI ({comfyUiConfig.baseUrl || 'http://127.0.0.1:8188'})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                      comfyOnline
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
                    )}
                  >
                    {comfyOnline ? (
                      <>
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Online</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-3 h-3" />
                        <span>Desconectado</span>
                      </>
                    )}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isCheckingComfy || isRunning}
                    onClick={() => void checkComfyStatus()}
                    className="h-6 w-6 p-0"
                    title="Comprobar conexión con ComfyUI"
                  >
                    <RefreshCw className={cn('w-3 h-3', isCheckingComfy && 'animate-spin')} />
                  </Button>
                </div>
              </div>

              {/* Workflow Slot Info */}
              <div className="rounded-md border border-border/80 bg-background/50 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">Workflow activo:</span>
                  <span className="text-[11px] font-mono text-purple-600 dark:text-purple-400 truncate max-w-[200px]">
                    {comfyTranscriptionSlot?.workflowName || 'Preset_Transcription_Whisper.json'}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Utiliza el workflow asignado en la ranura de <strong>Transcripción</strong> de ComfyUI.
                  Envía el audio al nodo de entrada y extrae subtítulos con marcas de tiempo.
                </p>
                <div className="pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1 w-full"
                    onClick={() => {
                      onOpenChange(false)
                      useEditorStore.getState().openSettingsDialog()
                    }}
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Configurar Workflow en Ajustes</span>
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: BROWSER ORIGINAL APP MODELS */}
          {providerType === 'browser' && (
            <div className="space-y-3 rounded-lg border border-border/80 bg-muted/10 p-3">
              <div className="space-y-1.5">
                <Label htmlFor="transcribe-model" className="text-sm">
                  {t('media.transcribe.model')}
                </Label>
                <Select value={model} onValueChange={handleModelChange} disabled={isRunning}>
                  <SelectTrigger id="transcribe-model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {modelOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {!isParakeetModel(model) && (
                <div className="space-y-1.5">
                  <Label htmlFor="transcribe-quantization" className="text-sm">
                    {t('media.transcribe.quantization')}
                  </Label>
                  <Select
                    value={quantization}
                    onValueChange={(value) => setQuantization(value as MediaTranscriptQuantization)}
                    disabled={isRunning}
                  >
                    <SelectTrigger id="transcribe-quantization">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WHISPER_QUANTIZATION_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {isParakeetModel(model) && (
                <div className="space-y-1.5">
                  <Label className="text-sm">{t('media.transcribe.language')}</Label>
                  <div className="rounded-md border border-border bg-secondary/35 px-3 py-2.5">
                    <div className="text-sm font-medium">{t('media.transcribe.autoDetect')}</div>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {t('media.transcribe.parakeetAutoDetects', {
                        count: PARAKEET_SUPPORTED_LANGUAGES.size,
                      })}
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      {t('media.transcribe.parakeetChooseWhisper')}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: CLOUD PROVIDERS */}
          {providerType === 'cloud' && (
            <div className="space-y-3 rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3">
              {/* Cloud sub-provider selector */}
              <div className="space-y-1.5">
                <Label className="text-sm">Proveedor Cloud</Label>
                <div className="grid grid-cols-3 gap-1">
                  <Button
                    type="button"
                    variant={cloudProvider === 'groq' ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 text-xs font-semibold"
                    onClick={() => {
                      setCloudProvider('groq')
                      setCloudModel(CLOUD_MODEL_PRESETS.groq[0]!.value)
                      setCustomCloudModel('')
                    }}
                    disabled={isRunning}
                  >
                    Groq (Whisper)
                  </Button>
                  <Button
                    type="button"
                    variant={cloudProvider === 'openai' ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 text-xs font-semibold"
                    onClick={() => {
                      setCloudProvider('openai')
                      setCloudModel(CLOUD_MODEL_PRESETS.openai[0]!.value)
                      setCustomCloudModel('')
                    }}
                    disabled={isRunning}
                  >
                    OpenAI
                  </Button>
                  <Button
                    type="button"
                    variant={cloudProvider === 'gemini' ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 text-xs font-semibold"
                    onClick={() => {
                      setCloudProvider('gemini')
                      setCloudModel(CLOUD_MODEL_PRESETS.gemini[0]!.value)
                      setCustomCloudModel('')
                    }}
                    disabled={isRunning}
                  >
                    Google Gemini
                  </Button>
                </div>
              </div>

              {/* Cloud model dropdown */}
              <div className="space-y-1.5">
                <Label className="text-sm">Modelo sugerido</Label>
                <Select
                  value={cloudModel}
                  onValueChange={(val) => {
                    setCloudModel(val)
                    setCustomCloudModel('')
                  }}
                  disabled={isRunning}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLOUD_MODEL_PRESETS[cloudProvider].map((preset) => (
                      <SelectItem key={preset.value} value={preset.value}>
                        {preset.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Free-form custom model input */}
              <div className="space-y-1.5">
                <Label htmlFor="cloud-custom-model" className="text-xs font-medium text-foreground">
                  O escribe cualquier modelo (no solo los sugeridos):
                </Label>
                <Input
                  id="cloud-custom-model"
                  placeholder={`Ej. ${CLOUD_MODEL_PRESETS[cloudProvider][0]!.value}, modelo personalizado...`}
                  value={customCloudModel}
                  onChange={(e) => setCustomCloudModel(e.target.value)}
                  disabled={isRunning}
                  className="h-8 text-xs font-mono"
                />
              </div>

              {/* API Key configuration input */}
              <div className="space-y-1.5">
                <Label htmlFor="cloud-api-key" className="text-xs font-medium flex items-center gap-1.5">
                  <Key className="w-3 h-3 text-muted-foreground" />
                  <span>
                    API Key de{' '}
                    {cloudProvider === 'groq'
                      ? 'Groq'
                      : cloudProvider === 'openai'
                        ? 'OpenAI'
                        : 'Gemini'}
                  </span>
                </Label>
                <Input
                  id="cloud-api-key"
                  type="password"
                  placeholder="gsk_... o AIza... o sk-..."
                  value={cloudApiKeyInput}
                  onChange={(e) => setCloudApiKeyInput(e.target.value)}
                  disabled={isRunning}
                  className="h-8 text-xs font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  Se guarda en la configuración local de tu navegador.
                </p>
              </div>
            </div>
          )}

          {/* COMMON LANGUAGE SELECTOR FOR NON-PARAKEET */}
          {!(providerType === 'browser' && isParakeetModel(model)) && (
            <div className="space-y-1.5">
              <Label htmlFor="transcribe-language" className="text-sm">
                {t('media.transcribe.language')} (99 idiomas disponibles)
              </Label>
              <Combobox
                id="transcribe-language"
                value={languageValue}
                onValueChange={setLanguageValue}
                options={WHISPER_LANGUAGE_OPTIONS}
                placeholder={t('media.transcribe.autoDetect')}
                searchPlaceholder={t('media.transcribe.searchLanguages')}
                emptyMessage={t('media.transcribe.noLanguages')}
                disabled={isRunning}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Selecciona tu idioma o déjalo en &ldquo;Auto-detect&rdquo; para que Whisper identifique la lengua automáticamente.
              </p>
            </div>
          )}

          {errorMessage && !isRunning && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {errorMessage}
            </div>
          )}

          {isRunning && (
            <div className="space-y-1.5 rounded-md border border-border bg-secondary/40 px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span className="truncate">{progressLabel}</span>
                {!progressIndeterminate && progressPercent !== null && (
                  <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                    {progressPercent}%
                  </span>
                )}
              </div>
              {(progressIndeterminate || progressPercent !== null) && (
                <div
                  role="progressbar"
                  aria-label={t('media.transcribe.progressAria')}
                  aria-valuemin={progressIndeterminate ? undefined : 0}
                  aria-valuemax={progressIndeterminate ? undefined : 100}
                  aria-valuenow={progressIndeterminate ? undefined : (progressPercent ?? 0)}
                  className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
                >
                  <div
                    className={cn(
                      'h-full bg-primary transition-all duration-200',
                      progressIndeterminate && 'w-1/3 animate-indeterminate-progress',
                    )}
                    style={
                      progressIndeterminate
                        ? undefined
                        : { width: `${Math.min(100, Math.max(0, progressPercent ?? 0))}%` }
                    }
                  />
                </div>
              )}
              {progressDetail && (
                <p className="text-xs text-muted-foreground truncate">{progressDetail}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-col sm:flex-row items-center justify-between gap-2">
          {hasTranscript && onDelete && !isRunning ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5 text-xs mr-auto"
              onClick={async () => {
                await onDelete()
                onOpenChange(false)
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t('media.transcribe.cleanTranscript', { defaultValue: 'Limpiar transcripción' })}</span>
            </Button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2 ml-auto">
            {isRunning ? (
              <Button type="button" variant="outline" onClick={onCancel} className="gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{t('media.transcribe.stop')}</span>
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="button" onClick={handleStart} className="gap-1.5 font-semibold">
                  {hasTranscript ? (
                    <RefreshCw className="w-3.5 h-3.5" />
                  ) : (
                    <Zap className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {hasTranscript
                      ? t('media.transcribe.retranscribe', { defaultValue: 'Volver a transcribir' })
                      : t('media.transcribe.start')}
                  </span>
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
