/**
 * GPU-accelerated Optical Flow Analyzer
 *
 * Uses Lucas-Kanade with Gaussian pyramids (3 levels) via WebGPU compute shaders.
 * Processes frames at 160x90 resolution for real-time analysis speed.
 *
 * Outputs motion magnitude, direction coherence, and scene cut detection
 * per frame by comparing current and previous frame.
 */

import { OPTICAL_FLOW_WGSL, ANALYSIS_WIDTH, ANALYSIS_HEIGHT, PYRAMID_LEVELS } from './optical-flow-shaders';

export interface MotionResult {
  totalMotion: number;
  globalMotion: number;
  localMotion: number;
  isSceneCut: boolean;
  dominantDirection: number;
  directionCoherence: number;
}

const LK_WINDOW_RADIUS = 2;
const LK_MIN_EIGENVALUE = 0.001;
const SCENE_CUT_THRESHOLD = 8.0;
const MAGNITUDE_THRESHOLD = 0.1;
const COHERENCE_GLOBAL_THRESHOLD = 0.7;
const STATS_BUFFER_SIZE = 48; // 12 x u32

export class OpticalFlowAnalyzer {
  private device: GPUDevice;

  // Compute pipelines
  private grayscalePipeline!: GPUComputePipeline;
  private pyramidPipeline!: GPUComputePipeline;
  private spatialGradPipeline!: GPUComputePipeline;
  private temporalGradPipeline!: GPUComputePipeline;
  private lucasKanadePipeline!: GPUComputePipeline;
  private flowStatsPipeline!: GPUComputePipeline;
  private clearStatsPipeline!: GPUComputePipeline;

  // Bind group layouts
  private grayscaleLayout!: GPUBindGroupLayout;
  private pyramidLayout!: GPUBindGroupLayout;
  private spatialGradLayout!: GPUBindGroupLayout;
  private temporalGradLayout!: GPUBindGroupLayout;
  private lucasKanadeLayout!: GPUBindGroupLayout;
  private flowStatsLayout!: GPUBindGroupLayout;
  private clearStatsLayout!: GPUBindGroupLayout;

  // Textures — initialized in createTextures()
  private inputTexture!: GPUTexture;
  private grayscaleTextures: [GPUTexture, GPUTexture] = null!;
  // pyramidTextures[frameIdx][levelIdx]
  private pyramidTextures: [GPUTexture[], GPUTexture[]] = null!;
  private gradIxTextures: GPUTexture[] = [];
  private gradIyTextures: GPUTexture[] = [];
  private gradItTextures: GPUTexture[] = [];
  private flowTextures: GPUTexture[] = [];

  // Level dimensions for dispatch
  private levelDims: Array<{ w: number; h: number }> = [];

  // Buffers
  private statsBuffer!: GPUBuffer;
  private stagingBuffer!: GPUBuffer;
  private lkParamsBuffer!: GPUBuffer;
  private statsParamsBuffer!: GPUBuffer;

  private frameIndex = 0;
  private initialized = false;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  private init(): void {
    if (this.initialized) return;
    this.createPipelines();
    this.createTextures();
    this.createBuffers();
    this.initialized = true;
  }

