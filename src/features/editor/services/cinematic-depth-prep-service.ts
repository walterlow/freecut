import type { ImageItem } from '@/types/timeline'
import { sanitizeAiOutputFileNameSegment } from '@/shared/utils/ai-output-filename'
import {
  buildAlphaSubjectMask,
  buildDepthSubjectMask,
  createCinematicDepthAssetBaseName,
  selectCinematicSubjectMask,
  type DepthPixelPlane,
  type DepthSubjectMask,
} from '../utils/cinematic-depth-prep'

type TransformersModule = typeof import('@huggingface/transformers')

interface ProgressInfo {
  status?: string
  file?: string
  loaded?: number
  total?: number
  progress?: number
}

interface RawDepthImage extends DepthPixelPlane {
  toBlob?: (type?: string, quality?: number) => Promise<Blob>
}

interface DepthEstimationOutput {
  depth: RawDepthImage
}

interface RawMattedImage extends DepthPixelPlane {
  channels: 4
}

type DepthPipeline = {
  (image: Blob): Promise<DepthEstimationOutput | DepthEstimationOutput[]>
  dispose?: () => Promise<void> | void
}

type SubjectMattingPipeline = {
  (image: Blob): Promise<RawMattedImage | RawMattedImage[]>
  dispose?: () => Promise<void> | void
}

interface PrepareCinematicDepthStillOptions {
  image: ImageItem
  sourceBlob: Blob
  signal?: AbortSignal
  onProgress?: (stage: string, fraction?: number) => void
}

interface PreparedCinematicDepthStill {
  backgroundFile: File
  subjectFile: File
  depthMapFile: File
  width: number
  height: number
  quality: number
  coverage: number
  contrast: number
  polarity: DepthSubjectMask['polarity']
  modelId: string
  maskSource: 'matting' | 'depth'
}

const DEPTH_MODEL_ID = 'onnx-community/depth-anything-v2-small'
const SUBJECT_MATTING_MODEL_ID = 'Xenova/modnet'

function abortIfNeeded(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw new DOMException('Depth preparation was cancelled.', 'AbortError')
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('Cinematic depth prep requires a browser canvas.')
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = 'image/png',
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Could not encode cinematic depth image.'))
        }
      },
      type,
      quality,
    )
  })
}

function makeDepthFileName(image: ImageItem, suffix: string): string {
  const base = sanitizeAiOutputFileNameSegment(createCinematicDepthAssetBaseName(image), 'still')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `cinematic-depth-${base}-${suffix}-${timestamp}.png`
}

function firstDepthOutput(
  output: DepthEstimationOutput | DepthEstimationOutput[],
): DepthEstimationOutput {
  const first = Array.isArray(output) ? output[0] : output
  if (!first?.depth) {
    throw new Error('The depth model did not return a usable depth map.')
  }
  return first
}

function firstMattingOutput(output: RawMattedImage | RawMattedImage[]): RawMattedImage {
  const first = Array.isArray(output) ? output[0] : output
  if (!first?.data || first.channels !== 4) {
    throw new Error('The subject matting model did not return a usable RGBA image.')
  }
  return first
}

function sampleMaskAlpha(
  mask: DepthSubjectMask,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const sx = Math.min(
    mask.width - 1,
    Math.max(0, Math.floor((x / Math.max(1, width)) * mask.width)),
  )
  const sy = Math.min(
    mask.height - 1,
    Math.max(0, Math.floor((y / Math.max(1, height)) * mask.height)),
  )
  return mask.alpha[sy * mask.width + sx] ?? 0
}

async function drawSourceToCanvas(params: {
  sourceBlob: Blob
  width: number
  height: number
  filter?: string
  scale?: number
}): Promise<{ canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }> {
  const imageBitmap = await createImageBitmap(params.sourceBlob)
  const canvas = createCanvas(params.width, params.height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    imageBitmap.close()
    throw new Error('Could not create a canvas context for cinematic depth prep.')
  }

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  if (params.filter) context.filter = params.filter
  const scale = params.scale ?? 1
  const scaledWidth = params.width * scale
  const scaledHeight = params.height * scale
  context.drawImage(
    imageBitmap,
    (params.width - scaledWidth) / 2,
    (params.height - scaledHeight) / 2,
    scaledWidth,
    scaledHeight,
  )
  imageBitmap.close()
  return { canvas, context }
}

