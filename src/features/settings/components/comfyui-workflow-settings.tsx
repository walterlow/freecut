import { useRef, useState } from 'react'
import {
  Captions,
  Check,
  CheckCircle2,
  FileCode2,
  Film,
  Image as ImageIcon,
  Layers,
  Loader2,
  Mic,
  Music,
  RotateCcw,
  Server,
  SlidersHorizontal,
  Upload,
  Volume2,
  Wand2,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useComfyWorkflowStore } from '@/infrastructure/comfyui/workflow-store'
import { useAiSettingsStore } from '@/shared/state/ai-settings-store'
import type { ComfyAssetType } from '@/infrastructure/comfyui/types'
import { cn } from '@/shared/ui/cn'

interface WorkflowCategoryMeta {
  id: ComfyAssetType
  label: string
  shortLabel: string
  description: string
  icon: typeof Film
}

const WORKFLOW_CATEGORIES: WorkflowCategoryMeta[] = [
  {
    id: 'video_broll',
    label: 'Video B-Roll',
    shortLabel: 'Video',
    description: 'Workflows para planos de apoyo y tomas de video (Wan 2.1, AnimateDiff, CogVideoX, LTX, SVD).',
    icon: Film,
  },
  {
    id: 'image',
    label: 'Imagen Fija',
    shortLabel: 'Imagen',
    description: 'Workflows para imágenes fijas, miniaturas, fondos y texturas (Flux.1, SDXL, SD 1.5).',
    icon: ImageIcon,
  },
  {
    id: 'voice',
    label: 'Voz en Off / Natural',
    shortLabel: 'Voz en Off',
    description: 'Workflows de locución con IA, clonación y TTS natural (F5-TTS, CosyVoice, Kokoro, ChatTTS).',
    icon: Mic,
  },
  {
    id: 'music',
    label: 'Música de Fondo',
    shortLabel: 'Música',
    description: 'Workflows de composición musical y bandas sonoras (MusicGen, Stable Audio, Ace-Step).',
    icon: Music,
  },
  {
    id: 'sfx',
    label: 'Efectos de Sonido',
    shortLabel: 'Sonido SFX',
    description: 'Workflows para Foley, impactos, transiciones de audio y ambiente (AudioLDM2, Stable Audio SFX).',
    icon: Volume2,
  },
  {
    id: 'vfx',
    label: 'Efectos Visuales (VFX / Img2Img)',
    shortLabel: 'Efectos VFX',
    description: 'Workflows para transformar o estilizar fotogramas de la línea de tiempo (ControlNet, Upscale).',
    icon: Wand2,
  },
  {
    id: 'model3d',
    label: 'Modelos 3D (.glb)',
    shortLabel: 'Modelos 3D',
    description: 'Workflows para generar mallas 3D importables a partir de prompts o imágenes (TripoSR, Hunyuan3D).',
    icon: Layers,
  },
  {
    id: 'transcription',
    label: 'Transcripción (Audio a Texto)',
    shortLabel: 'Transcripción',
    description: 'Workflows para transcribir voz a texto y subtítulos con marcas de tiempo (ComfyUI-Whisper, SenseVoice, Audio-Subtitles).',
    icon: Captions,
  },
]

