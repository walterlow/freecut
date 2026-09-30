import type { ComfyAssetType, ComfyGenerationParams, ComfyNodeBinding } from './types'

interface ParsedWorkflowResult {
  promptGraph: Record<string, any>
  uiGraph?: Record<string, any>
  detectedBindings: ComfyNodeBinding
}

/**
 * Normalizes input JSON into a valid ComfyUI API Prompt graph.
 * Handles both API prompt format ({ "1": { class_type, inputs } }) and UI format ({ nodes: [...] }).
 */
export function parseComfyWorkflow(
  input: string | Record<string, unknown>,
  assetType: ComfyAssetType
): ParsedWorkflowResult {
  let parsed: Record<string, any>
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input)
    } catch (err) {
      throw new Error(`El archivo no contiene un JSON válido: ${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    parsed = input
  }

  let promptGraph: Record<string, any> = {}
  let uiGraph: Record<string, any> | undefined

  // Check if it's already an API Prompt graph
  const isApiFormat = Object.values(parsed).some(
    (v) => v && typeof v === 'object' && ('class_type' in v || 'inputs' in v)
  )

  if (isApiFormat) {
    promptGraph = parsed
  } else if (Array.isArray(parsed.nodes)) {
    // UI format with nodes array
    uiGraph = parsed
    promptGraph = convertUiFormatToApi(parsed)
  } else if (parsed.prompt && typeof parsed.prompt === 'object') {
    // Wrapped in { prompt: { ... } }
    promptGraph = parsed.prompt
    if (parsed.workflow) uiGraph = parsed.workflow
  } else {
    throw new Error('Formato de workflow no reconocido. Asegúrate de exportar desde ComfyUI usando "Save (API format)" o "Save".')
  }

  const detectedBindings = detectNodeBindings(promptGraph, assetType)
  return { promptGraph, uiGraph, detectedBindings }
}

/**
 * Basic converter from ComfyUI UI format to API prompt format
 */
function convertUiFormatToApi(uiGraph: Record<string, any>): Record<string, any> {
  const apiGraph: Record<string, any> = {}
  const nodes = uiGraph.nodes || []

  for (const node of nodes) {
    if (!node.id || !node.type) continue
    const inputs: Record<string, any> = {}

    // Map widget values to common input names
    if (Array.isArray(node.widgets_values)) {
      if (node.type.includes('CLIPTextEncode')) {
        inputs.text = node.widgets_values[0] || ''
      } else if (node.type.includes('KSampler')) {
        inputs.seed = node.widgets_values[0] ?? 123456789
        inputs.steps = node.widgets_values[2] ?? 20
        inputs.cfg = node.widgets_values[3] ?? 7.0
      } else if (node.type.includes('EmptyLatentImage')) {
        inputs.width = node.widgets_values[0] ?? 512
        inputs.height = node.widgets_values[1] ?? 512
        inputs.batch_size = node.widgets_values[2] ?? 1
      }
    }

    apiGraph[String(node.id)] = {
      class_type: node.type,
      inputs,
    }
  }

  return apiGraph
}

/**
 * Analyzes the node graph and heuristically identifies which nodes represent
 * prompts, seed, sampler, media input, and outputs.
 */
export function detectNodeBindings(
  promptGraph: Record<string, any>,
  assetType: ComfyAssetType
): ComfyNodeBinding {
  const bindings: ComfyNodeBinding = {}
  const textNodes: Array<{ id: string; node: any }> = []
  const samplerNodes: Array<{ id: string; node: any }> = []
  const latentNodes: Array<{ id: string; node: any }> = []
  const mediaInputNodes: Array<{ id: string; node: any }> = []
  const outputNodes: Array<{ id: string; node: any }> = []

  for (const [id, node] of Object.entries(promptGraph)) {
    if (!node || typeof node !== 'object') continue
    const classType = (node.class_type || '').toLowerCase()
    const inputs = node.inputs || {}

    // 1. Text nodes (CLIPTextEncode, PrimitiveString, TTS text)
    if (
      classType.includes('cliptextencode') ||
      classType.includes('textencode') ||
      classType.includes('prompt') ||
      typeof inputs.text === 'string' ||
      typeof inputs.speech_text === 'string'
    ) {
      textNodes.push({ id, node })
    }

    // 2. Samplers
    if (
      classType.includes('ksampler') ||
      classType.includes('audiosampler') ||
      classType.includes('sampler') ||
      inputs.seed !== undefined
    ) {
      samplerNodes.push({ id, node })
    }

    // 3. Latents / Resolution
    if (
      classType.includes('emptylatent') ||
      (inputs.width !== undefined && inputs.height !== undefined)
    ) {
      latentNodes.push({ id, node })
    }

    // 4. Media Inputs
    if (
      classType.includes('loadimage') ||
      classType.includes('loadvideo') ||
      classType.includes('loadaudio')
    ) {
      mediaInputNodes.push({ id, node })
    }

    // 5. Outputs
    if (
      classType.includes('saveimage') ||
      classType.includes('videocombine') ||
      classType.includes('saveaudio') ||
      classType.includes('savegltf') ||
      classType.includes('previewimage') ||
      classType.includes('previewaudio') ||
      classType.includes('whisper') ||
      classType.includes('transcrib') ||
      classType.includes('subtitle')
    ) {
      outputNodes.push({ id, node })
    }
  }

  // --- Assign Bindings according to Asset Type ---

  // Voice / TTS
  if (assetType === 'voice') {
    // Look for node with speech_text or text
    const ttsNode = textNodes.find((tn) => tn.node.inputs?.speech_text !== undefined) || textNodes[0]
    if (ttsNode) {
      bindings.scriptTextNodeId = ttsNode.id
      bindings.scriptTextInputKey = ttsNode.node.inputs?.speech_text !== undefined ? 'speech_text' : 'text'
    }
  } else {
    // Normal Text Prompts (Positive / Negative)
    const firstText = textNodes[0]
    const secondText = textNodes[1]
    if (firstText) {
      bindings.positivePromptNodeId = firstText.id
      bindings.positivePromptInputKey = 'text'
    }
    if (secondText) {
      bindings.negativePromptNodeId = secondText.id
      bindings.negativePromptInputKey = 'text'
    }
  }

  // Sampler & Seed
  const s = samplerNodes[0]
  if (s) {
    bindings.samplerNodeId = s.id
    bindings.seedNodeId = s.id
    bindings.seedInputKey = 'seed'
    if (s.node.inputs?.steps !== undefined) bindings.stepsNodeId = s.id
    if (s.node.inputs?.cfg !== undefined) bindings.cfgNodeId = s.id
  }

  // Latent Resolution
  const firstLatent = latentNodes[0]
  if (firstLatent) {
    bindings.widthNodeId = firstLatent.id
    bindings.heightNodeId = firstLatent.id
  }

  // Media Input (for VFX / Img2Img)
  const firstMedia = mediaInputNodes[0]
  if (firstMedia) {
    bindings.inputMediaNodeId = firstMedia.id
  }

  // Output Node (prioritize video combine for video, saveaudio for audio, saveimage for image)
  const firstOutput = outputNodes[0]
  if (outputNodes.length > 0 && firstOutput) {
    if (assetType === 'video_broll') {
      const vidOut = outputNodes.find((o) => (o.node.class_type || '').toLowerCase().includes('video'))
      bindings.outputNodeId = vidOut ? vidOut.id : firstOutput.id
    } else if (assetType === 'voice' || assetType === 'music' || assetType === 'sfx') {
      const audOut = outputNodes.find((o) => (o.node.class_type || '').toLowerCase().includes('audio'))
      bindings.outputNodeId = audOut ? audOut.id : firstOutput.id
    } else if (assetType === 'model3d') {
      const gltfOut = outputNodes.find((o) => (o.node.class_type || '').toLowerCase().includes('gltf'))
      bindings.outputNodeId = gltfOut ? gltfOut.id : firstOutput.id
    } else if (assetType === 'transcription') {
      const transOut = outputNodes.find(
        (o) =>
          (o.node.class_type || '').toLowerCase().includes('whisper') ||
          (o.node.class_type || '').toLowerCase().includes('transcrib') ||
          (o.node.class_type || '').toLowerCase().includes('subtitle'),
      )
      bindings.outputNodeId = transOut ? transOut.id : firstOutput.id
    } else {
      bindings.outputNodeId = firstOutput.id
    }
  }

  return bindings
}

/**
 * Injects user parameters into the ComfyUI workflow graph before submission.
 */
export function injectParametersIntoWorkflow(
  rawWorkflow: Record<string, any>,
  bindings: ComfyNodeBinding,
  params: ComfyGenerationParams
): Record<string, any> {
  const graph = JSON.parse(JSON.stringify(rawWorkflow))

  // 1. Positive Prompt
  if (bindings.positivePromptNodeId && graph[bindings.positivePromptNodeId]) {
    const key = bindings.positivePromptInputKey || 'text'
    graph[bindings.positivePromptNodeId].inputs = graph[bindings.positivePromptNodeId].inputs || {}
    graph[bindings.positivePromptNodeId].inputs[key] = params.positivePrompt
  }

  // 2. Negative Prompt
  if (bindings.negativePromptNodeId && graph[bindings.negativePromptNodeId]) {
    const key = bindings.negativePromptInputKey || 'text'
    graph[bindings.negativePromptNodeId].inputs = graph[bindings.negativePromptNodeId].inputs || {}
    graph[bindings.negativePromptNodeId].inputs[key] = params.negativePrompt
  }

  // 3. Voice / TTS Script Text
  if (params.scriptText && bindings.scriptTextNodeId && graph[bindings.scriptTextNodeId]) {
    const key = bindings.scriptTextInputKey || 'speech_text'
    graph[bindings.scriptTextNodeId].inputs = graph[bindings.scriptTextNodeId].inputs || {}
    graph[bindings.scriptTextNodeId].inputs[key] = params.scriptText
  }

  // 4. Seed
  if (bindings.seedNodeId && graph[bindings.seedNodeId]) {
    const key = bindings.seedInputKey || 'seed'
    graph[bindings.seedNodeId].inputs = graph[bindings.seedNodeId].inputs || {}
    graph[bindings.seedNodeId].inputs[key] = params.seed
  }

  // 5. Steps & CFG
  if (bindings.stepsNodeId && graph[bindings.stepsNodeId]) {
    graph[bindings.stepsNodeId].inputs = graph[bindings.stepsNodeId].inputs || {}
    graph[bindings.stepsNodeId].inputs.steps = params.steps
  }
  if (bindings.cfgNodeId && graph[bindings.cfgNodeId]) {
    graph[bindings.cfgNodeId].inputs = graph[bindings.cfgNodeId].inputs || {}
    graph[bindings.cfgNodeId].inputs.cfg = params.cfg
  }

  // 6. Resolution
  if (bindings.widthNodeId && graph[bindings.widthNodeId]) {
    const inputs = graph[bindings.widthNodeId].inputs || {}
    if (inputs.width !== undefined) inputs.width = params.width
    if (inputs.height !== undefined) inputs.height = params.height
    graph[bindings.widthNodeId].inputs = inputs
  }

  // 7. Input Media (for VFX / Img2Img)
  if (params.inputMediaFileName && bindings.inputMediaNodeId && graph[bindings.inputMediaNodeId]) {
    const inputs = graph[bindings.inputMediaNodeId].inputs || {}
    if (inputs.image !== undefined) inputs.image = params.inputMediaFileName
    if (inputs.video !== undefined) inputs.video = params.inputMediaFileName
    graph[bindings.inputMediaNodeId].inputs = inputs
  }

  return graph
}