async function createSubjectCutoutBlob(params: {
  sourceBlob: Blob
  mask: DepthSubjectMask
  width: number
  height: number
}): Promise<Blob> {
  const { canvas, context } = await drawSourceToCanvas(params)

  const imageData = context.getImageData(0, 0, params.width, params.height)
  const data = imageData.data
  for (let y = 0; y < params.height; y += 1) {
    for (let x = 0; x < params.width; x += 1) {
      const offset = (y * params.width + x) * 4
      const alpha = sampleMaskAlpha(params.mask, x, y, params.width, params.height)
      data[offset + 3] = Math.round((data[offset + 3] ?? 255) * (alpha / 255))
    }
  }
  context.putImageData(imageData, 0, 0)
  return canvasToBlob(canvas)
}

interface MaskExtent {
  minX: number
  minY: number
  maxX: number
  maxY: number
  maskWidth: number
  maskHeight: number
}

function measureMaskExtent(mask: DepthSubjectMask): MaskExtent | null {
  let minX = mask.width
  let minY = mask.height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if ((mask.alpha[y * mask.width + x] ?? 0) < 24) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  return maxX >= minX && maxY >= minY
    ? { minX, minY, maxX, maxY, maskWidth: mask.width, maskHeight: mask.height }
    : null
}

function sampleOffset(width: number, height: number, x: number, y: number) {
  const sx = Math.min(width - 1, Math.max(0, Math.round(x)))
  const sy = Math.min(height - 1, Math.max(0, Math.round(y)))
  return (sy * width + sx) * 4
}

function outsideMaskSample(params: {
  x: number
  y: number
  width: number
  height: number
  extent: MaskExtent
}): { x: number; y: number } {
  const scaleX = params.width / Math.max(1, params.extent.maskWidth)
  const scaleY = params.height / Math.max(1, params.extent.maskHeight)
  const minX = params.extent.minX * scaleX
  const maxX = (params.extent.maxX + 1) * scaleX - 1
  const minY = params.extent.minY * scaleY
  const maxY = (params.extent.maxY + 1) * scaleY - 1
  const paddingX = Math.max(4, params.width * 0.012)
  const paddingY = Math.max(4, params.height * 0.012)
  const leftDistance = Math.abs(params.x - minX)
  const rightDistance = Math.abs(maxX - params.x)
  const topDistance = Math.abs(params.y - minY)
  const bottomDistance = Math.abs(maxY - params.y)
  const nearest = Math.min(leftDistance, rightDistance, topDistance, bottomDistance)

  if (nearest === leftDistance) return { x: minX - paddingX, y: params.y }
  if (nearest === rightDistance) return { x: maxX + paddingX, y: params.y }
  if (nearest === topDistance) return { x: params.x, y: minY - paddingY }
  return { x: params.x, y: maxY + paddingY }
}

async function createBackgroundPlateBlob(params: {
  sourceBlob: Blob
  mask: DepthSubjectMask
  width: number
  height: number
}): Promise<Blob> {
  const base = await drawSourceToCanvas(params)
  const blur = await drawSourceToCanvas({
    ...params,
    filter: 'blur(28px)',
    scale: 1.16,
  })
  const baseData = base.context.getImageData(0, 0, params.width, params.height)
  const blurData = blur.context.getImageData(0, 0, params.width, params.height).data
  const extent = measureMaskExtent(params.mask)

  for (let y = 0; y < params.height; y += 1) {
    for (let x = 0; x < params.width; x += 1) {
      const offset = (y * params.width + x) * 4
      const alpha = sampleMaskAlpha(params.mask, x, y, params.width, params.height)
      const strength = Math.min(1, Math.max(0, (alpha - 8) / 205))
      if (strength <= 0) continue

      const sample = extent
        ? outsideMaskSample({ x, y, width: params.width, height: params.height, extent })
        : { x, y }
      const sourceOffset = sampleOffset(params.width, params.height, sample.x, sample.y)
      for (let channel = 0; channel < 3; channel += 1) {
        const original = baseData.data[offset + channel] ?? 0
        const directionalFill = baseData.data[sourceOffset + channel] ?? original
        const softFill = blurData[offset + channel] ?? directionalFill
        const replacement = directionalFill * 0.84 + softFill * 0.16
        baseData.data[offset + channel] = Math.round(
          original * (1 - strength) + replacement * strength,
        )
      }
    }
  }

  base.context.putImageData(baseData, 0, 0)
  return canvasToBlob(base.canvas)
}

