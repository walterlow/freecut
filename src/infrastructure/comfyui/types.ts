export type ComfyAssetType =
  | 'video_broll'
  | 'image'
  | 'voice'
  | 'music'
  | 'sfx'
  | 'vfx'
  | 'model3d'
  | 'transcription'

export type ComfyArtStyle =
  | 'cinematic'
  | 'photorealistic'
  | 'anime'
  | '3d_stylized'
  | 'low_poly'
  | 'dark_fantasy'
  | 'sci_fi'
  | 'pixel_art'
  | '2d_hand_painted'

export type ComfyViewMode =
  | 'close_up'
  | 'wide_shot'
  | 'three_quarter'
  | 'front_view'
  | 'top_down'
  | 'isometric'
  | 'dutch_angle'
  | 'drone_view'

export interface ComfyNodeBinding {
  positivePromptNodeId?: string
  positivePromptInputKey?: string
  negativePromptNodeId?: string
  negativePromptInputKey?: string
  scriptTextNodeId?: string
  scriptTextInputKey?: string
  seedNodeId?: string
  seedInputKey?: string
  stepsNodeId?: string
  cfgNodeId?: string
  samplerNodeId?: string
  widthNodeId?: string
  heightNodeId?: string
  inputMediaNodeId?: string
  outputNodeId?: string
}

export interface ComfyWorkflowSlot {
  id: ComfyAssetType
  label: string
  workflowName?: string
  rawWorkflow: Record<string, unknown>
  uiWorkflow?: Record<string, unknown>
  bindings: ComfyNodeBinding
  isCustom: boolean
  lastUpdated?: number
}

export interface ComfyGenerationParams {
  positivePrompt: string
  negativePrompt: string
  context?: string
  scriptText?: string
  assetType: ComfyAssetType
  artStyle: ComfyArtStyle
  viewMode: ComfyViewMode
  width: number
  height: number
  steps: number
  cfg: number
  seed: number
  durationSeconds?: number
  fps?: number
  inputMediaBlob?: Blob
  inputMediaFileName?: string
}

export interface ComfyGeneratedAsset {
  blob: Blob
  url: string
  fileName: string
  mimeType: string
  assetType: ComfyAssetType
  metadata: {
    positivePrompt: string
    negativePrompt: string
    assetType: string
    artStyle: string
    viewMode: string
    seed: number
  }
}

export interface ComfySystemStats {
  online: boolean
  devices?: Array<{
    name: string
    vram_total: number
    vram_free: number
  }>
}
