/**
 * GPU-accelerated Optical Flow Analyzer
 *
 * Uses Lucas-Kanade with Gaussian pyramids (3 levels) via WebGPU compute shaders.
 * Processes frames at 160x90 resolution for real-time analysis speed.
 *
 * Outputs motion magnitude, direction coherence, and scene cut detection
 * per frame by comparing current and previous frame.
 */

import {
  OPTICAL_FLOW_WGSL,
  ANALYSIS_WIDTH,
  ANALYSIS_HEIGHT,
  PYRAMID_LEVELS,
} from './optical-flow-shaders'

export interface MotionResult {
  totalMotion: number
  globalMotion: number
  localMotion: number
  isSceneCut: boolean
  dominantDirection: number
  directionCoherence: number
}

const LK_WINDOW_RADIUS = 2
const LK_MIN_EIGENVALUE = 0.001
const SCENE_CUT_THRESHOLD = 8.0
const COVERAGE_THRESHOLD = 0.7
const MAGNITUDE_THRESHOLD = 0.5
const COHERENCE_THRESHOLD = 0.6
const STATS_BUFFER_SIZE = 64 // 15 × u32 padded to 64 (matches masterselects)

export class OpticalFlowAnalyzer {
  private device: GPUDevice

  // Compute pipelines
  private grayscalePipeline!: GPUComputePipeline
  private pyramidPipeline!: GPUComputePipeline
  private spatialGradPipeline!: GPUComputePipeline
  private temporalGradPipeline!: GPUComputePipeline
  private lucasKanadePipeline!: GPUComputePipeline
  private flowStatsPipeline!: GPUComputePipeline
  private clearStatsPipeline!: GPUComputePipeline

  // Bind group layouts
  private grayscaleLayout!: GPUBindGroupLayout
  private pyramidLayout!: GPUBindGroupLayout
  private spatialGradLayout!: GPUBindGroupLayout
  private temporalGradLayout!: GPUBindGroupLayout
  private lucasKanadeLayout!: GPUBindGroupLayout
  private flowStatsLayout!: GPUBindGroupLayout
  private clearStatsLayout!: GPUBindGroupLayout

  // Textures — initialized in createTextures()
  private inputTexture!: GPUTexture
  private grayscaleTextures: [GPUTexture, GPUTexture] = null!
  // pyramidTextures[frameIdx][levelIdx]
  private pyramidTextures: [GPUTexture[], GPUTexture[]] = null!
  private gradIxTextures: GPUTexture[] = []
  private gradIyTextures: GPUTexture[] = []
  private gradItTextures: GPUTexture[] = []
  private flowTextures: GPUTexture[] = []
  private dummyFlowTexture!: GPUTexture

  // Level dimensions for dispatch
  private levelDims: Array<{ w: number; h: number }> = []

  // Buffers
  private statsBuffer!: GPUBuffer
  private stagingBuffer!: GPUBuffer
  private lkParamsBuffer!: GPUBuffer
  private statsParamsBuffer!: GPUBuffer

  private frameIndex = 0
  private initialized = false

  constructor(device: GPUDevice) {
    this.device = device
  }

  private init(): void {
    if (this.initialized) return
    this.createPipelines()
    this.createTextures()
    this.createBuffers()
    this.initialized = true
  }

  /** Check shader compilation for errors (dev diagnostic) */
  async checkShaderCompilation(): Promise<boolean> {
    const module = this.device.createShaderModule({
      label: 'optical-flow-check',
      code: OPTICAL_FLOW_WGSL,
    })
    const info = await module.getCompilationInfo()
    const errors = info.messages.filter((m) => m.type === 'error')
    if (errors.length > 0) {
      for (const err of errors) {
        console.error(
          `[OpticalFlow] Shader error: ${err.message} (line ${err.lineNum}:${err.linePos})`,
        )
      }
      return false
    }
    return true
  }