export function ComfyUiWorkflowSettings() {
  const [selectedSlot, setSelectedSlot] = useState<ComfyAssetType>('video_broll')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const slot = useComfyWorkflowStore((s) => s.slots[selectedSlot] || s.getSlot(selectedSlot))
  const loadWorkflowJson = useComfyWorkflowStore((s) => s.loadWorkflowJson)
  const updateSlotBindings = useComfyWorkflowStore((s) => s.updateSlotBindings)
  const resetSlotToPreset = useComfyWorkflowStore((s) => s.resetSlotToPreset)

  const [pasteDialogOpen, setPasteDialogOpen] = useState(false)
  const [pasteContent, setPasteContent] = useState('')
  const [bindingsDialogOpen, setBindingsDialogOpen] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  const nodeCount = Object.keys(slot.rawWorkflow || {}).length
  const nodesList = Object.entries(slot.rawWorkflow || {}).map(([id, node]: [string, any]) => ({
    id,
    label: `${id}: ${node?.class_type || 'Unknown'}`,
    classType: node?.class_type || '',
  }))

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      if (!text) return
      const res = loadWorkflowJson(selectedSlot, text, file.name)
      if (res.success) {
        setFeedback({
          ok: true,
          msg: `Workflow "${file.name}" cargado para ${slot.label} (${Object.keys(useComfyWorkflowStore.getState().getSlot(selectedSlot).rawWorkflow).length} nodos).`,
        })
      } else {
        setFeedback({
          ok: false,
          msg: res.error || 'Error al cargar el archivo JSON.',
        })
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handlePasteSubmit = () => {
    if (!pasteContent.trim()) return
    const res = loadWorkflowJson(selectedSlot, pasteContent, `Custom_${selectedSlot}.json`)
    if (res.success) {
      setFeedback({ ok: true, msg: `Workflow pegado y vinculado para ${slot.label}.` })
      setPasteDialogOpen(false)
      setPasteContent('')
    } else {
      setFeedback({ ok: false, msg: res.error || 'Error al procesar el JSON pegado.' })
    }
  }

  const comfyui = useAiSettingsStore((s) => s.comfyui)
  const setComfyUiBaseUrl = useAiSettingsStore((s) => s.setComfyUiBaseUrl)
  const [testingComfy, setTestingComfy] = useState(false)
  const [comfyTestResult, setComfyTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const handleTestComfy = async () => {
    setTestingComfy(true)
    setComfyTestResult(null)
    const url = comfyui.baseUrl.trim().replace(/\/+$/, '')
    try {
      const res = await fetch(`${url}/system_stats`, { signal: AbortSignal.timeout(4000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const vram = data?.devices?.[0]?.vram_total
        ? ` (VRAM: ${(data.devices[0].vram_total / 1024 / 1024 / 1024).toFixed(1)} GB)`
        : ''
      setComfyTestResult({ ok: true, message: `ComfyUI conectado exitosamente${vram}` })
    } catch {
      setComfyTestResult({
        ok: false,
        message: `No se pudo conectar a ComfyUI en ${url}. Asegúrate de que esté encendido y con CORS habilitado (--enable-cors-header).`,
      })
    } finally {
      setTestingComfy(false)
    }
  }

  return (
    <div className="space-y-6 pt-1">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Servidor Local ComfyUI */}
      <div className="space-y-3 pb-3 border-b border-border/40">
        <div>
          <Label className="text-sm font-semibold flex items-center gap-1.5">
            <Server className="w-4 h-4 text-primary" />
            Servidor ComfyUI Local
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Conexión para generación de B-Roll, audio, SFX, voces y assets 3D en tiempo real.
          </p>
        </div>

        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">URL del Servidor ComfyUI</Label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={comfyui.baseUrl}
                onChange={(e) => setComfyUiBaseUrl(e.target.value)}
                placeholder="http://127.0.0.1:8188"
                className="h-8 text-xs font-mono flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={handleTestComfy}
                disabled={testingComfy}
              >
                {testingComfy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                Probar Conexión
              </Button>
            </div>
          </div>

          {comfyTestResult && (
            <p
              className={`text-xs flex items-center gap-1.5 ${
                comfyTestResult.ok ? 'text-emerald-500' : 'text-rose-500'
              }`}
            >
              {comfyTestResult.ok ? (
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
              ) : (
                <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
              )}
              {comfyTestResult.message}
            </p>
          )}

          <p className="text-[11px] text-muted-foreground">
            💡 <em>Tip:</em> Inicia ComfyUI con el flag <code>--enable-cors-header "*"</code> para permitir que el navegador se comunique directamente con él.
          </p>
        </div>
      </div>

      <div>
        <Label className="text-sm font-semibold">Workflows de ComfyUI por Categoría</Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          Carga aquí tus propios archivos <code>.json</code> (formato API o estándar exportado desde ComfyUI) para cada tipo de generación.
        </p>
      </div>

      {/* Selector de Pestaña / Sección */}
      <Tabs
        value={selectedSlot}
        onValueChange={(val) => {
          setSelectedSlot(val as ComfyAssetType)
          setFeedback(null)
        }}
        className="w-full"
      >
        <TabsList className="grid grid-cols-4 sm:grid-cols-7 h-auto p-1 bg-muted/40 gap-1">
          {WORKFLOW_CATEGORIES.map((cat) => {
            const Icon = cat.icon
            const isCustom = useComfyWorkflowStore.getState().getSlot(cat.id)?.isCustom
            return (
              <TabsTrigger
                key={cat.id}
                value={cat.id}
                className="text-[11px] py-1.5 px-2 flex flex-col sm:flex-row items-center gap-1 data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{cat.shortLabel}</span>
                {isCustom && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="Personalizado" />}
              </TabsTrigger>
            )
          })}
        </TabsList>

        {WORKFLOW_CATEGORIES.map((cat) => (
          <TabsContent key={cat.id} value={cat.id} className="mt-3 space-y-3">
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/40 pb-2.5">
                <div>
                  <h4 className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                    <cat.icon className="w-4 h-4 text-primary" />
                    Sección: {cat.label}
                  </h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{cat.description}</p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className={cn(
                      'rounded px-2 py-0.5 text-[10px] font-semibold border',
                      slot.isCustom
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
                        : 'border-border/60 bg-muted/60 text-muted-foreground'
                    )}
                  >
                    {slot.isCustom ? 'Personalizado' : 'Preset de Referencia'}
                  </span>
                </div>
              </div>

              {/* Fila con Detalles del Archivo y Botones de Acción */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-background/50 rounded-md p-2.5 border border-border/40">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FileCode2 className="w-4 h-4 text-primary shrink-0" />
                    <span className="font-mono text-xs font-medium text-foreground truncate" title={slot.workflowName}>
                      {slot.workflowName || 'Workflow.json'}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {nodeCount} nodos • Nodos de control detectados automáticamente
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1 px-2"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Cargar JSON
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs px-2"
                    onClick={() => setPasteDialogOpen(true)}
                  >
                    Pegar JSON
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1 px-2"
                    onClick={() => setBindingsDialogOpen(true)}
                    title="Ajustar mapeo de nodos"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    Mapeo
                  </Button>

                  {slot.isCustom && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        resetSlotToPreset(cat.id)
                        setFeedback({ ok: true, msg: 'Restablecido al preset base de referencia.' })
                      }}
                      title="Restablecer al preset base"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              {feedback && (
                <div
                  className={cn(
                    'text-xs flex items-center justify-between gap-1 rounded p-2',
                    feedback.ok ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'
                  )}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    {feedback.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                    {feedback.msg}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFeedback(null)}
                    className="text-xs opacity-70 hover:opacity-100"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Resumen de Nodos Mapeados para Verificación */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] bg-muted/30 p-2 rounded border border-border/30">
                {cat.id === 'voice' ? (
                  <div>
                    <span className="text-muted-foreground">Guion de Voz (TTS):</span>{' '}
                    <span className="font-mono text-foreground">
                      {slot.bindings.scriptTextNodeId ? `Nodo #${slot.bindings.scriptTextNodeId}` : 'No asignado'}
                    </span>
                  </div>
                ) : (
                  <>
                    <div>
                      <span className="text-muted-foreground">Prompt Positivo:</span>{' '}
                      <span className="font-mono text-foreground">
                        {slot.bindings.positivePromptNodeId ? `Nodo #${slot.bindings.positivePromptNodeId}` : 'No asignado'}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Prompt Negativo:</span>{' '}
                      <span className="font-mono text-foreground">
                        {slot.bindings.negativePromptNodeId ? `Nodo #${slot.bindings.negativePromptNodeId}` : 'No asignado'}
                      </span>
                    </div>
                  </>
                )}

                <div>
                  <span className="text-muted-foreground">Sampler / Semilla:</span>{' '}
                  <span className="font-mono text-foreground">
                    {slot.bindings.seedNodeId ? `Nodo #${slot.bindings.seedNodeId}` : 'No asignado'}
                  </span>
                </div>

                {cat.id === 'vfx' && (
                  <div>
                    <span className="text-muted-foreground">Entrada Clip/Frame:</span>{' '}
                    <span className="font-mono text-foreground">
                      {slot.bindings.inputMediaNodeId ? `Nodo #${slot.bindings.inputMediaNodeId}` : 'No asignado'}
                    </span>
                  </div>
                )}

                <div>
                  <span className="text-muted-foreground">Salida del Asset:</span>{' '}
                  <span className="font-mono text-foreground">
                    {slot.bindings.outputNodeId ? `Nodo #${slot.bindings.outputNodeId}` : 'Detectado automático'}
                  </span>
                </div>
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {/* Dialog para Pegar JSON */}
      <Dialog open={pasteDialogOpen} onOpenChange={setPasteDialogOpen}>
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Upload className="w-4 h-4 text-primary" />
              Pegar Workflow JSON ({WORKFLOW_CATEGORIES.find((c) => c.id === selectedSlot)?.label})
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Pega aquí el JSON exportado desde ComfyUI (Save API format o Save estándar).
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={pasteContent}
            onChange={(e) => setPasteContent(e.target.value)}
            placeholder='{ "1": { "class_type": "CheckpointLoaderSimple", ... } }'
            className="h-64 font-mono text-xs resize-none"
          />

          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <span className="text-[11px] text-muted-foreground">
              Se detectarán automáticamente los nodos de prompt, sampler y salida.
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPasteDialogOpen(false)}>
                Cancelar
              </Button>
              <Button size="sm" onClick={handlePasteSubmit} disabled={!pasteContent.trim()}>
                Cargar Workflow
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog para Mapeo de Nodos */}
      <Dialog open={bindingsDialogOpen} onOpenChange={setBindingsDialogOpen}>
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-primary" />
              Mapeo de Nodos: {slot.label}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Selecciona qué nodo de tu workflow recibe cada parámetro dinámico.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto pr-1">
            {selectedSlot === 'voice' ? (
              <div className="space-y-1">
                <Label className="text-xs font-medium">Nodo de Guion / Texto de Voz (TTS)</Label>
                <Select
                  value={slot.bindings.scriptTextNodeId || 'none'}
                  onValueChange={(val) =>
                    updateSlotBindings(selectedSlot, { scriptTextNodeId: val === 'none' ? undefined : val })
                  }
                >
                  <SelectTrigger className="h-8 text-xs font-mono">
                    <SelectValue placeholder="Seleccionar nodo..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" className="text-xs">
                      (Ninguno / No asignar)
                    </SelectItem>
                    {nodesList.map((n) => (
                      <SelectItem key={n.id} value={n.id} className="text-xs font-mono">
                        {n.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Nodo para Prompt Positivo</Label>
                  <Select
                    value={slot.bindings.positivePromptNodeId || 'none'}
                    onValueChange={(val) =>
                      updateSlotBindings(selectedSlot, { positivePromptNodeId: val === 'none' ? undefined : val })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs font-mono">
                      <SelectValue placeholder="Seleccionar nodo..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" className="text-xs">
                        (Ninguno / No asignar)
                      </SelectItem>
                      {nodesList.map((n) => (
                        <SelectItem key={n.id} value={n.id} className="text-xs font-mono">
                          {n.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-medium">Nodo para Prompt Negativo</Label>
                  <Select
                    value={slot.bindings.negativePromptNodeId || 'none'}
                    onValueChange={(val) =>
                      updateSlotBindings(selectedSlot, { negativePromptNodeId: val === 'none' ? undefined : val })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs font-mono">
                      <SelectValue placeholder="Seleccionar nodo..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" className="text-xs">
                        (Ninguno / No asignar)
                      </SelectItem>
                      {nodesList.map((n) => (
                        <SelectItem key={n.id} value={n.id} className="text-xs font-mono">
                          {n.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="space-y-1">
              <Label className="text-xs font-medium">Nodo de Sampler / Semilla (Seed)</Label>
              <Select
                value={slot.bindings.seedNodeId || 'none'}
                onValueChange={(val) =>
                  updateSlotBindings(selectedSlot, {
                    seedNodeId: val === 'none' ? undefined : val,
                    samplerNodeId: val === 'none' ? undefined : val,
                  })
                }
              >
                <SelectTrigger className="h-8 text-xs font-mono">
                  <SelectValue placeholder="Seleccionar nodo..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">
                    (Ninguno / No asignar)
                  </SelectItem>
                  {nodesList.map((n) => (
                    <SelectItem key={n.id} value={n.id} className="text-xs font-mono">
                      {n.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedSlot === 'vfx' && (
              <div className="space-y-1">
                <Label className="text-xs font-medium">Nodo de Entrada de Medios (LoadImage / Clip)</Label>
                <Select
                  value={slot.bindings.inputMediaNodeId || 'none'}
                  onValueChange={(val) =>
                    updateSlotBindings(selectedSlot, { inputMediaNodeId: val === 'none' ? undefined : val })
                  }
                >
                  <SelectTrigger className="h-8 text-xs font-mono">
                    <SelectValue placeholder="Seleccionar nodo..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" className="text-xs">
                      (Ninguno / No asignar)
                    </SelectItem>
                    {nodesList.map((n) => (
                      <SelectItem key={n.id} value={n.id} className="text-xs font-mono">
                        {n.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs font-medium">Nodo de Salida del Asset (Save/Combine)</Label>
              <Select
                value={slot.bindings.outputNodeId || 'none'}
                onValueChange={(val) =>
                  updateSlotBindings(selectedSlot, { outputNodeId: val === 'none' ? undefined : val })
                }
              >
                <SelectTrigger className="h-8 text-xs font-mono">
                  <SelectValue placeholder="Seleccionar nodo..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">
                    (Ninguno / No asignar)
                  </SelectItem>
                  {nodesList.map((n) => (
                    <SelectItem key={n.id} value={n.id} className="text-xs font-mono">
                      {n.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button size="sm" onClick={() => setBindingsDialogOpen(false)}>
              Listo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
