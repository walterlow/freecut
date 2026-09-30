import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Camera,
  Check,
  Copy,
  Dices,
  Download,
  FileCode2,
  Film,
  Image as ImageIcon,
  Layers,
  Loader2,
  Mic,
  Music,
  Plus,
  RefreshCw,
  Server,
  Sparkles,
  Upload,
  Volume2,
  Wand2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAiSettingsStore } from '@/shared/state/ai-settings-store'
import { comfyClient } from '@/infrastructure/comfyui/comfy-client'
import { refinePromptWithAi } from '@/infrastructure/comfyui/prompt-refiner'
import { getDefaultLlmAdapter } from '@/infrastructure/llm'
import type {
  ComfyArtStyle,
  ComfyAssetType,
  ComfyGeneratedAsset,
  ComfyViewMode,
} from '@/infrastructure/comfyui/types'
import { useComfyWorkflowStore } from '@/infrastructure/comfyui/workflow-store'
import { cn } from '@/shared/ui/cn'
import {
  useMediaLibraryStore,
  importMediaLibraryService,
  importMediaTranscriptionService,
} from '@/features/editor/deps/media-library'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { usePlaybackStore } from '@/shared/state/playback'

const ASSET_TYPE_OPTIONS: { id: ComfyAssetType; label: string; icon: typeof Film }[] = [
  { id: 'video_broll', label: 'Video B-Roll', icon: Film },
  { id: 'image', label: 'Imagen Fija', icon: ImageIcon },
  { id: 'voice', label: 'Voz en Off / Natural', icon: Mic },
  { id: 'music', label: 'Música de Fondo', icon: Music },
  { id: 'sfx', label: 'Efecto Sonido (SFX)', icon: Volume2 },
  { id: 'vfx', label: 'Efectos / Img2Img', icon: Wand2 },
  { id: 'model3d', label: 'Modelo 3D (.glb)', icon: Layers },
]

const ART_STYLE_OPTIONS: { id: ComfyArtStyle; label: string }[] = [
  { id: 'cinematic', label: 'Cinemático 35mm' },
  { id: 'photorealistic', label: 'Fotorrealista 8K' },
  { id: 'anime', label: 'Anime / Manga' },
  { id: '3d_stylized', label: '3D Estilizado (Pixar/Disney)' },
  { id: 'low_poly', label: 'Low Poly 3D' },
  { id: 'dark_fantasy', label: 'Dark Fantasy' },
  { id: 'sci_fi', label: 'Sci-Fi / Cyberpunk' },
  { id: 'pixel_art', label: 'Pixel Art 16-bit' },
  { id: '2d_hand_painted', label: '2D Hand-Painted' },
]

const VIEW_MODE_OPTIONS: { id: ComfyViewMode; label: string }[] = [
  { id: 'wide_shot', label: 'Plano General (Wide Shot)' },
  { id: 'close_up', label: 'Primer Plano (Close Up)' },
  { id: 'three_quarter', label: 'Tres Cuartos (3/4 View)' },
  { id: 'front_view', label: 'Vista Frontal' },
  { id: 'top_down', label: 'Cenital / Aérea (Top-Down)' },
  { id: 'drone_view', label: 'Vista de Dron' },
  { id: 'isometric', label: 'Isométrico' },
  { id: 'dutch_angle', label: 'Ángulo Holandés' },
]

