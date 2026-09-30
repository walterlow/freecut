import { useEffect, useState } from 'react'
import {
  Check,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Sparkles,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useAiSettingsStore,
  type AiProviderId,
} from '@/shared/state/ai-settings-store'
import {
  getLlmAdapter,
  fetchOllamaModels,
  fetchGeminiModels,
  fetchOpenAiCompatibleModels,
} from '@/infrastructure/llm'
import { cn } from '@/shared/ui/cn'
import { ComfyUiWorkflowSettings } from './comfyui-workflow-settings'

const PROVIDER_METADATA: Record<
  AiProviderId,
  {
    name: string
    description: string
    helpUrl?: string
    placeholderKey?: string
    defaultModels: string[]
    needsKey: boolean
    isLocal: boolean
  }
> = {
  gemini: {
    name: 'Google Gemini',
    description: 'Modelos multimodales rápidos y de última generación (Gemini 3.8 / 3.5).',
    helpUrl: 'https://aistudio.google.com/app/apikey',
    placeholderKey: 'AIzaSy...',
    defaultModels: [
      'gemini-3.8-flash',
      'gemini-3.8-pro',
      'gemini-3.5-pro',
      'gemini-3.5-flash',
      'gemini-3-flash-thinking',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.0-flash',
    ],
    needsKey: true,
    isLocal: false,
  },
  ollama: {
    name: 'Ollama (Local)',
    description: 'Servidor local de IA: detecta y carga tus modelos instalados sin telemetría.',
    helpUrl: 'https://ollama.com',
    defaultModels: [
      'qwen3.6:27b',
      'qwen3.6:35b-a3b',
      'qwen3:32b',
      'gemma4:26b',
      'deepseek-r1:7b',
      'llama3:8b',
      'qwen2.5-coder:32b',
      'qwen2.5-coder:14b',
      'deepseek-coder-v2:latest',
    ],
    needsKey: false,
    isLocal: true,
  },
  openai: {
    name: 'OpenAI',
    description: 'Modelos GPT-5, o3 y razonamiento de última generación.',
    helpUrl: 'https://platform.openai.com/api-keys',
    placeholderKey: 'sk-...',
    defaultModels: [
      'gpt-5',
      'gpt-5-mini',
      'o3',
      'o3-mini',
      'gpt-4.5',
      'gpt-4o',
      'gpt-4o-mini',
      'o1',
    ],
    needsKey: true,
    isLocal: false,
  },
  anthropic: {
    name: 'Anthropic Claude',
    description: 'Claude 4 y Claude 3.7 Sonnet para razonamiento y edición compleja.',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    placeholderKey: 'sk-ant-...',
    defaultModels: [
      'claude-4-sonnet-latest',
      'claude-4-opus-latest',
      'claude-3-7-sonnet-latest',
      'claude-3-5-sonnet-latest',
      'claude-3-5-haiku-latest',
    ],
    needsKey: true,
    isLocal: false,
  },
  deepseek: {
    name: 'DeepSeek',
    description: 'DeepSeek-V3 y R1 con razonamiento de frontera y costo ultra bajo.',
    helpUrl: 'https://platform.deepseek.com/api_keys',
    placeholderKey: 'sk-...',
    defaultModels: [
      'deepseek-v3',
      'deepseek-r1',
      'deepseek-coder-v2',
      'deepseek-chat',
      'deepseek-reasoner',
    ],
    needsKey: true,
    isLocal: false,
  },
  openrouter: {
    name: 'OpenRouter',
    description: 'Pasarela unificada a los últimos modelos de IA globales.',
    helpUrl: 'https://openrouter.ai/keys',
    placeholderKey: 'sk-or-...',
    defaultModels: [
      'openrouter/auto',
      'google/gemini-3.8-flash',
      'anthropic/claude-4-sonnet',
      'openai/gpt-5',
      'deepseek/deepseek-v3',
      'meta-llama/llama-3.3-70b-instruct',
    ],
    needsKey: true,
    isLocal: false,
  },
  groq: {
    name: 'Groq',
    description: 'Inferencia ultra rápida con LPUs para modelos Llama 3 y Mixtral.',
    helpUrl: 'https://console.groq.com/keys',
    placeholderKey: 'gsk_...',
    defaultModels: [
      'llama-3.3-70b-versatile',
      'llama-3.1-405b-reasoning',
      'mixtral-8x22b-32768',
      'qwen-2.5-72b-instruct',
      'llama-3.1-8b-instant',
    ],
    needsKey: true,
    isLocal: false,
  },
  gemma: {
    name: 'Gemma 4 (On-Device WebGPU)',
    description: 'Modelo en navegador sin servidor externo (requiere WebGPU).',
    defaultModels: ['gemma-4-on-device'],
    needsKey: false,
    isLocal: true,
  },
}