async function createDepthMapBlob(depth: RawDepthImage): Promise<Blob> {
  if (typeof depth.toBlob === 'function') {
    return depth.toBlob('image/png')
  }

  const canvas = createCanvas(depth.width, depth.height)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Could not create a canvas context for the depth map.')
  }

  const imageData = context.createImageData(depth.width, depth.height)
  for (let index = 0; index < depth.width * depth.height; index += 1) {
    const sourceOffset = index * depth.channels
    const value =
      depth.channels === 1
        ? (depth.data[sourceOffset] ?? 0)
        : ((depth.data[sourceOffset] ?? 0) +
            (depth.data[sourceOffset + 1] ?? 0) +
            (depth.data[sourceOffset + 2] ?? 0)) /
          3
    const targetOffset = index * 4
    imageData.data[targetOffset] = value
    imageData.data[targetOffset + 1] = value
    imageData.data[targetOffset + 2] = value
    imageData.data[targetOffset + 3] = 255
  }
  context.putImageData(imageData, 0, 0)
  return canvasToBlob(canvas)
}

class CinematicDepthPrepService {
  private modulePromise: Promise<TransformersModule> | null = null
  private depthPipelinePromise: Promise<DepthPipeline> | null = null
  private mattingPipelinePromise: Promise<SubjectMattingPipeline> | null = null

  isSupported(): boolean {
    return typeof document !== 'undefined' && typeof createImageBitmap === 'function'
  }

  private getModule(): Promise<TransformersModule> {
    if (!this.modulePromise) {
      this.modulePromise = import('@huggingface/transformers').then((module) => {
        module.env.useBrowserCache = true
        module.env.allowLocalModels = false
        return module
      })
    }
    return this.modulePromise
  }

  private getDepthPipeline(
    onProgress?: (stage: string, fraction?: number) => void,
  ): Promise<DepthPipeline> {
    if (this.depthPipelinePromise) return this.depthPipelinePromise

    this.depthPipelinePromise = (async () => {
      const module = await this.getModule()
      onProgress?.('Loading cinematic depth model')
      const options: Record<string, unknown> = {
        dtype: 'q8',
        progress_callback: (progress: ProgressInfo) => {
          if (progress.status !== 'progress' && progress.status !== 'download') return
          const fraction =
            typeof progress.progress === 'number'
              ? progress.progress / 100
              : progress.total && progress.loaded
                ? progress.loaded / progress.total
                : undefined
          onProgress?.('Downloading cinematic depth model', fraction)
        },
      }
      if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
        options.device = 'webgpu'
      }
      return module.pipeline('depth-estimation', DEPTH_MODEL_ID, options) as Promise<DepthPipeline>
    })()