  private createPipelines(): void {
    const module = this.device.createShaderModule({
      label: 'optical-flow',
      code: OPTICAL_FLOW_WGSL,
    });

    // Grayscale
    this.grayscaleLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: {} },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
      ],
    });
    this.grayscalePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.grayscaleLayout] }),
      compute: { module, entryPoint: 'grayscaleMain' },
    });

    // Pyramid downsample
    this.pyramidLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: {} },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
      ],
    });
    this.pyramidPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.pyramidLayout] }),
      compute: { module, entryPoint: 'pyramidDownsampleMain' },
    });

    // Spatial gradients
    this.spatialGradLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: {} },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
      ],
    });
    this.spatialGradPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.spatialGradLayout] }),
      compute: { module, entryPoint: 'spatialGradientsMain' },
    });

    // Temporal gradient
    this.temporalGradLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: {} },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: {} },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
      ],
    });
    this.temporalGradPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.temporalGradLayout] }),
      compute: { module, entryPoint: 'temporalGradientMain' },
    });

    // Lucas-Kanade
    this.lucasKanadeLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: {} },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: {} },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: {} },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rg32float' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: {} },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    this.lucasKanadePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.lucasKanadeLayout] }),
      compute: { module, entryPoint: 'lucasKanadeMain' },
    });

    // Flow statistics
    this.flowStatsLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: {} },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    this.flowStatsPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.flowStatsLayout] }),
      compute: { module, entryPoint: 'flowStatisticsMain' },
    });

    // Clear stats
    this.clearStatsLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this.clearStatsPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.clearStatsLayout] }),
      compute: { module, entryPoint: 'clearStatsMain' },
    });
  }

  private createStorageTexture(w: number, h: number, format: GPUTextureFormat): GPUTexture {
    return this.device.createTexture({
      size: { width: w, height: h },
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
  }

  private createTextures(): void {
    const w = ANALYSIS_WIDTH;
    const h = ANALYSIS_HEIGHT;

    // Input RGBA texture
    this.inputTexture = this.device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // Grayscale: current and previous
    this.grayscaleTextures = [
      this.createStorageTexture(w, h, 'r32float'),
      this.createStorageTexture(w, h, 'r32float'),
    ];

    // Compute level dimensions
    this.levelDims = [];
    let lw = w;
    let lh = h;
    for (let level = 0; level < PYRAMID_LEVELS; level++) {
      this.levelDims.push({ w: lw, h: lh });
      lw = Math.max(1, Math.floor(lw / 2));
      lh = Math.max(1, Math.floor(lh / 2));
    }

    // Pyramid textures: 2 frames x 3 levels
    const pyr0: GPUTexture[] = [];
    const pyr1: GPUTexture[] = [];
    for (let level = 0; level < PYRAMID_LEVELS; level++) {
      const dim = this.levelDims[level]!;
      pyr0.push(this.createStorageTexture(dim.w, dim.h, 'r32float'));
      pyr1.push(this.createStorageTexture(dim.w, dim.h, 'r32float'));
    }
    this.pyramidTextures = [pyr0, pyr1];

    // Gradient and flow textures per level
    this.gradIxTextures = [];
    this.gradIyTextures = [];
    this.gradItTextures = [];
    this.flowTextures = [];
    for (let level = 0; level < PYRAMID_LEVELS; level++) {
      const dim = this.levelDims[level]!;
      this.gradIxTextures.push(this.createStorageTexture(dim.w, dim.h, 'r32float'));
      this.gradIyTextures.push(this.createStorageTexture(dim.w, dim.h, 'r32float'));
      this.gradItTextures.push(this.createStorageTexture(dim.w, dim.h, 'r32float'));
      this.flowTextures.push(this.createStorageTexture(dim.w, dim.h, 'rg32float'));
    }
  }

  private createBuffers(): void {
    this.statsBuffer = this.device.createBuffer({
      size: STATS_BUFFER_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.stagingBuffer = this.device.createBuffer({
      size: STATS_BUFFER_SIZE,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    this.lkParamsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.statsParamsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const statsData = new Float32Array([MAGNITUDE_THRESHOLD, 0, 0, 0]);
    this.device.queue.writeBuffer(this.statsParamsBuffer, 0, statsData.buffer);
  }

  private dispatch(encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, bindGroup: GPUBindGroup, wx: number, wy: number): void {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(wx / 8), Math.ceil(wy / 8));
    pass.end();
  }

  /**
   * Analyze a frame. Must be called sequentially — compares to previous frame.
   * First frame returns zero motion (no previous frame to compare).
   */
  async analyzeFrame(source: ImageBitmap): Promise<MotionResult> {
    this.init();

    const currentIdx = (this.frameIndex % 2) as 0 | 1;
    const previousIdx = ((this.frameIndex + 1) % 2) as 0 | 1;

    // Upload source to input texture
    this.device.queue.copyExternalImageToTexture(
      { source, flipY: false },
      { texture: this.inputTexture },
      { width: ANALYSIS_WIDTH, height: ANALYSIS_HEIGHT },
    );

    const encoder = this.device.createCommandEncoder();

    // 1. Grayscale conversion
    const grayBG = this.device.createBindGroup({
      layout: this.grayscaleLayout,
      entries: [
        { binding: 0, resource: this.inputTexture.createView() },
        { binding: 1, resource: this.grayscaleTextures[currentIdx].createView() },
      ],
    });
    this.dispatch(encoder, this.grayscalePipeline, grayBG, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);

    // 2. Build Gaussian pyramid for current frame
    // Level 0 = grayscale itself (share texture reference)
    const currentPyramid = this.pyramidTextures[currentIdx];
    // Copy grayscale to level 0 pyramid slot
    encoder.copyTextureToTexture(
      { texture: this.grayscaleTextures[currentIdx] },
      { texture: currentPyramid[0]! },
      { width: ANALYSIS_WIDTH, height: ANALYSIS_HEIGHT },
    );

    for (let level = 1; level < PYRAMID_LEVELS; level++) {
      const prevLevelTex = currentPyramid[level - 1]!;
      const currLevelTex = currentPyramid[level]!;
      const dim = this.levelDims[level]!;
      const pyrBG = this.device.createBindGroup({
        layout: this.pyramidLayout,
        entries: [
          { binding: 0, resource: prevLevelTex.createView() },
          { binding: 1, resource: currLevelTex.createView() },
        ],
      });
      this.dispatch(encoder, this.pyramidPipeline, pyrBG, dim.w, dim.h);
    }

    // First frame — no previous to compare
    if (this.frameIndex === 0) {
      this.device.queue.submit([encoder.finish()]);
      this.frameIndex++;
      return {
        totalMotion: 0, globalMotion: 0, localMotion: 0,
        isSceneCut: false, dominantDirection: 0, directionCoherence: 0,
      };
    }

    // 3. Clear stats
    const clearBG = this.device.createBindGroup({
      layout: this.clearStatsLayout,
      entries: [{ binding: 0, resource: { buffer: this.statsBuffer } }],
    });
    const clearPass = encoder.beginComputePass();
    clearPass.setPipeline(this.clearStatsPipeline);
    clearPass.setBindGroup(0, clearBG);
    clearPass.dispatchWorkgroups(1);
    clearPass.end();

    const previousPyramid = this.pyramidTextures[previousIdx];

    // 4. Coarse-to-fine: process pyramid levels from coarsest to finest
    for (let level = PYRAMID_LEVELS - 1; level >= 0; level--) {
      const dim = this.levelDims[level]!;

      // Spatial gradients on current pyramid level
      const spatialBG = this.device.createBindGroup({
        layout: this.spatialGradLayout,
        entries: [
          { binding: 0, resource: currentPyramid[level]!.createView() },
          { binding: 1, resource: this.gradIxTextures[level]!.createView() },
          { binding: 2, resource: this.gradIyTextures[level]!.createView() },
        ],
      });
      this.dispatch(encoder, this.spatialGradPipeline, spatialBG, dim.w, dim.h);

      // Temporal gradient
      const temporalBG = this.device.createBindGroup({
        layout: this.temporalGradLayout,
        entries: [
          { binding: 0, resource: currentPyramid[level]!.createView() },
          { binding: 1, resource: previousPyramid[level]!.createView() },
          { binding: 2, resource: this.gradItTextures[level]!.createView() },
        ],
      });
      this.dispatch(encoder, this.temporalGradPipeline, temporalBG, dim.w, dim.h);

      // Lucas-Kanade
      const hasPrevFlow = level < PYRAMID_LEVELS - 1 ? 1 : 0;
      const prevFlowLevel = Math.min(level + 1, PYRAMID_LEVELS - 1);
      const lkData = new ArrayBuffer(16);
      new Int32Array(lkData, 0, 1)[0] = LK_WINDOW_RADIUS;
      new Float32Array(lkData, 4, 1)[0] = LK_MIN_EIGENVALUE;
      new Float32Array(lkData, 8, 1)[0] = 2.0;
      new Uint32Array(lkData, 12, 1)[0] = hasPrevFlow;
      this.device.queue.writeBuffer(this.lkParamsBuffer, 0, lkData);

      const lkBG = this.device.createBindGroup({
        layout: this.lucasKanadeLayout,
        entries: [
          { binding: 0, resource: this.gradIxTextures[level]!.createView() },
          { binding: 1, resource: this.gradIyTextures[level]!.createView() },
          { binding: 2, resource: this.gradItTextures[level]!.createView() },
          { binding: 3, resource: this.flowTextures[level]!.createView() },
          { binding: 4, resource: this.flowTextures[prevFlowLevel]!.createView() },
          { binding: 5, resource: { buffer: this.lkParamsBuffer } },
        ],
      });
      this.dispatch(encoder, this.lucasKanadePipeline, lkBG, dim.w, dim.h);
    }

    // 5. Compute flow statistics on finest level
    const statsBG = this.device.createBindGroup({
      layout: this.flowStatsLayout,
      entries: [
        { binding: 0, resource: this.flowTextures[0]!.createView() },
        { binding: 1, resource: { buffer: this.statsBuffer } },
        { binding: 2, resource: { buffer: this.statsParamsBuffer } },
      ],
    });
    this.dispatch(encoder, this.flowStatsPipeline, statsBG, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);

    // 6. Copy stats to staging
    encoder.copyBufferToBuffer(this.statsBuffer, 0, this.stagingBuffer, 0, STATS_BUFFER_SIZE);

    this.device.queue.submit([encoder.finish()]);

    // 7. Readback and classify
    await this.stagingBuffer.mapAsync(GPUMapMode.READ);
    const data = new Uint32Array(this.stagingBuffer.getMappedRange().slice(0));
    this.stagingBuffer.unmap();

    const result = this.classifyMotion(data);
    this.frameIndex++;
    return result;
  }

  private classifyMotion(data: Uint32Array): MotionResult {
    const sumMag = data[0] ?? 0;
    const pixelCount = data[3] ?? 0;

    if (pixelCount === 0) {
      return {
        totalMotion: 0, globalMotion: 0, localMotion: 0,
        isSceneCut: false, dominantDirection: 0, directionCoherence: 0,
      };
    }

    const totalMotion = (sumMag / pixelCount) / 1000;

    // Direction histogram (bins at indices 4-11)
    const bins: number[] = [];
    for (let i = 0; i < 8; i++) {
      bins.push(data[4 + i] ?? 0);
    }
    const totalBins = bins.reduce((a, b) => a + b, 0);
    const maxBin = Math.max(...bins);
    const maxBinIndex = bins.indexOf(maxBin);

    const dominantDirection = (maxBinIndex * 45 + 22.5) % 360;
    const directionCoherence = totalBins > 0 ? maxBin / totalBins : 0;

    const isGlobal = directionCoherence > COHERENCE_GLOBAL_THRESHOLD;
    const globalMotion = isGlobal ? totalMotion : totalMotion * directionCoherence;
    const localMotion = totalMotion - globalMotion;

    return {
      totalMotion,
      globalMotion,
      localMotion,
      isSceneCut: totalMotion > SCENE_CUT_THRESHOLD,
      dominantDirection,
      directionCoherence,
    };
  }

  /**
   * Analyze a sequence of frames with progress callback.
   */
  async analyzeSequence(
    frames: ImageBitmap[],
    onProgress?: (index: number, result: MotionResult) => void,
  ): Promise<MotionResult[]> {
    const results: MotionResult[] = [];
    for (let i = 0; i < frames.length; i++) {
      const result = await this.analyzeFrame(frames[i]!);
      results.push(result);
      onProgress?.(i, result);
    }
    return results;
  }

  destroy(): void {
    if (!this.initialized) return;

    this.inputTexture.destroy();
    for (const t of this.grayscaleTextures) t.destroy();
    for (const frame of this.pyramidTextures) {
      for (const t of frame) t.destroy();
    }
    for (const t of this.gradIxTextures) t.destroy();
    for (const t of this.gradIyTextures) t.destroy();
    for (const t of this.gradItTextures) t.destroy();
    for (const t of this.flowTextures) t.destroy();
    this.statsBuffer.destroy();
    this.stagingBuffer.destroy();
    this.lkParamsBuffer.destroy();
    this.statsParamsBuffer.destroy();
    this.initialized = false;
  }
}
