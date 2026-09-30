import { useAiSettingsStore } from '@/shared/state/ai-settings-store'
import { useComfyWorkflowStore } from './workflow-store'
import { injectParametersIntoWorkflow } from './workflow-parser'
import type {
  ComfyGeneratedAsset,
  ComfyGenerationParams,
  ComfySystemStats,
} from './types'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('ComfyClient')

export class ComfyClient {
  private get baseUrl(): string {
    return useAiSettingsStore.getState().comfyui.baseUrl.replace(/\/+$/, '')
  }

  async checkStatus(): Promise<ComfySystemStats> {
    try {
      const resp = await fetch(`${this.baseUrl}/system_stats`, {
        signal: AbortSignal.timeout(4000),
      })
      if (!resp.ok) return { online: false }
      const data = await resp.json()
      return {
        online: true,
        devices: data.devices,
      }
    } catch {
      return { online: false }
    }
  }

  /**
   * Uploads an input image or frame to ComfyUI for Img2Img or ControlNet workflows.
   */
  async uploadImage(blob: Blob, filename = 'freecut_input.png'): Promise<string> {
    const formData = new FormData()
    formData.append('image', blob, filename)
    formData.append('overwrite', 'true')
    const res = await fetch(`${this.baseUrl}/upload/image`, {
      method: 'POST',
      body: formData,
    })
    if (!res.ok) {
      throw new Error(`Error al subir imagen a ComfyUI (${res.status})`)
    }
    const data = await res.json()
    return data.name || filename
  }

  /**
   * Builds a dynamic, universal execution graph for ComfyUI based on asset type and user parameters.
   */
  private buildWorkflowGraph(params: ComfyGenerationParams): Record<string, unknown> {
    const seed = params.seed || Math.floor(Math.random() * 1000000000)

    if (params.assetType === 'music' || params.assetType === 'sfx') {
      // Audio generation graph (AudioLDM or Stable Audio sampler)
      return {
        '1': {
          inputs: {
            text: params.positivePrompt,
          },
          class_type: 'CLIPTextEncode',
        },
        '2': {
          inputs: {
            text: params.negativePrompt,
          },
          class_type: 'CLIPTextEncode',
        },
        '3': {
          inputs: {
            seed,
            steps: params.steps || 25,
            cfg: params.cfg || 7.0,
            positive: ['1', 0],
            negative: ['2', 0],
            duration: params.durationSeconds || 5,
          },
          class_type: 'AudioSampler',
        },
        '4': {
          inputs: {
            audio: ['3', 0],
            filename_prefix: `FreeCut_${params.assetType}`,
          },
          class_type: 'SaveAudio',
        },
      }
    }

    if (params.assetType === 'video_broll') {
      // Video generation graph (AnimateDiff / Wan / Hunyuan / SVD format)
      return {
        '1': {
          inputs: {
            ckpt_name: 'v1-5-pruned-emaonly.safetensors',
          },
          class_type: 'CheckpointLoaderSimple',
        },
        '2': {
          inputs: {
            text: params.positivePrompt,
            clip: ['1', 1],
          },
          class_type: 'CLIPTextEncode',
        },
        '3': {
          inputs: {
            text: params.negativePrompt,
            clip: ['1', 1],
          },
          class_type: 'CLIPTextEncode',
        },
        '4': {
          inputs: {
            width: params.width || 768,
            height: params.height || 512,
            batch_size: Math.min(24, Math.round((params.durationSeconds || 2) * (params.fps || 12))),
          },
          class_type: 'EmptyLatentImage',
        },
        '5': {
          inputs: {
            seed,
            steps: params.steps || 20,
            cfg: params.cfg || 7.0,
            sampler_name: 'euler',
            scheduler: 'normal',
            denoise: 1.0,
            model: ['1', 0],
            positive: ['2', 0],
            negative: ['3', 0],
            latent_image: ['4', 0],
          },
          class_type: 'KSampler',
        },
        '6': {
          inputs: {
            samples: ['5', 0],
            vae: ['1', 2],
          },
          class_type: 'VAEDecode',
        },
        '7': {
          inputs: {
            images: ['6', 0],
            fps: params.fps || 16,
            filename_prefix: 'FreeCut_Broll',
            format: 'video/h264-mp4',
          },
          class_type: 'VHS_VideoCombine',
        },
      }
    }

    // Default: Image Generation Graph (standard SDXL / SD1.5 / Flux compatible)
    return {
      '3': {
        inputs: {
          seed,
          steps: params.steps || 25,
          cfg: params.cfg || 7.0,
          sampler_name: 'euler_ancestral',
          scheduler: 'normal',
          denoise: 1.0,
          model: ['4', 0],
          positive: ['6', 0],
          negative: ['7', 0],
          latent_image: ['5', 0],
        },
        class_type: 'KSampler',
      },
      '4': {
        inputs: {
          ckpt_name: 'sd_xl_base_1.0.safetensors',
        },
        class_type: 'CheckpointLoaderSimple',
      },
      '5': {
        inputs: {
          width: params.width || 1024,
          height: params.height || 1024,
          batch_size: 1,
        },
        class_type: 'EmptyLatentImage',
      },
      '6': {
        inputs: {
          text: params.positivePrompt,
          clip: ['4', 1],
        },
        class_type: 'CLIPTextEncode',
      },
      '7': {
        inputs: {
          text: params.negativePrompt,
          clip: ['4', 1],
        },
        class_type: 'CLIPTextEncode',
      },
      '8': {
        inputs: {
          samples: ['3', 0],
          vae: ['4', 2],
        },
        class_type: 'VAEDecode',
      },
      '9': {
        inputs: {
          filename_prefix: `FreeCut_${params.assetType}`,
          images: ['8', 0],
        },
        class_type: 'SaveImage',
      },
    }
  }