    return this.depthPipelinePromise
  }

  private getMattingPipeline(
    onProgress?: (stage: string, fraction?: number) => void,
  ): Promise<SubjectMattingPipeline> {
    if (this.mattingPipelinePromise) return this.mattingPipelinePromise

    this.mattingPipelinePromise = (async () => {
      const module = await this.getModule()
      onProgress?.('Loading subject matting model')
      const options: Record<string, unknown> = {
        dtype: 'q8',
        progress_callback: (progress: ProgressInfo) => {
          if (progress.status !== 'progress' && progress.status !== 'download') return
          const fraction =
            typeof progress.progress === 'number'
              ? progress.progress / 100
              : progress.total && progress.loaded
                ? progress.loaded / progress.total
                : undefined
          onProgress?.('Downloading subject matting model', fraction)
        },
      }
      if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
        options.device = 'webgpu'
      }
      return module.pipeline(
        'background-removal',
        SUBJECT_MATTING_MODEL_ID,
        options,
      ) as Promise<SubjectMattingPipeline>
    })()

    return this.mattingPipelinePromise
  }

  async prepareStillImage(
    options: PrepareCinematicDepthStillOptions,
  ): Promise<PreparedCinematicDepthStill> {
    if (!this.isSupported()) {
      throw new Error('Cinematic depth prep requires browser image and canvas APIs.')
    }

    abortIfNeeded(options.signal)
    options.onProgress?.('Estimating still-image depth and subject matte')
    const [depthPipeline, mattingPipeline] = await Promise.all([
      this.getDepthPipeline(options.onProgress),
      this.getMattingPipeline(options.onProgress).catch(() => null),
    ])
    abortIfNeeded(options.signal)

    const [depthResult, matteResult] = await Promise.all([
      depthPipeline(options.sourceBlob),
      mattingPipeline ? mattingPipeline(options.sourceBlob).catch(() => null) : null,
    ])
    const output = firstDepthOutput(depthResult)
    abortIfNeeded(options.signal)

    const width = Math.max(1, options.image.sourceWidth ?? output.depth.width)
    const height = Math.max(1, options.image.sourceHeight ?? output.depth.height)
    const depthMask = buildDepthSubjectMask(output.depth)
    const matteMask = matteResult ? buildAlphaSubjectMask(firstMattingOutput(matteResult)) : null
    const selectedMask = selectCinematicSubjectMask({ depthMask, matteMask })
    const mask = selectedMask.mask
    options.onProgress?.('Building subject and depth-map layers', 0.85)

    const [backgroundBlob, subjectBlob, depthBlob] = await Promise.all([
      createBackgroundPlateBlob({
        sourceBlob: options.sourceBlob,
        mask,
        width,
        height,
      }),
      createSubjectCutoutBlob({
        sourceBlob: options.sourceBlob,
        mask,
        width,
        height,
      }),
      createDepthMapBlob(output.depth),
    ])
    abortIfNeeded(options.signal)

    const backgroundFile = new File(
      [backgroundBlob],
      makeDepthFileName(options.image, 'background'),
      {
        type: 'image/png',
      },
    )
    const subjectFile = new File([subjectBlob], makeDepthFileName(options.image, 'subject'), {
      type: 'image/png',
    })
    const depthMapFile = new File([depthBlob], makeDepthFileName(options.image, 'map'), {
      type: 'image/png',
    })

    return {
      backgroundFile,
      subjectFile,
      depthMapFile,
      width,
      height,
      quality: mask.quality,
      coverage: mask.coverage,
      contrast: mask.contrast,
      polarity: mask.polarity,
      modelId:
        selectedMask.source === 'matting'
          ? `${DEPTH_MODEL_ID}+${SUBJECT_MATTING_MODEL_ID}`
          : DEPTH_MODEL_ID,
      maskSource: selectedMask.source,
    }
  }

  async unloadModel(): Promise<void> {
    const pipelinePromise = this.depthPipelinePromise
    const mattingPipelinePromise = this.mattingPipelinePromise
    this.depthPipelinePromise = null
    this.mattingPipelinePromise = null
    if (!pipelinePromise && !mattingPipelinePromise) return

    const [pipeline, mattingPipeline] = await Promise.all([
      pipelinePromise?.catch(() => null) ?? null,
      mattingPipelinePromise?.catch(() => null) ?? null,
    ])
    await Promise.all([pipeline?.dispose?.(), mattingPipeline?.dispose?.()])
  }
}

export const cinematicDepthPrepService = new CinematicDepthPrepService()
