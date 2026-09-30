import { getDefaultLlmAdapter } from '@/infrastructure/llm'
import type { ComfyArtStyle, ComfyAssetType, ComfyViewMode } from './types'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('ComfyPromptRefiner')

export interface RefinePromptOptions {
  userPrompt: string
  userNegativePrompt?: string
  context?: string
  assetType: ComfyAssetType
  artStyle: ComfyArtStyle
  viewMode: ComfyViewMode
}

export interface RefinedPromptResult {
  positivePrompt: string
  negativePrompt: string
}

const ART_STYLE_LABELS: Record<ComfyArtStyle, string> = {
  cinematic: 'cinematic 35mm film photography, 8k resolution, volumetric dramatic lighting',
  photorealistic: 'photorealistic ultra detailed, high dynamic range, natural textures',
  anime: 'modern anime aesthetic, Makoto Shinkai style, vibrant colors, clean lineart',
  '3d_stylized': 'stylized 3D render, Pixar/Disney lighting, smooth subsurface scattering',
  low_poly: 'clean low poly 3D art, geometric flat shading, isometric lighting',
  dark_fantasy: 'dark fantasy aesthetic, moody atmospheric fog, Elden Ring grim atmosphere',
  sci_fi: 'hard sci-fi aesthetic, neon highlights, industrial cyberpunk details',
  pixel_art: 'retro 16-bit pixel art, crisp dithering, cohesive palette',
  '2d_hand_painted': 'hand painted 2D concept art, painterly brush strokes, expressive lighting',
}

const VIEW_MODE_LABELS: Record<ComfyViewMode, string> = {
  close_up: 'close-up shot focusing on fine details and expressions',
  wide_shot: 'wide shot displaying full scene environment and deep perspective',
  three_quarter: 'three-quarter dynamic perspective view',
  front_view: 'direct front orthographic view',
  top_down: 'top-down bird-eye view',
  isometric: 'isometric orthographic angle with 30 degree inclination',
  dutch_angle: 'dynamic dutch tilt angle creating tension and energy',
  drone_view: 'sweeping aerial drone camera perspective',
}

const ASSET_TYPE_BOILERPLATE: Record<ComfyAssetType, { positive: string; negative: string }> = {
  video_broll: {
    positive: 'smooth camera motion, stable footage, professional color grade, 60fps fluidity, cinematic b-roll cut',
    negative: 'jitter, stutter, flickering frames, distorted motion, bad hands, morphing artifacts, watermark',
  },
  image: {
    positive: 'masterpiece, production quality, highly detailed, crisp focus, clear composition',
    negative: 'blurry, low quality, artifacts, cropped, watermark, signature, ugly, bad anatomy',
  },
  music: {
    positive: 'high fidelity studio master, rich stereo spread, balanced mix, pristine acoustic clarity',
    negative: 'distortion, clipping, muddy frequencies, harsh sibilance, background hiss, low bitrate',
  },
  sfx: {
    positive: 'isolated sound effect, punchy transient, clean high sample rate, Foley studio recording',
    negative: 'room echo, speech bleed, hum, low-fi distortion, clipped waveform',
  },
  voice: {
    positive: 'natural human vocal cadence, clear diction, professional microphone presence, warm resonance',
    negative: 'robotic, metallic artifacts, breath clipping, nasal tone, autotune distortion',
  },
  model3d: {
    positive: 'clean 3D mesh geometry, manifold topology, watertight, neutral lighting, 360 degree showcase',
    negative: 'holes, inverted normals, floating artifacts, self-intersecting faces, blurry textures',
  },
  vfx: {
    positive: 'cinematic visual effects, particle simulation, energy glow, volumetric compositing, clean alpha channel',
    negative: 'bad edges, jagged matte, noise artifacts, low resolution simulation, flat shading',
  },
  transcription: {
    positive: 'clear human speech transcription, precise words, accurate punctuation, clean audio text',
    negative: 'garbled, hallucinations, background noise, repetition, cutoffs',
  },
}

/**
 * Deterministic prompt composer (matches Omni IA Game logic).
 */
export function composeAssetPrompt(options: RefinePromptOptions): RefinedPromptResult {
  const styleDesc = ART_STYLE_LABELS[options.artStyle] || options.artStyle
  const viewDesc = VIEW_MODE_LABELS[options.viewMode] || options.viewMode
  const boilerplate = ASSET_TYPE_BOILERPLATE[options.assetType]

  const positiveParts = [
    options.context ? `[Scene Context: ${options.context}]` : '',
    options.userPrompt.trim(),
    styleDesc,
    viewDesc,
    boilerplate.positive,
  ].filter(Boolean)

  const negativeParts = [
    options.userNegativePrompt?.trim() || '',
    boilerplate.negative,
    'ugly, distorted, noisy, low resolution, bad quality',
  ].filter(Boolean)

  return {
    positivePrompt: positiveParts.join(', '),
    negativePrompt: negativeParts.join(', '),
  }
}

/**
 * AI-assisted prompt refiner (uses the active LLM adapter configured in FreeCut).
 */
export async function refinePromptWithAi(
  options: RefinePromptOptions,
): Promise<RefinedPromptResult> {
  const adapter = getDefaultLlmAdapter()
  logger.info(`Refining prompt with active LLM adapter: ${adapter.label}`)

  const systemPrompt = `You are an elite prompt engineer for ComfyUI generative workflows (video, images, 3D assets, audio/music).
Your task is to take a raw creative concept and expand it into an optimized positive and negative prompt for generative models.
Target Asset Type: "${options.assetType}"
Art Style: "${options.artStyle}"
Camera / View Mode: "${options.viewMode}"
${options.context ? `Scene Context: "${options.context}"` : ''}

Rules:
1. Provide descriptive sensory details: lighting, materials, textures, camera optics, atmosphere.
2. Return ONLY a strict JSON object with this exact structure:
{
  "positivePrompt": "the full enriched positive prompt",
  "negativePrompt": "the targeted negative prompt avoiding artifacts"
}
Do NOT wrap in markdown code blocks. Do not add conversational text.`

  const userMessage = `Raw concept: "${options.userPrompt}"
${options.userNegativePrompt ? `User exclusions: "${options.userNegativePrompt}"` : ''}`

  try {
    const rawReply = await adapter.generate(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      { temperature: 0.7, maxTokens: 1024 },
    )

    // Parse JSON safely
    const cleanJson = rawReply.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleanJson)

    if (typeof parsed.positivePrompt === 'string' && parsed.positivePrompt.length > 0) {
      return {
        positivePrompt: parsed.positivePrompt,
        negativePrompt: parsed.negativePrompt || ASSET_TYPE_BOILERPLATE[options.assetType].negative,
      }
    }
  } catch (err) {
    logger.warn('AI prompt refinement failed or returned invalid JSON; falling back to deterministic composer:', err)
  }

  // Fallback to deterministic composer if LLM failed
  return composeAssetPrompt(options)
}