  /**
   * Submits prompt to ComfyUI, monitors WebSocket/polling, and retrieves the generated file.
   */
  async generateAsset(
    params: ComfyGenerationParams,
    onProgress?: (message: string, percent: number) => void,
  ): Promise<ComfyGeneratedAsset> {
    const clientId = `freecut_${Date.now()}`
    
    // Retrieve workflow slot for the requested asset type
    const slot = useComfyWorkflowStore.getState().getSlot(params.assetType)
    let inputMediaFileName: string | undefined = undefined

    if (params.inputMediaBlob) {
      onProgress?.('Subiendo imagen de entrada a ComfyUI...', 3)
      inputMediaFileName = await this.uploadImage(
        params.inputMediaBlob,
        params.inputMediaFileName || `freecut_in_${Date.now()}.png`,
      )
    }

    const workflow =
      Object.keys(slot.rawWorkflow || {}).length > 0
        ? injectParametersIntoWorkflow(
            slot.rawWorkflow,
            slot.bindings,
            { ...params, inputMediaFileName },
          )
        : this.buildWorkflowGraph(params)

    onProgress?.('Enviando workflow a ComfyUI...', 5)

    const queueRes = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    })

    if (!queueRes.ok) {
      const errText = await queueRes.text().catch(() => '')
      throw new Error(`ComfyUI rechazó la petición (${queueRes.status}): ${errText || queueRes.statusText}`)
    }

    const { prompt_id: promptId } = await queueRes.json()
    logger.info(`Prompt encolado con ID: ${promptId}`)
    onProgress?.('Procesando en ComfyUI...', 15)

    // Polling loop for job completion
    const startTime = Date.now()
    const timeoutMs = 180000 // 3 minutes timeout

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, 1500))

      const historyRes = await fetch(`${this.baseUrl}/history/${promptId}`)
      if (!historyRes.ok) continue

      const historyData = await historyRes.json()
      const jobData = historyData[promptId]

      if (jobData && jobData.outputs) {
        onProgress?.('Descargando asset generado...', 90)

        // Find output in outputs nodes
        for (const nodeId of Object.keys(jobData.outputs)) {
          const nodeOutput = jobData.outputs[nodeId]

          // Image output
          if (nodeOutput.images && nodeOutput.images.length > 0) {
            const img = nodeOutput.images[0]
            const viewUrl = `${this.baseUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'output')}`
            const blobResp = await fetch(viewUrl)
            const blob = await blobResp.blob()
            const mimeType = blob.type || 'image/png'

            return {
              blob,
              url: URL.createObjectURL(blob),
              fileName: img.filename,
              mimeType,
              assetType: params.assetType,
              metadata: {
                positivePrompt: params.positivePrompt,
                negativePrompt: params.negativePrompt,
                assetType: params.assetType,
                artStyle: params.artStyle,
                viewMode: params.viewMode,
                seed: params.seed,
              },
            }
          }

          // Audio output
          if (nodeOutput.audio && nodeOutput.audio.length > 0) {
            const aud = nodeOutput.audio[0]
            const viewUrl = `${this.baseUrl}/view?filename=${encodeURIComponent(aud.filename)}&subfolder=${encodeURIComponent(aud.subfolder || '')}&type=${encodeURIComponent(aud.type || 'output')}`
            const blobResp = await fetch(viewUrl)
            const blob = await blobResp.blob()
            const mimeType = blob.type || 'audio/wav'

            return {
              blob,
              url: URL.createObjectURL(blob),
              fileName: aud.filename,
              mimeType,
              assetType: params.assetType,
              metadata: {
                positivePrompt: params.positivePrompt,
                negativePrompt: params.negativePrompt,
                assetType: params.assetType,
                artStyle: params.artStyle,
                viewMode: params.viewMode,
                seed: params.seed,
              },
            }
          }

          // Video output (VHS or VideoCombine)
          if (nodeOutput.gifs && nodeOutput.gifs.length > 0) {
            const vid = nodeOutput.gifs[0]
            const viewUrl = `${this.baseUrl}/view?filename=${encodeURIComponent(vid.filename)}&subfolder=${encodeURIComponent(vid.subfolder || '')}&type=${encodeURIComponent(vid.type || 'output')}`
            const blobResp = await fetch(viewUrl)
            const blob = await blobResp.blob()
            const mimeType = blob.type || 'video/mp4'

            return {
              blob,
              url: URL.createObjectURL(blob),
              fileName: vid.filename,
              mimeType,
              assetType: params.assetType,
              metadata: {
                positivePrompt: params.positivePrompt,
                negativePrompt: params.negativePrompt,
                assetType: params.assetType,
                artStyle: params.artStyle,
                viewMode: params.viewMode,
                seed: params.seed,
              },
            }
          }

          // 3D GLTF / Mesh output
          if (nodeOutput.gltf && nodeOutput.gltf.length > 0) {
            const mesh = nodeOutput.gltf[0]
            const viewUrl = `${this.baseUrl}/view?filename=${encodeURIComponent(mesh.filename)}&subfolder=${encodeURIComponent(mesh.subfolder || '')}&type=${encodeURIComponent(mesh.type || 'output')}`
            const blobResp = await fetch(viewUrl)
            const blob = await blobResp.blob()
            const mimeType = blob.type || 'model/gltf-binary'

            return {
              blob,
              url: URL.createObjectURL(blob),
              fileName: mesh.filename,
              mimeType,
              assetType: params.assetType,
              metadata: {
                positivePrompt: params.positivePrompt,
                negativePrompt: params.negativePrompt,
                assetType: params.assetType,
                artStyle: params.artStyle,
                viewMode: params.viewMode,
                seed: params.seed,
              },
            }
          }
        }
      }

      onProgress?.('Generando tensores en GPU...', Math.min(85, Math.round(15 + ((Date.now() - startTime) / timeoutMs) * 70)))
    }

    throw new Error('Tiempo de espera agotado esperando la respuesta de ComfyUI.')
  }
}

export const comfyClient = new ComfyClient()