export function ComfyUiDockPanel() {
  const { t } = useTranslation()
  const comfyConfig = useAiSettingsStore((s) => s.comfyui)
  const inputMediaFileRef = useRef<HTMLInputElement>(null)

  // Server state
  const [serverOnline, setServerOnline] = useState<boolean | null>(null)
  const [vramInfo, setVramInfo] = useState<string>('')
  const [checkingServer, setCheckingServer] = useState(false)

  // Asset slot state
  const [assetType, setAssetType] = useState<ComfyAssetType>('video_broll')
  const activeSlot = useComfyWorkflowStore((s) => s.slots[assetType] || s.getSlot(assetType))

  // Prompts and text
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [context, setContext] = useState('')
  const [scriptText, setScriptText] = useState('')
  const [artStyle, setArtStyle] = useState<ComfyArtStyle>('cinematic')
  const [viewMode, setViewMode] = useState<ComfyViewMode>('wide_shot')

  // Voiceover / Subtitles option
  const [autoGenerateSubtitles, setAutoGenerateSubtitles] = useState(true)
  const [generatingScript, setGeneratingScript] = useState(false)

  // VFX / Media input
  const [inputMediaBlob, setInputMediaBlob] = useState<Blob | null>(null)
  const [inputMediaPreview, setInputMediaPreview] = useState<string | null>(null)

  // Technical generation parameters
  const [width, setWidth] = useState(1280)
  const [height, setHeight] = useState(720)
  const [steps, setSteps] = useState(25)
  const [cfg, setCfg] = useState(7.0)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1000000000))
  const [durationSeconds, setDurationSeconds] = useState(4)

  // Execution state
  const [refining, setRefining] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [progressMsg, setProgressMsg] = useState('')
  const [progressPct, setProgressPct] = useState(0)
  const [generatedAsset, setGeneratedAsset] = useState<ComfyGeneratedAsset | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Check ComfyUI server status
  const checkServer = async () => {
    setCheckingServer(true)
    const stats = await comfyClient.checkStatus()
    setServerOnline(stats.online)
    if (stats.devices && stats.devices.length > 0) {
      const dev = stats.devices[0]
      const totalGb = Math.round(dev.vram_total / 1024 / 1024 / 1024)
      const freeGb = Math.round(dev.vram_free / 1024 / 1024 / 1024)
      setVramInfo(`${freeGb}GB libres / ${totalGb}GB (${dev.name})`)
    } else {
      setVramInfo('')
    }
    setCheckingServer(false)
  }

  useEffect(() => {
    checkServer()
  }, [comfyConfig.baseUrl])

  // Refine prompt with AI (Omni IA Game)
  const handleRefinePrompt = async () => {
    if (!prompt.trim()) return
    setRefining(true)
    setErrorMsg(null)
    try {
      const refined = await refinePromptWithAi({
        userPrompt: prompt,
        userNegativePrompt: negativePrompt,
        context,
        assetType,
        artStyle,
        viewMode,
      })
      setPrompt(refined.positivePrompt)
      setNegativePrompt(refined.negativePrompt)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al refinar prompt con IA.')
    } finally {
      setRefining(false)
    }
  }

  // Generate Voiceover Script with AI
  const handleGenerateScriptWithAi = async () => {
    setGeneratingScript(true)
    setErrorMsg(null)
    try {
      const adapter = getDefaultLlmAdapter()
      const promptText = `Eres un guionista y locutor profesional para videos.
Redacta una locución o narración natural en off para un video, clara, dinámica y atractiva, basada en esta descripción o tema:
"${prompt || context || 'Un video cinemático y entretenido'}"

Escribe ÚNICAMENTE el texto que debe pronunciar el locutor, sin acotaciones de cámara ni comentarios.`

      const script = await adapter.generate(
        [{ role: 'user', content: promptText }],
        { maxTokens: 400 }
      )
      setScriptText(script.trim())
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al redactar guion con IA.')
    } finally {
      setGeneratingScript(false)
    }
  }

  // Copy text from existing timeline subtitles
  const handleCopyFromSubtitles = () => {
    const tracks = useTimelineStore.getState().tracks
    const subTrack = tracks.find((t) => t.kind === 'subtitle')
    if (subTrack && subTrack.clips && subTrack.clips.length > 0) {
      const texts = subTrack.clips
        .map((c) => c.cue?.text || c.label)
        .filter(Boolean)
      if (texts.length > 0) {
        setScriptText(texts.join(' '))
        return
      }
    }
    setErrorMsg('No se encontraron subtítulos en la línea de tiempo para copiar.')
  }

  // Capture current preview frame as input image for VFX
  const handleCaptureFrame = () => {
    const canvas = document.querySelector('canvas')
    if (!canvas) {
      setErrorMsg('No se encontró el reproductor de video para capturar.')
      return
    }
    try {
      canvas.toBlob((blob) => {
        if (blob) {
          setInputMediaBlob(blob)
          setInputMediaPreview(URL.createObjectURL(blob))
        }
      }, 'image/png')
    } catch (err) {
      setErrorMsg('Error al capturar fotograma: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const handleInputMediaFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setInputMediaBlob(file)
    setInputMediaPreview(URL.createObjectURL(file))
    e.target.value = ''
  }

  // Trigger generation in ComfyUI
  const handleGenerate = async () => {
    if (assetType === 'voice') {
      if (!scriptText.trim()) {
        setErrorMsg('Por favor escribe el guion o texto a locutar.')
        return
      }
    } else if (assetType !== 'vfx' && !prompt.trim()) {
      setErrorMsg('Por favor ingresa un prompt positivo.')
      return
    }

    setGenerating(true)
    setErrorMsg(null)
    setProgressPct(5)
    setProgressMsg('Conectando a ComfyUI...')

    try {
      const result = await comfyClient.generateAsset(
        {
          positivePrompt: prompt,
          negativePrompt,
          context,
          scriptText: scriptText.trim(),
          assetType,
          artStyle,
          viewMode,
          width,
          height,
          steps,
          cfg,
          seed,
          durationSeconds,
          fps: 24,
          inputMediaBlob: inputMediaBlob || undefined,
        },
        (msg, pct) => {
          setProgressMsg(msg)
          setProgressPct(pct)
        },
      )
      setGeneratedAsset(result)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error en la generación con ComfyUI.')
    } finally {
      setGenerating(false)
    }
  }

  // Insert generated asset into media library and timeline
  const handleInsertToProject = async () => {
    if (!generatedAsset) return
    try {
      const mediaService = await importMediaLibraryService()
      const file = new File([generatedAsset.blob], generatedAsset.fileName, {
        type: generatedAsset.mimeType,
      })
      const imported = await mediaService.addMedia(file)

      // Add to timeline at current playhead
      const timelineState = useTimelineStore.getState()
      const playheadFrame = usePlaybackStore.getState().previewFrame ?? 0
      const isVideoOrImage =
        generatedAsset.assetType === 'video_broll' ||
        generatedAsset.assetType === 'image' ||
        generatedAsset.assetType === 'vfx' ||
        generatedAsset.assetType === 'model3d'

      // Find suitable track
      const tracks = timelineState.tracks
      const targetTrack = tracks.find((t) => (isVideoOrImage ? t.kind === 'video' : t.kind === 'audio'))

      if (targetTrack && imported) {
        timelineState.addClipToTrack(targetTrack.id, {
          type: isVideoOrImage ? (generatedAsset.assetType === 'image' ? 'image' : 'video') : 'audio',
          mediaId: imported.id,
          label: generatedAsset.fileName,
          from: playheadFrame,
          durationInFrames: isVideoOrImage ? 120 : 180,
        })

        // Auto-transcribe if voiceover and requested
        if (generatedAsset.assetType === 'voice' && autoGenerateSubtitles) {
          try {
            const { importMediaTranscriptionService } = await import('@/features/editor/deps/media-library')
            const { mediaTranscriptionService } = await importMediaTranscriptionService()
            await mediaTranscriptionService.insertTranscriptAsCaptions(imported.id, {
              targetTrackId: targetTrack.id,
            })
          } catch {
            // Non-blocking auto-transcription
          }
        }
      }
    } catch (err) {
      setErrorMsg(`Error al insertar en el proyecto: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background p-4 text-xs space-y-4">
      {/* Header con Estado de Servidor */}
      <div className="flex items-center justify-between border-b border-border/40 pb-3">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-primary" />
          <span className="font-semibold text-foreground text-sm">ComfyUI Studio</span>
        </div>

        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium border ${
              serverOnline
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-500'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${serverOnline ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            {serverOnline ? 'ComfyUI Online' : 'Desconectado'}
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={checkServer}
            disabled={checkingServer}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checkingServer ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {vramInfo && (
        <p className="text-[11px] text-muted-foreground -mt-2">
          GPU: <span className="font-mono text-foreground">{vramInfo}</span>
        </p>
      )}

      {/* Selector de Tipo de Asset / Ranura */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Ranura de Generación</Label>
        <div className="grid grid-cols-4 gap-1.5">
          {ASSET_TYPE_OPTIONS.map((opt) => {
            const Icon = opt.icon
            const isSelected = assetType === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setAssetType(opt.id)}
                className={`flex flex-col items-center justify-center gap-1 rounded-md border p-2 text-center transition-all ${
                  isSelected
                    ? 'border-primary bg-primary/10 text-primary font-medium shadow-sm'
                    : 'border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/40'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate text-[10px] max-w-full leading-tight">{opt.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Indicador de Workflow Activo de la Ranura */}
      <div className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-muted/30 border border-border/40 text-[11px]">
        <div className="flex items-center gap-1.5 min-w-0">
          <FileCode2 className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-muted-foreground shrink-0">Workflow:</span>
          <span className="font-mono font-medium text-foreground truncate max-w-[150px]" title={activeSlot.workflowName}>
            {activeSlot.workflowName || 'Workflow'}
          </span>
          <span
            className={cn(
              'rounded px-1.5 py-0.2 text-[9px] font-semibold border shrink-0',
              activeSlot.isCustom
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
                : 'border-border/60 bg-muted/60 text-muted-foreground'
            )}
          >
            {activeSlot.isCustom ? 'Personalizado' : 'Preset'}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:inline">
          (Configurable en Ajustes ⚙️)
        </span>
      </div>

      {/* SECCIÓN ESPECIAL: VOZ EN OFF / VOZ NATURAL */}
      {assetType === 'voice' && (
        <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold flex items-center gap-1.5">
              <Mic className="w-3.5 h-3.5 text-primary" />
              Guion de Locución / Narración
            </Label>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 text-[10px] gap-1 px-1.5"
                onClick={handleCopyFromSubtitles}
                title="Copiar texto desde los subtítulos de la pista activa"
              >
                <Copy className="w-3 h-3" />
                Desde Subtítulos
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] gap-1 text-primary hover:text-primary hover:bg-primary/10 px-1.5"
                onClick={handleGenerateScriptWithAi}
                disabled={generatingScript}
                title="Generar narración con el LLM activo"
              >
                {generatingScript ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Redactar con IA
              </Button>
            </div>
          </div>

          <Textarea
            placeholder="Escribe aquí el texto que la voz de IA debe pronunciar con cadencia natural..."
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
            className="h-28 text-xs resize-none"
          />

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="auto-subtitles-check"
              checked={autoGenerateSubtitles}
              onChange={(e) => setAutoGenerateSubtitles(e.target.checked)}
              className="rounded border-border text-primary focus:ring-primary w-3.5 h-3.5"
            />
            <Label htmlFor="auto-subtitles-check" className="text-[11px] text-muted-foreground font-normal cursor-pointer">
              Auto-generar subtítulos animados con Whisper al insertar la voz en la línea de tiempo
            </Label>
          </div>
        </div>
      )}

      {/* SECCIÓN ESPECIAL: EFECTOS VISUALES / IMG2IMG (VFX) */}
      {assetType === 'vfx' && (
        <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          <Label className="text-xs font-semibold flex items-center gap-1.5">
            <Camera className="w-3.5 h-3.5 text-primary" />
            Medio de Entrada (Clip / Fotograma)
          </Label>

          <input
            ref={inputMediaFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleInputMediaFileChange}
          />

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={handleCaptureFrame}
            >
              <Camera className="w-3.5 h-3.5" />
              Capturar Fotograma Actual
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => inputMediaFileRef.current?.click()}
            >
              <Upload className="w-3.5 h-3.5" />
              Subir Imagen
            </Button>
          </div>

          {inputMediaPreview && (
            <div className="relative rounded overflow-hidden border border-border/60 max-w-[200px]">
              <img src={inputMediaPreview} alt="Entrada VFX" className="w-full h-auto object-cover max-h-32" />
              <button
                type="button"
                onClick={() => {
                  setInputMediaBlob(null)
                  setInputMediaPreview(null)
                }}
                className="absolute top-1 right-1 bg-black/70 hover:bg-black text-white text-[10px] rounded px-1"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      )}

      {/* Controles de Estilo y Vista de Cámara (para Video, Imagen, VFX y 3D) */}
      {(assetType === 'video_broll' || assetType === 'image' || assetType === 'vfx' || assetType === 'model3d') && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Estilo Artístico</Label>
            <Select value={artStyle} onValueChange={(v) => setArtStyle(v as ComfyArtStyle)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ART_STYLE_OPTIONS.map((style) => (
                  <SelectItem key={style.id} value={style.id} className="text-xs">
                    {style.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Encuadre / Cámara</Label>
            <Select value={viewMode} onValueChange={(v) => setViewMode(v as ComfyViewMode)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIEW_MODE_OPTIONS.map((view) => (
                  <SelectItem key={view.id} value={view.id} className="text-xs">
                    {view.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Prompt Positivo con Refinador de IA (Para todos excepto Voz si ya tiene su guion) */}
      {assetType !== 'voice' && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">Prompt Positivo</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] gap-1 text-primary hover:text-primary hover:bg-primary/10 px-2"
              onClick={handleRefinePrompt}
              disabled={refining || !prompt.trim()}
            >
              {refining ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Refinar con IA
            </Button>
          </div>
          <Textarea
            placeholder={
              assetType === 'music'
                ? 'Género musical, instrumentos, tempo, atmósfera (ej: Synthwave 80s, ritmo enérgico)'
                : assetType === 'sfx'
                ? 'Efecto de sonido (ej: Paso pesado sobre grava, relámpago con trueno profundo)'
                : 'Describe la escena, acción o estilo visual deseado...'
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="h-20 text-xs resize-none"
          />
        </div>
      )}

      {/* Prompt Negativo (Para visuales y audio no-voz) */}
      {assetType !== 'voice' && (
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Prompt Negativo</Label>
          <Textarea
            placeholder="Excluir elementos (borroso, baja calidad, artefactos, ruido...)"
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            className="h-14 text-xs resize-none font-mono"
          />
        </div>
      )}

      {/* Contexto Opcional de la Escena */}
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Contexto de la Escena (Opcional)</Label>
        <Input
          placeholder="Ej: Escena nocturna en Tokio lloviendo, personaje en primer plano"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          className="h-7 text-xs"
        />
      </div>

      {/* Parámetros Técnicos */}
      <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5 space-y-2.5">
        <div className="grid grid-cols-2 gap-2">
          {assetType === 'video_broll' || assetType === 'image' || assetType === 'vfx' ? (
            <>
              <div>
                <Label className="text-[10px] text-muted-foreground">Resolución</Label>
                <div className="flex items-center gap-1 mt-0.5">
                  <Input
                    type="number"
                    value={width}
                    onChange={(e) => setWidth(Number(e.target.value))}
                    className="h-7 text-xs font-mono"
                  />
                  <span>×</span>
                  <Input
                    type="number"
                    value={height}
                    onChange={(e) => setHeight(Number(e.target.value))}
                    className="h-7 text-xs font-mono"
                  />
                </div>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Pasos (Steps)</Label>
                <Input
                  type="number"
                  value={steps}
                  min={10}
                  max={60}
                  onChange={(e) => setSteps(Number(e.target.value))}
                  className="h-7 text-xs font-mono mt-0.5"
                />
              </div>
            </>
          ) : (
            <div>
              <Label className="text-[10px] text-muted-foreground">Duración (segundos)</Label>
              <Input
                type="number"
                value={durationSeconds}
                min={1}
                max={60}
                onChange={(e) => setDurationSeconds(Number(e.target.value))}
                className="h-7 text-xs font-mono mt-0.5"
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Label className="text-[10px] text-muted-foreground">Semilla (Seed)</Label>
            <Input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
              className="h-7 text-xs font-mono"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7 mt-3.5"
            onClick={() => setSeed(Math.floor(Math.random() * 1000000000))}
            title="Generar nueva semilla aleatoria"
          >
            <Dices className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Botón de Generación Principal */}
      <Button
        className="w-full h-9 text-xs font-medium gap-2 shadow-sm"
        onClick={handleGenerate}
        disabled={generating || !serverOnline}
      >
        {generating ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>{progressMsg || 'Generando en ComfyUI...'}</span>
          </>
        ) : (
          <>
            <Sparkles className="w-3.5 h-3.5" />
            <span>Generar {ASSET_TYPE_OPTIONS.find((a) => a.id === assetType)?.label}</span>
          </>
        )}
      </Button>

      {/* Barra de Progreso si está en ejecución */}
      {generating && (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground text-center font-mono">{progressPct}% completado</p>
        </div>
      )}

      {/* Mensaje de Error si ocurre */}
      {errorMsg && (
        <div className="rounded border border-rose-500/40 bg-rose-500/10 p-2 text-rose-500 text-[11px]">
          {errorMsg}
        </div>
      )}

      {/* Previsualización del Asset Generado y Botón para Insertar en Línea de Tiempo */}
      {generatedAsset && (
        <div className="rounded-lg border border-border/80 bg-muted/40 p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-xs text-foreground flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 text-emerald-500" />
              Resultado Generado
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">{generatedAsset.fileName}</span>
          </div>

          {/* Previsualizador condicional según MIME */}
          {generatedAsset.mimeType.startsWith('image/') && (
            <div className="overflow-hidden rounded border border-border/60 bg-black/40">
              <img src={generatedAsset.url} alt="Generado" className="max-h-56 w-full object-contain" />
            </div>
          )}

          {generatedAsset.mimeType.startsWith('video/') && (
            <div className="overflow-hidden rounded border border-border/60 bg-black/40">
              <video src={generatedAsset.url} controls className="max-h-56 w-full" autoPlay loop muted />
            </div>
          )}

          {generatedAsset.mimeType.startsWith('audio/') && (
            <div className="p-2 rounded border border-border/60 bg-background/60">
              <audio src={generatedAsset.url} controls className="w-full h-8" />
            </div>
          )}

          {generatedAsset.assetType === 'model3d' && (
            <div className="p-3 text-center rounded border border-border/60 bg-background/60 text-[11px] text-muted-foreground">
              📦 Modelo 3D (.glb) listo para importar
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button
              className="flex-1 h-8 text-xs gap-1.5"
              onClick={handleInsertToProject}
            >
              <Plus className="w-3.5 h-3.5" />
              Insertar en Línea de Tiempo
            </Button>
            <a
              href={generatedAsset.url}
              download={generatedAsset.fileName}
              className="inline-flex items-center justify-center h-8 px-2.5 rounded-md border border-border text-xs hover:bg-muted"
              title="Descargar archivo"
            >
              <Download className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