  private createPipelines(): void {
    const module = this.device.createShaderModule({
      label: 'optical-flow',
      code: OPTICAL_FLOW_WGSL,
    })

    // r32float/rg32float textures are unfilterable — must declare sampleType
    const r32Texture = { sampleType: 'unfilterable-float' as GPUTextureSampleType }

    // Grayscale (input is rgba8unorm = filterable, output is storage write)
    this.grayscaleLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: {} },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'r32float' },
        },
      ],
    })
    this.grayscalePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.grayscaleLayout] }),
      compute: { module, entryPoint: 'grayscaleMain' },
    })

    // Pyramid downsample (reads r32float)
    this.pyramidLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: r32Texture },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'r32float' },
        },
      ],
    })
    this.pyramidPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.pyramidLayout] }),
      compute: { module, entryPoint: 'pyramidDownsampleMain' },
    })

    // Spatial gradients (reads r32float)
    this.spatialGradLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: r32Texture },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'r32float' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'r32float' },
        },
      ],
    })
    this.spatialGradPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.spatialGradLayout] }),
      compute: { module, entryPoint: 'spatialGradientsMain' },
    })

    // Temporal gradient (reads two r32float textures)
    this.temporalGradLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: r32Texture },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: r32Texture },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'r32float' },
        },
      ],
    })
    this.temporalGradPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.temporalGradLayout] }),
      compute: { module, entryPoint: 'temporalGradientMain' },
    })

    // Lucas-Kanade (reads r32float gradients + rg32float prev flow)
    this.lucasKanadeLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: r32Texture },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: r32Texture },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: r32Texture },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rg32float' },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'unfilterable-float' as GPUTextureSampleType },
        },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    })
    this.lucasKanadePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.lucasKanadeLayout] }),
      compute: { module, entryPoint: 'lucasKanadeMain' },
    })

    // Flow statistics (reads rg32float flow)
    this.flowStatsLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'unfilterable-float' as GPUTextureSampleType },
        },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    })
    this.flowStatsPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.flowStatsLayout] }),
      compute: { module, entryPoint: 'flowStatisticsMain' },
    })

    // Clear stats
    this.clearStatsLayout = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }],
    })
    this.clearStatsPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.clearStatsLayout] }),
      compute: { module, entryPoint: 'clearStatsMain' },
    })
  }

  private createStorageTexture(w: number, h: number, format: GPUTextureFormat): GPUTexture {
    return this.device.createTexture({
      size: { width: w, height: h },
      format,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    })
  }

  private createTextures(): void {
    const w = ANALYSIS_WIDTH
    const h = ANALYSIS_HEIGHT

    // Input RGBA texture
    this.inputTexture = this.device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    })

    // Grayscale: current and previous
    this.grayscaleTextures = [
      this.createStorageTexture(w, h, 'r32float'),
      this.createStorageTexture(w, h, 'r32float'),
    ]

    // Compute level dimensions
    this.levelDims = []
    let lw = w
    let lh = h
    for (let level = 0; level < PYRAMID_LEVELS; level++) {
      this.levelDims.push({ w: lw, h: lh })
      lw = Math.max(1, Math.floor(lw / 2))
      lh = Math.max(1, Math.floor(lh / 2))
    }

    // Pyramid textures: 2 frames x 3 levels
    const pyr0: GPUTexture[] = []
    const pyr1: GPUTexture[] = []
    for (let level = 0; level < PYRAMID_LEVELS; level++) {
      const dim = this.levelDims[level]!
      pyr0.push(this.createStorageTexture(dim.w, dim.h, 'r32float'))
      pyr1.push(this.createStorageTexture(dim.w, dim.h, 'r32float'))
    }
    this.pyramidTextures = [pyr0, pyr1]

    // Gradient and flow textures per level
    this.gradIxTextures = []
    this.gradIyTextures = []
    this.gradItTextures = []
    this.flowTextures = []
    for (let level = 0; level < PYRAMID_LEVELS; level++) {
      const dim = this.levelDims[level]!
      this.gradIxTextures.push(this.createStorageTexture(dim.w, dim.h, 'r32float'))
      this.gradIyTextures.push(this.createStorageTexture(dim.w, dim.h, 'r32float'))
      this.gradItTextures.push(this.createStorageTexture(dim.w, dim.h, 'r32float'))
      this.flowTextures.push(this.createStorageTexture(dim.w, dim.h, 'rg32float'))
    }

    // 1×1 dummy flow texture for coarsest LK level (no previous flow to read)
    this.dummyFlowTexture = this.device.createTexture({
      size: { width: 1, height: 1 },
      format: 'rg32float',
      usage: GPUTextureUsage.TEXTURE_BINDING,
    })
  }

  private createBuffers(): void {
    this.statsBuffer = this.device.createBuffer({
      size: STATS_BUFFER_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })
    this.stagingBuffer = this.device.createBuffer({
      size: STATS_BUFFER_SIZE,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    })
    this.lkParamsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.statsParamsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    const statsData = new Float32Array([MAGNITUDE_THRESHOLD, 0.0, 0.0, 0.0])
    this.device.queue.writeBuffer(this.statsParamsBuffer, 0, statsData)
  }

  private dispatch(
    encoder: GPUCommandEncoder,
    pipeline: GPUComputePipeline,
    bindGroup: GPUBindGroup,
    wx: number,
    wy: number,
  ): void {
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(Math.ceil(wx / 8), Math.ceil(wy / 8))
    pass.end()
  }

  /**
   * Analyze a frame. Must be called sequentially — compares to previous frame.
   * First frame returns zero motion (no previous frame to compare).
   */
  async analyzeFrame(source: ImageBitmap): Promise<MotionResult> {
    this.init()

    const currentIdx = (this.frameIndex % 2) as 0 | 1
    const previousIdx = ((this.frameIndex + 1) % 2) as 0 | 1

    // Upload source to input texture
    this.device.queue.copyExternalImageToTexture(
      { source, flipY: false },
      { texture: this.inputTexture },
      { width: ANALYSIS_WIDTH, height: ANALYSIS_HEIGHT },
    )

    const encoder = this.device.createCommandEncoder()

    // 1. Grayscale conversion
    const grayBG = this.device.createBindGroup({
      layout: this.grayscaleLayout,
      entries: [
        { binding: 0, resource: this.inputTexture.createView() },
        { binding: 1, resource: this.grayscaleTextures[currentIdx].createView() },
      ],
    })
    this.dispatch(encoder, this.grayscalePipeline, grayBG, ANALYSIS_WIDTH, ANALYSIS_HEIGHT)

    // 2. Build Gaussian pyramid for current frame
    // Level 0 = grayscale itself (share texture reference)
    const currentPyramid = this.pyramidTextures[currentIdx]
    // Copy grayscale to level 0 pyramid slot
    encoder.copyTextureToTexture(
      { texture: this.grayscaleTextures[currentIdx] },
      { texture: currentPyramid[0]! },
      { width: ANALYSIS_WIDTH, height: ANALYSIS_HEIGHT },
    )

    for (let level = 1; level < PYRAMID_LEVELS; level++) {
      const prevLevelTex = currentPyramid[level - 1]!
      const currLevelTex = currentPyramid[level]!
      const dim = this.levelDims[level]!
      const pyrBG = this.device.createBindGroup({
        layout: this.pyramidLayout,
        entries: [
          { binding: 0, resource: prevLevelTex.createView() },
          { binding: 1, resource: currLevelTex.createView() },
        ],
      })
      this.dispatch(encoder, this.pyramidPipeline, pyrBG, dim.w, dim.h)
    }

    // First frame — no previous to compare
    if (this.frameIndex === 0) {
      this.device.queue.submit([encoder.finish()])
      this.frameIndex++
      return {
        totalMotion: 0,
        globalMotion: 0,
        localMotion: 0,
        isSceneCut: false,
        dominantDirection: 0,
        directionCoherence: 0,
      }
    }

    // 3. Clear stats
    const clearBG = this.device.createBindGroup({
      layout: this.clearStatsLayout,
      entries: [{ binding: 0, resource: { buffer: this.statsBuffer } }],
    })
    const clearPass = encoder.beginComputePass()
    clearPass.setPipeline(this.clearStatsPipeline)
    clearPass.setBindGroup(0, clearBG)
    clearPass.dispatchWorkgroups(1)
    clearPass.end()

    const previousPyramid = this.pyramidTextures[previousIdx]

    // 4. Coarse-to-fine: process pyramid levels from coarsest to finest
    for (let level = PYRAMID_LEVELS - 1; level >= 0; level--) {
      const dim = this.levelDims[level]!

      // Spatial gradients on current pyramid level
      const spatialBG = this.device.createBindGroup({
        layout: this.spatialGradLayout,
        entries: [
          { binding: 0, resource: currentPyramid[level]!.createView() },
          { binding: 1, resource: this.gradIxTextures[level]!.createView() },
          { binding: 2, resource: this.gradIyTextures[level]!.createView() },
        ],
      })
      this.dispatch(encoder, this.spatialGradPipeline, spatialBG, dim.w, dim.h)

      // Temporal gradient
      const temporalBG = this.device.createBindGroup({
        layout: this.temporalGradLayout,
        entries: [
          { binding: 0, resource: currentPyramid[level]!.createView() },
          { binding: 1, resource: previousPyramid[level]!.createView() },
          { binding: 2, resource: this.gradItTextures[level]!.createView() },
        ],
      })
      this.dispatch(encoder, this.temporalGradPipeline, temporalBG, dim.w, dim.h)

      // Lucas-Kanade (matches masterselects exactly)
      const pyramidScale = level < PYRAMID_LEVELS - 1 ? 2.0 : 0.0
      const prevFlowTexture =
        level < PYRAMID_LEVELS - 1 ? this.flowTextures[level + 1]! : this.dummyFlowTexture

      const lkData = new ArrayBuffer(16)
      const lkView = new DataView(lkData)
      lkView.setUint32(0, LK_WINDOW_RADIUS, true)
      lkView.setFloat32(4, LK_MIN_EIGENVALUE, true)
      lkView.setFloat32(8, pyramidScale, true)
      lkView.setUint32(12, 0, true) // pad
      this.device.queue.writeBuffer(this.lkParamsBuffer, 0, lkData)

      const lkBG = this.device.createBindGroup({
        layout: this.lucasKanadeLayout,
        entries: [
          { binding: 0, resource: this.gradIxTextures[level]!.createView() },
          { binding: 1, resource: this.gradIyTextures[level]!.createView() },
          { binding: 2, resource: this.gradItTextures[level]!.createView() },
          { binding: 3, resource: this.flowTextures[level]!.createView() },
          { binding: 4, resource: prevFlowTexture.createView() },
          { binding: 5, resource: { buffer: this.lkParamsBuffer } },
        ],
      })
      this.dispatch(encoder, this.lucasKanadePipeline, lkBG, dim.w, dim.h)
    }

    // 5. Compute flow statistics on finest level
    const statsBG = this.device.createBindGroup({
      layout: this.flowStatsLayout,
      entries: [
        { binding: 0, resource: this.flowTextures[0]!.createView() },
        { binding: 1, resource: { buffer: this.statsBuffer } },
        { binding: 2, resource: { buffer: this.statsParamsBuffer } },
      ],
    })
    this.dispatch(encoder, this.flowStatsPipeline, statsBG, ANALYSIS_WIDTH, ANALYSIS_HEIGHT)

    // 6. Copy stats to staging
    encoder.copyBufferToBuffer(this.statsBuffer, 0, this.stagingBuffer, 0, STATS_BUFFER_SIZE)

    this.device.queue.submit([encoder.finish()])

    // 7. Readback and classify
    await this.stagingBuffer.mapAsync(GPUMapMode.READ)
    const data = new Uint32Array(this.stagingBuffer.getMappedRange().slice(0))
    this.stagingBuffer.unmap()

    const result = this.classifyMotion(data)
    this.frameIndex++
    return result
  }

  private classifyMotion(data: Uint32Array): MotionResult {
    // Buffer layout matches masterselects FlowStats exactly:
    // [0] sumMagnitude (×1000), [1] sumMagnitudeSq (×1000),
    // [2] sumVx (i32, ×1000), [3] sumVy (i32, ×1000),
    // [4] pixelCount, [5] significantPixels, [6] maxMagnitude (×1000),
    // [7..14] direction histogram bins 0-7
    const sumMagnitude = (data[0] ?? 0) / 1000
    const sumVx = new Int32Array([data[2] ?? 0])[0]! / 1000
    const sumVy = new Int32Array([data[3] ?? 0])[0]! / 1000
    const pixelCount = data[4] ?? 0
    const significantPixels = data[5] ?? 0
    const maxMagnitude = (data[6] ?? 0) / 1000

    if (pixelCount === 0) {
      return {
        totalMotion: 0,
        globalMotion: 0,
        localMotion: 0,
        isSceneCut: false,
        dominantDirection: 0,
        directionCoherence: 0,
      }
    }

    const meanMagnitude = sumMagnitude / pixelCount

    // Direction coherence (matches masterselects)
    const meanVx = sumVx / pixelCount
    const meanVy = sumVy / pixelCount
    const meanVectorMagnitude = Math.sqrt(meanVx * meanVx + meanVy * meanVy)
    const directionCoherence =
      meanMagnitude > 0.01 ? Math.min(1, meanVectorMagnitude / meanMagnitude) : 0

    // Coverage: fraction of ALL pixels with significant motion
    const totalPixels = ANALYSIS_WIDTH * ANALYSIS_HEIGHT
    const coverageRatio = significantPixels / totalPixels

    // Scene cut detection (matches masterselects exactly — no coherence filter)
    const isSceneCut = meanMagnitude > SCENE_CUT_THRESHOLD && coverageRatio > COVERAGE_THRESHOLD

    // Normalize motion to 0-1 range
    const normalizedMean = Math.min(1, meanMagnitude / 10)

    let globalMotion: number
    let localMotion: number

    if (isSceneCut) {
      globalMotion = normalizedMean
      localMotion = 0
    } else if (directionCoherence > COHERENCE_THRESHOLD) {
      globalMotion = normalizedMean * directionCoherence
      localMotion = normalizedMean * (1 - directionCoherence)
    } else {
      const magnitudeVariance = (data[1] ?? 0) / 1000 / pixelCount - meanMagnitude * meanMagnitude
      const varianceNorm = Math.min(1, Math.sqrt(Math.max(0, magnitudeVariance)) / 5)
      globalMotion = normalizedMean * directionCoherence
      localMotion = Math.max(normalizedMean * (1 - directionCoherence), varianceNorm)
    }

    // Dominant direction from histogram
    const bins: number[] = []
    for (let i = 0; i < 8; i++) {
      bins.push(data[7 + i] ?? 0)
    }
    const maxBin = Math.max(...bins)
    const maxBinIndex = bins.indexOf(maxBin)
    const dominantDirection = (maxBinIndex * 45 + 22.5) % 360

    // eslint-disable-next-line no-console
    console.debug(
      `[OF] mean=${meanMagnitude.toFixed(2)} cov=${coverageRatio.toFixed(2)} coh=${directionCoherence.toFixed(2)} max=${maxMagnitude.toFixed(2)} cut=${isSceneCut}`,
    )

    return {
      totalMotion: normalizedMean,
      globalMotion: Math.min(1, globalMotion),
      localMotion: Math.min(1, localMotion),
      isSceneCut,
      dominantDirection,
      directionCoherence,
    }
  }

  /**
   * Analyze a sequence of frames with progress callback.
   */
  async analyzeSequence(
    frames: ImageBitmap[],
    onProgress?: (index: number, result: MotionResult) => void,
  ): Promise<MotionResult[]> {
    const results: MotionResult[] = []
    for (let i = 0; i < frames.length; i++) {
      const result = await this.analyzeFrame(frames[i]!)
      results.push(result)
      onProgress?.(i, result)
    }
    return results
  }

  destroy(): void {
    if (!this.initialized) return

    this.inputTexture.destroy()
    for (const t of this.grayscaleTextures) t.destroy()
    for (const frame of this.pyramidTextures) {
      for (const t of frame) t.destroy()
    }
    for (const t of this.gradIxTextures) t.destroy()
    for (const t of this.gradIyTextures) t.destroy()
    for (const t of this.gradItTextures) t.destroy()
    for (const t of this.flowTextures) t.destroy()
    this.dummyFlowTexture.destroy()
    this.statsBuffer.destroy()
    this.stagingBuffer.destroy()
    this.lkParamsBuffer.destroy()
    this.statsParamsBuffer.destroy()
    this.initialized = false
  }
}