export function AiProviderSettings() {
  const activeProvider = useAiSettingsStore((s) => s.activeProvider)
  const providers = useAiSettingsStore((s) => s.providers)
  const discoveredModels = useAiSettingsStore((s) => s.discoveredModels)
  const setActiveProvider = useAiSettingsStore((s) => s.setActiveProvider)
  const setProviderConfig = useAiSettingsStore((s) => s.setProviderConfig)
  const setDiscoveredModels = useAiSettingsStore((s) => s.setDiscoveredModels)

  const [showKey, setShowKey] = useState(false)
  const [testingAi, setTestingAi] = useState(false)
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [scanningModels, setScanningModels] = useState(false)
  const [scanMessage, setScanMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const activeMeta = PROVIDER_METADATA[activeProvider]
  const currentConfig = providers[activeProvider] ?? {}

  const handleScanModels = async (manual = false) => {
    setScanningModels(true)
    if (manual) setScanMessage(null)

    try {
      if (activeProvider === 'ollama') {
        const url = currentConfig.baseUrl || 'http://127.0.0.1:11434'
        const list = await fetchOllamaModels(url)
        if (list.length > 0) {
          setDiscoveredModels('ollama', list)
          // If current model not set or not in list, auto-select the first one
          if (!currentConfig.model || !list.includes(currentConfig.model)) {
            setProviderConfig('ollama', { model: list[0] })
          }
          if (manual) {
            setScanMessage({ ok: true, text: `Se detectaron ${list.length} modelos instalados en tu Ollama.` })
          }
        } else if (manual) {
          setScanMessage({
            ok: false,
            text: `No se encontraron modelos en Ollama (${url}). Asegúrate de ejecutar 'ollama serve'.`,
          })
        }
      } else if (activeProvider === 'gemini') {
        if (!currentConfig.apiKey) {
          if (manual) setScanMessage({ ok: false, text: 'Ingresa tu API Key de Gemini para escanear modelos disponibles.' })
          return
        }
        const list = await fetchGeminiModels(currentConfig.apiKey, currentConfig.baseUrl)
        if (list.length > 0) {
          setDiscoveredModels('gemini', list)
          if (manual) setScanMessage({ ok: true, text: `Se detectaron ${list.length} modelos disponibles en tu cuenta de Gemini.` })
        } else if (manual) {
          setScanMessage({ ok: false, text: 'No se pudieron consultar los modelos con la clave proporcionada.' })
        }
      } else if (['openai', 'deepseek', 'openrouter', 'groq'].includes(activeProvider)) {
        if (!currentConfig.apiKey) {
          if (manual) setScanMessage({ ok: false, text: `Ingresa tu API Key de ${activeMeta.name} para consultar modelos.` })
          return
        }
        const targetUrl = currentConfig.baseUrl || (
          activeProvider === 'openrouter' ? 'https://openrouter.ai/api/v1' :
          activeProvider === 'deepseek' ? 'https://api.deepseek.com/v1' :
          activeProvider === 'groq' ? 'https://api.groq.com/openai/v1' :
          'https://api.openai.com/v1'
        )
        const list = await fetchOpenAiCompatibleModels(targetUrl, currentConfig.apiKey)
        if (list.length > 0) {
          setDiscoveredModels(activeProvider, list)
          if (manual) setScanMessage({ ok: true, text: `Se detectaron ${list.length} modelos disponibles.` })
        } else if (manual) {
          setScanMessage({ ok: false, text: 'No se pudieron obtener modelos del servidor.' })
        }
      }
    } catch (err) {
      if (manual) {
        setScanMessage({
          ok: false,
          text: err instanceof Error ? err.message : 'Error al consultar modelos.',
        })
      }
    } finally {
      setScanningModels(false)
    }
  }

  // Auto-scan local Ollama models on select or URL change
  useEffect(() => {
    if (activeProvider === 'ollama') {
      handleScanModels(false)
    }
  }, [activeProvider, currentConfig.baseUrl])

  const handleTestAi = async () => {
    setTestingAi(true)
    setAiTestResult(null)
    try {
      const adapter = getLlmAdapter(activeProvider)
      const reply = await adapter.generate([
        { role: 'user', content: 'Responde únicamente con la palabra OK.' },
      ], { maxTokens: 10 })
      setAiTestResult({ ok: true, message: `Conexión exitosa: "${reply.trim()}"` })
    } catch (err) {
      setAiTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Error desconocido al probar conexión.',
      })
    } finally {
      setTestingAi(false)
    }
  }

  return (
    <div className="space-y-6 pt-1">
      {/* Selector de Proveedor Principal */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Proveedor de Lenguaje (LLM) para Guion y Refinador de Prompts</Label>
            <p className="text-xs text-muted-foreground">
              Utilizado para el asistente de edición, redacción de locución y el refinador inteligente de prompts de ComfyUI.
            </p>
          </div>
          <Select
            value={activeProvider}
            onValueChange={(val) => {
              setActiveProvider(val as AiProviderId)
              setAiTestResult(null)
            }}
          >
            <SelectTrigger className="w-56 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PROVIDER_METADATA).map(([id, meta]) => (
                <SelectItem key={id} value={id} className="text-xs">
                  {meta.name} {meta.isLocal ? '💻' : '☁️'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <h4 className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                {activeMeta.name}
              </h4>
              <p className="text-xs text-muted-foreground mt-0.5">{activeMeta.description}</p>
            </div>
            {activeMeta.helpUrl && (
              <a
                href={activeMeta.helpUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-primary hover:underline flex items-center gap-1"
              >
                Obtener credenciales <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {/* Campo de API Key si aplica */}
          {activeMeta.needsKey && (
            <div className="space-y-1.5">
              <Label className="text-xs">Clave de API (API Key)</Label>
              <div className="relative flex items-center">
                <Input
                  type={showKey ? 'text' : 'password'}
                  placeholder={activeMeta.placeholderKey ?? 'Pega tu API key aquí'}
                  value={currentConfig.apiKey ?? ''}
                  onChange={(e) =>
                    setProviderConfig(activeProvider, { apiKey: e.target.value })
                  }
                  className="h-8 text-xs pr-8 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          )}

          {/* Campo de URL Base si es local o configurable */}
          {(activeMeta.isLocal || activeProvider === 'openrouter') && activeProvider !== 'gemma' && (
            <div className="space-y-1.5">
              <Label className="text-xs">URL del Servidor</Label>
              <Input
                type="text"
                value={currentConfig.baseUrl ?? ''}
                placeholder={activeProvider === 'ollama' ? 'http://127.0.0.1:11434' : 'https://...'}
                onChange={(e) =>
                  setProviderConfig(activeProvider, { baseUrl: e.target.value })
                }
                className="h-8 text-xs font-mono"
              />
            </div>
          )}

          {/* Campo de Modelo */}
          {activeProvider !== 'gemma' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">
                  Modelo Seleccionado
                  {activeProvider === 'ollama' && (
                    <span className="ml-1.5 font-normal text-muted-foreground text-[11px]">
                      (Modelos instalados en tu PC)
                    </span>
                  )}
                </Label>
                <button
                  type="button"
                  onClick={() => handleScanModels(true)}
                  disabled={scanningModels}
                  className="text-[11px] text-primary hover:underline flex items-center gap-1 disabled:opacity-50"
                  title="Detectar modelos instalados o disponibles"
                >
                  <RefreshCw className={cn('w-3 h-3', scanningModels && 'animate-spin')} />
                  {activeProvider === 'ollama' ? 'Escanear PC' : 'Consultar Modelos'}
                </button>
              </div>

              <div className="flex gap-2">
                <Input
                  type="text"
                  value={currentConfig.model ?? ''}
                  placeholder={activeProvider === 'ollama' ? 'ej: qwen3.6:27b' : 'Nombre del modelo'}
                  onChange={(e) =>
                    setProviderConfig(activeProvider, { model: e.target.value })
                  }
                  className="h-8 text-xs font-mono flex-1"
                />
                <Select
                  value={
                    currentConfig.model &&
                    ((discoveredModels[activeProvider]?.includes(currentConfig.model)) ||
                      activeMeta.defaultModels.includes(currentConfig.model))
                      ? currentConfig.model
                      : undefined
                  }
                  onValueChange={(val) => setProviderConfig(activeProvider, { model: val })}
                >
                  <SelectTrigger className="w-48 h-8 text-xs">
                    <SelectValue placeholder="Elegir modelo..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {discoveredModels[activeProvider] && discoveredModels[activeProvider].length > 0 && (
                      <SelectGroup>
                        <SelectLabel className="text-[11px] font-semibold text-emerald-500 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          {activeProvider === 'ollama'
                            ? `Instalados en tu PC (${discoveredModels[activeProvider].length})`
                            : `Disponibles (${discoveredModels[activeProvider].length})`}
                        </SelectLabel>
                        {discoveredModels[activeProvider].map((m) => (
                          <SelectItem key={`disc-${m}`} value={m} className="text-xs font-mono">
                            {m}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}

                    <SelectGroup>
                      <SelectLabel className="text-[11px] font-semibold text-muted-foreground">
                        {discoveredModels[activeProvider]?.length
                          ? 'Otros recomendados (2026)'
                          : 'Modelos recomendados (2026)'}
                      </SelectLabel>
                      {activeMeta.defaultModels
                        .filter((m) => !discoveredModels[activeProvider]?.includes(m))
                        .map((m) => (
                          <SelectItem key={`def-${m}`} value={m} className="text-xs font-mono">
                            {m}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              {scanMessage && (
                <p
                  className={cn(
                    'text-[11px] flex items-center gap-1 mt-1',
                    scanMessage.ok ? 'text-emerald-500' : 'text-amber-500'
                  )}
                >
                  {scanMessage.ok ? (
                    <CheckCircle2 className="w-3 h-3 shrink-0" />
                  ) : (
                    <XCircle className="w-3 h-3 shrink-0" />
                  )}
                  {scanMessage.text}
                </p>
              )}
            </div>
          )}

          {/* Botón de Prueba de Conexión */}
          {activeProvider !== 'gemma' && (
            <div className="flex items-center gap-3 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={handleTestAi}
                disabled={testingAi}
              >
                {testingAi ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Probar Conexión
              </Button>

              {aiTestResult && (
                <span
                  className={`text-xs flex items-center gap-1 ${
                    aiTestResult.ok ? 'text-emerald-500' : 'text-rose-500'
                  }`}
                >
                  {aiTestResult.ok ? (
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  )}
                  {aiTestResult.message}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Carga y Configuración de Workflows ComfyUI Local por Categoría */}
      <div className="pt-4 border-t border-border/40">
        <ComfyUiWorkflowSettings />
      </div>
    </div>
  )
}
